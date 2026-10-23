/**
 * 核心业务逻辑（纯函数，可在 Node 环境单测）
 */
import { CITIES, PROVINCES, TOTAL_CITIES, findCity } from '../data/cities.js';
import { GUIDES } from '../data/guides.js';

/** 两点球面距离（km），输入 {lng, lat} */
export function haversine(a, b) {
  const R = 6371.0088;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180, lb = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 足迹统计 */
export function stats(visitedMap) {
  const visitedNames = Object.keys(visitedMap);
  const provinces = PROVINCES.map(p => {
    const all = CITIES.filter(c => c.prov === p);
    const done = all.filter(c => visitedNames.includes(c.name));
    return { prov: p, total: all.length, visited: done.length, pct: all.length ? Math.round((done.length / all.length) * 100) : 0 };
  }).sort((a, b) => b.pct - a.pct || b.visited - a.visited);
  return {
    visitedCount: visitedNames.length,
    total: TOTAL_CITIES,
    pct: Math.round((visitedNames.length / TOTAL_CITIES) * 1000) / 10,
    provinces,
    provDone: provinces.filter(p => p.total > 0 && p.visited === p.total).length
  };
}

/**
 * 照片 GPS 就近匹配城市的阈值（直线 km）
 * 宁缺毋滥：超出阈值一律不猜，交给用户手动补录。
 */
export const GPS_MATCH_KM = 80;

/** 最近足迹：按打卡日期倒序（同日期按写入时间倒序），日期为空视为最旧 */
export function recentFootprints(visitedMap = {}, n = 5) {
  return Object.keys(visitedMap)
    .map(name => {
      const v = visitedMap[name] || {};
      return {
        name,
        date: typeof v.date === 'string' ? v.date : '',
        note: typeof v.note === 'string' ? v.note : '',
        photo: v.photo || '',
        source: v.source === 'import' ? 'import' : '',
        ts: typeof v.ts === 'number' ? v.ts : 0
      };
    })
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;   // 空字符串排最后
      return b.ts - a.ts;
    })
    .slice(0, n);
}

/**
 * 用照片坐标匹配城市：仅在 maxKm 内命中才返回，否则 null
 * @returns {{city: object, dist: number}|null}
 */
export function matchCityWithin(loc, maxKm = GPS_MATCH_KM) {
  if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return null;
  if (!isFinite(loc.lat) || !isFinite(loc.lng)) return null;
  const near = nearestCities(loc, 1, false)[0];
  if (!near) return null;
  return near.dist <= maxKm ? { city: near, dist: near.dist } : null;
}

/** 距 loc 最近的 n 个城市（可过滤未打卡） */
export function nearestCities(loc, n = 5, onlyUnvisited = false, visitedMap = {}) {
  const list = CITIES
    .filter(c => !onlyUnvisited || !visitedMap[c.name])
    .map(c => ({ ...c, dist: Math.round(haversine(loc, c)) }))
    .sort((a, b) => a.dist - b.dist);
  return list.slice(0, n);
}

/** 定位所在城市（50km 内视为"到了"，仅提示用） */
export function locateCity(loc) {
  if (!loc) return null;
  const c = nearestCities(loc, 1, false)[0];
  return c && c.dist <= 50 ? c : null;
}

/**
 * 行程里程（1.6.0 重构：全有全无 + 环线闭合段 + 分段明细）
 *
 * 分段：相邻城市段 (0→1, 1→2, ...) + （城市数 ≥ 3 时）末城→首城的闭合段。
 * calc(fromCity, toCity) → Promise<{ km, points }>，与 tmap.planRoute 的返回正好对齐。
 *
 * 契约（与详情页 1.5.2 一致）：
 *  - 全部段都成功 → mode='driving'，km = 各段道路 km 之和，legs 每项带 points；
 *  - 任一段失败 / 无 calc / calc 抛错 → 整体回退 mode='straight'，
 *    km = 各段（含闭合段）haversine 之和，legs 只含 km、无 points；
 *  - 禁止混算（不允许一段道路一段直线拼进同一个总数）。
 *
 * @returns {{km:number, mode:'driving'|'straight', straightKm:number,
 *            legs:Array<{from:string,to:string,km:number,points?:Array}>}}
 */
export async function tripMileage(cityList, calc) {
  const list = cityList || [];
  if (list.length < 2) return { km: 0, mode: 'straight', straightKm: 0, legs: [] };

  // 1) 分段定义：相邻段 + 闭合段（≥3 城才闭回起点，名副其实的环线）
  const pairs = [];
  for (let i = 0; i < list.length - 1; i++) pairs.push([list[i], list[i + 1]]);
  if (list.length >= 3) pairs.push([list[list.length - 1], list[0]]);

  // 2) 直线兜底（含闭合段），无论是否走道路线都算，供 straightKm 与回退共用
  const straightLegs = pairs.map(([a, b]) => ({
    from: a.name, to: b.name, km: Math.round(haversine(a, b))
  }));
  // 与分段列表逐行相加严格相等（避免总数与列表差 1km 的观感问题）
  const straightKm = straightLegs.reduce((s, l) => s + l.km, 0);

  // 3) 全有：逐段规划，任一段不达标立即整体放弃（不留半真半假的线）
  if (calc) {
    const acc = [];
    let ok = true;
    for (const [a, b] of pairs) {
      let r = null;
      try { r = await calc(a, b); } catch (e) { r = null; }
      if (!r || typeof r.km !== 'number' || !Array.isArray(r.points) || !r.points.length) {
        ok = false;
        break;
      }
      acc.push({ from: a.name, to: b.name, km: Math.round(r.km), points: r.points });
    }
    if (ok && acc.length === pairs.length) {
      return {
        km: acc.reduce((s, l) => s + l.km, 0),
        mode: 'driving',
        straightKm,
        legs: acc
      };
    }
  }

  // 4) 全无：整体回退直线（legs 不带 points，避免下游误画）
  return { km: straightKm, mode: 'straight', straightKm, legs: straightLegs };
}

/** 建议天数：城市建议天数之和 + 按每天驾驶 500km 估算的赶路天数 */
export function suggestDays(cityList, mileageKm) {
  const cityDays = cityList.reduce((s, c) => {
    const g = GUIDES[c.name];
    return s + (g ? g.days || 1 : 1);
  }, 0);
  const driveDays = Math.ceil(mileageKm / 500);
  return { cityDays, driveDays, total: cityDays + driveDays };
}

/** 里程展示文案（红线：未配置 Key 只能显示直线估算，并明确标注） */
export function kmLabel(mode) {
  if (mode === 'driving') return '驾车里程（路线规划实时计算）';
  if (mode === 'walking') return '步行里程（步行路线实时计算）';
  return '直线距离估算';
}

export function fmtKm(km) { return km >= 10000 ? (km / 10000).toFixed(1) + ' 万 km' : km + ' km'; }

/* ============================================================
 * 1.4.0 想去页空状态：正当时令 / 抽卡机
 * 纯函数，全部可在 Node 无头测试（不依赖 uni / DOM）
 * ============================================================ */

/** 单个季节段落是否命中某月；无法解析返回 false */
function seasonSegmentMatch(seg, month) {
  const t = String(seg || '').trim();
  if (!t) return false;
  const crossYear = /次年|翌年|跨年/.test(t);
  const nums = (t.match(/\d{1,2}/g) || [])
    .map(Number)
    .filter(n => n >= 1 && n <= 12);
  if (!nums.length) return false;
  if (nums.length === 1) return nums[0] === month;
  const a = nums[0], b = nums[1];
  // 明确「次年」或起点大于终点，视为跨年区间（如 10-4 月、12-2 月）
  if (crossYear || a > b) return month >= a || month <= b;
  return month >= a && month <= b;
}

/**
 * 攻略 season 字段是否覆盖某月。
 * 支持：区间「3-5月」、单月「6月」、跨年「10-4月 / 12-2月 / 10月-次年4月」、
 *       恒匹配「全年 / 四季皆宜」；括号补充说明里的月份不参与匹配；无法解析 → false。
 */
export function seasonMatch(seasonStr, month) {
  if (typeof seasonStr !== 'string') return false;
  const m = Number(month);
  if (!Number.isFinite(m) || m < 1 || m > 12) return false;
  const s = seasonStr.trim();
  if (!s) return false;
  if (/全年|四季皆宜|四季|全年皆宜/.test(s)) return true;
  // 去掉括号（中英文），避免「（菊花花期在10-11月）」这类说明里的月份被误算
  const cleaned = s.replace(/[（(][^）)]*[）)]/g, '');
  const parts = cleaned.split(/[、，,；;]/).map(x => x.trim()).filter(Boolean);
  return parts.some(p => seasonSegmentMatch(p, m));
}

/**
 * 抽卡池：未打卡城市名数组。
 * 优先只放有攻略的 99 城；仅当这 99 城全部打卡后，才扩到全部未打卡城市。
 */
export function drawPool(visitedMap = {}) {
  const visited = visitedMap || {};
  const guideUnvisited = Object.keys(GUIDES).filter(n => !visited[n]);
  if (guideUnvisited.length) return guideUnvisited;
  return CITIES.filter(c => !visited[c.name]).map(c => c.name);
}

/**
 * 正当时令：GUIDES 中 seasonMatch 为真且未打卡的城市名，按数据顺序取前 n（默认 10）。
 */
export function seasonalCities(month, visitedMap = {}, n = 10) {
  const visited = visitedMap || {};
  return Object.keys(GUIDES)
    .filter(name => !visited[name] && seasonMatch(GUIDES[name].season, month))
    .slice(0, n);
}

/* ============================================================
 * 1.5.0 足迹报告：时间序 / 里程 / 探索度 / 四极 / 最长段 / 跨度
 * 纯函数，全部可在 Node 无头测试（不依赖 uni / DOM）
 * 数据红线：只用本地打卡数据与 cities.js 坐标，不编造任何外部指标
 * ============================================================ */

/** 打卡时间戳：ts 优先；缺失用 date 兜底；再缺记 0（视为最旧） */
function visitTs(v) {
  if (v && typeof v.ts === 'number' && Number.isFinite(v.ts)) return v.ts;
  const d = v && typeof v.date === 'string' ? v.date.trim() : '';
  if (d) {
    const t = Date.parse(d.length <= 10 ? d + 'T00:00:00' : d);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

/** 已打卡城市按打卡时间升序（同时间按名称稳定排序）；含 name/prov/lng/lat/ts */
export function visitedChrono(visitedMap = {}) {
  const map = visitedMap || {};
  return Object.keys(map)
    .map(name => {
      const c = findCity(name);
      return {
        name,
        prov: (c && c.prov) || '',
        lng: c ? c.lng : null,
        lat: c ? c.lat : null,
        ts: visitTs(map[name])
      };
    })
    .sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      if (a.name === b.name) return 0;
      return a.name < b.name ? -1 : 1;
    });
}

/** 有坐标的时间序城市（缺坐标的城市不参与距离计算） */
function chronoWithCoord(visitedMap) {
  return visitedChrono(visitedMap).filter(
    c => typeof c.lat === 'number' && typeof c.lng === 'number'
  );
}

/** 旅游总里程：时间序相邻两城直线距离求和取整 km；不足 2 城返回 0 */
export function travelMileage(visitedMap = {}) {
  const list = chronoWithCoord(visitedMap);
  if (list.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < list.length - 1; i++) sum += haversine(list[i], list[i + 1]);
  return Math.round(sum);
}

/** 探索度：已打卡数 / CITIES 总数 × 100（数值，不做四舍五入） */
export function explorePct(visitedMap = {}) {
  const n = Object.keys(visitedMap || {}).length;
  if (!n) return 0;
  return (n / TOTAL_CITIES) * 100;
}

/** 四极城市：{ north, south, east, west }（lat/lng 极值）；无数据返回 null */
export function extremeCities(visitedMap = {}) {
  const list = chronoWithCoord(visitedMap);
  if (!list.length) return null;
  let north = list[0], south = list[0], east = list[0], west = list[0];
  list.forEach(c => {
    if (c.lat > north.lat) north = c;
    if (c.lat < south.lat) south = c;
    if (c.lng > east.lng) east = c;
    if (c.lng < west.lng) west = c;
  });
  const pick = c => ({ name: c.name, prov: c.prov, lat: c.lat, lng: c.lng });
  return { north: pick(north), south: pick(south), east: pick(east), west: pick(west) };
}

/** 时间序最长相邻段 { from, to, km }；不足 2 城返回 null */
export function longestLeg(visitedMap = {}) {
  const list = chronoWithCoord(visitedMap);
  if (list.length < 2) return null;
  let best = null;
  for (let i = 0; i < list.length - 1; i++) {
    const km = haversine(list[i], list[i + 1]);
    if (!best || km > best._raw) {
      best = { from: list[i].name, to: list[i + 1].name, km: Math.round(km), _raw: km };
    }
  }
  return best ? { from: best.from, to: best.to, km: best.km } : null;
}

/** 足迹跨度天数：最晚与最早打卡的整天数差；不足 2 城返回 0 */
export function footprintSpanDays(visitedMap = {}) {
  const list = visitedChrono(visitedMap);
  if (list.length < 2) return 0;
  const first = list[0].ts;
  const last = list[list.length - 1].ts;
  const days = Math.floor((last - first) / 86400000);
  return days > 0 ? days : 0;
}

