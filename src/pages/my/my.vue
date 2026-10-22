<template>
  <view class="page">
    <!-- 用户卡 -->
    <view class="card">
      <view class="row">
        <view>
          <text class="h2">{{ logged ? '微信用户' : '未登录' }}</text>
          <text class="tiny" style="display:block;margin-top:6rpx">{{ idText }}</text>
        </view>
        <button class="btn sm primary" @tap="doLogin">{{ logged ? '已登录' : '微信一键登录' }}</button>
      </view>
      <view class="notice" style="margin-top:16rpx">
        {{ cloudOn ? '☁️ 已连接云开发，足迹数据按微信账号（openid）隔离存储。' : '📍 本地演示模式：数据保存在本机。配置云开发环境后自动云端同步（见 README）。' }}
      </view>
    </view>

    <!-- 足迹统计 -->
    <view class="card">
      <view class="stats-hero">
        <view class="hero-item"><text class="hero-num">{{ st.visitedCount }}</text><text class="tiny">已打卡城市</text></view>
        <view class="hero-item"><text class="hero-num">{{ st.pct }}%</text><text class="tiny">点亮占比</text></view>
        <view class="hero-item"><text class="hero-num">{{ st.provDone }}/{{ st.provinces.length }}</text><text class="tiny">点亮的省级行政区</text></view>
      </view>
      <button class="btn primary" style="margin-top:20rpx" @tap="goPoster">🎨 生成足迹海报</button>
    </view>

    <!-- 各省进度 -->
    <view class="card">
      <text class="h3">各省进度</text>
      <view class="prov-line" v-for="p in st.provinces" :key="p.prov">
        <view class="row">
          <text class="prov-name2">{{ p.prov }}</text>
          <text class="tiny">{{ p.visited }}/{{ p.total}} · {{ p.pct }}%</text>
        </view>
        <view class="bar"><view :style="{ width: p.pct + '%' }"></view></view>
      </view>
    </view>

    <!-- 打卡记录 -->
    <view class="card">
      <text class="h3">最近打卡</text>
      <view v-if="!recent.length" class="empty">还没有打卡记录，去地图点亮第一座城吧</view>
      <view class="visit-row" v-for="v in recent" :key="v.name">
        <image v-if="v.photo" :src="v.photo" class="visit-photo" mode="aspectFill" />
        <view style="flex:1">
          <text class="visit-name" @tap="goDetail(v.name)">{{ v.name }}</text>
          <text class="tiny" style="display:block">{{ v.date }}<text v-if="v.note"> · {{ v.note }}</text></text>
        </view>
      </view>
    </view>

    <!-- 功能入口 -->
    <view class="card">
      <view class="row-item" @tap="goSafety"><text>🛡️ 安全角（注意事项 + 紧急求助）</text><text class="tiny">›</text></view>
      <view class="row-item" @tap="clearCache"><text>🗑️ 清理离线攻略缓存（{{ cached }} 城）</text><text class="tiny">›</text></view>
      <view class="row-item" v-if="cloudOn" @tap="seedGuides"><text>☁️ 初始化云端攻略库</text><text class="tiny">›</text></view>
    </view>

    <view class="tiny" style="margin:0 24rpx 40rpx">本小程序不提供任何收费功能；攻略信息仅供参考，出行前请核实最新路况。</view>
  </view>
</template>

<script>
import store from '../../core/store.js';
import cache from '../../utils/cache.js';
import api from '../../api/index.js';
import { SAFETY_DISCLAIMER } from '../../config.js';
import { GUIDES } from '../../data/guides.js';

export default {
  data() {
    return {
      logged: false,
      idText: '登录采用微信授权，无需注册账号密码',
      st: { visitedCount: 0, total: 0, pct: 0, provDone: 0, provinces: [] },
      recent: [],
      cached: 0,
      cloudOn: false,
      DISCLAIMER: SAFETY_DISCLAIMER
    };
  },
  onShow() {
    this.refresh();
    this.cloudOn = api.isCloud();
    const saved = uni.getStorageSync('tf_openid');
    this.logged = !!(saved && saved !== 'local-user');
    if (this.logged) this.idText = 'openid: ' + String(saved).slice(0, 8) + '****（已云端隔离存储）';
  },
  methods: {
    refresh() {
      this.st = store.getStats();
      const s = store.get();
      this.recent = Object.keys(s.visited)
        .map(n => ({ name: n, ...s.visited[n] }))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 8);
      this.cached = cache.cacheCount();
    },
    async doLogin() {
      try {
        const oid = await api.login();
        this.logged = true;
        if (oid === 'local-user') {
          uni.showToast({ title: '本地模式：配置云环境后即微信登录', icon: 'none', duration: 2000 });
        } else {
          uni.setStorageSync('tf_openid', oid);
          this.idText = 'openid: ' + oid.slice(0, 8) + '****（已云端隔离存储）';
          uni.showToast({ title: '登录成功', icon: 'success' });
        }
        this.cloudOn = api.isCloud();
      } catch (e) {
        uni.showToast({ title: '云服务暂不可用，已使用本地模式', icon: 'none' });
      }
      this.refresh();
    },
    goDetail(name) { uni.navigateTo({ url: '/pages/city/detail?name=' + encodeURIComponent(name) }); },
    goPoster() { uni.navigateTo({ url: '/pages/poster/poster' }); },
    goSafety() { uni.navigateTo({ url: '/pages/safety/safety' }); },
    clearCache() {
      uni.showModal({
        title: '清理离线缓存',
        content: '将删除已缓存的城市攻略，需联网重新浏览（内置攻略不受影响）。',
        success: r => {
          if (r.confirm) {
            cache.clearCache();
            this.cached = 0;
            uni.showToast({ title: '已清理', icon: 'success' });
          }
        }
      });
    },
    async seedGuides() {
      uni.showLoading({ title: '初始化中' });
      try {
        await new Promise((resolve, reject) => {
          wx.cloud.callFunction({
            name: 'seed', data: { action: 'createCollections' },
            success: resolve, fail: reject
          });
        });
        const list = Object.keys(GUIDES).map(k => GUIDES[k]);
        for (let i = 0; i < list.length; i += 10) {
          await new Promise((resolve, reject) => {
            wx.cloud.callFunction({
              name: 'seed', data: { action: 'seedGuides', guides: list.slice(i, i + 10) },
              success: resolve, fail: reject
            });
          });
        }
        uni.hideLoading();
        uni.showToast({ title: '云端攻略库已初始化', icon: 'success' });
      } catch (e) {
        uni.hideLoading();
        uni.showToast({ title: '初始化失败，请检查云环境', icon: 'none' });
      }
    }
  }
};
</script>

<style scoped>
.stats-hero { display: flex; gap: 20rpx; }
.hero-item { flex: 1; background: #10161F; border-radius: 16rpx; padding: 22rpx; text-align: center; }
.hero-num { display: block; font-size: 42rpx; font-weight: 800; color: #22C55E; margin-bottom: 8rpx; }
.prov-line { padding: 14rpx 0; }
.prov-name2 { font-size: 25rpx; color: #E8EDF2; }
.visit-row { display: flex; gap: 18rpx; align-items: center; padding: 16rpx 0; border-bottom: 1rpx solid #1B2432; }
.visit-photo { width: 100rpx; height: 100rpx; border-radius: 12rpx; flex: 0 0 100rpx; }
.visit-name { font-size: 28rpx; color: #E8EDF2; }
</style>
