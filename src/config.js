/**
 * 全局配置 —— 交付后由使用者填写
 *
 * 用 JSON.parse 包一层是刻意的：防止编译器把空字符串常量折叠，
 * 导致"填 Key 后再编译"时代码被裁掉。填写时只改下面的字符串内容即可。
 *
 * ── 腾讯位置服务 ──
 * 1. 前往 https://lbs.qq.com 申请「WebService API」Key。
 * 2. 小程序端直接调用需在小程序后台将 https://apis.map.qq.com 配置为
 *    request 合法域名（见 README「合法域名」一节）。
 * 3. 微信小程序 <map> 组件（底图/标记/路线预览）由微信内置腾讯地图提供，无需 Key。
 *
 * ── 微信云开发 ──
 * cloudEnv: 云开发环境 ID。留空 = 本地演示模式（数据存本机 Storage，功能完整）。
 * 填写后需在微信开发者工具中开通云开发，并上传 cloudfunctions/ 下三个云函数。
 */
export const CONFIG = JSON.parse(`{
  "tmapKey": "",
  "cloudEnv": "",
  "tmapViaCloud": false
}`);

export const BRAND = {
  name: '行走健将',
  slogan: '点亮你去过的每一座城'
};

export const SAFETY_DISCLAIMER = '以上信息仅供参考，出行前请核实最新路况与当地最新规定。';
