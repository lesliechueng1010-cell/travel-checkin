/**
 * 重上色 tabBar PNG 图标（纯 Node + zlib，无第三方依赖）
 * 只改像素 RGB/alpha，不改图形轮廓：选中态 → 香槟金 #D9B36A，未选中 → 次级米白 45%。
 * 用法：node scripts/recolor-tab-icons.js
 */
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';

const DIR = path.resolve('src/static/icons');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function chunks(buf) {
  const out = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    out.push({ type, data });
    off += 12 + len;
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
}

function decode(buf) {
  const list = chunks(buf);
  const ihdr = list.find(c => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported png: depth=${bitDepth} color=${colorType} interlace=${interlace}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(list.filter(c => c.type === 'IDAT').map(c => c.data)));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      cur[x] = v & 0xff;
    }
  }
  return { width, height, colorType, bpp, pixels: out };
}

function encode({ width, height, colorType, bpp, pixels }) {
  const stride = width * bpp;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** 把非透明像素统一成目标色，透明度按 alphaScale 缩放（保留原图标抗锯齿） */
function recolor(img, [r, g, b], alphaScale) {
  const { pixels, bpp } = img;
  for (let i = 0; i < pixels.length; i += bpp) {
    const a = bpp === 4 ? pixels[i + 3] : 255;
    if (!a) continue;
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b;
    if (bpp === 4) pixels[i + 3] = Math.round(a * alphaScale);
  }
  return img;
}

const ON = [217, 179, 106];   // 香槟金
const OFF = [242, 237, 227];  // 米白（再乘 alpha 做出 45% 观感）

const files = fs.readdirSync(DIR).filter(f => /^tab_.*\.png$/.test(f));
if (!files.length) { console.log('没有找到 tab_*.png'); process.exit(1); }

for (const f of files) {
  const p = path.join(DIR, f);
  const img = decode(fs.readFileSync(p));
  const isOn = /_on\.png$/.test(f);
  recolor(img, isOn ? ON : OFF, isOn ? 1 : 0.5);
  fs.writeFileSync(p, encode(img));
  console.log('recolored', f, isOn ? '#D9B36A' : '#F2EDE3 @50%');
}
