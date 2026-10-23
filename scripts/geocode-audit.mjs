#!/usr/bin/env node
/**
 * 一次性坐标核正脚本（不进构建产物：dist 只打包 src/，scripts/ 不参与 build）
 *
 * 作用：遍历 src/data/guides.js 中全部 drive / hike 路线点，逐点调用腾讯位置服务
 *      地点检索 /ws/place/v1/search（keyword=点名、boundary=region(所属城市)），
 *      取「名称最相近且位于该市域内」的首个 POI 与现坐标比对：
 *        · 偏差 ≤ 15 km 且名称相符 → 以 POI 坐标回写 guides.js
 *        · 偏差 > 15 km / 检索无结果 / 名称对不上 → 只列清单，不自动改
 *      最后产出 test/geocode-baseline.json（城市→路线→点名→{lng,lat} 全量表）。
 *
 * 用法：
 *   node scripts/geocode-audit.mjs                 # 只核正 + 打印报告（不改文件）
 *   node scripts/geocode-audit.mjs --write         # 回写 guides.js 并生成 baseline
 *   node scripts/geocode-audit.mjs --baseline-only  # 不联网，用当前坐标重生成 baseline
 *
 * 安全：Key 只从 src/config.js 读取，任何输出都不打印 Key。
 * 配额：status 121（日配额超限）/ 110 / 111 / 112 / 199 等致命错误立即停止并回报进度，不重试硬闯。
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { GUIDES } from '../src/data/guides.js';
import { CONFIG } from '../src/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDES_PATH = path.join(ROOT, 'src/data/guides.js');
const BASELINE_PATH = path.join(ROOT, 'test/geocode-baseline.json');
// 检索结果断点缓存（不进 git）：配额中断后可续跑，不必从头再查
const CACHE_PATH = path.join(ROOT, '.geocode-cache.json');

const MAX_DEV_KM = 15;   // 自动修正阈值
const MAX_SEG_KM = 200;  // 相邻段直线距离上限
const QPS_GAP = 180;     // 请求间隔 ms（个人 Key QPS 有限，稳妥起见串行）
const FATAL_STATUS = new Set([110, 111, 112, 113, 121, 199]);

const WRITE = process.argv.includes('--write');
const SELF_TEST = process.argv.includes('--self-test');
const BASELINE_ONLY = process.argv.includes('--baseline-only');
// 干跑抽样：--limit=20 只查前 20 个点（仅用于调试脚本，不写文件）
const LIMIT = (() => {
  const hit = process.argv.find(s => s.startsWith('--limit='));
  return hit ? Number(hit.split('=')[1]) || 0 : 0;
})();

/* ---------------- 基础工具 ---------------- */
const R = 6371.0088;
function haversine(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180, lb = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 名称归一：去空格/括号/连接符，便于比较 */
function normName(s) {
  return String(s || '')
    .replace(/[（）()【】\[\]·・\-—_\s]/g, '')
    .replace(/[，,。.]/g, '');
}

/** 行政名归一：去掉 市/地区/自治州/盟/特别行政区 等后缀，取核心名 */
function normRegion(s) {
  return String(s || '')
    .replace(/(特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|自治州|地区|省|市|盟|县)$/g, '')
    .replace(/\s/g, '');
}

/** 最长公共子序列长度 */
function lcs(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

/** 名称相似度 0~1：相等 1；包含关系按长度比；否则 LCS 比例 */
function nameSim(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) {
    return Math.min(x.length, y.length) / Math.max(x.length, y.length);
  }
  return (2 * lcs(x, y)) / (x.length + y.length);
}

const NAME_SUFFIX = /(风景区|景区|旅游区|度假区|博物院|博物馆|纪念馆|公园|古镇|老街|步行街|广场|索道|车站|机场|观景台|游客中心)$/;
function stripSuffix(s) { return s.replace(NAME_SUFFIX, ''); }

/**
 * 名称是否对得上：完全一致 / 一方是另一方的前缀（故宫 ⊂ 故宫博物院）/ 去后缀后前缀命中
 * 「蓟州城区」vs「蓟州区城区路灯管理所」这类错位不算相符
 */
function nameMatch(keyword, title) {
  const k = normName(keyword), t = normName(title);
  if (!k || !t) return false;
  if (k === t) return true;
  if (t.startsWith(k) || k.startsWith(t)) return true;
  const ks = stripSuffix(k), ts = stripSuffix(t);
  if (ks && ts && (ts.startsWith(ks) || ks.startsWith(ts))) return true;
  return nameSim(k, t) >= 0.75;
}

/** 排序分：精确 1 > 前缀（越接近越长尾越短）> LCS 相似度 */
function nameScore(keyword, title) {
  const k = normName(keyword), t = normName(title);
  if (!k || !t) return 0;
  if (k === t) return 1;
  if (t.startsWith(k)) return Math.max(0.62, 0.95 - (t.length - k.length) * 0.02);
  if (k.startsWith(t)) return Math.max(0.62, 0.95 - (k.length - t.length) * 0.02);
  return nameSim(k, t) * 0.9;
}

/** 点位是否落在该市域内（boundary 已限 region，这里再用 ad_info 兜一道） */
function inCity(poi, city) {
  const ad = poi.ad_info || {};
  const c = normRegion(ad.city);
  if (c) {
    const base = normRegion(city.name);
    return c === base || c.includes(base) || base.includes(c);
  }
  const p = normRegion(ad.province);
  if (p) {
    const provBase = normRegion(city.prov);
    return p === provBase || provBase.includes(p) || p.includes(provBase);
  }
  return true; // 无行政信息时信任 region 边界
}

/* ---------------- 腾讯地点检索 ---------------- */
function searchOnce(keyword, region) {
  return new Promise(resolve => {
    const q = new URLSearchParams({
      keyword,
      boundary: `region(${region},0)`,
      page_size: '10',
      key: CONFIG.tmapKey
    });
    const req = https.get(
      `https://apis.map.qq.com/ws/place/v1/search?${q.toString()}`,
      { timeout: 10000 },
      res => {
        let buf = '';
        res.on('data', d => { buf += d; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(buf); } catch (e) { json = null; }
          if (!json) return resolve({ net: true, status: res.statusCode, data: [] });
          resolve({ net: false, status: json.status, message: json.message, data: json.data || [] });
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ net: true, status: -1, data: [] }); });
    req.on('error', () => resolve({ net: true, status: -2, data: [] }));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 单点检索；返回 { fatal, reason, hit } */
async function searchPoint(keyword, city, origin) {
  let r = await searchOnce(keyword, city.name);
  if (r.net) { // 网络抖动：退避重试一次（配额错误不走这里）
    await sleep(800);
    r = await searchOnce(keyword, city.name);
    if (r.net) return { fatal: false, reason: '网络异常', hit: null };
  }
  if (r.status === 120) { // 每秒请求过多 → 降速重试一次
    await sleep(1200);
    r = await searchOnce(keyword, city.name);
  }
  if (FATAL_STATUS.has(r.status)) {
    return { fatal: true, reason: `status ${r.status}${r.message ? ' ' + r.message : ''}`, hit: null };
  }
  if (r.status !== 0 || !r.data.length) return { fatal: false, reason: '无结果', hit: null };

  let best = null;
  for (const poi of r.data) {
    if (!inCity(poi, city)) continue;
    const loc = poi.location || {};
    if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') continue;
    const score = nameScore(keyword, poi.title);
    const dist = origin ? haversine(origin, { lat: loc.lat, lng: loc.lng }) : 0;
    if (!best || score > best.score || (score === best.score && dist < best.dist)) {
      best = { poi, score, dist };
    }
  }
  if (!best) return { fatal: false, reason: '市域内无匹配 POI', hit: null };
  return {
    fatal: false,
    reason: '',
    hit: {
      title: best.poi.title, lng: best.poi.location.lng, lat: best.poi.location.lat,
      score: best.score, nameOk: nameMatch(keyword, best.poi.title)
    }
  };
}

/* ---------------- 采集任务 ---------------- */
function buildTasks() {
  const tasks = [];
  for (const cityName of Object.keys(GUIDES)) {
    const g = GUIDES[cityName];
    const city = { name: cityName, prov: g.prov };
    for (const kind of ['drive', 'hike']) {
      (g[kind] || []).forEach(route => {
        (route.points || []).forEach((p, i) => {
          tasks.push({
            city, cityName, kind, routeName: route.n, idx: i, name: p.n,
            lng: p.lng, lat: p.lat
          });
        });
      });
    }
  }
  return tasks;
}

/* ---------------- guides.js 回写（按城市块 + 出现顺序精确替换） ---------------- */
function fmtCoord(v) {
  const s = Number(v).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

function writeBackGuides(fixes, file = GUIDES_PATH) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  // 城市块：行首两个空格 + '城市名': G(
  const cityStart = {};
  lines.forEach((line, i) => {
    const m = line.match(/^  '([^']+)': G\(/);
    if (m && GUIDES[m[1]]) cityStart[m[1]] = i;
  });

  const cities = Object.keys(cityStart).sort((a, b) => cityStart[a] - cityStart[b]);
  let out = src;

  // 从后往前替换，避免偏移错乱
  for (let ci = cities.length - 1; ci >= 0; ci--) {
    const cityName = cities[ci];
    const startLine = cityStart[cityName];
    const endLine = ci + 1 < cities.length ? cityStart[cities[ci + 1]] : lines.length;
    const blockStart = lines.slice(0, startLine).join('\n').length + (startLine ? 1 : 0);
    const blockEnd = lines.slice(0, endLine).join('\n').length + (endLine ? 1 : 0);
    const block = out.slice(blockStart, blockEnd);

    // 该城市按 drive → hike 顺序记点
    const expected = [];
    const g = GUIDES[cityName];
    for (const kind of ['drive', 'hike']) {
      (g[kind] || []).forEach(route => {
        (route.points || []).forEach((p, i) => expected.push({ kind, route: route.n, idx: i, n: p.n }));
      });
    }

    const re = /\{ n: '([^']*)', lng: ([-\d.]+), lat: ([-\d.]+) \}/g;
    const hits = [];
    let m;
    while ((m = re.exec(block)) !== null) {
      hits.push({ n: m[1], lng: +m[2], lat: +m[3], start: m.index, end: m.index + m[0].length });
    }
    if (hits.length !== expected.length) {
      throw new Error(`[回写中止] ${cityName} 点位数不一致：文件 ${hits.length} / 数据 ${expected.length}`);
    }
    for (let i = 0; i < hits.length; i++) {
      if (hits[i].n !== expected[i].n) {
        throw new Error(`[回写中止] ${cityName} 第 ${i + 1} 个点名错位：文件「${hits[i].n}」/ 数据「${expected[i].n}」`);
      }
    }

    let newBlock = '';
    let cursor = 0;
    for (let i = 0; i < hits.length; i++) {
      const key = `${cityName}|${expected[i].kind}|${expected[i].route}|${expected[i].idx}`;
      const fix = fixes[key];
      if (!fix) continue;
      newBlock += block.slice(cursor, hits[i].start);
      newBlock += `{ n: '${hits[i].n}', lng: ${fmtCoord(fix.lng)}, lat: ${fmtCoord(fix.lat)} }`;
      cursor = hits[i].end;
    }
    newBlock += block.slice(cursor);
    if (newBlock !== block) out = out.slice(0, blockStart) + newBlock + out.slice(blockEnd);
  }

  fs.writeFileSync(file, out, 'utf8');
  return Object.keys(fixes).length;
}

/* ---------------- baseline ---------------- */
function buildBaseline(coordMap) {
  const cities = {};
  for (const cityName of Object.keys(GUIDES)) {
    const g = GUIDES[cityName];
    const entry = {};
    for (const kind of ['drive', 'hike']) {
      const routes = {};
      (g[kind] || []).forEach(route => {
        routes[route.n] = (route.points || []).map((p, i) => {
          const key = `${cityName}|${kind}|${route.n}|${i}`;
          const c = coordMap && coordMap[key] ? coordMap[key] : { lng: p.lng, lat: p.lat };
          return { n: p.n, lng: c.lng, lat: c.lat };
        });
      });
      if (Object.keys(routes).length) entry[kind] = routes;
    }
    cities[cityName] = entry;
  }
  return {
    version: '1.5.2',
    note: '坐标核正基线：guides.js 全部 drive/hike 路线点的权威坐标，headless 逐点比对防回退',
    source: '腾讯位置服务 /ws/place/v1/search（keyword=点名，boundary=region(所属城市)）',
    generatedAt: new Date().toISOString(),
    maxSegmentKm: MAX_SEG_KM,
    cities,
    exemptions: []
  };
}

/** 相邻段直线距离核验，超过 200km 的记录待人工确认（不自动豁免） */
function checkSegments(coordMap) {
  const bad = [];
  for (const cityName of Object.keys(GUIDES)) {
    const g = GUIDES[cityName];
    for (const kind of ['drive', 'hike']) {
      (g[kind] || []).forEach(route => {
        const pts = (route.points || []).map((p, i) => {
          const key = `${cityName}|${kind}|${route.n}|${i}`;
          return coordMap && coordMap[key] ? { ...p, ...coordMap[key] } : p;
        });
        for (let i = 0; i < pts.length - 1; i++) {
          const km = haversine(pts[i], pts[i + 1]);
          if (km > MAX_SEG_KM) {
            bad.push({ city: cityName, kind, route: route.n, i, from: pts[i].n, to: pts[i + 1].n, km: +km.toFixed(1) });
          }
        }
      });
    }
  }
  return bad;
}

/**
 * 自检：不联网，用一份临时副本验证「按城市块 + 出现顺序精确替换」不会改错点
 * 只把北京「京北长城环线」第 1 点纬度 +0.01，其余必须逐字不变
 */
function selfTest() {
  const tmp = path.join(ROOT, '.tmp-guides-selftest.js');
  fs.copyFileSync(GUIDES_PATH, tmp);
  const before = fs.readFileSync(GUIDES_PATH, 'utf8');
  const n = writeBackGuides({ '北京|drive|京北长城环线|0': { lng: 116.4, lat: 39.93 } }, tmp);
  const after = fs.readFileSync(tmp, 'utf8');
  const a = before.split('\n'), b = after.split('\n');
  const changed = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) changed.push(i + 1);
  const ok = n === 1 && changed.length === 1 &&
    after.includes("{ n: '故宫', lng: 116.4, lat: 39.93 }") &&
    !after.includes("{ n: '故宫', lng: 116.4, lat: 39.92 }");
  fs.unlinkSync(tmp);
  console.log(`[自检] 修改点位 ${n} 个，变动行 ${changed.join(',') || '无'}`);
  console.log(ok ? '[自检] 通过：只改了目标点，其余逐字未动' : '[自检] 失败：替换越界');
  if (!ok) process.exitCode = 5;
}

/* ------------------------------- 主流程 ------------------------------- */
/**
 * 相邻段 > 200km 的显式豁免理由（跨市域长途自驾 / 环线必经段）
 * key 格式：城市|kind|路线|起点→终点
 */
const EXEMPT_REASONS = {
  '长春|drive|长白山方向|伪满皇宫→长白山北坡':
    '长白山北坡位于延边州安图县一侧，距长春市区单程约 270km，本线按两日往返设计，属跨市域长途段',
  '武汉|drive|长江三峡方向|黄鹤楼→三峡大坝':
    '三峡坝区在宜昌，距武汉约 320km，本线为跨市三至四日行程，非单日可往返',
  '贵阳|drive|黔中山水线|黄果树瀑布→荔波小七孔':
    '黄果树在安顺、小七孔在黔南荔波，跨两个市州，本线按三至四日串联',
  '西安|drive|关中线|华山→法门寺':
    '华山在渭南华阴、法门寺在宝鸡扶风，东西横穿关中平原，属跨市一日长途',
  '伊犁哈萨克自治州|drive|河谷草原环线|伊宁→那拉提':
    '那拉提在新源县东部，沿巩乃斯河谷东行约 230km，本线按两日环线设计'
};

/** 组装基线：坐标表 + 豁免清单（无理由的豁免留空，headless 会拦下） */
function finishBaseline(coordMap) {
  const baseline = buildBaseline(coordMap);
  baseline.exemptions = checkSegments(coordMap).map(s => ({
    ...s,
    reason: EXEMPT_REASONS[`${s.city}|${s.kind}|${s.route}|${s.from}→${s.to}`] || ''
  }));
  return baseline;
}async function main() {
  if (SELF_TEST) { selfTest(); return; }
  if (BASELINE_ONLY) {
    const baseline = finishBaseline(null);
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
    console.log(`[baseline-only] 已按当前 guides.js 生成 ${Object.keys(baseline.cities).length} 城基线，豁免 ${baseline.exemptions.length} 段`);
    const missing = baseline.exemptions.filter(e => !e.reason);
    if (missing.length) {
      console.error('[注意] 以下超 200km 段缺豁免理由，headless 将失败：');
      missing.forEach(e => console.error(`  ${e.city} / ${e.kind}「${e.route}」${e.from}→${e.to} ${e.km}km`));
      process.exitCode = 4;
    }
    return;
  }
  if (!CONFIG.tmapKey) {
    console.error('[中止] src/config.js 未配置 tmapKey，无法核正。');
    process.exit(2);
  }

  const tasks = LIMIT && !WRITE ? buildTasks().slice(0, LIMIT) : buildTasks();
  console.log(`[核正] 待查 ${tasks.length} 个路线点（drive+hike）`);

  const results = [];
  const hitCache = new Map();   // 同名同城复用检索结果，省配额
  // 断点续跑：读入上次已查到的点位结果
  let cachedCount = 0;
  try {
    const saved = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    for (const [k, v] of Object.entries(saved)) { hitCache.set(k, v); cachedCount++; }
  } catch (e) { /* 无缓存首次运行 */ }
  if (cachedCount) console.log(`[续跑] 命中本地缓存 ${cachedCount} 个点位，本次只查剩余部分`);
  const flushCache = () => {
    try {
      fs.writeFileSync(CACHE_PATH, JSON.stringify(Object.fromEntries(hitCache), null, 0), 'utf8');
    } catch (e) { /* 缓存写失败不影响主流程 */ }
  };
  let done = 0;
  for (const t of tasks) {
    const ck = `${t.cityName}|${t.name}`;
    if (hitCache.has(ck)) {
      const c = hitCache.get(ck);
      results.push({ ...t, hit: c.hit, reason: c.reason });
      done++;
      continue;
    }
    const r = await searchPoint(t.name, t.city, { lat: t.lat, lng: t.lng });
    if (r.fatal) {
      flushCache();
      console.error(`\n[立即停止] 腾讯接口返回致命状态：${r.reason}`);
      console.error(`[进度] 已完成 ${done}/${tasks.length} 个点；已查结果写入 .geocode-cache.json，未改动 guides.js。`);
      process.exit(3);
    }
    hitCache.set(ck, { hit: r.hit, reason: r.reason });
    results.push({ ...t, hit: r.hit, reason: r.reason });
    done++;
    if (done % 50 === 0) console.log(`   ... 已核 ${done}/${tasks.length}`);
    if (done % 20 === 0) flushCache();
    await sleep(QPS_GAP);
  }

  flushCache();
  const fixes = {};   // key → {lng,lat}
  const manual = [];
  for (const r of results) {
    if (!r.hit) {
      manual.push({ ...r, poiText: '—', dev: null, why: r.reason || '无结果' });
      continue;
    }
    const dev = haversine({ lat: r.lat, lng: r.lng }, { lat: r.hit.lat, lng: r.hit.lng });
    const nameOk = r.hit.nameOk;
    if (nameOk && dev <= MAX_DEV_KM) {
      fixes[`${r.cityName}|${r.kind}|${r.routeName}|${r.idx}`] = { lng: r.hit.lng, lat: r.hit.lat };
      r.applied = true;
      r.devKm = +dev.toFixed(2);
    } else {
      manual.push({
        ...r, poiText: `${r.hit.title}（${r.hit.lng},${r.hit.lat}）`,
        dev: +dev.toFixed(2),
        why: nameOk ? `偏差 ${dev.toFixed(1)}km > ${MAX_DEV_KM}km` : `名称不符（「${r.hit.title}」score ${r.hit.score.toFixed(2)}）`
      });
    }
  }

  const coordMap = {};
  for (const r of results) {
    const key = `${r.cityName}|${r.kind}|${r.routeName}|${r.idx}`;
    coordMap[key] = fixes[key] || { lng: r.lng, lat: r.lat };
  }

  const segBad = checkSegments(coordMap);

  console.log('\n===== 核正结果 =====');
  console.log(`点位总数        ${results.length}`);
  console.log(`自动修正        ${Object.keys(fixes).length}`);
  console.log(`待人工          ${manual.length}`);
  console.log(`相邻段>${MAX_SEG_KM}km  ${segBad.length}`);

  if (manual.length) {
    console.log('\n----- 待人工清单（城市/路线/点名/现坐标/检索坐标/偏差）-----');
    for (const m of manual) {
      const cur = `${m.lng},${m.lat}`;
      console.log(`${m.cityName} / ${m.kind === 'drive' ? '自驾' : '徒步'}「${m.routeName}」/ ${m.name} / ${cur} / ${m.poiText} / ${m.dev === null ? '—' : m.dev + 'km'} / ${m.why}`);
    }
  }
  if (segBad.length) {
    console.log('\n----- 相邻段超 200km -----');
    for (const s of segBad) console.log(`${s.city} / ${s.kind}「${s.route}」#${s.i} ${s.from} → ${s.to} ${s.km}km`);
  }

  if (!WRITE) {
    console.log('\n[干跑] 未写任何文件；确认无误后加 --write 执行回写与基线生成。');
    return;
  }

  const n = writeBackGuides(fixes);
  console.log(`\n[回写] guides.js 已更新 ${n} 个点坐标`);

  const baseline = finishBaseline(coordMap);
  baseline.manualReview = manual.map(m => ({
    city: m.cityName, kind: m.kind, route: m.routeName, point: m.name,
    current: { lng: m.lng, lat: m.lat }, why: m.why
  }));
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  console.log(`[基线] 已写入 test/geocode-baseline.json（${Object.keys(baseline.cities).length} 城 / ${results.length} 点）`);
}

main().catch(e => { console.error('[异常]', e.message); process.exit(1); });
