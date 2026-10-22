/**
 * 纯本地 EXIF 解析（不联网、不上传照片本体）
 * - JPEG：只读 APP1 段的 TIFF 结构
 * - HEIC：只读 ISO-BMFF 的 meta 盒（iinf 找 Exif 条目 → iloc 定位数据块 → 复用同一套 TIFF 读取）
 * 只取两样东西：GPS 经纬度、拍摄时间（DateTimeOriginal）。其余一律忽略。
 * 解析失败一律返回 ok:false + reason，由调用方按「跳过」计数，绝不猜测。
 */

const T = {
  BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, UNDEFINED: 7, SLONG: 9, SRATIONAL: 10
};
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATETIME = 0x0132;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_GPS_LAT_REF = 0x0001;
const TAG_GPS_LAT = 0x0002;
const TAG_GPS_LNG_REF = 0x0003;
const TAG_GPS_LNG = 0x0004;

/** HEIC 单个 Exif 数据块上限，防异常文件把内存吃满 */
const HEIC_MAX_ITEM = 8 * 1024 * 1024;

function fail(reason) { return { ok: false, reason, lat: null, lng: null, takenAt: '', date: '' }; }

/** "2023:07:15 10:22:31" / "2023-07-15" / "2023-07-15T10:22:31Z" → "2023-07-15"；非法返回 '' */
export function parseDateTimeString(s) {
  if (typeof s !== 'string') return '';
  const m = s.match(/^(\d{4})[:/-](\d{2})[:/-](\d{2})/);
  if (!m) return '';
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return m[1] + '-' + m[2] + '-' + m[3];
}

/** 文件头格式判断（用于给出友好提示） */
export function detectFormat(buffer) {
  const b = new Uint8Array(buffer, 0, Math.min(12, buffer.byteLength));
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50) return 'png';
  // ISO-BMFF：第 4~7 字节为 "ftyp"（HEIC / HEIF 都走这条）
  if (b.length >= 12 && String.fromCharCode(b[4], b[5], b[6], b[7]) === 'ftyp') return 'heic';
  return 'unknown';
}

/* ============================================================
 * TIFF 结构读取（JPEG / HEIC 共用）
 * 所有偏移都相对 tiff 起始位置，view 覆盖整个 buffer
 * ============================================================ */

function readIFD(view, tiff, dirStart, little) {
  if (dirStart <= 0 || dirStart + 2 > view.byteLength) return null;
  const count = view.getUint16(dirStart, little);
  if (count <= 0 || count > 512) return null;
  const map = {};
  for (let i = 0; i < count; i++) {
    const off = dirStart + 2 + i * 12;
    if (off + 12 > view.byteLength) break;
    const tag = view.getUint16(off, little);
    const type = view.getUint16(off + 2, little);
    const num = view.getUint32(off + 4, little);
    const size = TYPE_SIZE[type] || 0;
    if (!size) continue;
    const total = size * num;
    const valueOff = total <= 4 ? off + 8 : tiff + view.getUint32(off + 8, little);
    if (valueOff < 0 || valueOff + total > view.byteLength) continue;
    map[tag] = { type, num, off: valueOff, little };
  }
  return map;
}

function readAscii(view, ent) {
  if (!ent) return '';
  let s = '';
  for (let i = 0; i < ent.num; i++) {
    const c = view.getUint8(ent.off + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

function readRationals(view, ent) {
  if (!ent) return null;
  const out = [];
  for (let i = 0; i < ent.num; i++) {
    const o = ent.off + i * 8;
    const num = ent.type === T.SRATIONAL ? view.getInt32(o, ent.little) : view.getUint32(o, ent.little);
    const den = ent.type === T.SRATIONAL ? view.getInt32(o + 4, ent.little) : view.getUint32(o + 4, ent.little);
    if (!den) return null;
    out.push(num / den);
  }
  return out;
}

function dmsToDeg(dms, ref) {
  if (!dms || dms.length < 3) return null;
  const v = dms[0] + dms[1] / 60 + dms[2] / 3600;
  if (!isFinite(v)) return null;
  const neg = ref === 'S' || ref === 'W';
  return neg ? -v : v;
}

/**
 * 从 TIFF 头的绝对偏移开始，读出拍摄时间与 GPS
 * @param {ArrayBuffer} buffer
 * @param {number} tiff TIFF 头在 buffer 中的绝对偏移
 */
function parseTiffBuffer(buffer, tiff) {
  const view = new DataView(buffer);
  const limit = buffer.byteLength;
  if (tiff < 0 || tiff + 8 > limit) return fail('bad-tiff');

  const order = view.getUint16(tiff, false);
  const little = order === 0x4949;
  if (!little && order !== 0x4D4D) return fail('bad-tiff');
  if (view.getUint16(tiff + 2, little) !== 0x002A) return fail('bad-tiff');
  const ifd0Off = view.getUint32(tiff + 4, little);
  const ifd0 = readIFD(view, tiff, tiff + ifd0Off, little);
  if (!ifd0) return fail('bad-ifd0');

  // 拍摄时间：优先 DateTimeOriginal（Exif 子 IFD），退回 IFD0 的 DateTime
  let dateStr = '';
  if (ifd0[TAG_EXIF_IFD]) {
    const exifOff = view.getUint32(ifd0[TAG_EXIF_IFD].off, little);
    const exifIfd = readIFD(view, tiff, tiff + exifOff, little);
    if (exifIfd && exifIfd[TAG_DATETIME_ORIGINAL]) dateStr = readAscii(view, exifIfd[TAG_DATETIME_ORIGINAL]);
  }
  if (!dateStr && ifd0[TAG_DATETIME]) dateStr = readAscii(view, ifd0[TAG_DATETIME]);
  const date = parseDateTimeString(dateStr);

  // GPS
  let lat = null, lng = null;
  if (ifd0[TAG_GPS_IFD]) {
    const gpsOff = view.getUint32(ifd0[TAG_GPS_IFD].off, little);
    const gps = readIFD(view, tiff, tiff + gpsOff, little);
    if (gps) {
      const latRef = readAscii(view, gps[TAG_GPS_LAT_REF]);
      const lngRef = readAscii(view, gps[TAG_GPS_LNG_REF]);
      const la = dmsToDeg(readRationals(view, gps[TAG_GPS_LAT]), latRef);
      const ln = dmsToDeg(readRationals(view, gps[TAG_GPS_LNG]), lngRef);
      if (la !== null && ln !== null && Math.abs(la) <= 90 && Math.abs(ln) <= 180 && !(la === 0 && ln === 0)) {
        lat = Math.round(la * 1e6) / 1e6;
        lng = Math.round(ln * 1e6) / 1e6;
      }
    }
  }

  if (lat === null || lng === null) {
    return { ok: false, reason: 'no-gps', lat: null, lng: null, takenAt: dateStr, date };
  }
  return { ok: true, reason: '', lat, lng, takenAt: dateStr, date };
}

/* ============================================================
 * JPEG：找 APP1 / Exif 段
 * ============================================================ */

function parseJpeg(buffer) {
  const view = new DataView(buffer);
  if (view.getUint8(0) !== 0xFF || view.getUint8(1) !== 0xD8) return fail('not-jpeg');

  let tiff = -1;
  let pos = 2;
  const limit = buffer.byteLength;
  while (pos + 4 <= limit) {
    if (view.getUint8(pos) !== 0xFF) break;
    const marker = view.getUint8(pos + 1);
    if (marker === 0xDA || marker === 0xD9) break;           // SOS / EOI，后面没有元数据了
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { pos += 2; continue; }
    const len = view.getUint16(pos + 2, false);
    if (len < 8 || pos + 2 + len > limit) break;
    if (marker === 0xE1) {
      const sig = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
      let hit = true;
      for (let i = 0; i < 6; i++) if (view.getUint8(pos + 4 + i) !== sig[i]) { hit = false; break; }
      if (hit) { tiff = pos + 10; break; }
    }
    pos += 2 + len;
  }
  if (tiff < 0) return fail('no-exif');
  return parseTiffBuffer(buffer, tiff);
}

/* ============================================================
 * HEIC / HEIF：ISO-BMFF 盒解析
 * 结构：ftyp … meta( FullBox ) { hdlr, iinf, iloc, idat, iprp … }
 *   - iinf 里 item_type === 'Exif' 的条目拿到 item_ID
 *   - iloc 里按 item_ID 拿到数据块的绝对偏移与长度
 *   - 数据块开头 4 字节是「TIFF 头偏移」，切出后交给 parseTiffBuffer
 * ============================================================ */

/** 读一个盒头：size(4) + type(4)，size==1 表示 64 位长度，size==0 表示到文件尾 */
function boxHeader(view, pos, limit) {
  if (pos + 8 > limit) return null;
  let size = view.getUint32(pos, false);
  const type = String.fromCharCode(
    view.getUint8(pos + 4), view.getUint8(pos + 5), view.getUint8(pos + 6), view.getUint8(pos + 7)
  );
  let head = 8;
  if (size === 1) {
    if (pos + 16 > limit) return null;
    size = view.getUint32(pos + 8, false) * 4294967296 + view.getUint32(pos + 12, false);
    head = 16;
  } else if (size === 0) {
    size = limit - pos;
  }
  if (!(size >= head)) return null;
  return { type, dataStart: pos + head, end: Math.min(pos + size, limit), size };
}

/** 遍历 [start, limit) 区间内的同级盒，fn 返回 false 中止 */
function eachBox(view, start, limit, fn) {
  let pos = start;
  let guard = 0;
  while (pos + 8 <= limit && guard++ < 4096) {
    const b = boxHeader(view, pos, limit);
    if (!b) return;
    if (fn(b) === false) return;
    pos += b.size;
  }
}

function findBox(view, start, limit, type) {
  let found = null;
  eachBox(view, start, limit, b => {
    if (b.type === type) { found = b; return false; }
  });
  return found;
}

/** 读 1/2/4/8 字节的无符号整数（0 字节表示该字段不存在，按 0 计） */
function readUIntN(view, off, size) {
  if (size === 0) return 0;
  if (off + size > view.byteLength) return -1;
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + view.getUint8(off + i);
  return v;
}

/** iinf：返回 item_type 为 'Exif' 的 item_ID；找不到返回 -1 */
function findExifItemId(view, box) {
  let p = box.dataStart;
  if (p + 4 > box.end) return -1;
  const version = view.getUint8(p);
  p += 4;
  let count;
  if (version === 0) {
    if (p + 2 > box.end) return -1;
    count = view.getUint16(p, false);
    p += 2;
  } else {
    if (p + 4 > box.end) return -1;
    count = view.getUint32(p, false);
    p += 4;
  }
  if (count <= 0 || count > 512) return -1;

  let exifId = -1;
  for (let i = 0; i < count && p + 8 <= box.end; i++) {
    const b = boxHeader(view, p, box.end);
    if (!b) break;
    if (b.type === 'infe' && version >= 2) {
      // infe (v2+): version/flags(4) + item_ID(2) + protection(2) + item_type(4) + item_name…
      let q = b.dataStart + 4;
      if (q + 8 <= b.end) {
        const id = view.getUint16(q, false);
        const t = String.fromCharCode(
          view.getUint8(q + 4), view.getUint8(q + 5), view.getUint8(q + 6), view.getUint8(q + 7)
        );
        if (t === 'Exif' && exifId < 0) exifId = id;
      }
    }
    p += b.size;
  }
  return exifId;
}

/**
 * iloc：返回 { itemID: [{ method, baseOffset, offset, length }] }
 * 支持 version 0 / 1 / 2（version ≥1 才有 construction_method）
 */
function parseIloc(view, box) {
  let p = box.dataStart;
  if (p + 4 > box.end) return null;
  const version = view.getUint8(p);
  p += 4;
  if (p + 2 > box.end) return null;
  const b0 = view.getUint8(p);
  const b1 = view.getUint8(p + 1);
  const offsetSize = b0 >> 4;
  const lengthSize = b0 & 0x0F;
  const baseOffsetSize = b1 >> 4;
  const indexSize = (version === 1 || version === 2) ? (b1 & 0x0F) : 0;
  p += 2;

  let itemCount;
  if (version < 2) {
    if (p + 2 > box.end) return null;
    itemCount = view.getUint16(p, false);
    p += 2;
  } else {
    if (p + 4 > box.end) return null;
    itemCount = view.getUint32(p, false);
    p += 4;
  }
  if (itemCount <= 0 || itemCount > 512) return null;

  const items = {};
  for (let i = 0; i < itemCount; i++) {
    let itemId;
    if (version < 2) {
      if (p + 2 > box.end) return null;
      itemId = view.getUint16(p, false);
      p += 2;
    } else {
      if (p + 4 > box.end) return null;
      itemId = view.getUint32(p, false);
      p += 4;
    }
    let method = 0;
    if (version === 1 || version === 2) {
      if (p + 2 > box.end) return null;
      method = view.getUint16(p, false) & 0x0F;
      p += 2;
    }
    if (p + 2 > box.end) return null;
    p += 2;   // data_reference_index
    const baseOffset = readUIntN(view, p, baseOffsetSize);
    p += baseOffsetSize;
    if (baseOffset < 0 || p + 2 > box.end) return null;
    const extentCount = view.getUint16(p, false);
    p += 2;
    if (extentCount > 256) return null;

    const extents = [];
    for (let j = 0; j < extentCount; j++) {
      if ((version === 1 || version === 2) && indexSize > 0) {
        if (readUIntN(view, p, indexSize) < 0) return null;
        p += indexSize;
      }
      const offset = readUIntN(view, p, offsetSize);
      p += offsetSize;
      const length = readUIntN(view, p, lengthSize);
      p += lengthSize;
      if (offset < 0 || length < 0) return null;
      extents.push({ method, baseOffset, offset, length });
    }
    items[itemId] = extents;
  }
  return items;
}

/** 把一个 item 的若干 extent 拼成连续字节；无法定位返回 null */
function readItemBytes(view, extents, idat, limit) {
  if (!extents || !extents.length) return null;
  const parts = [];
  let total = 0;
  for (const e of extents) {
    let base = 0;
    if (e.method === 1) {                 // 数据在 idat 盒内，偏移相对 idat 内容起点
      if (!idat) return null;
      base = idat.dataStart;
    } else if (e.method !== 0) {          // method 2（item 内相对偏移）不支持，不猜
      return null;
    }
    const start = base + e.baseOffset + e.offset;
    const len = e.length || (limit - start);   // 未写长度 → 取到文件末尾
    if (start < 0 || len <= 0 || start + len > limit) return null;
    total += len;
    if (total > HEIC_MAX_ITEM) return null;
    parts.push({ start, len });
  }
  if (!total) return null;
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    out.set(new Uint8Array(view.buffer, view.byteOffset + part.start, part.len), o);
    o += part.len;
  }
  return out;
}

/**
 * Exif 数据块开头 4 字节是「TIFF 头偏移」，但不同编码器对这个偏移的基准不一致
 * （有的相对偏移字段之后，有的相对数据块起点，还有的带 "Exif\0\0" 前缀）。
 * 这里按优先级逐个候选位置校验 TIFF 魔数，只有真正是 TIFF 头的才采用 —— 不做任何猜测。
 */
function locateTiff(bytes) {
  if (bytes.length < 12) return -1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isTiff = off => off >= 0 && off + 8 <= bytes.length && (
    (bytes[off] === 0x49 && bytes[off + 1] === 0x49 && bytes[off + 2] === 0x2A && bytes[off + 3] === 0x00) ||
    (bytes[off] === 0x4D && bytes[off + 1] === 0x4D && bytes[off + 2] === 0x00 && bytes[off + 3] === 0x2A)
  );
  const declared = view.getUint32(0, false);
  const cands = [4 + declared, declared, 4];
  const scanTo = Math.min(bytes.length, 64);
  for (let i = 0; i + 6 <= scanTo; i++) {
    if (bytes[i] === 0x45 && bytes[i + 1] === 0x78 && bytes[i + 2] === 0x69 &&
        bytes[i + 3] === 0x66 && bytes[i + 4] === 0x00 && bytes[i + 5] === 0x00) {
      cands.push(i + 6);   // "Exif\0\0" 之后
    }
  }
  for (const c of cands) if (isTiff(c)) return c;
  return -1;
}

function parseHeic(buffer) {
  const limit = buffer.byteLength;
  if (limit < 16) return fail('bad-heic');
  const view = new DataView(buffer);

  const meta = findBox(view, 0, limit, 'meta');
  if (!meta) return fail('no-exif');
  const kids = meta.dataStart + 4;      // meta 是 FullBox，4 字节 version/flags
  if (kids > meta.end) return fail('bad-heic');

  const iinf = findBox(view, kids, meta.end, 'iinf');
  const iloc = findBox(view, kids, meta.end, 'iloc');
  const idat = findBox(view, kids, meta.end, 'idat');
  if (!iloc) return fail('no-exif');

  const items = parseIloc(view, iloc);
  if (!items) return fail('bad-heic');

  // 优先按 iinf 里的 item_type='Exif' 定位；没有 iinf 时逐个候选条目校验
  const exifId = iinf ? findExifItemId(view, iinf) : -1;
  const order = exifId >= 0 ? [exifId] : Object.keys(items).map(Number);

  for (const id of order) {
    const bytes = readItemBytes(view, items[id], idat, limit);
    if (!bytes) continue;
    const tiffOff = locateTiff(bytes);
    if (tiffOff < 0) continue;
    const tiffBuf = bytes.slice(tiffOff).buffer;   // slice 出来的是独立定长 buffer
    const res = parseTiffBuffer(tiffBuf, 0);
    if (res.ok || res.reason === 'no-gps') return res;   // 认到了 Exif，结论（含「无 GPS」）就是最终结论
  }
  return fail('no-exif');
}

/* ============================================================
 * 统一入口
 * ============================================================ */

/**
 * 解析照片 EXIF（JPEG / HEIC 均支持，返回契约完全一致）
 * @param {ArrayBuffer} buffer 照片原始字节
 * @returns {{ok:boolean, reason?:string, lat:number|null, lng:number|null, takenAt:string, date:string}}
 */
export function parseExif(buffer) {
  if (!buffer || typeof buffer.byteLength !== 'number' || buffer.byteLength < 4) return fail('empty');
  const fmt = detectFormat(buffer);
  if (fmt === 'heic') return parseHeic(buffer);
  if (fmt !== 'jpeg') return fail('not-jpeg');
  if (buffer.byteLength < 20) return fail('empty');
  return parseJpeg(buffer);
}

export default { parseExif, parseDateTimeString, detectFormat };
