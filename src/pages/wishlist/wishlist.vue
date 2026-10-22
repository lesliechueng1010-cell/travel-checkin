<template>
  <view class="page">
    <!-- 离你最近的未打卡城市 -->
    <view class="card" v-if="nearest">
      <text class="tiny">离你最近的未打卡城市</text>
      <view class="row" style="margin-top:12rpx">
        <view>
          <text class="h2">{{ nearest.name }}</text>
          <text class="sub" style="display:block;margin-top:6rpx">{{ nearest.prov }} · 约 {{ fmtDist(nearest.dist) }}</text>
        </view>
        <button class="btn primary sm" @tap="goDetail(nearest.name)">去看看</button>
      </view>
    </view>

    <view class="card">
      <view class="row">
        <text class="h3">想去清单（{{ list.length }}）</text>
        <text class="tiny" v-if="hasLoc">按距离排序</text>
      </view>
      <view v-if="!list.length" class="empty">还没有想去的城市<br />去地图点亮第一个目标吧</view>
      <view class="wish-row" v-for="c in list" :key="c.name">
        <view @tap="goDetail(c.name)">
          <text class="wish-name">{{ c.name }}</text>
          <text class="tiny" style="display:block;margin-top:4rpx">
            {{ c.prov }}<text v-if="c.dist !== null"> · 约 {{ fmtDist(c.dist) }}</text>
          </text>
        </view>
        <view class="wish-actions">
          <button class="btn sm ghost" @tap="addTrip(c)">＋行程</button>
          <button class="btn sm danger" @tap="removeWish(c.name)">移除</button>
        </view>
      </view>
    </view>

    <view class="notice" style="margin: 0 24rpx">提示：允许定位后，清单会按离你的距离由近到远排序，并推荐最近的未去城市。</view>
  </view>
</template>

<script>
import store from '../../core/store.js';
import { findCity, CITIES } from '../../data/cities.js';
import { haversine } from '../../core/logic.js';

export default {
  data() {
    return { list: [], nearest: null, hasLoc: false };
  },
  onShow() { this.refresh(); },
  methods: {
    refresh() {
      const s = store.get();
      const loc = s.lastLoc;
      this.hasLoc = !!loc;
      const items = (s.wishlist || [])
        .map(n => findCity(n))
        .filter(Boolean)
        .map(c => ({ ...c, dist: loc ? Math.round(haversine(loc, c)) : null }));
      if (loc) items.sort((a, b) => a.dist - b.dist);
      this.list = items;
      if (loc) {
        const un = CITIES.filter(c => !s.visited[c.name])
          .map(c => ({ ...c, dist: Math.round(haversine(loc, c)) }))
          .sort((a, b) => a.dist - b.dist);
        this.nearest = un[0] || null;
      } else {
        this.nearest = null;
      }
    },
    fmtDist(km) { return km >= 1000 ? (km / 1000).toFixed(2) + ' 千km' : km + ' km'; },
    goDetail(name) { uni.navigateTo({ url: '/pages/city/detail?name=' + encodeURIComponent(name) }); },
    removeWish(name) {
      store.toggleWish(name);
      this.refresh();
      uni.showToast({ title: '已从想去清单移除', icon: 'none' });
    },
    addTrip(c) {
      uni.switchTab({ url: '/pages/trip/trip' });
      uni.setStorageSync('tf_trip_pending', c.name);
      uni.showToast({ title: '已带去行程页，点「添加到行程」', icon: 'none' });
    }
  }
};
</script>

<style scoped>
.wish-row { display: flex; justify-content: space-between; align-items: center; padding: 22rpx 0; border-bottom: 1rpx solid #1B2432; }
.wish-name { font-size: 30rpx; color: #E8EDF2; }
.wish-actions { display: flex; gap: 12rpx; }
</style>
