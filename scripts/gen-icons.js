/**
 * 生成地图标记 PNG 图标（纯 Node + zlib，无第三方依赖）
 * 输出到 src/static/icons/：绿（已打卡）/橙（想去）/灰（未去）/蓝（定位）
 */
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';

const SIZE = 48, CX = 24, CY = 24, R = 15, RING = 19;

function png(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcBuf) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    rgba.row(y).forEach((v, i) => raw[y * (1 + width * 4) + 1 + i * 4 + 0] = v[0]);
    // fill below with per-pixel copy
  }
  // simpler: rebuild raw
  for (let y = 0; y < height; y++) {
    const row = rgba.row(y);
    for (let x = 0; x < width; x++) {
      const o = y * (1 + width * 4) + 1 + x * 4;
      raw[o] = row[x][0]; raw[o + 1] = row[x][1]; raw[o + 2] = row[x][2]; raw[o + 3] = row[x][3];
    }
  }
  return Buffer.concat([
    sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function makeIcon(color, ringAlpha) {
  const [cr, cg, cb] = color;
  const row = y => {
    const arr = [];
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - CX, y - CY);
      let a = 0;
      // outer ring
      const ring = smooth(d, RING, RING - 2.2);
      const inner = smooth(d, R, R - 1.6);
      if (inner > 0) a = Math.max(a, inner);
      else if (ring > 0) a = Math.max(a, ring * ringAlpha);
      arr.push([cr, cg, cb, Math.round(Math.min(1, a) * 255)]);
    }
    return arr;
  };
  return { row };
}
function smooth(d, edge, inner) {
  if (d <= inner) return 1;
  if (d >= edge) return 0;
  return (edge - d) / (edge - inner);
}

const outDir = path.resolve('src/static/icons');
fs.mkdirSync(outDir, { recursive: true });

const colors = {
  'dot_green.png': [[34, 197, 94], 0.35],
  'dot_orange.png': [[245, 158, 11], 0.35],
  'dot_gray.png': [[148, 163, 178], 0.30],
  'dot_blue.png': [[59, 130, 246], 0.35],
  'dot_red.png': [[229, 69, 69], 0.35]
};

for (const [file, [color, ra]] of Object.entries(colors)) {
  const img = makeIcon(color, ra);
  fs.writeFileSync(path.join(outDir, file), png(SIZE, SIZE, img));
  console.log('written', file);
}
