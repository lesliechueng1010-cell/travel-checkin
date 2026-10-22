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

/** 驾车路线：from/to 为 {lat,lng}；返回 {km, mode:'driving'} 或 null */
export async function driving(from, to) {
  const r = await get('/ws/direction/v1/driving', {
    from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}`
  });
  if (!r || !r.result || !r.result.routes || !r.result.routes.length) return null;
  return { km: r.result.routes[0].distance / 1000, mode: 'driving' };
}

/** 步行路线 */
export async function walking(from, to) {
  const r = await get('/ws/direction/v1/walking', {
    from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}`
  });
  if (!r || !r.result || !r.result.routes || !r.result.routes.length) return null;
  return { km: r.result.routes[0].distance / 1000, mode: 'driving' };
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
export default { driving, walking, searchFood, hasKey };
