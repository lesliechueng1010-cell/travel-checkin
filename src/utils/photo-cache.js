/**
 * 城市头图缓存层（1.6.1）
 *
 * 解决的问题：原来每次打开城市 → 云函数换临时链接 → 下载原图（≈400KB）+ 无缓存，
 * 三头慢。现在改为：
 *   1) 链接预取 —— 进地图页 2 秒后空闲时批量换回 30 城链接，点开城市不再等云函数；
 *   2) 本地文件缓存 —— 首次下载后 saveFile 到本地文件系统，二次打开零网络；
 *   3) 预下载 —— 预取后按 3 张一批、热门城市优先，把图悄悄填进缓存；
 *   4) 30MB 上限 —— 超限按 LRU 淘汰，并同步清索引，避免撑爆用户文件目录。
 *
 * 缓存键 = 城市 + PHOTO_VER：换图后 PHOTO_VER +1，索引键与目录名一起变，旧缓存自然作废。
 * 任何一步失败都只降级（直接给临时链接让 <image> 远程渲染），不阻塞详情页、不白屏。
 */
import api from '../api/index.js';
import { PHOTO_BASE, PHOTO_EXT, PHOTO_VER, CITY_PHOTOS } from '../data/photos.js';

/** 本地缓存总量上限（超出按 LRU 淘汰） */
export const MAX_BYTES = 30 * 1024 * 1024;
/** 索引 Storage key：带版本号，PHOTO_VER +1 即整批失效 */
export const IDX_KEY = 'tf_photo_idx_v' + PHOTO_VER;
/** 本地缓存目录（位于本地用户文件目录，上限 200MB，我们只用到 30MB） */
const DIR_NAME = 'tf_photo_v' + PHOTO_VER;
/** 云函数下发 30 分钟有效；前端再保守一档，缺 expireAt 时按 25 分钟算 */
const URL_TTL_MS = 25 * 60 * 1000;
/** 预下载节奏：每批张数 + 批次间隔（毫秒），不抢首屏网络 */
const BATCH = 3;
const BATCH_GAP = 260;
/** 连续这么多次下载失败就判定下载通道不可用（如未配 downloadFile 合法域名），本次启动不再重试 */
const DL_BREAK_AFTER = 3;
/** 预下载优先顺序：热门城市在前，评委/新用户最可能先点开 */
export const HOT_ORDER = [
  '重庆', '成都', '北京', '上海', '西安', '杭州', '南京', '厦门',
  '广州', '武汉', '长沙', '苏州', '青岛', '大理白族自治州', '丽江', '拉萨'
];

const idx = { loaded: false, items: {} };
const urlMap = {};          // city -> { url, exp }
const inflight = {};        // city -> Promise（防止预下载与点开同时下两次）
let boostStarted = false;
let cleaned = false;
let dlFailStreak = 0;
let dlBroken = false;       // 下载通道熔断（连续失败），置位后只走远程直出

/* ---------------- 纯逻辑（可单测，不碰文件系统） ---------------- */

/** LRU 淘汰名单：按最近使用时间升序，淘汰到总量 ≤ maxBytes 为止 */
export function pickEvict(items, maxBytes) {
  const list = Object.keys(items || {}).map(k => ({
    k, s: (items[k] && items[k].s) || 0, t: (items[k] && items[k].t) || 0
  }));
  let total = list.reduce((a, b) => a + b.s, 0);
  if (total <= maxBytes) return [];
  list.sort((a, b) => a.t - b.t);
  const out = [];
  for (let i = 0; i < list.length && total > maxBytes; i++) {
    out.push(list[i].k);
    total -= list[i].s;
  }
  return out;
}

/** 索引条目是否仍可用于该城市（版本一致 + 有路径） */
export function entryUsable(entry, ver) {
  return !!(entry && entry.p && entry.v === ver && entry.s >= 0);
}

/* ---------------- 环境适配 ---------------- */

function fsm() {
  try {
    if (typeof wx !== 'undefined' && wx.getFileSystemManager && wx.env && wx.env.USER_DATA_PATH) {
      return wx.getFileSystemManager();
    }
  } catch (e) { /* 无文件系统（H5/测试环境）：走远程直出 */ }
  return null;
}

function dirPath() {
  try { return wx.env.USER_DATA_PATH + '/' + DIR_NAME; } catch (e) { return ''; }
}

function ensureDir() {
  const f = fsm();
  const d = dirPath();
  if (!f || !d) return false;
  try { f.accessSync(d); return true; } catch (e) {}
  try { f.mkdirSync(d, true); return true; } catch (e) { return false; }
}

function fileExists(p) {
  const f = fsm();
  if (!f || !p) return false;
  try { f.accessSync(p); return true; } catch (e) { return false; }
}

function fileSize(p) {
  const f = fsm();
  if (!f || !p) return 0;
  try { return f.statSync(p).size || 0; } catch (e) { return 0; }
}

function unlink(p) {
  const f = fsm();
  if (!f || !p) return;
  try { f.unlinkSync(p); } catch (e) {}
}

/* ---------------- 索引 ---------------- */

/**
 * 版本升级后的旧缓存清理（每次启动跑一次，失败静默）：
 * PHOTO_VER +1 后旧目录里的文件不再被引用，留着白占 30MB；索引键同理。
 */
function cleanupOld() {
  if (cleaned) return;
  cleaned = true;
  const f = fsm();
  if (!f) return;
  try {
    const root = wx.env.USER_DATA_PATH;
    const names = f.readdirSync(root) || [];
    names.forEach(name => {
      const m = /^tf_photo_v(\d+)$/.exec(name);
      if (m && Number(m[1]) !== PHOTO_VER) {
        try { f.rmdirSync(root + '/' + name, true); } catch (e) {}
      }
    });
  } catch (e) { /* 不支持 readdir 的基础库就留到系统清理 */ }
  try {
    (uni.getStorageInfoSync().keys || []).forEach(k => {
      if (/^tf_photo_idx_v\d+$/.test(k) && k !== IDX_KEY) uni.removeStorageSync(k);
    });
  } catch (e) {}
}

function loadIdx() {
  if (idx.loaded) return idx.items;
  idx.loaded = true;
  cleanupOld();
  try {
    const raw = uni.getStorageSync(IDX_KEY) || {};
    const items = raw && raw.items ? raw.items : {};
    // 只保留版本一致、字段完整的条目
    Object.keys(items).forEach(k => {
      if (!entryUsable(items[k], PHOTO_VER)) delete items[k];
    });
    idx.items = items;
  } catch (e) { idx.items = {}; }
  return idx.items;
}

function saveIdx() {
  try { uni.setStorageSync(IDX_KEY, { v: PHOTO_VER, items: idx.items }); } catch (e) {}
}

/** 索引里的字节总数（用于 LRU 判断，不必逐个 stat 文件） */
export function cachedBytes() {
  const items = loadIdx();
  return Object.keys(items).reduce((a, k) => a + (items[k].s || 0), 0);
}

/** 命中本地缓存返回文件路径，未命中返回 ''（顺便刷 LRU 时间戳） */
export function getCached(city) {
  const items = loadIdx();
  const e = items[city];
  if (!entryUsable(e, PHOTO_VER)) return '';
  if (!fileExists(e.p)) {           // 文件被系统清理：索引跟着失效
    delete items[city];
    saveIdx();
    return '';
  }
  e.t = Date.now();
  saveIdx();
  return e.p;
}

/** 把下载好的临时文件存进缓存目录并写索引，随后做一次 LRU 收敛。
 *  ext 跟随云函数实际返回的档位：lite → .webp，orig（回退原图）→ .jpg，
 *  避免把 jpeg 内容存成 .webp 后缀导致个别机型解码失败。 */
function putCached(city, tempPath, knownSize, ext) {
  if (!ensureDir()) return '';
  const f = fsm();
  const meta = CITY_PHOTOS[city];
  if (!f || !meta) return '';
  const dst = dirPath() + '/' + meta.slug + (ext === '.jpg' ? '.jpg' : '.webp');
  try {
    if (fileExists(dst)) unlink(dst);
    f.saveFileSync({ srcPath: tempPath, dstPath: dst });
  } catch (e) {
    return '';
  }
  const size = knownSize || fileSize(dst);
  loadIdx()[city] = { p: dst, s: size, v: PHOTO_VER, t: Date.now() };
  saveIdx();
  enforceLimit(city);
  return dst;
}

/** 超 30MB 按 LRU 淘汰（当前城市永不淘汰），文件与索引一起清 */
export function enforceLimit(keepCity) {
  const items = loadIdx();
  const pool = {};
  Object.keys(items).forEach(k => { if (k !== keepCity) pool[k] = items[k]; });
  // 先用「全部」算出要淘汰谁，再把 keepCity 排除在淘汰候选之外重算
  const bytesAll = cachedBytes();
  if (bytesAll <= MAX_BYTES) return [];
  let evicted = pickEvict(pool, MAX_BYTES - ((items[keepCity] && items[keepCity].s) || 0));
  if (!evicted.length) return [];
  evicted.forEach(k => {
    unlink(items[k] && items[k].p);
    delete items[k];
  });
  saveIdx();
  return evicted;
}

/* ---------------- 链接 ---------------- */

/** 城市 → 云存储 fileID（cloud://<桶>/city-photos/<slug>.jpg） */
export function fileIdOf(city) {
  const m = CITY_PHOTOS[city];
  if (!PHOTO_BASE || !m || !m.slug) return '';
  return PHOTO_BASE + m.slug + PHOTO_EXT;
}

/** 取（或复用）单城临时链接条目（含命中档位与过期时间）；过期自动重取。
 *  size='orig' 单独存一份（key 加 #orig 后缀），用于 lite 图解码失败时兜底。 */
async function getEntry(city, fileID, size) {
  const sz = size === 'orig' ? 'orig' : 'lite';
  const key = sz === 'orig' ? city + '#orig' : city;
  const now = Date.now();
  const hit = urlMap[key];
  if (hit && hit.url && hit.exp > now) return hit;
  const fid = fileID || fileIdOf(city);
  if (!fid) return null;
  const info = await api.fetchPhotoInfo(fid, sz);
  if (!info) return null;
  const entry = {
    url: info.url,
    exp: Math.min(info.expireAt || 0, now + URL_TTL_MS) || now + URL_TTL_MS,
    size: info.size
  };
  urlMap[key] = entry;
  return entry;
}

/** 单城临时链接（字符串）；size 默认 lite，失败返回 '' */
export async function getUrl(city, fileID, size) {
  const e = await getEntry(city, fileID, size);
  return e ? e.url : '';
}

/**
 * 批量换链并写入内存（预取入口）。
 * 返回成功写进内存的城市数；云不可用/失败返回 0，调用方什么都不用做。
 */
export async function prefetchUrls(cities) {
  const list = (cities || []).filter(c => CITY_PHOTOS[c]);
  if (!list.length) return 0;
  const ids = list.map(fileIdOf).filter(Boolean);
  if (!ids.length) return 0;
  const r = await api.fetchPhotoUrls(ids);
  if (!r) return 0;
  const now = Date.now();
  const exp = Math.min(r.expireAt || 0, now + URL_TTL_MS) || now + URL_TTL_MS;
  let n = 0;
  list.forEach(c => {
    const fid = fileIdOf(c);
    const url = r.urls[fid];
    if (url) {
      urlMap[c] = { url, exp, size: r.sizes[fid] === 'orig' ? 'orig' : 'lite' };
      n++;
    }
  });
  return n;
}

/* ---------------- 下载 / 落盘 ---------------- */

function download(url) {
  return new Promise(resolve => {
    if (typeof uni === 'undefined' || !uni.downloadFile || !url) { resolve(null); return; }
    uni.downloadFile({
      url,
      success: res => {
        const ok = res && (res.statusCode === 200 || res.statusCode === undefined);
        resolve(ok && res.tempFilePath ? { path: res.tempFilePath, size: res.fileContentLength || 0 } : null);
      },
      fail: () => resolve(null)
    });
  });
}

/** 下载 → 存本地 → 写索引；失败返回 ''（由调用方降级为远程直出） */
async function fill(city, fileID) {
  if (dlBroken) return '';                    // 连续失败已判定下载不可用，别再白试
  const entry = await getEntry(city, fileID);
  if (!entry) return '';
  const got = await download(entry.url);
  if (!got) {
    if (++dlFailStreak >= DL_BREAK_AFTER) dlBroken = true;
    return '';
  }
  dlFailStreak = 0;
  return putCached(city, got.path, got.size, entry.size === 'orig' ? '.jpg' : '.webp');
}

/** 同一城市只下一次：预下载与点开同时发生也复用同一个 Promise */
function fillOnce(city, fileID) {
  if (!inflight[city]) {
    inflight[city] = fill(city, fileID).then(
      p => { delete inflight[city]; return p; },
      () => { delete inflight[city]; return ''; }
    );
  }
  return inflight[city];
}

/**
 * 详情页取图：本地缓存优先，其次下载落盘，最终降级为临时链接直出。
 * 返回 { src, cached, degraded }：
 *   cached=true  → src 是本地文件路径（零网络）
 *   degraded=true → 落盘失败，src 是远程临时链接（能看，但下次还要下）
 */
export async function resolve(city, fileID) {
  if (!CITY_PHOTOS[city]) return { src: '', cached: false, degraded: false };
  const local = getCached(city);
  if (local) return { src: local, cached: true, degraded: false };

  if (!fsm()) {                              // 无文件系统：直接用临时链接
    const url = await getUrl(city, fileID);
    return url ? { src: url, cached: false, degraded: true } : { src: '', cached: false, degraded: false };
  }

  const saved = await fillOnce(city, fileID);
  if (saved) return { src: saved, cached: false, degraded: false };
  const url = await getUrl(city, fileID);
  return url ? { src: url, cached: false, degraded: true } : { src: '', cached: false, degraded: false };
}

/** 图片渲染失败（文件损坏 / 机型不支持 WebP）：作废这条缓存，下次重新下。
 *  连带清掉原图链接缓存，确保重试走的是（云函数重新给的）最新链接。 */
export function invalidate(city) {
  const items = loadIdx();
  const e = items[city];
  if (e) { unlink(e.p); delete items[city]; saveIdx(); }
  delete urlMap[city];
  delete urlMap[city + '#orig'];
}

/* ---------------- 预取 + 预下载（地图页调用一次） ---------------- */

/** 全部有头图的城市，热门优先 */
export function orderCities() {
  const all = Object.keys(CITY_PHOTOS);
  const hot = HOT_ORDER.filter(c => CITY_PHOTOS[c]);
  return hot.concat(all.filter(c => hot.indexOf(c) < 0));
}

/**
 * 地图页空闲时调一次：先批量换链，再按批预下载（每批 3 张，热门优先）。
 * 幂等：同一次启动内重复调用直接返回；不阻塞首屏、失败静默。
 * onProgress(done, total) 可选，仅用于调试/统计。
 */
export async function boost(onProgress) {
  if (boostStarted) return { urls: 0, files: 0 };
  boostStarted = true;
  const cities = orderCities();
  if (!cities.length) return { urls: 0, files: 0 };

  const urls = await prefetchUrls(cities);
  if (!urls) return { urls: 0, files: 0 };

  let files = 0;
  const total = cities.length;
  for (let i = 0; i < cities.length; i += BATCH) {
    const batch = cities.slice(i, i + BATCH);
    for (const c of batch) {
      if (getCached(c)) { files++; continue; }
      const p = await fillOnce(c, fileIdOf(c));   // 与详情页共用同一次下载
      if (p) files++;
    }
    if (typeof onProgress === 'function') onProgress(Math.min(i + BATCH, total), total);
    if (dlBroken) break;                          // 下载通道不可用，剩下的留给远程直出
    await new Promise(r => setTimeout(r, BATCH_GAP));
  }
  return { urls, files };
}

/** 仅供自测/排查：当前内存链接数、缓存统计 */
export function stats() {
  const items = loadIdx();
  const keys = Object.keys(items);
  return {
    ver: PHOTO_VER,
    idxKey: IDX_KEY,
    dir: dirPath(),
    count: keys.length,
    bytes: cachedBytes(),
    urls: Object.keys(urlMap).length,
    limit: MAX_BYTES
  };
}

/** 清空头像缓存（切换版本/排查用；不删索引以外的业务数据） */
export function clearAll() {
  const items = loadIdx();
  Object.keys(items).forEach(k => unlink(items[k] && items[k].p));
  idx.items = {};
  idx.loaded = true;
  saveIdx();
  Object.keys(urlMap).forEach(k => delete urlMap[k]);
  boostStarted = false;
  dlFailStreak = 0;
  dlBroken = false;
}

export default {
  MAX_BYTES, IDX_KEY, HOT_ORDER,
  pickEvict, entryUsable, cachedBytes, enforceLimit,
  fileIdOf, getUrl, prefetchUrls, resolve, getCached, invalidate,
  orderCities, boost, stats, clearAll
};
