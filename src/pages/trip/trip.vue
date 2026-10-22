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
        <picker mode="selector" :range="pickNames" @change="onPick">
          <button class="btn ghost">＋ 添加城市（想去清单 / 全部城市）</button>
        </picker>
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
  </view>
</template>

<script>
import store from '../../core/store.js';
import { CITIES, findCity } from '../../data/cities.js';
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
      pickIndex: 0,
      pendingCity: '',
      DISCLAIMER: SAFETY_DISCLAIMER
    };
  },
  computed: {
    cityNames() { return this.cities.map(c => c.name).join(' → ') + (this.cities.length > 2 ? ' → ' + this.cities[0].name + '（闭环）' : ''); },
    pickNames() {
      const s = store.get();
      const wished = (s.wishlist || []).filter(n => !this.cities.find(c => c.name === n));
      const rest = CITIES.map(c => c.name).filter(n => !this.cities.find(c => c.name === n) && !wished.includes(n));
      return ['★ 想去：' + (wished.join(' / ') || '（空）')].concat(rest);
    }
  },
  onShow() {
    this.saved = store.get().trips || [];
    const pending = uni.getStorageSync('tf_trip_pending');
    if (pending) { this.pendingCity = pending; uni.removeStorageSync('tf_trip_pending'); }
  },
  methods: {
    goDetail(name) { uni.navigateTo({ url: '/pages/city/detail?name=' + encodeURIComponent(name) }); },
    onPick(e) {
      const idx = Number(e.detail.value);
      if (idx === 0) {
        const wished = (store.get().wishlist || []).filter(n => !this.cities.find(c => c.name === n));
        if (!wished.length) { uni.showToast({ title: '想去清单是空的', icon: 'none' }); return; }
        this.cities.push(findCity(wished[0]));
        return;
      }
      const name = this.pickNames[idx];
      const c = findCity(name);
      if (c) this.cities.push(c);
    },
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
          callout: { content: (i + 1) + '. ' + c.name, display: 'ALWAYS', fontSize: 10, bgColor: 'rgba(13,37,53,0.9)', color: '#F5F0E6', padding: 4, borderRadius: 6 }
        })),
        polyline: [{
          points: this.cities.map(c => { return { latitude: c.lat, longitude: c.lng }; }).concat(
            m.mode !== 'driving' && this.cities.length > 2 ? [{ latitude: this.cities[0].lat, longitude: this.cities[0].lng }] : []
          ),
          color: '#E8A838', width: 4, dottedLine: m.mode !== 'driving'
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
.trip-name { background: rgba(10,31,44,0.45); border: 1rpx solid rgba(245,240,230,0.14); border-radius: 12rpx; padding: 10rpx 18rpx; font-size: 24rpx; color: #F5F0E6; width: 300rpx; text-align: right; }
.city-line { margin-top: 16rpx; }
.route-text { color: #E8A838; font-size: 26rpx; font-weight: 600; }
.trip-rows { margin-top: 10rpx; }
.trip-row { display: flex; align-items: center; gap: 18rpx; padding: 18rpx 0; border-bottom: 1rpx solid rgba(245,240,230,0.08); }
.trip-row .ord { width: 44rpx; height: 44rpx; border-radius: 50%; background: rgba(245,240,230,0.08); color: #E8A838; display: flex; align-items: center; justify-content: center; font-size: 24rpx; flex: 0 0 44rpx; }
.trip-row .name { flex: 1; font-size: 28rpx; color: #F5F0E6; }
.ops { display: flex; gap: 10rpx; }
.add-bar { margin-top: 20rpx; }
.result-grid { display: flex; gap: 30rpx; margin-top: 16rpx; }
.res { flex: 1; background: rgba(13,37,53,0.9); border-radius: 16rpx; padding: 20rpx; }
.res-num { display: block; font-size: 44rpx; font-weight: 800; color: #E8A838; margin-bottom: 6rpx; }
.trip-map { width: 100%; height: 440rpx; border-radius: 16rpx; margin-top: 20rpx; }
</style>
