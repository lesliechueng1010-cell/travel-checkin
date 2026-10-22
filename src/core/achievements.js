/**
 * 成就徽章 —— 纯本地规则，不依赖云端、不虚构任何数据
 * 解锁判定与解锁日期全部由本地打卡数据推导，不额外存状态（老数据天然兼容）
 */
import { CITIES, PROVINCES, CITY_MAP, citiesOfProv } from '../data/cities.js';

/** 中国七大地理分区 */
export const REGIONS = ['华北', '东北', '华东', '华中', '华南', '西南', '西北'];

export const PROV_REGION = {
  北京市: '华北', 天津市: '华北', 河北省: '华北', 山西省: '华北', 内蒙古自治区: '华北',
  辽宁省: '东北', 吉林省: '东北', 黑龙江省: '东北',
  上海市: '华东', 江苏省: '华东', 浙江省: '华东', 安徽省: '华东', 福建省: '华东',
  江西省: '华东', 山东省: '华东', 台湾省: '华东',
  河南省: '华中', 湖北省: '华中', 湖南省: '华中',
  广东省: '华南', 广西壮族自治区: '华南', 海南省: '华南', 香港特别行政区: '华南', 澳门特别行政区: '华南',
  重庆市: '西南', 四川省: '西南', 贵州省: '西南', 云南省: '西南', 西藏自治区: '西南',
  陕西省: '西北', 甘肃省: '西北', 青海省: '西北', 宁夏回族自治区: '西北', 新疆维吾尔自治区: '西北'
};

/** 大区 → 该区所有城市名 */
export const REGION_CITIES = REGIONS.reduce((acc, r) => {
  acc[r] = CITIES.filter(c => PROV_REGION[c.prov] === r).map(c => c.name);
  return acc;
}, {});

/**
 * 徽章定义
 * kind: count（城市数）/ prov（集齐一省）/ region（踏遍一个大区）
 */
export const BADGES = [
  { id: 'city_1', icon: '🌱', title: '第一步', kind: 'count', n: 1, cond: '点亮第 1 座城市' },
  { id: 'city_10', icon: '🧭', title: '十城旅人', kind: 'count', n: 10, cond: '点亮 10 座城市' },
  { id: 'city_30', icon: '🗺️', title: '三十城行者', kind: 'count', n: 30, cond: '点亮 30 座城市' },
  { id: 'city_100', icon: '🏅', title: '百城大师', kind: 'count', n: 100, cond: '点亮 100 座城市' },
  { id: 'prov_1', icon: '🏵️', title: '一省通', kind: 'prov', cond: '集齐任意一个省级行政区的全部城市' },
  { id: 'region_1', icon: '🌄', title: '大区纵横', kind: 'region', cond: '踏遍任意一个地理大区的全部城市' }
];

/** 打卡记录按日期升序（日期为空视为未知，排在最后，仅影响「第 N 城」解锁日期） */
function sortedEntries(visitedMap) {
  return Object.keys(visitedMap)
    .filter(n => !!CITY_MAP[n])
    .map(n => {
      const v = visitedMap[n] || {};
      return { name: n, date: typeof v.date === 'string' ? v.date : '', ts: typeof v.ts === 'number' ? v.ts : 0 };
    })
    .sort((a, b) => {
      const ad = a.date || '9999', bd = b.date || '9999';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return a.ts - b.ts;
    });
}

/** 一组城市全部点亮时，取其中最晚的打卡日期作为完成日期 */
function completionDate(names, visitedMap) {
  const dates = names.map(n => (visitedMap[n] && visitedMap[n].date) || '').filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : '';
}

/**
 * 评估全部徽章
 * @param {object} visitedMap { 城市名: { date, note, ts, source } }
 * @returns {{badges: Array, unlocked: number, total: number}}
 */
export function evaluate(visitedMap = {}) {
  const entries = sortedEntries(visitedMap);
  const visitedNames = entries.map(e => e.name);
  const visitedSet = new Set(visitedNames);

  // 集齐省份
  const doneProvs = PROVINCES.filter(p => {
    const all = citiesOfProv(p);
    return all.length > 0 && all.every(c => visitedSet.has(c.name));
  });
  const doneProvDates = doneProvs
    .map(p => ({ prov: p, date: completionDate(citiesOfProv(p).map(c => c.name), visitedMap) }))
    .sort((a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : 1);
  // 进度最高（未集齐时用于展示）
  let bestProv = { prov: '', visited: 0, total: 1 };
  PROVINCES.forEach(p => {
    const all = citiesOfProv(p);
    const done = all.filter(c => visitedSet.has(c.name)).length;
    if (done > bestProv.visited && done < all.length) bestProv = { prov: p, visited: done, total: all.length };
  });

  // 踏遍大区
  const doneRegions = REGIONS.filter(r => REGION_CITIES[r].length > 0 && REGION_CITIES[r].every(n => visitedSet.has(n)));
  const doneRegionDates = doneRegions
    .map(r => ({ region: r, date: completionDate(REGION_CITIES[r], visitedMap) }))
    .sort((a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : 1);
  let bestRegion = { region: '', visited: 0, total: 1 };
  REGIONS.forEach(r => {
    const all = REGION_CITIES[r];
    const done = all.filter(n => visitedSet.has(n)).length;
    if (done > bestRegion.visited && done < all.length) bestRegion = { region: r, visited: done, total: all.length };
  });

  const badges = BADGES.map(b => {
    if (b.kind === 'count') {
      const unlocked = entries.length >= b.n;
      return {
        ...b,
        unlocked,
        date: unlocked ? entries[b.n - 1].date : '',
        progress: { cur: Math.min(entries.length, b.n), total: b.n }
      };
    }
    if (b.kind === 'prov') {
      const unlocked = doneProvDates.length > 0;
      return {
        ...b,
        unlocked,
        date: unlocked ? doneProvDates[0].date : '',
        detail: unlocked ? '首个集齐：' + doneProvDates[0].prov : '',
        progress: unlocked ? { cur: 1, total: 1 } : { cur: bestProv.visited, total: bestProv.total }
      };
    }
    const unlocked = doneRegionDates.length > 0;
    return {
      ...b,
      unlocked,
      date: unlocked ? doneRegionDates[0].date : '',
      detail: unlocked ? '首个踏遍：' + doneRegionDates[0].region : '',
      progress: unlocked ? { cur: 1, total: 1 } : { cur: bestRegion.visited, total: bestRegion.total }
    };
  });

  return { badges, unlocked: badges.filter(b => b.unlocked).length, total: badges.length };
}

export default { BADGES, PROV_REGION, REGIONS, REGION_CITIES, evaluate };
