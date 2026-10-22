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

console.log(process.exitCode ? '\n== 存在失败项 ==' : '\n== 全部通过 ==');
