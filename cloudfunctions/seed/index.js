/**
 * 云函数 seed：初始化云数据库
 * 小程序端发起（传入内置攻略库内容），把结构化攻略 upsert 到 guides 集合；
 * 也可传 action:'createCollections' 让后端建集合（或直接在开发者工具控制台手动建）。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const db = cloud.database();
  const action = event.action;

  try {
    if (action === 'createCollections') {
      for (const name of ['footprints', 'guides']) {
        try { await db.createCollection(name); } catch (e) {
          if (!/collection exists/i.test(String(e.errMsg || e))) throw e;
        }
      }
      return { ok: true };
    }

    if (action === 'seedGuides') {
      const guides = event.guides || [];
      let upserted = 0;
      for (const g of guides) {
        const r = await db.collection('guides').where({ city: g.city }).limit(1).get();
        if (r.data.length) await db.collection('guides').doc(r.data[0]._id).update({ data: { guide: g } });
        else await db.collection('guides').add({ data: { city: g.city, guide: g } });
        upserted++;
      }
      return { ok: true, count: upserted };
    }

    return { ok: false, msg: 'unknown action' };
  } catch (e) {
    return { ok: false, msg: e.errMsg || String(e) };
  }
};
