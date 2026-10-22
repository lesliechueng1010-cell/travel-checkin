<template>
  <view class="page">
    <!-- 当前行程 -->
    <view class="card">
      <view class="row">
        <text class="h3">🚙 串线行程</text>
        <input class="trip-name" v-model="tripName" placeholder="行程名称" />
      </view>
      <view class="city-line" v-if="cities.length">
        <text class="route-text">{{ cityNames }}</text>
      </view>
      <view v-else class="empty empty-block">
        <view class="empty-ornament">— ◇ —</view>
        <text class="empty-title">还没有行程</text>
        <text class="empty-desc">从想去清单加几座城，串成一条自驾环线</text>
      </view>

      <view class="trip-rows" v-if="cities.length">
        <view class="trip-row" v-for="(c, i) in cities" :key="c.name">
          <text class="ord">{{ i + 1 }}</text>
          <text class="name" @tap="goDetail(c.name)">{{ c.name }}<text class="tiny">（{{ c.prov }}）</text></text>
          <view class="ops">
            <button class="btn sm ghost" :disabled="i === 0" @tap="move(i, -1)">↑</button>
            <button class="btn sm ghost" :disabled="i === cities.length - 1" @tap="move(i, 1)">↓</button>
            <button class="btn sm danger" @tap="removeAt(i)">✕</button>
          </view>
        </view>
      </view>

      <view class="add-bar">
        <button class="btn ghost" @tap="openPicker">＋ 添加城市（想去清单 / 全部城市）</button>
      </view>
      <view class="add-bar" v-if="pendingCity" style="margin-top:14rpx">
        <button class="btn primary" @tap="addPending">把「{{ pendingCity }}」加入行程</button>
      </view>

      <view class="divider"></view>
      <button class="btn primary" :disabled="cities.length < 2" @tap="compute">
        计算环线里程与建议天数
      </button>
    </view>

    <!-- 计算结果 -->
    <view class="card" v-if="result">
      <view class="h3">环线方案</view>
      <view class="result-grid">
        <view class="res">
          <text class="res-num">{{ result.km }}</text>
          <text class="tiny">{{ result.kmLabel }}</text>
        </view>
        <view class="res">
          <text class="res-num">{{ result.days.total }}</text>
          <text class="tiny">建议总天数（游玩 {{ result.days.cityDays }} + 赶路 {{ result.days.driveDays }}）</text>
        </view>
      </view>
      <map
        v-if="cities.length >= 2"
        class="trip-map"
        :latitude="result.center.lat"
        :longitude="result.center.lng"
        :scale="result.scale"
        :markers="result.markers"
        :polyline="result.polyline"
      />
      <button class="btn ghost" style="margin-top:20rpx" @tap="save">💾 保存这条行程</button>
    </view>

    <!-- 已保存行程 -->
    <view class="card" v-if="saved.length">
      <text class="h3">已保存行程</text>
      <view class="trip-row" v-for="t in saved" :key="t.id">
        <text class="name">{{ t.name }}<text class="tiny">（{{ t.cities.length }} 城）</text></text>
        <view class="ops">
          <button class="btn sm ghost" @tap="loadTrip(t)">编辑</button>
          <button class="btn sm danger" @tap="delTrip(t.id)">删除</button>
        </view>
      </view>
    </view>

    <view class="tiny" style="margin:0 24rpx 40rpx">天数估算规则：各城建议游玩天数之和 + 按每天驾驶约 500 km 估算的赶路天数。{{ DISCLAIMER }}</view>

    <!-- 添加城市：搜索式底部弹层（1.3.0 替代系统滚轮选择器） -->
    <view class="sheet-mask" v-if="pickerOpen" @tap="closePicker">
      <view class="sheet" @tap.stop>
        <view class="sheet-head">
          <text class="sheet-title">添加城市</text>
          <text class="sheet-close" @tap="closePicker">✕</text>
        </view>
        <input
          class="sheet-search"
          :value="pickKw"
          placeholder="搜城市名或省份名，如：大理 / 云南"
          confirm-type="search"
          @input="onPickSearch"
        />
        <scroll-view scroll-y class="sheet-list">
          <view v-if="pickKw.trim()">
            <view v-if="!pickResults.length" class="empty">没找到这个城市</view>
            <view class="pick-line" v-for="c in pickResults" :key="c.name" @tap="togglePick(c.name)">
              <text class="pick-name">{{ c.name }}</text>
              <text class="pick-prov">{{ c.prov }}</text>
              <text class="pick-check" :class="{ on: !!draftSet[c.name] }">{{ draftSet[c.name] ? '✓' : '' }}</text>
            </view>
          </view>
          <view v-else>
            <view v-if="wishCities.length">
              <view class="group-title">★ 想去</view>
              <view class="pick-line" v-for="c in wishCities" :key="c.name" @tap="togglePick(c.name)">
                <text class="pick-name">{{ c.name }}</text>
                <text class="pick-prov">{{ c.prov }}</text>
                <text class="pick-check" :class="{ on: !!draftSet[c.name] }">{{ draftSet[c.name] ? '✓' : '' }}</text>
              </view>
            </view>
            <view v-for="p in provinces" :key="p">
              <view class="group-title">{{ p }}</view>
              <view class="pick-line" v-for="c in citiesOfProv(p)" :key="c.name" @tap="togglePick(c.name)">
                <text class="pick-name">{{ c.name }}</text>
                <text class="pick-prov">{{ c.prov }}</text>
                <text class="pick-check" :class="{ on: !!draftSet[c.name] }">{{ draftSet[c.name] ? '✓' : '' }}</text>
              </view>
            </view>
          </view>
        </scroll-view>
        <button class="btn primary sheet-done" @tap="confirmPicker">完成（{{ draftList.length }}）</button>
      </view>
    </view>
  </view>
</template>

<script>
import store from '../../core/store.js';
import { CITIES, findCity, searchCity, PROVINCES, citiesOfProv } from '../../data/cities.js';
import { tripMileage, suggestDays, kmLabel } from '../../core/logic.js';
import tmap from '../../utils/tmap.js';
import { SAFETY_DISCLAIMER } from '../../config.js';

export default {
  data() {
    return {
      tripName: '我的自驾环线',
      cities: [],
      result: null,
      saved: [],
      pendingCity: '',
      pickerOpen: false,
      pickKw: '',
      draftList: [],
      wishCities: [],
      provinces: PROVINCES,
      DISCLAIMER: SAFETY_DISCLAIMER
    };
  },
  computed: {
    cityNames() { return this.cities.map(c => c.name).join(' → ') + (this.cities.length > 2 ? ' → ' + this.cities[0].name + '（闭环）' : ''); },
    draftSet() {
      const m = {};
      this.draftList.forEach(n => { m[n] = true; });
      return m;
    },
    pickResults() {
      const kw = (this.pickKw || '').trim();
      if (!kw) return [];
      // 纯本地匹配：城市名 / 所属省份名；无结果再走别名（如「香格里拉」→ 迪庆）
      const direct = CITIES.filter(c => c.name.includes(kw) || c.prov.includes(kw));
      return direct.length ? direct : searchCity(kw);
    }
  },
  onShow() {
    this.saved = store.get().trips || [];
    const pending = uni.getStorageSync('tf_trip_pending');
    if (pending) { this.pendingCity = pending; uni.removeStorageSync('tf_trip_pending'); }
  },
  methods: {
    goDetail(name) { uni.navigateTo({ url: '/pages/city/detail?name=' + encodeURIComponent(name) }); },
    /* ---------- 添加城市弹层（搜索 + 分组浏览，切换式多选） ---------- */
    openPicker() {
      this.draftList = this.cities.map(c => c.name);
      this.pickKw = '';
      this.wishCities = (store.get().wishlist || []).map(n => findCity(n)).filter(Boolean);
      this.pickerOpen = true;
    },
    closePicker() { this.pickerOpen = false; },
    onPickSearch(e) { this.pickKw = e.detail.value || ''; },
    togglePick(name) {
      const i = this.draftList.indexOf(name);
      if (i >= 0) this.draftList.splice(i, 1);
      else this.draftList.push(name);
    },
    confirmPicker() {
      this.cities = this.draftList.map(n => findCity(n)).filter(Boolean);
      this.result = null;
      this.pickerOpen = false;
    },
    citiesOfProv(p) { return citiesOfProv(p); },
    addPending() {
      const c = findCity(this.pendingCity);
      if (c && !this.cities.find(x => x.name === c.name)) this.cities.push(c);
      this.pendingCity = '';
    },
    move(i, d) {
      const arr = this.cities;
      const t = arr[i]; arr[i] = arr[i + d]; arr[i + d] = t;
      this.cities = arr.slice();
    },
    removeAt(i) { this.cities.splice(i, 1); this.result = null; },
    async compute() {
      if (this.cities.length < 2) return;
      uni.showLoading({ title: '路线计算中' });
      const calc = tmap.hasKey() ? (a, b) => tmap.driving({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) : null;
      const m = await tripMileage(this.cities, calc);
      const days = suggestDays(this.cities, m.km);
      const lats = this.cities.map(c => c.lat), lngs = this.cities.map(c => c.lng);
      this.result = {
        km: m.km,
        kmLabel: kmLabel(m.mode),
        days,
        center: { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 },
        scale: 4,
        markers: this.cities.map((c, i) => ({
          id: i, latitude: c.lat, longitude: c.lng, width: 20, height: 20,
          iconPath: i === 0 ? '/static/icons/dot_green.png' : '/static/icons/dot_orange.png',
          callout: { content: (i + 1) + '. ' + c.name, display: 'ALWAYS', fontSize: 10, bgColor: 'rgba(9,30,52,0.94)', color: '#F2EDE3', borderWidth: 1, borderColor: 'rgba(217,179,106,0.45)', padding: 4, borderRadius: 6 }
        })),
        polyline: [{
          points: this.cities.map(c => { return { latitude: c.lat, longitude: c.lng }; }).concat(
            m.mode !== 'driving' && this.cities.length > 2 ? [{ latitude: this.cities[0].lat, longitude: this.cities[0].lng }] : []
          ),
          color: '#D9B36A', width: 4, dottedLine: m.mode !== 'driving'
        }]
      };
      uni.hideLoading();
    },
    save() {
      store.saveTrip({ id: 'T' + Date.now(), name: this.tripName || '未命名行程', cities: this.cities.map(c => c.name) });
      this.saved = store.get().trips || [];
      uni.showToast({ title: '已保存', icon: 'success' });
    },
    loadTrip(t) {
      this.tripName = t.name;
      this.cities = t.cities.map(n => findCity(n)).filter(Boolean);
      this.result = null;
      uni.pageScrollTo({ scrollTop: 0 });
    },
    delTrip(id) { store.removeTrip(id); this.saved = store.get().trips || []; }
  }
};
</script>

<style scoped>
.trip-name {
  background: rgba(245, 240, 230, 0.05);
  border: 1rpx solid rgba(245, 240, 230, 0.14);
  border-radius: 999rpx; padding: 10rpx 22rpx;
  font-size: 24rpx; color: #F2EDE3; width: 300rpx; text-align: right;
}
.city-line { margin-top: 16rpx; }
.route-text { color: #D9B36A; font-size: 26rpx; font-weight: 600; }
.trip-rows { margin-top: 14rpx; }
.trip-row {
  display: flex; align-items: center; gap: 18rpx;
  margin-bottom: 10rpx; padding: 18rpx 20rpx;
  border-radius: 22rpx;
  background: rgba(245, 240, 230, 0.05);
  border: 1rpx solid rgba(245, 240, 230, 0.10);
}
.trip-row .ord {
  width: 44rpx; height: 44rpx; border-radius: 50%;
  background: rgba(217, 179, 106, 0.14);
  border: 1rpx solid rgba(217, 179, 106, 0.38);
  color: #D9B36A;
  display: flex; align-items: center; justify-content: center;
  font-size: 24rpx; flex: 0 0 44rpx;
}
.trip-row .name { flex: 1; font-size: 28rpx; color: #F2EDE3; }
.ops { display: flex; gap: 10rpx; }
.add-bar { margin-top: 20rpx; }
.result-grid { display: flex; gap: 16rpx; margin-top: 16rpx; }
.res {
  flex: 1;
  background: rgba(245, 240, 230, 0.05);
  border: 1rpx solid rgba(245, 240, 230, 0.10);
  border-radius: 24rpx; padding: 22rpx;
}
.res-num { display: block; font-size: 46rpx; font-weight: 800; color: #D9B36A; margin-bottom: 6rpx; }
.trip-map { width: 100%; height: 440rpx; border-radius: 24rpx; margin-top: 20rpx; }

/* 添加城市弹层：深海蓝玻璃，与 1.1.0 视觉语言一致 */
.sheet-mask {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0; z-index: 50;
  background: rgba(4, 15, 28, 0.62);
}
.sheet {
  position: absolute; left: 0; right: 0; bottom: 0;
  max-height: 78vh; display: flex; flex-direction: column;
  background: rgba(9, 30, 52, 0.98);
  border-radius: 32rpx 32rpx 0 0;
  border-top: 1rpx solid rgba(245, 240, 230, 0.16);
  padding: 28rpx 28rpx 36rpx;
}
.sheet-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20rpx; }
.sheet-title { font-size: 32rpx; font-weight: 700; color: #F2EDE3; }
.sheet-close { font-size: 30rpx; color: rgba(242, 237, 227, 0.6); padding: 6rpx 10rpx; }
.sheet-search {
  background: rgba(245, 240, 230, 0.06);
  border: 1rpx solid rgba(245, 240, 230, 0.16);
  border-radius: 999rpx; padding: 18rpx 28rpx;
  font-size: 27rpx; color: #F2EDE3;
}
.sheet-list { flex: 1 1 auto; min-height: 200rpx; margin-top: 18rpx; }
.group-title {
  font-size: 24rpx; font-weight: 600; color: #D9B36A;
  margin: 22rpx 6rpx 10rpx;
}
.pick-line {
  display: flex; align-items: center; gap: 16rpx;
  padding: 20rpx 22rpx; margin-bottom: 10rpx;
  border-radius: 20rpx;
  background: rgba(245, 240, 230, 0.05);
  border: 1rpx solid rgba(245, 240, 230, 0.09);
}
.pick-name { font-size: 28rpx; color: #F2EDE3; }
.pick-prov { flex: 1; font-size: 23rpx; color: rgba(242, 237, 227, 0.5); }
.pick-check {
  width: 40rpx; text-align: center;
  font-size: 30rpx; font-weight: 700; color: rgba(242, 237, 227, 0.25);
}
.pick-check.on { color: #D9B36A; }
.sheet-done { margin-top: 20rpx; }
</style>
