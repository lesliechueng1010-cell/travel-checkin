/**
 * 腾讯位置服务 WebService API 封装
 * Key 未配置时所有方法返回 null，调用方按「直线估算 / 提示配置」降级，绝不编造数字。
 * 合规：仅使用腾讯位置服务（lbs.qq.com）；Key 由使用者在 config.js 填写，代码不内置任何可用 Key。
 * 域名要求：小程序后台需将 https://apis.map.qq.com 加入 request 合法域名（见 README）。
 */
import { CONFIG } from '../config.js';

const BASE = 'https://apis.map.qq.com';

function get(path, params) {
  if (!CONFIG.tmapKey) return Promise.resolve(null);
  return new Promise(resolve => {
    uni.request({
      url: BASE + path,
      method: 'GET',
      data: Object.assign({}, params, { key: CONFIG.tmapKey }),
      success: res => {
        if (res.statusCode === 200 && res.data && res.data.status === 0) resolve(res.data);
        else resolve(null);
      },
      fail: () => resolve(null)
    });
  });
}

/**
 * 解码腾讯路线规划返回的 polyline 压缩坐标串
 * 格式：一维数组，前两位为起点 lat、lng（×1e6）；
 *      其后每两位分别是「相对同维度前一点的增量」×1e6（lat 增量、lng 增量交替出现）。
 * 例：[39917990, 116397027, 12, -8, ...] → [{lat:39.91799, lng:116.397027}, {lat:39.91799012...}]
 * 解析失败（非数组 / 长度不足）返回 []，由调用方回退直线，绝不编造坐标。
 */
export function decodePolyline(raw) {
  let arr = raw;
  if (typeof arr === 'string') arr = arr.split(',').map(Number);
  if (!Array.isArray(arr) || arr.length < 2) return [];
  const nums = arr.map(Number);
  if (nums.some(n => !Number.isFinite(n))) return [];
  const out = [];
  let lat = nums[0] / 1e6;
  let lng = nums[1] / 1e6;
  out.push({ lat, lng });
  for (let i = 2; i + 1 < nums.length; i += 2) {
    // 逐点收敛到 6 位小数（约 0.1m），避免增量累加产生浮点漂移
    lat = Math.round((lat + nums[i] / 1e6) * 1e6) / 1e6;
    lng = Math.round((lng + nums[i + 1] / 1e6) * 1e6) / 1e6;
    out.push({ lat, lng });
  }
  return out;
}

/**
 * 路线规划通用流程：取 routes[0] 的 distance + polyline
 * 失败 / 无 routes / 无可解码坐标 → null（调用方整条回退直线，不做半真半假的混搭）
 */
async function plan(path, from, to, mode) {
  const r = await get(path, {
    from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}`
  });
  if (!r || !r.result || !r.result.routes || !r.result.routes.length) return null;
  const route = r.result.routes[0];
  const points = decodePolyline(route.polyline);
  if (!points.length) return null;
  return { km: (route.distance || 0) / 1000, mode, points };
}

/** 驾车路线：from/to 为 {lat,lng}；返回 { km, mode:'driving', points:[{lat,lng}] } 或 null */
export function driving(from, to) {
  return plan('/ws/direction/v1/driving', from, to, 'driving');
}

/** 步行路线：返回 { km, mode:'walking', points } 或 null */
export function walking(from, to) {
  return plan('/ws/direction/v1/walking', from, to, 'walking');
}

/** 城市内美食店搜索：返回 [{title, address, rating?, distText?}] 或 null（未配置 Key） */
export async function searchFood(city) {
  const r = await get('/ws/place/v1/search', {
    keyword: '美食',
    boundary: `region(${city.name}, 0)`,
    page_size: 10,
    orderby: '_distance',
    filter: 'category=美食'
  });
  if (!r || !r.data) return null;
  return r.data.map(p => ({
    title: p.title,
    address: p.address || '',
    rating: p.category ? '' : '',
    distance: typeof p._distance === 'number' ? (p._distance >= 1000 ? (p._distance / 1000).toFixed(1) + ' km' : p._distance + ' m') : '',
    lat: p.location && p.location.lat, lng: p.location && p.location.lng
  }));
}

export function hasKey() { return !!CONFIG.tmapKey; }
export default { driving, walking, searchFood, hasKey, decodePolyline };
