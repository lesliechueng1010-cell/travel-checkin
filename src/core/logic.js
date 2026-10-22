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
