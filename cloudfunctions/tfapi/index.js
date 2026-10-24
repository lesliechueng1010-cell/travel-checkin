/**
 * 云函数 tfapi：用户足迹数据按 openid 隔离读写 + 云数据库攻略读取
 * 集合约定：
 *  - footprints: { _openid, data, updatedAt }   （每用户一条文档）
 *  - guides:     { city, guide }                （由 seed 云函数初始化）
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/* ---------------- 头图链接（1.6.1） ----------------
 * 目录约定：原图 city-photos/<slug>.jpg，压缩图 city-photos-lite/<slug>.webp
 * 压缩图由 scripts/compress-photos.mjs 生成（750px WebP q80），不存在时回退原图。
 */
const PHOTO_TTL_MS = 30 * 60 * 1000;   // 临时链默认 2 小时有效，按 30 分钟保守过期，前端到期重取
const PHOTO_DIR = { lite: '/city-photos-lite/', orig: '/city-photos/' };
const PHOTO_EXT = { lite: '.webp', orig: '.jpg' };
const URL_BATCH_MAX = 50;              // getTempFileURL 单次 fileList 上限

/** 'lite'（默认）或 'orig'，其他值一律按 lite 处理 */
function normalizeSize(v) {
  return String(v || '') === 'orig' ? 'orig' : 'lite';
}

/** 从 fileID 取出城市 slug；不是 city-photos(-lite)/ 下的 jpg/webp 就返回空 */
function parsePhotoSlug(fileID) {
  if (typeof fileID !== 'string' || fileID.indexOf('cloud://') !== 0) return '';
  const m = /\/city-photos(?:-lite)?\/([A-Za-z0-9_-]+)\.(?:jpe?g|webp)$/i.exec(fileID);
  return m ? m[1] : '';
}

/** 同一个存储前缀下换成目标目录 + 扩展名的 fileID（云函数不硬编码环境/桶名） */
function photoFileId(fileID, size) {
  const slug = parsePhotoSlug(fileID);
  if (!slug) return '';
  const cut = fileID.indexOf('/city-photos');
  return fileID.slice(0, cut) + PHOTO_DIR[size] + slug + PHOTO_EXT[size];
}

/** 批量换临时链接；返回 { fileID: url }，取不到的条目不在结果里 */
async function tempUrlMap(fileIDs) {
  const out = {};
  for (let i = 0; i < fileIDs.length; i += URL_BATCH_MAX) {
    const chunk = fileIDs.slice(i, i + URL_BATCH_MAX);
    try {
      const r = await cloud.getTempFileURL({ fileList: chunk });
      (r.fileList || []).forEach(f => {
        if (f && f.fileID && f.status === 0 && f.tempFileURL) out[f.fileID] = f.tempFileURL;
      });
    } catch (e) { /* 整批失败就当作这批都没取到，交给上层回退原图 */ }
  }
  return out;
}

/** 单个换链：lite 优先，取不到回退原图；都没有返回 null */
async function resolvePhoto(fileID, size) {
  if (size === 'orig') {
    const id = photoFileId(fileID, 'orig');
    const m = await tempUrlMap([id]);
    return m[id] ? { url: m[id], size: 'orig' } : null;
  }
  const liteId = photoFileId(fileID, 'lite');
  const liteMap = await tempUrlMap([liteId]);
  if (liteMap[liteId]) return { url: liteMap[liteId], size: 'lite' };
  const origId = photoFileId(fileID, 'orig');
  const origMap = await tempUrlMap([origId]);
  return origMap[origId] ? { url: origMap[origId], size: 'orig' } : null;
}

/**
 * 批量换链：先整批取 lite（1 次调用），再把没取到的整批取原图（第 2 次），
 * 结果按下标与入参对齐，取不到的为 null（前端据此逐城回退，不影响其他城市）。
 */
async function resolvePhotos(fileIDs, size) {
  const hits = new Array(fileIDs.length).fill(null);
  if (size === 'orig') {
    const ids = fileIDs.map(f => photoFileId(f, 'orig'));
    const map = await tempUrlMap(ids.filter(Boolean));
    fileIDs.forEach((_, i) => { if (ids[i] && map[ids[i]]) hits[i] = { url: map[ids[i]], size: 'orig' }; });
    return hits;
  }
  const liteIds = fileIDs.map(f => photoFileId(f, 'lite'));
  const liteMap = await tempUrlMap(liteIds.filter(Boolean));
  const missIdx = [];
  fileIDs.forEach((_, i) => {
    const id = liteIds[i];
    if (id && liteMap[id]) hits[i] = { url: liteMap[id], size: 'lite' };
    else missIdx.push(i);
  });
  if (missIdx.length) {
    const origIds = missIdx.map(i => photoFileId(fileIDs[i], 'orig'));
    const origMap = await tempUrlMap(origIds.filter(Boolean));
    missIdx.forEach((i, k) => {
      const id = origIds[k];
      if (id && origMap[id]) hits[i] = { url: origMap[id], size: 'orig' };
    });
  }
  return hits;
}

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

    if (action === 'updateProfile') {
      const p = event.profile || {};
      const payload = {
        profile: {
          avatar: String(p.avatar || ''),
          nickname: String(p.nickname || '').slice(0, 20),
          updatedAt: p.updatedAt || Date.now()
        }
      };
      const r = await db.collection('footprints').where({ _openid: OPENID }).limit(1).get();
      if (r.data.length) {
        await db.collection('footprints').doc(r.data[0]._id).update(payload);
      } else {
        await db.collection('footprints').add({ data: { _openid: OPENID, profile: payload.profile } });
      }
      return { ok: true };
    }

    if (action === 'getProfile') {
      const r = await db.collection('footprints').where({ _openid: OPENID }).limit(1).get();
      return { ok: true, profile: (r.data.length && r.data[0].profile) ? r.data[0].profile : null };
    }

    if (action === 'getGuide') {
      const r = await db.collection('guides').where({ city: event.city }).limit(1).get();
      return { ok: true, guide: r.data.length ? r.data[0].guide : null };
    }

    if (action === 'photoUrl') {
      // 头图临时链接：云存储权限是「仅创建者可读写」（免费套餐改不了），
      // 小程序端直读 cloud:// 会被拒；服务端不受该权限限制，换临时 HTTPS 链接下发。
      // 1.6.1：默认优先换 city-photos-lite/ 的压缩图（750px WebP），取不到再回退原图。
      const fileID = String(event.fileID || '');
      if (!parsePhotoSlug(fileID)) return { ok: false, msg: 'bad fileID' };
      const hit = await resolvePhoto(fileID, normalizeSize(event.size));
      if (!hit) return { ok: false, msg: 'no temp url' };
      return { ok: true, url: hit.url, size: hit.size, expireAt: Date.now() + PHOTO_TTL_MS };
    }

    if (action === 'photoUrls') {
      // 批量换链：地图页进入后一次取回全部城市的头图链接，点开城市不再单独调云函数。
      const raw = Array.isArray(event.fileIDs) ? event.fileIDs : [];
      const ids = [];
      for (const f of raw) {
        const id = String(f || '');
        if (parsePhotoSlug(id) && ids.indexOf(id) < 0) ids.push(id);
      }
      if (!ids.length) return { ok: false, msg: 'bad fileIDs' };
      if (ids.length > 60) return { ok: false, msg: 'too many fileIDs' };
      const hits = await resolvePhotos(ids, normalizeSize(event.size));
      return {
        ok: true,
        expireAt: Date.now() + PHOTO_TTL_MS,
        items: ids.map((id, i) => ({
          fileID: id,
          url: hits[i] ? hits[i].url : '',
          size: hits[i] ? hits[i].size : ''
        }))
      };
    }

    return { ok: false, msg: 'unknown action' };
  } catch (e) {
    return { ok: false, msg: e.errMsg || String(e) };
  }
};
