/**
 * 核心业务逻辑（纯函数，可在 Node 环境单测）
 */
import { CITIES, PROVINCES, TOTAL_CITIES } from '../data/cities.js';
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
 * 行程里程：pairs 由外部注入的距离计算函数逐段求和
 * calc(fromCity, toCity) → Promise<{km, mode: 'driving'|'straight'}>；抛错回退直线
 */
export async function tripMileage(cityList, calc) {
  let total = 0, straightTotal = 0, mode = 'straight';
  for (let i = 0; i < cityList.length - 1; i++) {
    straightTotal += haversine(cityList[i], cityList[i + 1]);
    if (calc) {
      try {
        const r = await calc(cityList[i], cityList[i + 1]);
        if (r && r.mode === 'driving') { total += r.km; mode = 'driving'; continue; }
      } catch (e) { /* 回退直线 */ }
    }
    total += straightTotal === 0 ? 0 : haversine(cityList[i], cityList[i + 1]);
  }
  return { km: Math.round(total), mode, straightKm: Math.round(straightTotal) };
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
  return mode === 'driving' ? '驾车里程（路线规划实时计算）' : '直线估算（配置地图 Key 后显示真实驾车里程）';
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

