/**
 * 云函数 tfapi：用户足迹数据按 openid 隔离读写 + 云数据库攻略读取
 * 集合约定：
 *  - footprints: { _openid, data, updatedAt }   （每用户一条文档）
 *  - guides:     { city, guide }                （由 seed 云函数初始化）
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const db = cloud.database();
  const action = event.action;

  try {
    if (action === 'get') {
      const r = await db.collection('footprints').where({ _openid: OPENID }).limit(1).get();
      if (!r.data.length) return { ok: true, data: null };
      return { ok: true, data: { data: r.data[0].data, updatedAt: r.data[0].updatedAt } };
    }

    if (action === 'save') {
      const payload = { data: event.data, updatedAt: event.updatedAt || Date.now() };
      const r = await db.collection('footprints').where({ _openid: OPENID }).limit(1).get();
      if (r.data.length) {
        await db.collection('footprints').doc(r.data[0]._id).update(payload);
      } else {
        await db.collection('footprints').add({ data: { _openid: OPENID, ...payload } });
      }
      return { ok: true };
    }

    if (action === 'getGuide') {
      const r = await db.collection('guides').where({ city: event.city }).limit(1).get();
      return { ok: true, guide: r.data.length ? r.data[0].guide : null };
    }

    return { ok: false, msg: 'unknown action' };
  } catch (e) {
    return { ok: false, msg: e.errMsg || String(e) };
  }
};
