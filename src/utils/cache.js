/**
 * 攻略离线缓存：浏览过的城市详情自动缓存到 Storage，无网也能看。
 * 优先级：内存缓存 > 本地 Storage > 内置内容库 / 云数据库。
 */
const KEY = 'tf_guide_cache_v1';

let mem = null;

function loadAll() {
  if (mem) return mem;
  try { mem = uni.getStorageSync(KEY) || {}; } catch (e) { mem = {}; }
  return mem;
}

export function cacheGuide(cityName, guide) {
  const all = loadAll();
  all[cityName] = { guide, at: Date.now() };
  try { uni.setStorageSync(KEY, all); } catch (e) {}
  mem = all;
}

export function readCache(cityName) {
  const hit = loadAll()[cityName];
  return hit ? hit.guide : null;
}

export function cacheCount() { return Object.keys(loadAll()).length; }

export function clearCache() {
  mem = {};
  try { uni.removeStorageSync(KEY); } catch (e) {}
}

export default { cacheGuide, readCache, cacheCount, clearCache };
