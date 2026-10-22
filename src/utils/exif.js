/**
 * 纯本地 EXIF 解析（只读 JPEG 的 APP1 段，不联网、不上传照片本体）
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

function fail(reason) { return { ok: false, reason, lat: null, lng: null, takenAt: '', date: '' }; }

/** "2023:07:15 10:22:31" / "2023-07-15" → "2023-07-15"；非法返回 '' */
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
  if (b.length >= 12 && String.fromCharCode(b[4], b[5], b[6], b[7]) === 'ftyp') return 'heic';
  return 'unknown';
}

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
 * 解析 JPEG 的 EXIF
 * @param {ArrayBuffer} buffer 照片原始字节
 * @returns {{ok:boolean, reason?:string, lat:number|null, lng:number|null, takenAt:string, date:string}}
 */
export function parseExif(buffer) {
  if (!buffer || typeof buffer.byteLength !== 'number' || buffer.byteLength < 4) return fail('empty');
  const fmt = detectFormat(buffer);
  if (fmt === 'heic') return fail('heic');
  if (fmt !== 'jpeg') return fail('not-jpeg');
  if (buffer.byteLength < 20) return fail('empty');

  const view = new DataView(buffer);
  if (view.getUint8(0) !== 0xFF || view.getUint8(1) !== 0xD8) return fail('not-jpeg');

  // 找 APP1 / Exif 段
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
  if (tiff + 8 > limit) return fail('bad-tiff');

  // TIFF 头
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

export default { parseExif, parseDateTimeString, detectFormat };
