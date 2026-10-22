/**
 * 足迹数据 store —— localStorage 持久化 + 云端同步（云可用时由 api 层推送）
 */
import api from '../api/index.js';
import { stats } from './logic.js';

const KEY = 'tf_data_v1';
const SUB_KEY = 'tf_sub_v1';

let state = {
  visited: {},   // { 城市名: { date, note, photo, ts } }
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

export function getStats() { return stats(state.visited); }

export default { get, boot, checkin, uncheckin, toggleWish, saveTrip, removeTrip, setLastLoc, getStats, subscribe, getProfile, setProfile };
