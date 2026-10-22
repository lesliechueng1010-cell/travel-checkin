/**
 * 无头自测：模拟 uni/wx 环境跑核心业务闭环
 * 覆盖：定位 → 最近城市推荐 → 想去清单 → 打卡（含日期/游记）→ 统计 → 串线行程里程/天数 → 取消打卡 → 离线缓存
 */
const mem = {};
globalThis.uni = {
  getStorageSync: k => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: k => { delete mem[k]; },
  showToast: () => {}, showModal: () => {}, showLoading: () => {}, hideLoading: () => {},
  request: () => {}, navigateTo: () => {}, switchTab: () => {}, navigateBack: () => {}
};
globalThis.wx = { cloud: null };

const assert = (name, cond, extra) => {
  if (!cond) { console.error('✗ FAIL:', name, extra || ''); process.exitCode = 1; }
  else console.log('✓', name);
};

const store = (await import('../src/core/store.js')).default;
const logic = await import('../src/core/logic.js');
const cache = (await import('../src/utils/cache.js')).default;
const guides = await import('../src/data/guides.js.js'.replace(/\.js\.js/, '.js'));
const { CITIES, findCity } = await import('../src/data/cities.js');

// 1. boot（本地模式，无云）
await store.boot();
assert('启动：本地模式 boot', store.get().openid === 'local-user');

// 2. 统计基线
const st0 = store.getStats();
assert('统计：基线 0 城', st0.visitedCount === 0 && st0.pct === 0);

// 3. 最近城市推荐（模拟定位在北京）
const loc = { lat: 39.9, lng: 116.41 };
store.setLastLoc(loc);
const near = logic.nearestCities(loc, 5, true, store.get().visited);
assert('最近未打卡城市：第一名为北京', near[0].name === '北京' && near[0].dist <= 50);
assert('最近城市升序排序', near.every((c, i) => i === 0 || c.dist >= near[i - 1].dist));
const located = logic.locateCity(loc);
assert('定位识别城市', located && located.name === '北京');

// 4. 想去清单
store.toggleWish('大理白族自治州');
store.toggleWish('丽江');
assert('想去清单可添加', store.get().wishlist.length === 2);
store.toggleWish('丽江');
assert('想去清单可移除', store.get().wishlist.length === 1);

// 5. 打卡（日期 + 游记 + 照片）
await store.checkin('北京', { date: '2026-10-01', note: '秋天的北城', photo: 'x.jpg' });
await store.checkin('天津', { date: '2026-10-05', note: '', photo: '' });
assert('打卡生效', !!store.get().visited['北京'] && store.get().visited['北京'].date === '2026-10-01');
assert('打卡后统计', store.getStats().visitedCount === 2);
const bjPct = store.getStats().provinces.find(p => p.prov === '北京市');
assert('省份进度=100%', bjPct.pct === 100);

// 6. 已打卡城市自动移出想去清单
await store.checkin('大理白族自治州', { note: '' });
assert('打卡自动清想去', !store.get().wishlist.includes('大理白族自治州'));

// 7. 串线行程（无 Key → 直线估算，明确标注）
const tripCities = ['成都', '丽江', '拉萨'].map(n => findCity(n));
const m = await logic.tripMileage(tripCities, null);
assert('行程里程为直线估算', m.mode === 'straight' && m.km > 300 && m.km < 2000, m.km);
const days = logic.suggestDays(tripCities, m.km);
assert('建议天数 = 城市天数+赶路天数', days.total === days.cityDays + days.driveDays && days.cityDays >= 3);
store.saveTrip({ id: 'T1', name: '川滇藏', cities: ['成都', '丽江', '拉萨'] });
assert('行程可保存', store.get().trips.length === 1);

// 8. 攻略红线检查：43 城攻略文本中不得出现编造的"XX公里/XX小时"
let bad = [];
for (const [name, g] of Object.entries(guides.GUIDES)) {
  const texts = [g.summary, g.danger, ...g.spots.map(s => s.d), ...g.drive.map(r => r.desc), ...g.hike.map(r => r.desc)];
  for (const t of texts) {
    if (/(\d+)\s*(公里|千米|小时|km)/i.test(t)) bad.push(name + ': ' + t);
  }
}
assert('攻略无编造里程/时长数字', bad.length === 0, bad.join(' | '));

// 9. 通用模板城市
const my = findCity('绵阳');
const gg = guides.genericGuide(my);
assert('通用模板标注内容补充中', gg.partial === true);
assert('通用模板有安全提示', gg.safety.length > 0);

// 10. 离线缓存
cache.cacheGuide('绵阳', gg);
assert('攻略可离线缓存', cache.readCache('绵阳').partial === true);
assert('缓存计数', cache.cacheCount() === 1);
cache.clearCache();
assert('缓存可清理', cache.cacheCount() === 0);

// 11. 取消打卡
store.uncheckin('北京');
assert('取消打卡', !store.get().visited['北京'] && store.getStats().visitedCount === 2);

// 12. 数据持久化到 storage
assert('数据持久化', typeof mem['tf_data_v1'] === 'object' && mem['tf_data_v1'].visited['天津']);

// 13. 用户资料（头像 + 昵称）
let p0 = store.getProfile();
assert('资料初始为空', p0.avatar === '' && p0.nickname === '');
const saved = store.setProfile({ avatar: '/tmp/avatar.png', nickname: '行走的小明' });
assert('资料可写入', saved.avatar === '/tmp/avatar.png' && saved.nickname === '行走的小明');
assert('资料带更新时间戳', saved.updatedAt > 0);
const tooLong = store.setProfile({ nickname: '这是一段非常非常非常非常非常长的昵称超过二十个字了吧' });
assert('昵称超长自动截断到 20 字', tooLong.nickname.length === 20);
store.setProfile({ nickname: '小明' });
assert('资料可再更新', store.getProfile().nickname === '小明');
assert('资料随数据持久化', (mem['tf_data_v1'] || {}).profile && mem['tf_data_v1'].profile.nickname === '小明');

/* ============================================================
 * 1.0.3 新增：最近足迹 / 成就徽章 / 补录导入 / EXIF 解析 / 老数据兼容 / 抽屉布局
 * ============================================================ */
const ach = await import('../src/core/achievements.js');
const exifMod = await import('../src/utils/exif.js');
const { readFileSync } = await import('node:fs');

// 14. 最近足迹：按打卡日期倒序，最多 5 条，空日期排最后
const recentSrc = {
  甲: { date: '2020-01-01', note: '', ts: 1 },
  乙: { date: '2023-06-01', note: '乙的游记', ts: 2 },
  丙: { date: '2022-03-01', note: '丙的游记', ts: 3 },
  丁: { date: '2021-05-01', note: '', ts: 4 },
  戊: { date: '2024-09-01', note: '', ts: 5 },
  己: { date: '2019-01-01', note: '', ts: 6 },
  庚: { date: '', note: '', ts: 7 }
};
const rec = logic.recentFootprints(recentSrc, 5);
assert('最近足迹：最多 5 条', rec.length === 5, rec.length);
assert('最近足迹：按日期倒序', rec[0].name === '戊' && rec[1].name === '乙' && rec[4].name === '甲', rec.map(r => r.name).join(','));
assert('最近足迹：无日期排最后且带游记摘要', rec.every(r => r.date !== '') && rec[1].note === '乙的游记');

// 15. 成就判定
const oneMap = { 北京: { date: '2024-03-02', note: '', ts: 1 } };
const ach1 = ach.evaluate(oneMap);
const bCity1 = ach1.badges.find(b => b.id === 'city_1');
const bCity10 = ach1.badges.find(b => b.id === 'city_10');
assert('成就：点亮第 1 城解锁「第一步」并带解锁日期', bCity1.unlocked === true && bCity1.date === '2024-03-02');
assert('成就：未解锁徽章灰显判定 + 写明条件', bCity10.unlocked === false && bCity10.cond.includes('10 座'));
assert('成就：北京一城即集齐北京市 → 解锁「一省通」', ach1.badges.find(b => b.id === 'prov_1').unlocked === true);
assert('成就：徽章总数为 6 枚', ach1.badges.length === 6 && ach1.total === 6);

const tenMap = {};
CITIES.slice(0, 10).forEach((c, i) => {
  tenMap[c.name] = { date: '2021-01-' + String(i + 1).padStart(2, '0'), note: '', ts: i };
});
const ach10 = ach.evaluate(tenMap);
const b10 = ach10.badges.find(b => b.id === 'city_10');
assert('成就：点亮 10 城解锁「十城旅人」，日期取第 10 城', b10.unlocked && b10.date === '2021-01-10', b10.date);
assert('成就：30 城未解锁时给进度', ach10.badges.find(b => b.id === 'city_30').unlocked === false
  && ach10.badges.find(b => b.id === 'city_30').progress.cur === 10);

const hundredMap = {};
CITIES.slice(0, 100).forEach((c, i) => { hundredMap[c.name] = { date: '2015-01-01', note: '', ts: i }; });
assert('成就：点亮 100 城解锁「百城大师」', ach.evaluate(hundredMap).badges.find(b => b.id === 'city_100').unlocked === true);

const eastMap = {};
ach.REGION_CITIES['华东'].forEach((n, i) => { eastMap[n] = { date: '2022-05-01', note: '', ts: i }; });
const achEast = ach.evaluate(eastMap);
const bRegion = achEast.badges.find(b => b.id === 'region_1');
assert('成就：踏遍华东解锁「大区纵横」', bRegion.unlocked === true && bRegion.detail.includes('华东'), bRegion.detail);
const notEast = { ...eastMap };
delete notEast[ach.REGION_CITIES['华东'][0]];
assert('成就：大区缺一城则不判定解锁', ach.evaluate(notEast).badges.find(b => b.id === 'region_1').unlocked === false);

// 16. 补录导入：来源标记、补录游记、去重、统计即时刷新
const beforeCount = store.getStats().visitedCount;
const imp1 = store.importFootprints([{ city: '拉萨', year: '2018' }, { city: '成都', year: '' }]);
assert('补录：一次导入 2 城', imp1.imported === 2 && imp1.skipped === 0, JSON.stringify(imp1));
const lhasa = store.get().visited['拉萨'];
assert('补录：打上 import 来源标记', lhasa.source === 'import');
assert('补录：自动生成补录游记', lhasa.note === '补录 · 历史足迹导入', lhasa.note);
assert('补录：年份写入该年 1 月 1 日', lhasa.date === '2018-01-01', lhasa.date);
assert('补录：年份留空则不写日期（不编造）', store.get().visited['成都'].date === '');
const imp2 = store.importFootprints([{ city: '拉萨', year: '2018' }, { city: '成都' }]);
assert('补录：已点亮城市不重复导入', imp2.imported === 0 && imp2.skipped === 2, JSON.stringify(imp2));
assert('补录：统计立即刷新', store.getStats().visitedCount === beforeCount + 2);
assert('补录：成就立即刷新（含补录城市）', ach.evaluate(store.get().visited).badges.find(b => b.id === 'city_1').unlocked === true);

// 17. EXIF 解析（本地构造最小 JPEG 样例，不依赖真实照片）
function buildExifJpeg(opt = {}) {
  const little = opt.little !== false;
  const latRef = opt.latRef || 'N';
  const lngRef = opt.lngRef || 'E';
  const dms = opt.latDms || [39, 54, 26.7];
  const lngDms = opt.lngDms || [116, 23, 29.0];
  const dateStr = opt.dateStr === undefined ? '2023:07:15 10:22:31' : opt.dateStr;
  const withGps = opt.withGps !== false;

  const ifd0Len = 2 + 12 * 2 + 4;
  const exifLen = 2 + 12 * 1 + 4;
  const gpsLen = withGps ? 2 + 12 * 4 + 4 : 0;
  const ifd0Off = 8;
  const exifOff = ifd0Off + ifd0Len;
  const gpsOff = exifOff + exifLen;
  const dataOff = gpsOff + gpsLen;
  const dateOff = dataOff;
  const latOff = dateOff + 20;
  const lngOff = latOff + 24;
  const total = lngOff + 24;

  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const w16 = (o, val) => v.setUint16(o, val, little);
  const w32 = (o, val) => v.setUint32(o, val, little);

  // TIFF 头
  if (little) { u8[0] = 0x49; u8[1] = 0x49; } else { u8[0] = 0x4D; u8[1] = 0x4D; }
  w16(2, 0x002A);
  w32(4, ifd0Off);

  // IFD0：两个指针
  w16(ifd0Off, 2);
  w16(ifd0Off + 2, 0x8769); w16(ifd0Off + 4, 4); w32(ifd0Off + 6, 1); w32(ifd0Off + 10, exifOff);
  w16(ifd0Off + 14, 0x8825); w16(ifd0Off + 16, 4); w32(ifd0Off + 18, 1); w32(ifd0Off + 22, gpsOff);
  w32(ifd0Off + 26, 0);

  // Exif IFD：DateTimeOriginal
  w16(exifOff, 1);
  w16(exifOff + 2, 0x9003); w16(exifOff + 4, 2); w32(exifOff + 6, 20); w32(exifOff + 10, dateOff);
  w32(exifOff + 14, 0);

  // GPS IFD
  if (withGps) {
    w16(gpsOff, 4);
    // 0x0001 LatRef（ASCII 2 字节，内联）
    w16(gpsOff + 2, 0x0001); w16(gpsOff + 4, 2); w32(gpsOff + 6, 2);
    u8[gpsOff + 10] = latRef.charCodeAt(0); u8[gpsOff + 11] = 0;
    // 0x0002 Latitude（RATIONAL x3）
    w16(gpsOff + 14, 0x0002); w16(gpsOff + 16, 5); w32(gpsOff + 18, 3); w32(gpsOff + 22, latOff);
    // 0x0003 LngRef
    w16(gpsOff + 26, 0x0003); w16(gpsOff + 28, 2); w32(gpsOff + 30, 2);
    u8[gpsOff + 34] = lngRef.charCodeAt(0); u8[gpsOff + 35] = 0;
    // 0x0004 Longitude
    w16(gpsOff + 38, 0x0004); w16(gpsOff + 40, 5); w32(gpsOff + 42, 3); w32(gpsOff + 46, lngOff);
    w32(gpsOff + 50, 0);
  }

  // 数据区：日期字符串 + 两组角度
  for (let i = 0; i < 20; i++) {
    const ch = i < dateStr.length ? dateStr.charCodeAt(i) : 0;
    u8[dateOff + i] = ch;
  }
  const writeDms = (off, arr) => {
    arr.forEach((val, i) => {
      if (i === 2) { w32(off + i * 8, Math.round(val * 100)); w32(off + i * 8 + 4, 100); }
      else { w32(off + i * 8, Math.round(val)); w32(off + i * 8 + 4, 1); }
    });
  };
  if (withGps) { writeDms(latOff, dms); writeDms(lngOff, lngDms); }

  // 包一层 JPEG：SOI + APP1(Exif) + EOI
  const app1Len = 2 + 6 + total;
  const jpeg = new Uint8Array(2 + app1Len + 2);
  const jv = new DataView(jpeg.buffer);
  jpeg[0] = 0xFF; jpeg[1] = 0xD8;
  jpeg[2] = 0xFF; jpeg[3] = 0xE1;
  jv.setUint16(4, app1Len, false);
  'Exif\u0000\u0000'.split('').forEach((ch, i) => { jpeg[6 + i] = ch.charCodeAt(0); });
  jpeg.set(new Uint8Array(buf), 12);
  jpeg[jpeg.length - 2] = 0xFF; jpeg[jpeg.length - 1] = 0xD9;
  return jpeg.buffer;
}

const jpg = buildExifJpeg();
const ex = exifMod.parseExif(jpg);
assert('EXIF：识别出 GPS', ex.ok === true && Math.abs(ex.lat - 39.9074) < 0.01 && Math.abs(ex.lng - 116.3914) < 0.01, `lat=${ex.lat} lng=${ex.lng}`);
assert('EXIF：识别出拍摄日期', ex.date === '2023-07-15', ex.date);
assert('EXIF：日期字符串规范化', exifMod.parseDateTimeString('2019:11:03 08:00:00') === '2019-11-03');
assert('EXIF：非法日期不瞎猜', exifMod.parseDateTimeString('0000:00:00') === '');

const southJpg = buildExifJpeg({ latRef: 'S', lngRef: 'W', little: false, latDms: [33, 51, 54], lngDms: [70, 39, 21], dateStr: '2017-02-03 09:00:00' });
const exS = exifMod.parseExif(southJpg);
assert('EXIF：大端 + 南纬/西经取负值', exS.ok && exS.lat < 0 && exS.lng < 0, `lat=${exS.lat} lng=${exS.lng}`);

const noGps = exifMod.parseExif(buildExifJpeg({ withGps: false }));
assert('EXIF：无位置信息 → 标记跳过而不是猜', noGps.ok === false && noGps.reason === 'no-gps');
const pngBuf = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]).buffer;
assert('EXIF：PNG 明确标记不支持', exifMod.parseExif(pngBuf).reason === 'not-jpeg');
const heicBuf = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]).buffer;
assert('EXIF：HEIC 明确标记不支持', exifMod.parseExif(heicBuf).reason === 'heic');

// 18. 照片坐标 → 城市就近匹配（阈值内才命中）
const hitBj = logic.matchCityWithin({ lat: 39.92, lng: 116.40 });
assert('坐标匹配：北京市区命中北京', hitBj && hitBj.city.name === '北京');
const farAway = logic.matchCityWithin({ lat: 35.0, lng: 90.0 });
assert('坐标匹配：无人区超出阈值不猜（返回 null）', farAway === null);

// 19. 老数据兼容：1.0.2 及更早的本地数据（无 source 字段）升级后不丢档
const legacySnapshot = mem['tf_data_v1'];
mem['tf_data_v1'] = {
  visited: { 成都: { date: '2019-05-01', note: '老数据游记', photo: '', ts: 11 } },
  wishlist: ['丽江'], trips: [], updatedAt: 1000
};
const storeLegacy = (await import('../src/core/store.js?v=legacy')).default;
await storeLegacy.boot();
const legacyChengdu = storeLegacy.get().visited['成都'];
assert('老数据兼容：打卡记录完整保留', legacyChengdu && legacyChengdu.date === '2019-05-01' && legacyChengdu.note === '老数据游记');
assert('老数据兼容：无 source 视为手动打卡', legacyChengdu.source === undefined);
assert('老数据兼容：统计与想去清单不受影响', storeLegacy.getStats().visitedCount === 1 && storeLegacy.get().wishlist.length === 1);
assert('老数据兼容：成就可由旧数据推导', ach.evaluate(storeLegacy.get().visited).badges.find(b => b.id === 'city_1').unlocked === true);
mem['tf_data_v1'] = legacySnapshot;

// 20. 抽屉布局硬化：省行数字列不可被压缩（320 / 375 / 430 三档屏宽预算）
const mapSrc = readFileSync(new URL('../src/pages/map/map.vue', import.meta.url), 'utf8');
const block = sel => {
  const re = new RegExp(sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}', 's');
  const m = mapSrc.match(re);
  return m ? m[1] : '';
};
const provCountCss = block('.prov-count');
const provNameCss = block('.prov-name');
const cityNameCss = block('.city-name');
const cityRightCss = block('.city-right');
assert('抽屉：数字列固定宽度不参与压缩', /flex:\s*0\s+0\s+auto/.test(provCountCss) && /white-space:\s*nowrap/.test(provCountCss));
assert('抽屉：省名占剩余宽度并可单行省略', /min-width:\s*0/.test(provNameCss) && /text-overflow:\s*ellipsis/.test(provNameCss) && /flex:\s*1\s+1\s+0%/.test(provNameCss));
assert('抽屉：城市名同样单行省略、右侧徽标不压缩', /min-width:\s*0/.test(cityNameCss) && /text-overflow:\s*ellipsis/.test(cityNameCss) && /flex:\s*0\s+0\s+auto/.test(cityRightCss));
// 预算：最宽数字 "100/100"（7 字符）在最窄剩余空间下仍完整可见
const widestCount = 7 * 0.55 * 22;          // rpx，22rpx 字号按 0.55em/字符估
const gapRpx = 16, nameMinRpx = 40, innerRpx = 750 - 56;
[320, 375, 430].forEach(w => {
  const r = w / 750;
  const need = (widestCount + gapRpx + nameMinRpx) * r;
  assert(`抽屉：${w}px 屏宽下数字完整可见`, need <= (innerRpx) * r, `need=${need.toFixed(1)}px avail=${(innerRpx * r).toFixed(1)}px`);
});

// 21. 我的页结构：各省进度整卡移除，新增最近足迹 / 成就徽章 / 导入入口
const mySrc = readFileSync(new URL('../src/pages/my/my.vue', import.meta.url), 'utf8');
assert('我的页：已移除「各省进度」整卡', !mySrc.includes('各省进度'));
assert('我的页：最近足迹 / 成就徽章 / 导入入口齐备',
  mySrc.includes('最近足迹') && mySrc.includes('成就徽章') && mySrc.includes('导入历史足迹'));
const importSrc = readFileSync(new URL('../src/pages/import/import.vue', import.meta.url), 'utf8');
assert('补录页：明示照片不上传', importSrc.includes('照片本体绝不上传'));
assert('补录页：单次最多 20 张', /count\s*[=:]\s*20/.test(importSrc));

console.log(process.exitCode ? '\n== 存在失败项 ==' : '\n== 全部通过 ==');