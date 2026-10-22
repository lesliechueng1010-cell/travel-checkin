/**
 * 云开发适配层：配置了 cloudEnv 走云函数（按 openid 隔离），否则本地演示模式。
 * 云函数失败时全部静默降级为本地模式，不阻塞功能。
 */
import { CONFIG } from '../config.js';

const hasWx = typeof wx !== 'undefined';

export function isCloud() {
  return !!(CONFIG.cloudEnv && hasWx && wx.cloud);
}

export function cloudCall(name, data) {
  return new Promise((resolve, reject) => {
    if (!isCloud()) return reject(new Error('cloud not configured'));
    wx.cloud.callFunction({
      name,
      data,
      success: r => (r.result && r.result.ok) ? resolve(r.result) : reject(r.result || r),
      fail: reject
    });
  });
}

let openidCache = '';
export async function login() {
  if (openidCache) return openidCache;
  if (!isCloud()) { openidCache = 'local-user'; return openidCache; }
  const r = await cloudCall('login', {});
  openidCache = r.openid;
  try { uni.setStorageSync('tf_openid', openidCache); } catch (e) {}
  return openidCache;
}

export async function pull() {
  if (!isCloud()) return null;
  const r = await cloudCall('tfapi', { action: 'get' });
  return r.data || null;   // { data: {...}, updatedAt }
}

export async function push(state) {
  if (!isCloud()) return null;
  const r = await cloudCall('tfapi', {
    action: 'save',
    data: state,
    updatedAt: state.updatedAt || Date.now()
  });
  return r;
}

/** 从云数据库读攻略（seed 初始化后可用），失败返回 null */
export async function fetchGuide(cityName) {
  if (!isCloud()) return null;
  try {
    const r = await cloudCall('tfapi', { action: 'getGuide', city: cityName });
    return r.guide || null;
  } catch (e) { return null; }
}

/**
 * 用户资料云端同步（按 openid 隔离）
 * 云可用时写 tfapi.updateProfile；未配置云环境或失败时静默返回 null，
 * 资料本身仍存本地 setProfile 的持久化数据。
 */
export async function pushProfile(profile) {
  if (!isCloud()) return null;
  try {
    const r = await cloudCall('tfapi', { action: 'updateProfile', profile });
    return r;
  } catch (e) { return null; }
}

export async function pullProfile() {
  if (!isCloud()) return null;
  try {
    const r = await cloudCall('tfapi', { action: 'getProfile' });
    return r.profile || null;
  } catch (e) { return null; }
}

export default { isCloud, login, pull, push, fetchGuide, pushProfile, pullProfile };
