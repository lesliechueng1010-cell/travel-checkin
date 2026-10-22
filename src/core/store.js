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
  lastLoc: null
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

export default { get, boot, checkin, uncheckin, toggleWish, saveTrip, removeTrip, setLastLoc, getStats, subscribe };
