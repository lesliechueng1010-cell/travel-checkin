#!/usr/bin/env node
/**
 * 构建后置步骤（build:mp-weixin 在 uni build 之后自动调用）
 *
 * 解决：uni 的微信小程序产物 dist/build/mp-weixin 不含云函数目录，
 * project.config.json 也没有 cloudfunctionRoot，开发者工具打开后看不到
 * 云函数、无法右键上传。本脚本把根目录 cloudfunctions/ 拷进产物，并写回
 * cloudfunctionRoot 字段，让云函数在工具里可被识别与上传。
 *
 * 注意：只动产物目录与 project.config.json，不触碰任何源码。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist/build/mp-weixin');
const srcCF = resolve(root, 'cloudfunctions');
const dstCF = resolve(distDir, 'cloudfunctions');
const cfgPath = resolve(distDir, 'project.config.json');

// 1) 把根目录 cloudfunctions/ 整个递归拷到产物目录
if (!existsSync(srcCF)) {
  console.error('✗ postbuild：找不到 cloudfunctions/ 源目录', srcCF);
  process.exit(1);
}
if (!existsSync(distDir)) {
  console.error('✗ postbuild：产物目录不存在，请先执行 uni build', distDir);
  process.exit(1);
}
// 先清掉上一次产物里的 cloudfunctions，保证是本次根目录的完整镜像（无残留旧函数）
if (existsSync(dstCF)) rmSync(dstCF, { recursive: true, force: true });
mkdirSync(dirname(dstCF), { recursive: true });
cpSync(srcCF, dstCF, { recursive: true });
console.log('✓ postbuild：cloudfunctions/ → dist/build/mp-weixin/cloudfunctions/');

// 2) 读取 project.config.json，写入 cloudfunctionRoot，其他字段原样保留
if (!existsSync(cfgPath)) {
  console.error('✗ postbuild：找不到 project.config.json', cfgPath);
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
cfg.cloudfunctionRoot = 'cloudfunctions/';
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
console.log('✓ postbuild：project.config.json 写入 cloudfunctionRoot = "cloudfunctions/"');
