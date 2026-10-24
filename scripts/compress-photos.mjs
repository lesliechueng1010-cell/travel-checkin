#!/usr/bin/env node
/**
 * 头图压缩：city-photos/ 原图 → city-photos-lite/ 压缩版（1.6.1）
 *
 * 只读原图目录，另建待上传目录，**不动原图**（原图继续作为回退）。
 * 规格：宽 750px（按原比例）、WebP、质量 80，单张目标 ≤ 200KB。
 * 文件名与原图一一对应（beijing.jpg → beijing.webp），城市 slug 不变。
 *
 * 用法：
 *   node scripts/compress-photos.mjs --src <原图目录> --out <输出目录>
 *
 * 默认：--src 取环境变量 TF_PHOTO_SRC 或 ../city-photos（仓库同级的原图目录）
 *       --out 取 ../photo-lite-upload/city-photos-lite
 *
 * 编码依赖 @napi-rs/canvas（构建机本地工具，不进小程序包、不进依赖清单）。
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, extname, join, resolve } from 'node:path';

const requireWs = createRequire('C:/Users/leslie/.workbuddy/binaries/node/workspace/');
const { createCanvas, loadImage } = requireWs('@napi-rs/canvas');

const WIDTH = 750;
const QUALITY = 80;
const LIMIT_KB = 200;

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const srcDir = resolve(arg('src', process.env.TF_PHOTO_SRC || '../city-photos'));
const outDir = resolve(arg('out', '../photo-lite-upload/city-photos-lite'));

if (!existsSync(srcDir)) {
  console.error('✗ 原图目录不存在：', srcDir);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const files = readdirSync(srcDir).filter(f => /\.(jpe?g|png)$/i.test(f)).sort();
if (!files.length) {
  console.error('✗ 原图目录里没有 jpg/png：', srcDir);
  process.exit(1);
}

const rows = [];
let totalSrc = 0;
let totalOut = 0;
let over = 0;

for (const f of files) {
  const src = join(srcDir, f);
  const slug = basename(f, extname(f)).toLowerCase();
  const img = await loadImage(src);
  const w = Math.min(WIDTH, img.width);
  const h = Math.round((img.height * w) / img.width);

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  // 质量 80 仍超 200KB 时逐档降到 70，保证单张达标（实拍图 q80 一般 40~90KB）
  let buf = canvas.toBuffer('image/webp', QUALITY);
  let q = QUALITY;
  if (buf.length > LIMIT_KB * 1024) {
    q = 70;
    buf = canvas.toBuffer('image/webp', q);
  }

  const dst = join(outDir, slug + '.webp');
  writeFileSync(dst, buf);

  const sIn = statSync(src).size;
  const sOut = buf.length;
  totalSrc += sIn;
  totalOut += sOut;
  if (sOut > LIMIT_KB * 1024) over++;

  rows.push({
    file: slug + '.webp',
    src: basename(f),
    w,
    h,
    q,
    inKB: sIn / 1024,
    outKB: sOut / 1024
  });
}

rows.sort((a, b) => b.inKB - a.inKB);
const pad = (s, n) => String(s).padEnd(n, ' ');
console.log(pad('压缩后文件', 22) + pad('原文件', 20) + pad('尺寸', 12) + pad('q', 5) + '原大小 → 压缩后');
for (const r of rows) {
  console.log(
    pad(r.file, 22) + pad(r.src, 20) + pad(`${r.w}x${r.h}`, 12) + pad(r.q, 5) +
    `${r.inKB.toFixed(0).padStart(4)}KB → ${r.outKB.toFixed(1).padStart(6)}KB` +
    `  (${((1 - r.outKB / r.inKB) * 100).toFixed(0)}%↓)`
  );
}
console.log('\n合计：' + rows.length + ' 张，' +
  (totalSrc / 1024 / 1024).toFixed(2) + 'MB → ' + (totalOut / 1024 / 1024).toFixed(2) + 'MB ' +
  '(' + ((1 - totalOut / totalSrc) * 100).toFixed(1) + '%↓)，单张均值 ' +
  (totalOut / rows.length / 1024).toFixed(0) + 'KB，超 ' + LIMIT_KB + 'KB 的 ' + over + ' 张');
console.log('输出目录：' + outDir);

writeFileSync(join(outDir, '..', '大小对照.txt'), rows.map(r =>
  `${r.file}\t${r.inKB.toFixed(0)}KB → ${r.outKB.toFixed(1)}KB\t${r.w}x${r.h} q${r.q}`
).join('\n') + '\n', 'utf8');
