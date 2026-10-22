/**
 * 足迹数据 store —— localStorage 持久化 + 云端同步（云可用时由 api 层推送）
 */
import api from '../api/index.js';
import { stats } from './logic.js';

const KEY = 'tf_data_v1';
const SUB_KEY = 'tf_sub_v1';

let state = {
  visited: {},   // { 城市名: { date, note, photo, ts, source? } }  source='import' 表示历史足迹补录
  wishlist: [], // [城市名]
  trips: [],    // [{ id, name, cities: [城市名] }]
  openid: '',
  lastLoc: null,
  // 用户资料：头像为本地永久文件路径，昵称来自微信「头像昵称填写」能力
  // updatedAt 用于云端合并，syncedAt 记录上次云端同步时间（开通云开发后按 openid 同步）
  profile: { avatar: '', nickname: '', updatedAt: 0, syncedAt: 0 }
};

const subs = [];
function subscribe(fn) { subs.push(fn); }
function emit() { subs.forEach(f => { try { f(state); } catch (e) {} }); }

function load() {
  try {
    const raw = uni.getStorageSync(KEY);
    if (raw) state = Object.assign(state, typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch (e) {}
  return state;
}
function persist() {
  try { uni.setStorageSync(KEY, state); } catch (e) {}
}

export function get() { return state; }

/* 迁移：旧数据没有 profile 时补齐，避免读到 undefined */
function migrate() {
  if (!state.profile || typeof state.profile !== 'object') {
    state.profile = { avatar: '', nickname: '', updatedAt: 0, syncedAt: 0 };
  }
  ['avatar', 'nickname'].forEach(k => { if (typeof state.profile[k] !== 'string') state.profile[k] = ''; });
  ['updatedAt', 'syncedAt'].forEach(k => { if (typeof state.profile[k] !== 'number') state.profile[k] = 0; });
  migrateVisited();
}

/**
 * 打卡记录向后兼容（1.0.3 起新增 source 字段）
 * 老数据没有 source / date 为空字符串都能正常读，不丢档、不改写日期
 */
function migrateVisited() {
  if (!state.visited || typeof state.visited !== 'object') state.visited = {};
  Object.keys(state.visited).forEach(k => {
    const v = state.visited[k];
    if (!v || typeof v !== 'object') { delete state.visited[k]; return; }
    if (typeof v.date !== 'string') v.date = '';
    if (typeof v.note !== 'string') v.note = '';
    if (typeof v.photo !== 'string') v.photo = '';
    if (typeof v.ts !== 'number') v.ts = 0;
    // 只有补录才带来源标记，老数据/手动打卡一律没有该字段
    if (v.source !== 'import') delete v.source;
  });
}

export function getProfile() {
  migrate();
  return state.profile;
}

/**
 * 保存用户资料（头像 / 昵称）
 * 头像 filePath 会用 uni.saveFile 落到本地永久目录，避免临时路径失效
 */
export function setProfile(patch = {}) {
  migrate();
  if (typeof patch.avatar === 'string') state.profile.avatar = patch.avatar;
  if (typeof patch.nickname === 'string') state.profile.nickname = patch.nickname.trim().slice(0, 20);
  state.profile.updatedAt = Date.now();
  if (patch.syncedAt) state.profile.syncedAt = patch.syncedAt;
  persist();
  // 云端可用时按 openid 同步（api 层内部判断是否已配置云环境）
  try { api.pushProfile && api.pushProfile(state.profile); } catch (e) {}
  emit();
  return state.profile;
}

export async function boot() {
  load();
  migrate();   // 老版本数据先做一次向后兼容整形（不丢档）
  try { state.openid = await api.login(); } catch (e) {}
  try {
    const remote = await api.pull();
    if (remote && remote.updatedAt && (!state.updatedAt || remote.updatedAt > state.updatedAt)) {
      state = Object.assign(state, remote.data);
      persist();
    }
  } catch (e) {}
  emit();
  return state;
}

export async function checkin(cityName, info = {}) {
  state.visited[cityName] = {
    date: info.date || new Date().toISOString().slice(0, 10),
    note: info.note || '',
    photo: info.photo || '',
    ts: Date.now()
  };
  state.wishlist = state.wishlist.filter(n => n !== cityName);
  state.updatedAt = Date.now();
  persist(); emit();
  await api.push(state);   // 云不可用时静默失败
}

export function uncheckin(cityName) {
  delete state.visited[cityName];
  state.updatedAt = Date.now();
  persist(); emit();
  api.push(state).catch(() => {});
}

export function toggleWish(cityName) {
  const i = state.wishlist.indexOf(cityName);
  if (i >= 0) state.wishlist.splice(i, 1);
  else if (!state.visited[cityName]) state.wishlist.push(cityName);
  state.updatedAt = Date.now();
  persist(); emit();
  api.push(state).catch(() => {});
}

export function saveTrip(trip) {
  if (!state.trips) state.trips = [];
  const idx = state.trips.findIndex(t => t.id === trip.id);
  if (idx >= 0) state.trips[idx] = trip; else state.trips.unshift(trip);
  state.updatedAt = Date.now();
  persist(); emit();
  api.push(state).catch(() => {});
}

export function removeTrip(id) {
  state.trips = (state.trips || []).filter(t => t.id !== id);
  state.updatedAt = Date.now();
  persist(); emit();
  api.push(state).catch(() => {});
}

export function setLastLoc(loc) {
  state.lastLoc = loc;
  persist();
}

/* ===== 历史足迹补录（1.0.3） ===== */

export const IMPORT_NOTE = '补录 · 历史足迹导入';

/**
 * 批量导入历史足迹（照片识别 / 点选补录共用这一个动作）
 * - 已点亮的城市自动跳过，不可重复导入
 * - year 留空则不写日期（date = ''），绝不编造日期
 * - 写入 source='import' 来源标记，每城自动生成一条补录游记
 * @param {Array<{city?:string,name?:string,year?:string|number}>} list
 * @returns {{imported:number, skipped:number, cities:string[]}}
 */
export function importFootprints(list = []) {
  migrateVisited();
  const now = Date.now();
  const importedCities = [];
  let skipped = 0;
  (Array.isArray(list) ? list : []).forEach((item, i) => {
    const name = typeof item === 'string' ? item : (item && (item.city || item.name)) || '';
    if (!name) return;
    if (state.visited[name]) { skipped++; return; }   // 已点亮 → 不重复
    const raw = item && item.year !== undefined && item.year !== null ? String(item.year).trim() : '';
    const year = /^\d{4}$/.test(raw) ? raw : '';
    state.visited[name] = {
      date: year ? year + '-01-01' : '',
      note: IMPORT_NOTE,
      photo: '',
      ts: now + i,          // 同批次内保持稳定顺序
      source: 'import'
    };
    state.wishlist = (state.wishlist || []).filter(n => n !== name);
    importedCities.push(name);
  });
  if (importedCities.length) {
    state.updatedAt = now;
    persist();
    emit();
    api.push(state).catch(() => {});
  }
  return { imported: importedCities.length, skipped, cities: importedCities };
}

export function getStats() { return stats(state.visited); }

export default { get, boot, checkin, uncheckin, toggleWish, saveTrip, removeTrip, setLastLoc, getStats, subscribe, getProfile, setProfile, importFootprints, IMPORT_NOTE };
