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
const { CITIES, findCity, searchCity } = await import('../src/data/cities.js');
const { CONFIG } = await import('../src/config.js');

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

// 17. EXIF 解析（本地构造最小 JPEG / HEIC 样例，不依赖真实照片）
/** 只造 TIFF 结构（EXIF 的核心），JPEG 与 HEIC 都复用它 */
function buildTiff(opt = {}) {
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
  return u8;
}

function buildExifJpeg(opt = {}) {
  const tiff = buildTiff(opt);
  const total = tiff.length;

  // 包一层 JPEG：SOI + APP1(Exif) + EOI
  const app1Len = 2 + 6 + total;
  const jpeg = new Uint8Array(2 + app1Len + 2);
  const jv = new DataView(jpeg.buffer);
  jpeg[0] = 0xFF; jpeg[1] = 0xD8;
  jpeg[2] = 0xFF; jpeg[3] = 0xE1;
  jv.setUint16(4, app1Len, false);
  'Exif\u0000\u0000'.split('').forEach((ch, i) => { jpeg[6 + i] = ch.charCodeAt(0); });
  jpeg.set(tiff, 12);
  jpeg[jpeg.length - 2] = 0xFF; jpeg[jpeg.length - 1] = 0xD9;
  return jpeg.buffer;
}

const asciiBytes = (s, n) => {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = i < s.length ? s.charCodeAt(i) : 0;
  return a;
};

/**
 * 造最小 HEIC（ISO-BMFF）：ftyp + meta{ iinf(infe 里 item_type='Exif'), iloc, [idat] }
 * opt.prefix  Exif 数据块里 TIFF 前是否带 "Exif\0\0"
 * opt.idat    用 iloc v1 + construction_method=1（数据放 idat 盒内）而不是文件偏移
 */
function buildHeic(opt = {}) {
  const prefix = opt.prefix !== false;
  const declared = opt.declared === undefined ? (prefix ? 6 : 0) : opt.declared;
  const withIinf = opt.withIinf !== false;
  const useIdat = opt.idat === true;
  const tiff = buildTiff(opt);

  const payloadLen = 4 + (prefix ? 6 : 0) + tiff.length;
  const payload = new Uint8Array(payloadLen);
  new DataView(payload.buffer).setUint32(0, declared, false);
  if (prefix) payload.set(asciiBytes('Exif\u0000\u0000', 6), 4);
  payload.set(tiff, 4 + (prefix ? 6 : 0));

  const infeLen = 8 + 4 + 2 + 2 + 4 + 4;                  // v2：item_ID + protection + item_type + name
  const iinfLen = 8 + 4 + 2 + infeLen;
  const idatLen = 8 + payloadLen;
  const ilocLen = useIdat
    ? 8 + 4 + 2 + 2 + (2 + 2 + 2 + 2 + 4 + 4)             // v1 多一个 construction_method
    : 8 + 4 + 2 + 2 + (2 + 2 + 2 + 4 + 4);
  const ftypLen = 24;
  const metaLen = 8 + 4 + (withIinf ? iinfLen : 0) + ilocLen + (useIdat ? idatLen : 0);
  const dataStart = ftypLen + metaLen;

  const out = new Uint8Array(dataStart + (useIdat ? 0 : payloadLen));
  const dv = new DataView(out.buffer);
  const box = (at, size, type) => {
    dv.setUint32(at, size, false);
    out.set(asciiBytes(type, 4), at + 4);
  };

  // ftyp
  box(0, ftypLen, 'ftyp');
  out.set(asciiBytes('heic', 4), 8);
  dv.setUint32(12, 0, false);
  out.set(asciiBytes('mif1', 4), 16);
  out.set(asciiBytes('heic', 4), 20);

  // meta（FullBox）
  const metaAt = ftypLen;
  box(metaAt, metaLen, 'meta');
  dv.setUint32(metaAt + 8, 0, false);
  let cur = metaAt + 12;

  if (withIinf) {
    box(cur, iinfLen, 'iinf');
    dv.setUint32(cur + 8, 0, false);          // version 0
    dv.setUint16(cur + 12, 1, false);         // entry_count
    const infeAt = cur + 14;
    box(infeAt, infeLen, 'infe');
    out[infeAt + 8] = 2;                      // version 2
    dv.setUint16(infeAt + 12, 1, false);      // item_ID
    dv.setUint16(infeAt + 14, 0, false);      // protection_index
    out.set(asciiBytes('Exif', 4), infeAt + 16);
    out[infeAt + 20] = 0;                     // item_name
    cur += iinfLen;
  }

  box(cur, ilocLen, 'iloc');
  out[cur + 8] = useIdat ? 1 : 0;             // version
  out[cur + 12] = 0x44;                       // offset_size=4, length_size=4
  out[cur + 13] = 0x00;                       // base_offset_size=0 (+ index_size=0)
  dv.setUint16(cur + 14, 1, false);           // item_count
  dv.setUint16(cur + 16, 1, false);           // item_ID
  if (useIdat) dv.setUint16(cur + 18, 1, false);   // construction_method=1 → idat 内
  // data_reference_index / extent_count 位置随 version 不同，统一按偏移写
  const p = useIdat ? 20 : 18;
  dv.setUint16(cur + p, 0, false);            // data_reference_index
  dv.setUint16(cur + p + 2, 1, false);        // extent_count
  dv.setUint32(cur + p + 4, useIdat ? 0 : dataStart, false);   // extent_offset
  dv.setUint32(cur + p + 8, payloadLen, false);                // extent_length
  cur += ilocLen;

  if (useIdat) {
    box(cur, idatLen, 'idat');
    out.set(payload, cur + 8);
  } else {
    out.set(payload, dataStart);
  }
  return out.buffer;
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
// 17b. HEIC（ISO-BMFF）通道：1.2.0 新增，返回契约与 JPEG 完全一致
const heicBj = exifMod.parseExif(buildHeic());
assert('HEIC：解析出 GPS 坐标（39.9074 / 116.3914）',
  heicBj.ok === true && Math.abs(heicBj.lat - 39.9074) < 0.01 && Math.abs(heicBj.lng - 116.3914) < 0.01,
  `lat=${heicBj.lat} lng=${heicBj.lng}`);
assert('HEIC：解析出拍摄日期', heicBj.date === '2023-07-15' && heicBj.takenAt === '2023:07:15 10:22:31', heicBj.date);
assert('HEIC：返回字段与 JPEG 完全一致',
  Object.keys(heicBj).sort().join(',') === Object.keys(ex).sort().join(','),
  Object.keys(heicBj).join(','));
assert('HEIC：数据块不带 Exif\\0\\0 前缀也能定位 TIFF 头',
  exifMod.parseExif(buildHeic({ prefix: false })).ok === true);
assert('HEIC：iloc v1 + construction_method=1（数据在 idat 内）也能解析',
  exifMod.parseExif(buildHeic({ idat: true })).ok === true);
assert('HEIC：缺 iinf 时按 TIFF 头校验回退定位',
  exifMod.parseExif(buildHeic({ withIinf: false })).ok === true);
const heicS = exifMod.parseExif(buildHeic({
  little: false, latRef: 'S', lngRef: 'W', latDms: [33, 51, 54], lngDms: [70, 39, 21], dateStr: '2017-02-03 09:00:00'
}));
assert('HEIC：大端 + 南纬/西经取负值', heicS.ok && heicS.lat < 0 && heicS.lng < 0, `lat=${heicS.lat} lng=${heicS.lng}`);
const heicNoGps = exifMod.parseExif(buildHeic({ withGps: false }));
assert('HEIC：无 GPS → 标记跳过而不是猜', heicNoGps.ok === false && heicNoGps.reason === 'no-gps');
const heicTruncated = exifMod.parseExif(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]).buffer);
assert('HEIC：截断/坏文件不崩也不猜（bad-heic）', heicTruncated.ok === false && heicTruncated.reason === 'bad-heic', heicTruncated.reason);

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
const provHeadCss = block('.prov-head');
const provRowCss = block('.prov-row');
const provCountCss = block('.prov-count');
const provNameCss = block('.prov-name');
const cityRowCss = block('.city-row');
const cityNameCss = block('.city-name');
const cityRightCss = block('.city-right');
// 1.0.4 起改用绝对定位钉右，不再依赖 flex 收缩（真机 flex 方案仍会被切）
// 1.1.0 省行改成独立圆角卡，计数右侧再让出 40rpx 给行尾 ›
assert('抽屉：数字列绝对定位钉右、宽度固定、不换行',
  /position:\s*absolute/.test(provCountCss) && /right:\s*\d+rpx/.test(provCountCss) &&
  /width:\s*110rpx/.test(provCountCss) && /white-space:\s*nowrap/.test(provCountCss) &&
  /text-align:\s*right/.test(provCountCss) && /translateY\(-50%\)/.test(provCountCss));
assert('抽屉：省名块级 + 右侧预留固定宽度并可单行省略',
  /position:\s*relative/.test(provHeadCss) &&
  /display:\s*block/.test(provNameCss) && /margin-right:\s*168rpx/.test(provNameCss) &&
  /white-space:\s*nowrap/.test(provNameCss) && /text-overflow:\s*ellipsis/.test(provNameCss) &&
  /overflow:\s*hidden/.test(provNameCss));
assert('抽屉：城市行同样硬化（右列绝对定位 + 名称预留 90rpx）',
  /position:\s*relative/.test(cityRowCss) && /overflow:\s*hidden/.test(cityRowCss) &&
  /margin-right:\s*90rpx/.test(cityNameCss) && /text-overflow:\s*ellipsis/.test(cityNameCss) &&
  /position:\s*absolute/.test(cityRightCss) && /right:\s*\d+rpx/.test(cityRightCss));
assert('抽屉：省行/城市行均加 overflow:hidden 兜底',
  /overflow:\s*hidden/.test(provRowCss) && /overflow:\s*hidden/.test(cityRowCss));
// 城市行右列预算：「想去」徽标 + 箭头必须收在 90rpx 预留区内，否则会压到城市名
assert('抽屉：城市行徽标改用紧凑规格', /\.city-right\s+\.chip\s*\{[^}]*font-size:\s*20rpx/.test(mapSrc));
const chipRpx = 2 * 0.55 * 20 + 20 + 6;   // 2 字 + 左右内边距 + 右外边距
const arrowRpx = 0.6 * 22 + 8;            // 箭头 + 左外边距
assert('抽屉：城市行右列（徽标+箭头）收在 90rpx 预留区内', chipRpx + arrowRpx <= 90,
  `need=${(chipRpx + arrowRpx).toFixed(1)}rpx limit=90rpx`);

// 21. 返回全国按钮收进抽屉标题栏；定位条改为整行
assert('抽屉：顶部悬浮「返回全国」已移除', !/class="back-nation"/.test(mapSrc) && !/\.back-nation\s*\{/.test(mapSrc));
assert('抽屉：标题栏内含「⬅ 返回全国」胶囊，仅省视图显示且不冒泡',
  /class="back-pill"/.test(mapSrc) && /v-if="viewMode === 'province'"/.test(mapSrc) &&
  /@tap\.stop="backNation"/.test(mapSrc));
const locBannerCss = block('.loc-banner');
assert('定位条：改为整行左右各 24rpx + 单行省略',
  /left:\s*24rpx/.test(locBannerCss) && /right:\s*24rpx/.test(locBannerCss) &&
  !/max-width/.test(locBannerCss) && /white-space:\s*nowrap/.test(locBannerCss) &&
  /text-overflow:\s*ellipsis/.test(locBannerCss));
// 预算：最宽数字 "100/100"（7 字符）在最窄剩余空间下仍完整可见
const widestCount = 7 * 0.55 * 22;          // rpx，22rpx 字号按 0.55em/字符估
const gapRpx = 16, nameMinRpx = 40, innerRpx = 750 - 72;   // 1.1.1 胶囊行左右内边距各 36rpx
[320, 375, 430].forEach(w => {
  const r = w / 750;
  const need = (widestCount + gapRpx + nameMinRpx) * r;
  assert(`抽屉：${w}px 屏宽下数字完整可见`, need <= (innerRpx) * r, `need=${need.toFixed(1)}px avail=${(innerRpx * r).toFixed(1)}px`);
});

// 22. 我的页结构：各省进度整卡移除，新增最近足迹 / 成就徽章 / 导入入口
const mySrc = readFileSync(new URL('../src/pages/my/my.vue', import.meta.url), 'utf8');
assert('我的页：已移除「各省进度」整卡', !mySrc.includes('各省进度'));
assert('我的页：最近足迹 / 成就徽章 / 导入入口齐备',
  mySrc.includes('最近足迹') && mySrc.includes('成就徽章') && mySrc.includes('导入历史足迹'));
const importSrc = readFileSync(new URL('../src/pages/import/import.vue', import.meta.url), 'utf8');
const tripSrc = readFileSync(new URL('../src/pages/trip/trip.vue', import.meta.url), 'utf8');
// 行程页样式块提取（只取 <style> 里的规则，避免模板 class 干扰）
const tripBlock = sel => {
  const re = new RegExp(sel.replace(/[.-]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}');
  const m = tripSrc.match(re);
  return m ? m[1] : '';
};
assert('补录页：明示照片不上传', importSrc.includes('照片本体绝不上传'));
assert('补录页：单次最多 20 张', /count\s*[=:]\s*20/.test(importSrc));

// 23. 1.1.0 视觉规范：深海蓝玻璃 + 香槟金
const themeSrc = readFileSync(new URL('../src/styles/theme.scss', import.meta.url), 'utf8');
assert('1.1.0 主题：玻璃面板 token（深蓝 88% + 描边）',
  /rgba\(9,\s*30,\s*52,\s*0\.88\)/.test(themeSrc) && /rgba\(245,\s*240,\s*230,\s*0\.14\)/.test(themeSrc) &&
  /backdrop-filter:\s*blur/.test(themeSrc));
assert('1.1.0 主题：香槟金 #D9B36A 用于数字/选中/进度',
  themeSrc.includes('#D9B36A') && /\.bar\s*>\s*view\s*\{[^}]*#D9B36A/.test(themeSrc.replace(/\n/g, ' ')));
assert('1.1.0 主题：深海蓝微渐变 #0A1E34 → #0C2745',
  themeSrc.includes('#0A1E34') && themeSrc.includes('#0C2745'));
assert('1.1.0 主题：正文 #F2EDE3 / 次级 55% 米白',
  themeSrc.includes('#F2EDE3') && /rgba\(242,\s*237,\s*227,\s*0\.55\)/.test(themeSrc));
const pagesJson = JSON.parse(readFileSync(new URL('../src/pages.json', import.meta.url), 'utf8'));
assert('1.1.0 tabBar：选中态香槟金、未选中次级色',
  pagesJson.tabBar.selectedColor === '#D9B36A' && pagesJson.tabBar.color === '#7E93A8');
// 地图标记铁律：省级气泡全部移除，全国视图只给已打卡城市
assert('地图标记：省级进度气泡已全部移除', !mapSrc.includes('PROV_ABBR') && !mapSrc.includes('provAbbr'));
assert('地图标记：全国视图只渲染已打卡城市（无文字气泡）',
  /this\.viewMode === 'nation'[\s\S]{0,220}CITIES\.filter\(c => !!v\[c\.name\]\)/.test(mapSrc) &&
  !/display:\s*'ALWAYS'/.test(mapSrc.replace(/\n/g, ' ')));
assert('地图标记：省视图未打卡城市不挂文字', /if \(done\) \{\s*\n\s*m\.callout/.test(mapSrc));
const manifestSrc = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'));
assert('版本：1.5.1 / 151', manifestSrc.versionName === '1.5.1' && manifestSrc.versionCode === '151');
assert('配置：cloudEnv 已填入云开发环境 ID', CONFIG.cloudEnv === 'travel-checkin-d6g1yag6s4ceb9790',
  `cloudEnv=${JSON.stringify(CONFIG.cloudEnv)}`);

// 31. 1.3.5 构建后置：自动拷云函数 + 写 cloudfunctionRoot，否则开发者工具看不到云函数
const postbuildSrc = readFileSync(new URL('../scripts/postbuild.mjs', import.meta.url), 'utf8');
assert('1.3.5 postbuild：脚本含递归拷贝逻辑（拷 cloudfunctions）',
  /cpSync/.test(postbuildSrc) && /recursive:\s*true/.test(postbuildSrc) &&
  /cloudfunctions/.test(postbuildSrc));
assert('1.3.5 postbuild：脚本写入 cloudfunctionRoot 字段',
  /cloudfunctionRoot/.test(postbuildSrc) && /'cloudfunctions\/'/.test(postbuildSrc));

// 24. 1.1.1 终版：省行全胶囊 + 提亮填充 + 金色定位针 + 抽屉拖拽横条 + 顶部动态避让
const provRowCss111 = block('.prov-row');
const provPinCss = block('.prov-pin');
const provArrowCss = block('.prov-arrow');
const barCss111 = block('.prov-row .bar');
const grabCss = block('.sheet-grab');
const sheetTitleCss = block('.sheet-title');
assert('1.1.1 省行：全胶囊形（999rpx）+ 左右内边距 36rpx + 行距 12rpx',
  /border-radius:\s*999rpx/.test(provRowCss111) && /padding:\s*24rpx\s+36rpx/.test(provRowCss111) &&
  /margin-bottom:\s*12rpx/.test(provRowCss111));
assert('1.1.1 省行：提亮填充 + 提亮描边 + 悬浮阴影',
  /background:\s*rgba\(150,\s*180,\s*215,\s*0\.16\)/.test(provRowCss111) &&
  /border:\s*1rpx\s+solid\s+rgba\(235,\s*242,\s*250,\s*0\.28\)/.test(provRowCss111) &&
  /box-shadow:\s*0\s+6rpx\s+18rpx\s+rgba\(0,\s*0,\s*0,\s*0\.25\)/.test(provRowCss111));
assert('1.1.1 省行：金色定位针 30rpx + #D9B36A',
  /width:\s*30rpx/.test(provPinCss) && /height:\s*30rpx/.test(provPinCss) &&
  /background:\s*#D9B36A/.test(provPinCss) && /left:\s*0/.test(provPinCss));
assert('1.1.1 省行：计数与行尾箭头改亮白',
  /color:\s*#FFFFFF/.test(provCountCss) && /font-weight:\s*500/.test(provCountCss) &&
  /color:\s*#FFFFFF/.test(provArrowCss));
assert('1.1.1 省行：进度条右端收在计数列左侧（36+150 = 36+40+110）',
  /margin-right:\s*150rpx/.test(barCss111) && (36 + 150) === (36 + 40 + 110));
assert('1.1.1 抽屉：顶部居中拖拽横条 64×8rpx 白色 25%',
  /class="sheet-grab"/.test(mapSrc) && /width:\s*64rpx/.test(grabCss) && /height:\s*8rpx/.test(grabCss) &&
  /rgba\(255,\s*255,\s*255,\s*0\.25\)/.test(grabCss) && /margin:\s*14rpx\s+auto\s+0/.test(grabCss));
assert('1.1.1 抽屉：标题 30rpx 加粗', /font-size:\s*30rpx/.test(sheetTitleCss) && /font-weight:\s*700/.test(sheetTitleCss));
assert('1.1.1 顶部：统计卡按胶囊实测 bottom + 16rpx 动态下移',
  /getMenuButtonBoundingClientRect/.test(mapSrc) && /rect\.bottom/.test(mapSrc) &&
  /bottomPx \+ 16 \* rpx2px/.test(mapSrc) && /paddingTop:\s*statsTop \+ 'rpx'/.test(mapSrc));
assert('1.1.1 顶部：取不到胶囊时兜底「状态栏 + 96rpx」',
  /statusBarHeight \|\| 20\) \+ 96/.test(mapSrc));
assert('1.1.1 顶部：定位胶囊随统计卡同步下移',
  /top:\s*\(statsTop \+ 162\) \+ 'rpx'/.test(mapSrc));

// 25. 1.2.0 导入升级：微信文件 GPX / KML 轨迹（纯本地解析，不联网）
const track = await import('../src/utils/track.js');

const gpxSample = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="headless">
 <wpt lat="25.6065" lon="100.2676"><name>大理古城</name><time>2016-08-02T09:15:00Z</time></wpt>
 <trk><name>滇西</name><trkseg>
  <trkpt lat="26.8721" lon="100.2299"><ele>2400</ele><time>2018-03-11T10:20:00Z</time></trkpt>
  <trkpt lat="39.9042" lon="116.4074"><time>2017-01-01T00:00:00Z</time></trkpt>
  <trkpt lat="abc" lon="100.1000"/>
  <trkpt lat="0" lon="0"/>
  <trkpt lat="91" lon="100"/>
 </trkseg></trk>
</gpx>`;
const gpxPts = track.parseGpxPoints(gpxSample);
assert('GPX：解析 trkpt / wpt 的经纬度与 time', gpxPts.points.length === 3 && gpxPts.points[0].lat === 25.6065
  && gpxPts.points[0].time === '2016-08-02T09:15:00Z', JSON.stringify(gpxPts.points));
assert('GPX：非法坐标与 (0,0) 占位点全部跳过', !gpxPts.points.some(p => p.lat === 0 || Math.abs(p.lat) > 90));
const gpxCities = track.citiesFromPoints(gpxPts.points, p => logic.matchCityWithin(p));
assert('GPX：轨迹点复用 matchCityWithin 汇总成城市集合',
  gpxCities.map(c => c.name).sort().join(',') === ['北京', '大理白族自治州', '丽江'].sort().join(','),
  gpxCities.map(c => c.name).join(','));
assert('GPX：每城取最早轨迹日期作年份',
  gpxCities.find(c => c.name === '大理白族自治州').date === '2016-08-02'
  && gpxCities.find(c => c.name === '北京').date === '2017-01-01', JSON.stringify(gpxCities));

const kmlSample = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString><coordinates>
  100.2676,25.6065,2000 102.7125,25.0406,1890 116.4074,39.9042,44
</coordinates></LineString></Placemark></Document></kml>`;
const kmlPts = track.parseKmlPoints(kmlSample);
assert('KML：解析 coordinates 三元组（lng,lat,alt）',
  kmlPts.points.length === 3 && Math.abs(kmlPts.points[0].lng - 100.2676) < 1e-9 && Math.abs(kmlPts.points[0].lat - 25.6065) < 1e-9,
  JSON.stringify(kmlPts.points));
const kmlCities = track.citiesFromPoints(kmlPts.points, p => logic.matchCityWithin(p));
assert('KML：不带时间信息 → 年份留空不编造', kmlCities.length === 3 && kmlCities.every(c => c.date === ''));
assert('轨迹格式识别：扩展名 / 文件头，都不认识就 unknown',
  track.detectTrackFormat('a.GPX', '') === 'gpx' && track.detectTrackFormat('b.kml', '') === 'kml'
  && track.detectTrackFormat('c.txt', '<gpx>') === 'gpx' && track.detectTrackFormat('d.txt', 'hello') === 'unknown');

// 抽样上限：3 万个互不重复的点 → 正好 5000 点参与城市匹配
let bigGpx = '<gpx><trk><trkseg>';
for (let i = 0; i < 30000; i++) {
  const lat = 20 + Math.floor(i / 200) * 0.002;
  const lng = 100 + (i % 200) * 0.002;
  bigGpx += `<trkpt lat="${lat.toFixed(3)}" lon="${lng.toFixed(3)}"><time>2021-06-01T00:00:00Z</time></trkpt>`;
}
bigGpx += '</trkseg></trk></gpx>';
const bigParsed = track.parseGpxPoints(bigGpx);
assert('抽样：单文件最多取 5000 个轨迹点',
  bigParsed.total === 30000 && bigParsed.points.length === track.TRACK_POINT_LIMIT,
  `${bigParsed.total}/${bigParsed.points.length}`);

// 补录页：第三个入口（1.2.2 起含照片原图，修微信选图剥离定位）
assert('补录页：第三个入口走 wx.chooseMessageFile，认 gpx/kml/heic/heif/jpg/jpeg，最多 20 个',
  /chooseMessageFile/.test(importSrc) && /extension:\s*\[\s*'gpx'\s*,\s*'kml'\s*,\s*'heic'\s*,\s*'heif'\s*,\s*'jpg'\s*,\s*'jpeg'\s*\]/.test(importSrc) &&
  /count:\s*20/.test(importSrc));
assert('1.2.2 文件通道：图片扩展名按正则分流，与轨迹分开处理',
  /\(heic\|heif\|jpe\?g\)\$\/i/.test(importSrc) && /imagePaths\.push\(f\.path\)/.test(importSrc));
assert('1.2.2 文件通道：图片原图并入照片通道（handleFiles 静默 toast，避免双提示）',
  /handleFiles\(imagePaths,\s*\{\s*silentToast:\s*true\s*\}\)/.test(importSrc) &&
  /opts\.silentToast/.test(importSrc));
assert('1.2.2 文案：照片入口下有「微信选图剥离定位、改走文件导入」的如实提示',
  importSrc.includes('微信选图时剥离了定位') && importSrc.includes('可完整保留定位'));
assert('补录页：三个入口按 ①②③ 排列，汇总卡改为 ④',
  importSrc.includes('① 照片一键识别') && importSrc.includes('② 点选补录') &&
  importSrc.includes('③ 从微信文件导入') && importSrc.includes('④ 待导入城市'));
assert('补录页：轨迹通道同样明示不联网、不上传', importSrc.includes('不联网、不上传'));
assert('补录页：HEIC 原图已改为支持（不再标为跳过）', importSrc.includes('HEIC 原图都支持'));
assert('补录页：轨迹文件零命中计入跳过并给出原因',
  /skipFileNoPoints/.test(importSrc) && /skipFileNoCity/.test(importSrc) && /skipFileRead/.test(importSrc));
assert('补录页：解析结果统一走 importFootprints', /store\.importFootprints\(/.test(importSrc));

// 26. 1.2.1 定点修：省份行计数/箭头以整行为基准垂直居中 + 左右边距由行自身控制
const provRowCss121 = block('.prov-row');
const provCountCss121 = block('.prov-count');
const provArrowCss121 = block('.prov-arrow');
const sheetBodyShowCss = block('.sheet-body.show');
const headClose = mapSrc.indexOf('</view>', mapSrc.indexOf('class="prov-name"'));
assert('1.2.1 省行：左右边距改由行自身控制（各 24rpx）',
  /margin-left:\s*24rpx/.test(provRowCss121) && /margin-right:\s*24rpx/.test(provRowCss121));
assert('1.2.1 抽屉：.sheet-body 横向 padding 已去掉',
  /padding:\s*0\s+0\s+32rpx/.test(sheetBodyShowCss) && !/24rpx/.test(sheetBodyShowCss));
assert('1.2.1 省行：计数/箭头不再嵌在 .prov-head 内（定位基准改为整行）',
  headClose > 0 && mapSrc.indexOf('class="prov-count"') > headClose && mapSrc.indexOf('class="prov-arrow"') > headClose,
  `headClose=${headClose}`);
assert('1.2.1 省行：计数/箭头以整行 50% 垂直居中',
  /top:\s*50%/.test(provCountCss121) && /translateY\(-50%\)/.test(provCountCss121) &&
  /top:\s*50%/.test(provArrowCss121) && /translateY\(-50%\)/.test(provArrowCss121));
assert('1.2.1 省行：右偏移补上 36rpx 行内 padding，视觉位置与 1.1.1 一致',
  /right:\s*76rpx/.test(provCountCss121) && /right:\s*36rpx/.test(provArrowCss121) &&
  (36 + 40) === 76);
assert('1.2.1 省行：胶囊圆角/填充/金针/进度条未改',
  /border-radius:\s*999rpx/.test(provRowCss121) &&
  /rgba\(150,\s*180,\s*215,\s*0\.16\)/.test(provRowCss121) &&
  /width:\s*30rpx/.test(provPinCss) && /margin-right:\s*150rpx/.test(barCss111));
assert('1.2.1 城市行：补同样的左右边距，列表观感不变',
  /margin-left:\s*24rpx/.test(cityRowCss) && /margin-right:\s*24rpx/.test(cityRowCss));

// 27. 1.3.0 行程页：添加城市改搜索式弹层（替代系统滚轮选择器）
assert('1.3.0 行程页：系统滚轮选择器已移除', !/<picker\s/.test(tripSrc) && !/pickNames/.test(tripSrc));
assert('1.3.0 行程页：深色玻璃底部弹层 + 搜索框已上线',
  /sheet-mask/.test(tripSrc) && /sheet-search/.test(tripSrc) && /rgba\(9,\s*30,\s*52/.test(tripSrc));
assert('1.3.0 行程页：无输入时先列想去、再按省份分组',
  tripSrc.includes('★ 想去') && /citiesOfProv\(p\)/.test(tripSrc) && /wishCities/.test(tripSrc));
assert('1.3.0 行程页：点选为切换式，底部有完成（N）按钮',
  /togglePick\(c\.name\)/.test(tripSrc) && /draftList\.indexOf\(name\)/.test(tripSrc) &&
  tripSrc.includes('完成（{{ draftList.length }}）'));
assert('1.3.0 行程页：确认后按 draft 顺序落位且旧计算结果作废',
  /this\.cities = this\.draftList\.map/.test(tripSrc) && /this\.result = null/.test(tripSrc));
assert('1.3.0 搜索过滤：省份名能命中城市（云南 → 大理）',
  CITIES.filter(c => c.name.includes('云南') || c.prov.includes('云南')).some(c => c.name === '大理白族自治州'));
assert('1.3.0 搜索过滤：城市名关键词直达（喀什）',
  CITIES.filter(c => c.name.includes('喀什') || c.prov.includes('喀什')).length >= 1);
assert('1.3.0 搜索过滤：无直达时别名兜底（香格里拉 → 迪庆）',
  searchCity('香格里拉').length === 1 && searchCity('香格里拉')[0].prov === '云南省');
assert('1.3.0 行程页：里程/天数计算入口未动', /tripMileage/.test(tripSrc) && /suggestDays/.test(tripSrc));

// 28. 1.3.1 行程页弹层放大 + 列表滚动修复
const sheetCss131 = tripBlock('.sheet');
const sheetListCss131 = tripBlock('.sheet-list');
assert('1.3.1 弹层：高度改为固定 86vh（不再是 max-height）',
  /height:\s*86vh/.test(sheetCss131) && !/max-height/.test(sheetCss131),
  `sheet: ${JSON.stringify(sheetCss131.trim())}`);
assert('1.3.1 弹层：仍是纵向 flex 容器（配合高度撑满）',
  /display:\s*flex/.test(sheetCss131) && /flex-direction:\s*column/.test(sheetCss131));
assert('1.3.1 列表：flex:1 + height:0 + min-height:0（真机可滚的关键）',
  /flex:\s*1(;|\s|$)/.test(sheetListCss131) && /height:\s*0(;|\s|$)/.test(sheetListCss131) &&
  /min-height:\s*0(;|\s|$)/.test(sheetListCss131) && !/min-height:\s*200rpx/.test(sheetListCss131),
  `sheet-list: ${JSON.stringify(sheetListCss131.trim())}`);
assert('1.3.1 列表：scroll-view 显式开启滚动条',
  /<scroll-view[^>]*scroll-y[^>]*:show-scrollbar="true"/.test(tripSrc));
assert('1.3.1 搜索框与过滤逻辑未动',
  tripSrc.includes('placeholder="搜城市名或省份名，如：大理 / 云南"') &&
  /@input="onPickSearch"/.test(tripSrc) &&
  /const kw = \(this\.pickKw \|\| ''\)\.trim\(\)/.test(tripSrc) &&
  /CITIES\.filter\(c => c\.name\.includes\(kw\) \|\| c\.prov\.includes\(kw\)\)/.test(tripSrc));

// 29. 1.3.2 行程页搜索框与城市行等高
const sheetSearchCss132 = tripBlock('.sheet-search');
const pickLineCss132 = tripBlock('.pick-line');
assert('1.3.2 搜索框：height 88rpx + line-height 88rpx（占位文字不再被裁切）',
  /height:\s*88rpx/.test(sheetSearchCss132) && /line-height:\s*88rpx/.test(sheetSearchCss132),
  `sheet-search: ${JSON.stringify(sheetSearchCss132.trim())}`);
assert('1.3.2 搜索框：border-radius 20rpx + padding 0 28rpx（与 .pick-line 同圆角同内边距）',
  /border-radius:\s*20rpx/.test(sheetSearchCss132) && /padding:\s*0\s+28rpx/.test(sheetSearchCss132) &&
  !/border-radius:\s*999rpx/.test(sheetSearchCss132) && !/padding:\s*18rpx/.test(sheetSearchCss132));
assert('1.3.2 搜索框：外层观感与城市行一致（背景/描边/字号保留）',
  /rgba\(245,\s*240,\s*230,\s*0\.06\)/.test(sheetSearchCss132) &&
  /border-radius:\s*20rpx/.test(pickLineCss132) &&
  /font-size:\s*27rpx/.test(sheetSearchCss132));

/* ===== 30. 1.3.3 冷启动回归：import store 就恢复存档，写操作不再用空状态冲掉老档 =====
 * 真跑一遍冷启动：把存档预塞进存储桩 → 用全新模块实例重新导入 store（query 让 ESM 缓存失效）
 * → 不调 boot、不做任何初始化，直接读 get() 看存档在不在 → 再写一个新城市看老城还在不在。
 */
const appSrc = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8');

// 冷启动前的存档：已点亮南京、上海，想去里有拉萨
mem['tf_data_v1'] = {
  visited: {
    南京: { date: '2019-04-05', note: '', photo: '', ts: 1 },
    上海: { date: '2020-10-01', note: '外滩', photo: '', ts: 2 }
  },
  wishlist: ['拉萨'],
  trips: [],
  profile: { avatar: '', nickname: '', updatedAt: 0, syncedAt: 0 }
};

// 全新模块实例 = 模拟冷启动（?cold=1 使 ESM 走独立实例，state 从空白开始）
const coldMod = await import('../src/core/store.js?cold=1');
const coldStore = coldMod.default;

assert('1.3.3 冷启动：仅 import 就恢复存档（未调用 boot、未做任何写操作）',
  !!coldStore.get().visited['南京'] && !!coldStore.get().visited['上海'] &&
  coldStore.get().wishlist.includes('拉萨'),
  `visited=${JSON.stringify(Object.keys(coldStore.get().visited))}`);
assert('1.3.3 冷启动：恢复的字段完整（日期/笔记不丢）',
  Object.keys(coldStore.get().visited).length === 2 &&
  coldStore.get().visited['上海'].date === '2020-10-01' &&
  coldStore.get().visited['上海'].note === '外滩');

// 冷启动后直接写一个新城市（这正是老版本「点一下就冲掉存档」的动作）
await coldStore.checkin('北京', { date: '2026-10-20', note: '' });
const persisted = mem['tf_data_v1'];
assert('1.3.3 冷启动：写操作后新老城市都在存档里（南京/上海/北京齐全）',
  !!persisted && !!persisted.visited && !!persisted.visited['南京'] &&
  !!persisted.visited['上海'] && !!persisted.visited['北京'] &&
  Object.keys(persisted.visited).length === 3,
  `persisted=${JSON.stringify(persisted && Object.keys(persisted.visited || {}))}`);

// 守卫：把存储换回旧快照再 boot()，内存里的新数据不能被旧存档盖回去
mem['tf_data_v1'] = {
  visited: { 南京: { date: '2019-04-05', note: '', photo: '', ts: 1 } },
  wishlist: [],
  trips: []
};
await coldStore.boot();
assert('1.3.3 冷启动：boot() 内的二次 load 被守卫挡住，内存新数据未被旧存档覆盖',
  !!coldStore.get().visited['北京'] && !!coldStore.get().visited['上海'],
  `after boot=${JSON.stringify(Object.keys(coldStore.get().visited))}`);

assert('1.3.3 App.vue：onLaunch 里补调 store.boot()',
  /import store from '\.\/core\/store\.js'/.test(appSrc) &&
  /onLaunch\s*\(/.test(appSrc) && /store\.boot\(\)/.test(appSrc));
assert('1.3.3 store：模块顶层自启 load + migrate，且在 export default 之前',
  /^load\(\);\s*$/m.test(readFileSync(new URL('../src/core/store.js', import.meta.url), 'utf8')) &&
  /^migrate\(\);\s*$/m.test(readFileSync(new URL('../src/core/store.js', import.meta.url), 'utf8')) &&
  readFileSync(new URL('../src/core/store.js', import.meta.url), 'utf8').indexOf('load();') <
  readFileSync(new URL('../src/core/store.js', import.meta.url), 'utf8').indexOf('export default {'));

/* ===== 32. 1.4.0 空状态补内容：环线模板 / 抽卡机 / 正当时令 / 彩带 ===== */
const routes = await import('../src/data/routes.js');

// 环线模板：4 条、城市名全部 findCity 命中
assert('1.4.0 routes：4 条环线模板，城市名全部 findCity 命中',
  Array.isArray(routes.ROUTE_TEMPLATES) && routes.ROUTE_TEMPLATES.length === 4 &&
  routes.ROUTE_TEMPLATES.every(r => Array.isArray(r.cities) && r.cities.length >= 4 &&
    r.cities.every(n => !!findCity(n))),
  JSON.stringify(routes.ROUTE_TEMPLATES.map(r => r.name)));
assert('1.4.0 routes：每条含名称 / 描述 / 城市序列',
  routes.ROUTE_TEMPLATES.every(r => typeof r.name === 'string' && r.name &&
    typeof r.desc === 'string' && r.desc && Array.isArray(r.cities)));

// seasonMatch 五种用例（区间 / 单月 / 跨年 / 全年 / 无法解析）+ 括号外泄
assert('1.4.0 seasonMatch：区间（3-5月、9-11月）',
  logic.seasonMatch('3-5月、9-11月', 4) === true &&
  logic.seasonMatch('3-5月、9-11月', 10) === true &&
  logic.seasonMatch('3-5月、9-11月', 7) === false);
assert('1.4.0 seasonMatch：单月（6月）',
  logic.seasonMatch('6月', 6) === true && logic.seasonMatch('6月', 5) === false);
assert('1.4.0 seasonMatch：跨年区间（10-4月 / 12-2月）',
  logic.seasonMatch('10-4月', 12) === true && logic.seasonMatch('10-4月', 2) === true &&
  logic.seasonMatch('10-4月', 7) === false &&
  logic.seasonMatch('12-2月(冰雪)', 1) === true && logic.seasonMatch('12-2月(冰雪)', 6) === false);
assert('1.4.0 seasonMatch：全年 / 四季皆宜恒匹配',
  logic.seasonMatch('全年', 1) === true && logic.seasonMatch('四季皆宜', 7) === true);
assert('1.4.0 seasonMatch：无法解析返回 false',
  logic.seasonMatch('内容补充中', 5) === false && logic.seasonMatch('', 5) === false &&
  logic.seasonMatch(null, 5) === false);
assert('1.4.0 seasonMatch：括号里的无关月份不参与匹配',
  logic.seasonMatch('4-5月（菊花花期在10-11月）', 10) === false &&
  logic.seasonMatch('4-5月（菊花花期在10-11月）', 4) === true);

// drawPool：排除已打卡、99 城优先，全打卡后才扩池
const drawP = logic.drawPool({ '北京': {} });
assert('1.4.0 drawPool：排除已打卡且只放有攻略的 99 城',
  Array.isArray(drawP) && !drawP.includes('北京') &&
  drawP.length === Object.keys(guides.GUIDES).length - 1 &&
  drawP.every(n => !!guides.GUIDES[n]),
  `pool=${drawP.length}`);
assert('1.4.0 drawPool：99 城全打卡后才扩到全部未打卡城市',
  (() => {
    const all = {};
    Object.keys(guides.GUIDES).forEach(n => { all[n] = {}; });
    const p = logic.drawPool(all);
    return p.length > 0 && p.every(n => !guides.GUIDES[n]) && p.every(n => !all[n]);
  })());

// seasonalCities：按月过滤
const oct = logic.seasonalCities(10, {});
assert('1.4.0 seasonalCities：10 月含北京，只取前 10 且有攻略',
  oct.includes('北京') && oct.length > 0 && oct.length <= 10 && oct.every(n => !!guides.GUIDES[n]),
  `n=${oct.length}`);
assert('1.4.0 seasonalCities：已打卡城市被排除',
  !logic.seasonalCities(10, { '北京': {} }).includes('北京'));
assert('1.4.0 seasonalCities：返回城市均满足当月匹配',
  oct.every(n => logic.seasonMatch(guides.GUIDES[n].season, 10)));

// confetti 工具
const confettiSrc = readFileSync(new URL('../src/utils/confetti.js', import.meta.url), 'utf8');
assert('1.4.0 confetti：工具存在且含清理逻辑',
  /export function clearConfetti/.test(confettiSrc) && /clearTimeout/.test(confettiSrc) &&
  /export function playConfetti/.test(confettiSrc));

// 想去页：抽卡机 + 正当时令 + 彩带触发 + 清理
const wishSrc = readFileSync(new URL('../src/pages/wishlist/wishlist.vue', import.meta.url), 'utf8');
assert('1.4.0 想去页：抽卡机与正当时令关键结构',
  wishSrc.includes('抽一座城') && wishSrc.includes('正当时令') &&
  /seasonalCities|drawPool/.test(wishSrc));
assert('1.4.0 想去页：抽卡定格处触发彩带，且 onHide/onUnload 清理',
  /playConfetti\(/.test(wishSrc) && /confettiOn/.test(wishSrc) &&
  /clearConfetti\(/.test(wishSrc) && /clearInterval\(/.test(wishSrc) &&
  /onHide\s*\(/.test(wishSrc) && /onUnload\s*\(/.test(wishSrc));
assert('1.4.0 想去页：非空时底部紧凑入口复用抽卡',
  /draw-entry/.test(wishSrc) && /list\.length\s*&&\s*!drawOpen/.test(wishSrc) && /openDraw/.test(wishSrc));

// 行程页：模板区 + 一键载入 + 想去一键成行
const tripSrc2 = readFileSync(new URL('../src/pages/trip/trip.vue', import.meta.url), 'utf8');
assert('1.4.0 行程页：环线模板区 + 一键载入',
  /ROUTE_TEMPLATES/.test(tripSrc2) && tripSrc2.includes('一键载入') && /loadTemplate\s*\(/.test(tripSrc2));
assert('1.4.0 行程页：想去一键成行（wishlist≥2 显示）',
  tripSrc2.includes('一键串成环线') && /wishlist\.length\s*>=\s*2/.test(tripSrc2) && /loadWishList\s*\(/.test(tripSrc2));

/* ===== 33. 1.4.1 抽卡变脸修复 + 礼花喷射彩带 ===== */
// A. 抽卡结果变脸：draw() 先定 _target，末段钉住，finishDraw 直接用、不再随机
const drawBody = (() => {
  const i = wishSrc.indexOf('    draw() {');
  const j = wishSrc.indexOf('    stopRoll() {', i);
  return i >= 0 && j > i ? wishSrc.slice(i, j) : '';
})();
const finishBody = (() => {
  const i = wishSrc.indexOf('    finishDraw() {');
  const j = wishSrc.indexOf('    addDrawnWish() {', i);
  return i >= 0 && j > i ? wishSrc.slice(i, j) : '';
})();
assert('1.4.1 抽卡：finishDraw 函数体内不含 Math.random（结果不重抽）',
  finishBody.length > 0 && !/Math\.random/.test(finishBody) && /this\._target/.test(finishBody));
assert('1.4.1 抽卡：draw() 开场定选 _target（取自 drawPool）',
  /this\._target\s*=\s*pool\[/.test(drawBody) && /drawPool\(/.test(drawBody));
assert('1.4.1 抽卡：末段（≥950ms）rollName 固定为 _target 并保持到结束',
  /t\s*>=\s*950/.test(drawBody) && /this\.rollName\s*=\s*this\._target/.test(drawBody));

// B. 彩带：canvas 粒子引擎
assert('1.4.1 confetti：鲜艳配色七色齐全 + 香槟金仅作点缀',
  ['#FF4757', '#FF9F43', '#FFD32A', '#2ED573', '#54A0FF', '#A55EEA', '#FD79A8'].every(c => confettiSrc.includes(c)) &&
  /ACCENT_RATIO\s*=\s*0\.1/.test(confettiSrc) && /CONFETTI_ACCENT/.test(confettiSrc));
assert('1.4.1 confetti：粒子引擎含初速度 / 重力 / 阻力 / 自旋转 / 生命周期',
  /vx\s*:/.test(confettiSrc) && /vy\s*:/.test(confettiSrc) &&
  /GRAVITY/.test(confettiSrc) && /AIR_DRAG/.test(confettiSrc) &&
  /vr\s*:/.test(confettiSrc) && /life\s*\+=/.test(confettiSrc) && /maxLife/.test(confettiSrc) &&
  /export function createBurst/.test(confettiSrc) && /export function stepParticles/.test(confettiSrc));
assert('1.4.1 confetti：双喷口 + 停帧清理（rAF / 定时器）',
  /NOZZLE_LEFT/.test(confettiSrc) && /NOZZLE_RIGHT/.test(confettiSrc) &&
  /cancelAnimationFrame/.test(confettiSrc) && /clearTimeout/.test(confettiSrc) &&
  /export function clearConfetti/.test(confettiSrc) && /stopped/.test(confettiSrc));
assert('1.4.1 confetti：旧 CSS 飘落实现已移除（无 confettiPieces / keyframes）',
  !/confettiPieces/.test(confettiSrc) && !/@keyframes/.test(confettiSrc) &&
  !/confetti-fall/.test(wishSrc) && !/confetti-layer/.test(wishSrc) && !/confettiParts/.test(wishSrc));
assert('1.4.1 想去页：抽卡定格处触发 canvas 喷射，按窗口尺寸 + 像素比设画布',
  /type="2d"/.test(wishSrc) && /getContext\('2d'\)/.test(wishSrc) &&
  /confetti\.playConfetti\(/.test(wishSrc) && /canvas:\s*canvas/.test(wishSrc) &&
  /pixelRatio/.test(wishSrc) && /canvas\.width\s*=/.test(wishSrc) && /windowWidth/.test(wishSrc));
assert('1.4.1 想去页：onHide / onUnload 停引擎清帧',
  (() => {
    const grab = (key) => {
      const i = wishSrc.indexOf(key + '()');
      const j = wishSrc.indexOf('},', i);
      return i >= 0 && j > i ? wishSrc.slice(i, j) : '';
    };
    const hide = grab('onHide');
    const unload = grab('onUnload');
    return /clearConfetti\(\)/.test(hide) && /clearConfetti\(\)/.test(unload) &&
      /stopRoll\(\)/.test(hide) && /stopRoll\(\)/.test(unload);
  })());

// B'. 引擎纯函数实跑：出片数、双喷口仰射、生命耗尽后归零
const cf = await import('../src/utils/confetti.js');
const burst = cf.createBurst(375, 667, cf.CONFETTI_COUNT);
assert('1.4.1 confetti：单次 90 片，全部向上喷出并分左右两喷口',
  burst.length === 90 &&
  burst.every(p => p.vy < 0 && p.x >= 0 && p.x <= 375) &&
  burst.some(p => p.x < 375 * 0.3 && p.vx > 0) &&   // 左喷口向右上
  burst.some(p => p.x > 375 * 0.7 && p.vx < 0) &&   // 右喷口向左上
  burst.every(p => cf.CONFETTI_COLORS.includes(p.color) || p.color === cf.CONFETTI_ACCENT),
  `n=${burst.length}`);
assert('1.4.1 confetti：粒子约 2s 内自然消亡（生命周期生效）',
  (() => {
    const list = cf.createBurst(375, 667, 90);
    let alive = 0;
    for (let i = 0; i < 130; i++) alive = cf.stepParticles(list, 1 / 60, 375, 667); // ≈2.17s
    return alive === 0;
  })());

/* ===== 34. 1.4.2 彩带喷高（初速 2.0+0.6·屏高、阻力 0.975）===== */
// 实跑仿真：390×800 画布上，纸片最高点的中位数应达到屏高 55% 以上（旧参数约 37%），且不冲出顶部
assert('1.4.2 confetti：喷射高度达标（最高点中位 ≥ 屏高 55%、最高 ≤ 100%）',
  (() => {
    const W = 390, H = 800, dt = 1 / 60;
    const parts = cf.createBurst(W, H, 90);
    const mins = parts.map(() => H);
    for (let t = 0; t < 2.2; t += dt) {
      cf.stepParticles(parts, dt, W, H);
      parts.forEach((p, i) => { if (p.y < mins[i]) mins[i] = p.y; });
    }
    const pct = mins.map(y => (H - y) / H * 100).sort((a, b) => a - b);
    return pct[45] >= 55 && pct[89] <= 100;
  })());

/* ===== 34. 1.5.0 A：足迹报告（时间序 / 里程 / 四极 / 最长段 / 跨度 / 探索度 + 海报版式） ===== */
const DAY = 86400000;
const T0 = 1600000000000;
const vDemo = {
  '北京': { ts: T0 + 3 * DAY, date: '2023-11-15' },   // 乱序写入：北京最晚
  '上海': { ts: T0, date: '2020-09-13' },             // 最早
  '拉萨': { ts: T0 + DAY, date: '2022-04-15' }        // 居中
};
const chrono = logic.visitedChrono(vDemo);
const bj = findCity('北京'), sh = findCity('上海'), ls = findCity('拉萨');

assert('1.5.0 visitedChrono：乱序 ts 按时间升序（上海→拉萨→北京），字段齐全',
  chrono.map(c => c.name).join(',') === '上海,拉萨,北京' &&
  chrono.every(c => typeof c.ts === 'number' && !!c.name && typeof c.prov === 'string' &&
    typeof c.lng === 'number' && typeof c.lat === 'number'),
  chrono.map(c => c.name).join(','));
assert('1.5.0 visitedChrono：ts 缺失按 date 兜底，两者都缺按名称稳定排序',
  (() => {
    const a = logic.visitedChrono({ '北京': {}, '上海': {}, '拉萨': { date: '2021-01-01' } });
    return a.map(c => c.name).join(',') === '上海,北京,拉萨' && a[0].ts === 0;
  })());

const expectKm = Math.round(logic.haversine(sh, ls) + logic.haversine(ls, bj));
assert('1.5.0 travelMileage：时间序相邻两城 haversine 求和取整',
  logic.travelMileage(vDemo) === expectKm, `km=${logic.travelMileage(vDemo)} expect=${expectKm}`);
assert('1.5.0 travelMileage：不足 2 城返回 0',
  logic.travelMileage({}) === 0 && logic.travelMileage({ '北京': {} }) === 0);

const extremes = logic.extremeCities(vDemo);
assert('1.5.0 extremeCities：四极正确（北北京 / 南拉萨 / 东上海 / 西拉萨）',
  !!extremes && extremes.north.name === '北京' && extremes.south.name === '拉萨' &&
  extremes.east.name === '上海' && extremes.west.name === '拉萨' &&
  extremes.north.lat >= extremes.south.lat && extremes.east.lng >= extremes.west.lng,
  JSON.stringify(extremes && { n: extremes.north.name, s: extremes.south.name, e: extremes.east.name, w: extremes.west.name }));
assert('1.5.0 extremeCities：空数据返回 null', logic.extremeCities({}) === null);

const legA = logic.haversine(sh, ls), legB = logic.haversine(ls, bj);
const lg = logic.longestLeg(vDemo);
assert('1.5.0 longestLeg：取时间序最长相邻段 {from,to,km}',
  !!lg && lg.from === (legA >= legB ? '上海' : '拉萨') &&
  lg.to === (legA >= legB ? '拉萨' : '北京') &&
  lg.km === Math.round(Math.max(legA, legB)),
  JSON.stringify(lg));
assert('1.5.0 longestLeg：不足 2 城返回 null',
  logic.longestLeg({}) === null && logic.longestLeg({ '北京': {} }) === null);

assert('1.5.0 footprintSpanDays：最早到最晚整天数差',
  logic.footprintSpanDays(vDemo) === 3 && logic.footprintSpanDays({}) === 0 &&
  logic.footprintSpanDays({ '北京': { ts: T0 } }) === 0,
  `span=${logic.footprintSpanDays(vDemo)}`);
assert('1.5.0 explorePct：分母为 CITIES 总数，空数据为 0',
  Math.abs(logic.explorePct(vDemo) - (3 / CITIES.length) * 100) < 1e-9 &&
  logic.explorePct({}) === 0);

const posterSrc = readFileSync(new URL('../src/pages/poster/poster.vue', import.meta.url), 'utf8');
assert('1.5.0 海报：含「探索中国」「旅游总里程」，旧版式（省份进度条 / 城市墙）已删',
  posterSrc.includes('探索中国') && posterSrc.includes('旅游总里程') &&
  !posterSrc.includes('省份点亮进度') && !posterSrc.includes('我的足迹城市墙'));
assert('1.5.0 海报：星图投影 + 贝塞尔串联 + 四极/省份/最长段格 + 不足 2 城提示',
  /projX/.test(posterSrc) && /quadraticCurveTo/.test(posterSrc) &&
  posterSrc.includes('最北之城') && posterSrc.includes('最东之城') &&
  posterSrc.includes('点亮省份') && posterSrc.includes('单段最远') &&
  posterSrc.includes('点亮第 2 座城，开启你的旅行里程') &&
  /explorePct/.test(posterSrc) && /travelMileage/.test(posterSrc) &&
  /longestLeg/.test(posterSrc) && /footprintSpanDays/.test(posterSrc));

/* ===== 35. 1.5.0 B：城市详情实拍头图（photos.js + detail.vue） ===== */
const photos = await import('../src/data/photos.js');
const photoKeys = Object.keys(photos.CITY_PHOTOS);
assert('1.5.0 photos：首批 30 城全部 findCity 命中',
  photoKeys.length === 30 && photoKeys.every(n => !!findCity(n)),
  `n=${photoKeys.length}`);
assert('1.5.0 photos：slug 唯一且非空、scene 非空、credit 为字符串',
  (() => {
    const slugs = photoKeys.map(n => photos.CITY_PHOTOS[n].slug);
    return slugs.every(s => typeof s === 'string' && s.length > 0) &&
      new Set(slugs).size === slugs.length &&
      photoKeys.every(n => {
        const p = photos.CITY_PHOTOS[n];
        return typeof p.scene === 'string' && p.scene.length > 0 && typeof p.credit === 'string';
      });
  })());
assert('1.5.0 photos：PHOTO_BASE 为字符串前缀（留空即不请求）、扩展名 .jpg',
  typeof photos.PHOTO_BASE === 'string' && photos.PHOTO_EXT === '.jpg');

const detailSrc = readFileSync(new URL('../src/pages/city/detail.vue', import.meta.url), 'utf8');
assert('1.5.0 详情头图：PHOTO_BASE + slug + 扩展名拼装，且 PHOTO_BASE 为空不发请求',
  /PHOTO_BASE \+ m\.slug/.test(detailSrc) && /if \(!PHOTO_BASE \|\| !m \|\| !m\.slug\) return ''/.test(detailSrc));
assert('1.5.0 详情头图：aspectFill 铺满 + 加载失败回退渐变头部',
  /mode="aspectFill"/.test(detailSrc) && /@error="onPhotoError"/.test(detailSrc) &&
  /photoFailed\s*=\s*true/.test(detailSrc) && /!this\.photoFailed/.test(detailSrc));
assert('1.5.0 详情头图：440rpx 横幅 + 顶部 0.25 渐变罩 + 右下角场景小字',
  /\.city-cover\.has-photo/.test(detailSrc) && /height:\s*440rpx/.test(detailSrc) &&
  /cover-scrim/.test(detailSrc) &&
  /linear-gradient\(180deg, rgba\(6,20,38,0\.25\)/.test(detailSrc) &&
  /\.cover-credit/.test(detailSrc) && /font-size:\s*20rpx/.test(detailSrc) &&
  /m\.credit \? m\.scene \+ ' · ' \+ m\.credit : m\.scene/.test(detailSrc));

/* ===== 36. 1.5.1 A：头图点亮（cloud:// 前缀 + 30 城 credit + 两处 scene 修正） ===== */
assert('1.5.1 photos：PHOTO_BASE 走云存储 cloud:// 且以 /city-photos/ 结尾',
  /^cloud:\/\//.test(photos.PHOTO_BASE) && /\/city-photos\/$/.test(photos.PHOTO_BASE),
  photos.PHOTO_BASE);
assert('1.5.1 photos：30 城 credit 全部非空且含「摄影：」与 Wikimedia Commons（「用户供图」为唯一豁免）',
  photoKeys.length === 30 && photoKeys.every(n => {
    const c = photos.CITY_PHOTOS[n].credit;
    if (c === '用户供图') return true;
    return typeof c === 'string' && c.length > 10 && c.includes('摄影：') && c.includes('Wikimedia Commons');
  }),
  photoKeys.filter(n => !photos.CITY_PHOTOS[n].credit).join(','));
assert('1.5.1 photos：武汉 scene=黄鹤楼、厦门 scene=双子塔黄昏',
  photos.CITY_PHOTOS['武汉'].scene === '黄鹤楼' && photos.CITY_PHOTOS['厦门'].scene === '双子塔黄昏',
  photos.CITY_PHOTOS['武汉'].scene + ' / ' + photos.CITY_PHOTOS['厦门'].scene);

/* ===== 37. 1.5.1 B：海报全图化（china-outline 数据 + 年份子集 + 刻度） ===== */
const outline = await import('../src/data/china-outline.js');
const outlineNoRing = outline.PROVINCES.filter(p => !p.rings.length).map(p => p.name);
assert('1.5.1 outline：PROVINCES 恰 34 条且 center / rings 完备（澳门数据无面，仅标注点）',
  outline.PROVINCES.length === 34 &&
  outline.PROVINCES.every(p => typeof p.name === 'string' && p.name.length > 0 &&
    Array.isArray(p.center) && p.center.length === 2 &&
    typeof p.center[0] === 'number' && typeof p.center[1] === 'number' &&
    Array.isArray(p.rings) &&
    p.rings.every(r => Array.isArray(r) && r.length >= 3)) &&
  outline.PROVINCES.filter(p => p.rings.length > 0).length >= 33,
  `n=${outline.PROVINCES.length} 无面=${outlineNoRing.join(',')}`);
assert('1.5.1 outline：CHINA_RINGS ≥ 50 环、SCS 非空且每条环 ≥ 3 点',
  outline.CHINA_RINGS.length >= 50 && outline.SCS.length > 0 &&
  outline.CHINA_RINGS.every(r => Array.isArray(r) && r.length >= 3) &&
  outline.SCS.every(r => Array.isArray(r) && r.length >= 3),
  `rings=${outline.CHINA_RINGS.length} scs=${outline.SCS.length}`);
assert('1.5.1 outline：省名与城市数据 prov 全名一一对应（点亮省份可匹配）',
  new Set(outline.PROVINCES.map(p => p.name)).size === 34 &&
  [...new Set(CITIES.map(c => c.prov))].every(p => outline.PROVINCES.some(o => o.name === p)));

assert('1.5.1 海报：import china-outline，绘制 CHINA_RINGS / 省界 / SCS 小窗',
  /from '\.\.\/\.\.\/data\/china-outline\.js'/.test(posterSrc) &&
  /CHINA_RINGS/.test(posterSrc) && /OUTLINE_PROVINCES/.test(posterSrc) &&
  /pathRings\(ctx, SCS/.test(posterSrc) && posterSrc.includes('南海诸岛'));
assert('1.5.1 海报：年份页签状态 + 子集过滤（全部/年份切换重算）',
  /activeYear/.test(posterSrc) && /function filterByYear\(/.test(posterSrc) &&
  /function collectYears\(/.test(posterSrc) && /pickYear\(y\)/.test(posterSrc) &&
  posterSrc.includes('全部') && posterSrc.includes('年度足迹'));
assert('1.5.1 海报：环刻度 0/25/50/75/100 + 城市名四向候选 + measureText 防重叠',
  posterSrc.includes('[0, 25, 50, 75, 100]') &&
  /measureText/.test(posterSrc) && /function rectHit\(/.test(posterSrc) &&
  /p\.x \+ 9, p\.y - 23/.test(posterSrc) && /p\.x - 9 - tw, p\.y \+ 5/.test(posterSrc));
assert('1.5.1 海报：旧经纬网格线已删、年份模式环下标签带年份',
  !posterSrc.includes('淡经纬网格') &&
  /this\.activeYear \+ ' · 探索中国'/.test(posterSrc));

console.log(process.exitCode ? '\n== 存在失败项 ==' : '\n== 全部通过 ==');