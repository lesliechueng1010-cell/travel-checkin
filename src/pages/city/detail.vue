<template>
  <view class="page">
    <!-- 头部 -->
    <view class="city-head">
      <view class="h1">{{ city.name }}</view>
      <text class="sub">{{ city.prov }}<text v-if="guide.partial" class="chip orange" style="margin-left:14rpx">内容补充中</text></text>
      <view class="head-actions">
        <button class="btn sm" :class="visited ? 'primary' : ''" @tap="openCheckin">
          {{ visited ? '已打卡 ✓（修改）' : '打卡 ✓' }}
        </button>
        <button class="btn sm" :class="wished ? 'warn' : 'ghost'" @tap="toggleWish">
          {{ wished ? '★ 已想去' : '☆ 想去' }}
        </button>
        <button class="btn sm ghost" @tap="openNav">🧭 导航</button>
      </view>
      <view class="sub" v-if="visitedInfo">打卡于 {{ visitedInfo.date }}<text v-if="visitedInfo.note"> · {{ visitedInfo.note }}</text></view>
    </view>

    <!-- 危险注意事项（醒目置顶） -->
    <view class="danger-block" v-if="guide.danger">
      <view class="dt">⚠️ 危险注意事项</view>
      <text class="danger-text">{{ guide.danger }}</text>
    </view>

    <!-- 基础信息 -->
    <view class="card">
      <view class="row"><text class="h3">概况</text></view>
      <text class="guide-text">{{ guide.summary }}</text>
      <view class="chips-row" style="margin-top:18rpx">
        <text class="chip green">最佳季节：{{ guide.season }}</text>
        <text class="chip blue">建议游玩：{{ guide.days }} 天</text>
      </view>
    </view>

    <!-- 必去景点 -->
    <view class="card">
      <view class="h3">📍 必去景点</view>
      <view class="spot" v-for="(s, i) in guide.spots" :key="i">
        <text class="spot-name">{{ s.n }}</text>
        <text class="sub">{{ s.d }}</text>
      </view>
    </view>

    <!-- 自驾线路 -->
    <view class="card">
      <view class="h3">🚗 自驾线路推荐</view>
      <view v-for="(r, i) in guide.drive" :key="'d' + i" class="route-box">
        <view class="route-head">
          <text class="route-name">{{ r.n }}</text>
          <button class="btn sm ghost" @tap="previewRoute(r, 'drive')">预览路线</button>
        </view>
        <text class="sub">{{ r.desc }}</text>
        <text class="tiny">途经：{{ pointNames(r) }}</text>
      </view>
      <view v-if="!guide.drive.length" class="empty">内容补充中</view>
    </view>

    <!-- 徒步线路 -->
    <view class="card">
      <view class="h3">🥾 徒步线路推荐</view>
      <view v-for="(r, i) in guide.hike" :key="'h' + i" class="route-box">
        <view class="route-head">
          <text class="route-name">{{ r.n }} <text class="chip">{{ r.diff || '中等' }}</text></text>
          <button class="btn sm ghost" @tap="previewRoute(r, 'hike')">预览路线</button>
        </view>
        <text class="sub">{{ r.desc }}</text>
        <text class="tiny">途经：{{ pointNames(r) }}</text>
      </view>
      <view v-if="!guide.hike.length" class="empty">内容补充中</view>
    </view>

    <!-- 当地美食 -->
    <view class="card">
      <view class="h3">🍜 当地美食</view>
      <view class="food-row" v-if="guide.foods.length">
        <text class="chip" v-for="(f, i) in guide.foods" :key="i">{{ f }}</text>
      </view>
      <view v-else class="empty">内容补充中</view>
      <view class="divider"></view>
      <button class="btn sm warn" @tap="loadFoodShops">🍽️ 查附近美食店（地图地点数据）</button>
      <view v-if="foodShops" class="shop-list">
        <view class="shop" v-for="(s, i) in foodShops" :key="i">
          <view class="row">
            <text class="shop-name">{{ s.title }}</text>
            <text class="chip green" v-if="s.distance">{{ s.distance }}</text>
          </view>
          <text class="tiny">{{ s.address }}</text>
        </view>
        <text class="tiny">评分请在地图详情页以最新数据为准 · {{ foodShops.length }} 家</text>
      </view>
      <view class="notice" v-if="foodHint">{{ foodHint }}</view>
    </view>

    <!-- 安全注意 -->
    <view class="card">
      <view class="h3">🛡️ 安全注意</view>
      <view v-for="(s, i) in guide.safety" :key="'s' + i" class="safety-box">
        <text class="chip red">{{ s.t }}</text>
        <view class="safety-item" v-for="(it, j) in s.items" :key="j">· {{ it }}</view>
      </view>
      <button class="btn sm ghost" style="margin-top:16rpx" @tap="goSafety">进入安全角（含紧急求助）</button>
    </view>

    <view class="notice card-soft" style="margin:20rpx 24rpx">🔒 已离线缓存本页攻略，无网也能看。</view>
    <view class="tiny" style="margin:0 24rpx 40rpx">{{ DISCLAIMER }}</view>

    <!-- 打卡弹层 -->
    <view class="mask" v-if="showCheckin" @tap="showCheckin = false">
      <view class="sheet" @tap.stop>
        <view class="h2">打卡 · {{ city.name }}</view>
        <view class="form-row">
          <text class="sub">日期</text>
          <picker mode="date" :value="form.date" @change="e => form.date = e.detail.value">
            <view class="picker-value">{{ form.date }} ▾</view>
          </picker>
        </view>
        <view class="form-row" style="align-items:flex-start">
          <text class="sub">游记</text>
          <textarea class="textarea" v-model="form.note" placeholder="一句话游记（选填）" maxlength="60" />
        </view>
        <view class="form-row" style="align-items:flex-start">
          <text class="sub">照片</text>
          <view>
            <image v-if="form.photo" :src="form.photo" class="photo" mode="aspectFill" @tap="choosePhoto" />
            <button v-else class="btn sm ghost" style="width:200rpx" @tap="choosePhoto">＋ 拍/选一张</button>
          </view>
        </view>
        <button class="btn primary" style="margin-top:24rpx" @tap="submitCheckin">完成打卡</button>
        <button v-if="visited" class="btn danger sm" style="margin-top:14rpx" @tap="doUncheck">取消打卡</button>
      </view>
    </view>

    <!-- 路线预览弹层 -->
    <view class="mask" v-if="routePreview" @tap="routePreview = null">
      <view class="sheet wide" @tap.stop>
        <view class="h3">{{ routePreview.name }}</view>
        <map
          class="route-map"
          :latitude="routePreview.center.lat"
          :longitude="routePreview.center.lng"
          :scale="routePreview.scale"
          :markers="routePreview.markers"
          :polyline="routePreview.polyline"
        />
        <view class="mileage-box">
          <text class="mileage-num">{{ routePreview.kmText }}</text>
          <text class="tiny">{{ routePreview.kmLabel }}</text>
        </view>
        <view class="notice" style="margin-top:16rpx">{{ DISCLAIMER }}</view>
      </view>
    </view>
  </view>
</template>

<script>
import store from '../../core/store.js';
import { findCity } from '../../data/cities.js';
import { getGuideData } from '../../data/guides.js';
import { haversine, kmLabel } from '../../core/logic.js';
import { openNavMenu } from '../../utils/nav.js';
import tmap from '../../utils/tmap.js';
import cache from '../../utils/cache.js';
import api from '../../api/index.js';
import { SAFETY_DISCLAIMER } from '../../config.js';

export default {
  data() {
    return {
      city: { name: '', prov: '', lat: 0, lng: 0 },
      guide: {},
      visited: false,
      visitedInfo: null,
      wished: false,
      showCheckin: false,
      showFood: false,
      form: { date: '', note: '', photo: '' },
      foodShops: null,
      foodHint: '',
      routePreview: null,
      DISCLAIMER: SAFETY_DISCLAIMER
    };
  },
  onLoad(query) {
    const name = decodeURIComponent(query.name || '');
    const city = findCity(name);
    if (!city) { uni.showToast({ title: '城市不存在', icon: 'none' }); setTimeout(() => uni.navigateBack(), 800); return; }
    this.city = city;
    this.loadGuide();
    this.refreshState();
  },
  onShow() { this.refreshState(); },
  methods: {
    async loadGuide() {
      // 离线优先：缓存 > 云数据库 > 内置库 > 通用模板；浏览后自动缓存
      const cached = cache.readCache(this.city.name);
      if (cached) { this.guide = cached; }
      const remote = await api.fetchGuide(this.city.name);
      const final = remote || (cached && !cached.partial ? cached : getGuideData(this.city));
      this.guide = final;
      cache.cacheGuide(this.city.name, final);
    },
    refreshState() {
      const s = store.get();
      this.visited = !!s.visited[this.city.name];
      this.visitedInfo = s.visited[this.city.name] || null;
      this.wished = (s.wishlist || []).includes(this.city.name);
    },
    pointNames(r) { return (r.points || []).map(p => p.n).join(' → '); },
    openCheckin() {
      this.form = {
        date: this.visitedInfo ? this.visitedInfo.date : new Date().toISOString().slice(0, 10),
        note: this.visitedInfo ? this.visitedInfo.note : '',
        photo: this.visitedInfo ? this.visitedInfo.photo : ''
      };
      this.showCheckin = true;
    },
    choosePhoto() {
      uni.chooseMedia({
        count: 1, mediaType: ['image'], sizeType: ['compressed'],
        success: res => {
          const tmp = res.tempFiles[0].tempFilePath;
          // 持久化到用户目录，避免临时文件过期
          try {
            const fsm = uni.getFileSystemManager();
            const dst = `${wx.env.USER_DATA_PATH}/tf_${Date.now()}.jpg`;
            fsm.saveFileSync({ srcPath: tmp, dstPath: dst });
            this.form.photo = dst;
            return;
          } catch (e) {
            this.form.photo = tmp;
          }
        }
      });
    },
    async submitCheckin() {
      await store.checkin(this.city.name, {
        date: this.form.date, note: this.form.note, photo: this.form.photo
      });
      this.showCheckin = false;
      this.refreshState();
      uni.showToast({ title: '打卡成功 🎉', icon: 'none' });
    },
    doUncheck() {
      store.uncheckin(this.city.name);
      this.showCheckin = false;
      this.refreshState();
      uni.showToast({ title: '已取消打卡', icon: 'none' });
    },
    toggleWish() {
      store.toggleWish(this.city.name);
      this.refreshState();
    },
    openNav() { openNavMenu(this.city); },
    async loadFoodShops() {
      if (!tmap.hasKey()) {
        this.foodHint = '尚未配置腾讯位置服务 Key，美食店实时数据暂不可用。配置方法见 README（「当地美食」菜名不受影响）。';
        return;
      }
      uni.showLoading({ title: '搜索中' });
      const list = await tmap.searchFood(this.city);
      uni.hideLoading();
      if (list && list.length) this.foodShops = list;
      else this.foodHint = '未搜索到结果，请稍后再试。';
    },
    async previewRoute(route, kind) {
      const pts = route.points || [];
      if (!pts.length) return;
      uni.showLoading({ title: '计算里程' });
      let km = 0, mode = 'straight';
      if (tmap.hasKey()) {
        for (let i = 0; i < pts.length - 1; i++) {
          const r = kind === 'hike'
            ? await tmap.walking({ lat: pts[i].lat, lng: pts[i].lng }, { lat: pts[i + 1].lat, lng: pts[i + 1].lng })
            : await tmap.driving({ lat: pts[i].lat, lng: pts[i].lng }, { lat: pts[i + 1].lat, lng: pts[i + 1].lng });
          if (r) { km += r.km; mode = 'driving'; } else { km += haversine(pts[i], pts[i + 1]); }
        }
      } else {
        for (let i = 0; i < pts.length - 1; i++) km += haversine(pts[i], pts[i + 1]);
      }
      const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
      this.routePreview = {
        name: route.n,
        center: { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 },
        scale: kind === 'hike' ? 12 : 8,
        markers: pts.map((p, i) => ({
          id: i, latitude: p.lat, longitude: p.lng, width: 18, height: 18,
          iconPath: i === 0 ? '/static/icons/dot_green.png' : '/static/icons/dot_blue.png',
          callout: { content: p.n, display: 'ALWAYS', fontSize: 10, bgColor: '#10161F', color: '#E8EDF2', padding: 4, borderRadius: 6 }
        })),
        polyline: [{
          points: pts.map(p => { return { latitude: p.lat, longitude: p.lng }; }),
          color: '#22C55E', width: 4, dottedLine: mode === 'straight'
        }],
        kmText: Math.round(km) + ' km',
        kmLabel: kmLabel(mode)
      };
      uni.hideLoading();
    },
    goSafety() { uni.navigateTo({ url: '/pages/safety/safety?city=' + encodeURIComponent(this.city.name) }); }
  }
};
</script>

<style scoped>
.city-head { padding: 30rpx 28rpx 10rpx; }
.head-actions { display: flex; gap: 14rpx; margin: 20rpx 0 10rpx; flex-wrap: wrap; }
.head-actions .btn { flex: 0 0 auto; }
.guide-text { color: #A8B3BF; font-size: 26rpx; line-height: 1.7; margin-top: 10rpx; display: block; }
.chips-row { display: flex; flex-wrap: wrap; }
.spot { padding: 18rpx 0; border-bottom: 1rpx solid #1B2432; }
.spot-name { display: block; font-size: 28rpx; color: #E8EDF2; margin-bottom: 6rpx; }
.route-box { background: #10161F; border-radius: 16rpx; padding: 20rpx; margin-top: 16rpx; }
.route-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10rpx; }
.route-name { font-size: 27rpx; font-weight: 600; color: #E8EDF2; }
.food-row { display: flex; flex-wrap: wrap; margin-top: 12rpx; }
.shop-list { margin-top: 16rpx; }
.shop { padding: 14rpx 0; border-bottom: 1rpx solid #1B2432; }
.shop-name { font-size: 27rpx; color: #E8EDF2; }
.safety-box { margin-top: 14rpx; }
.safety-item { color: #A8B3BF; font-size: 25rpx; line-height: 1.8; margin-top: 8rpx; }
.danger-text { color: #F3B7B7; font-size: 26rpx; line-height: 1.7; }
.mask { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 30; display: flex; align-items: flex-end; }
.sheet { width: 100%; background: #151B24; border-radius: 28rpx 28rpx 0 0; padding: 34rpx 30rpx 50rpx; }
.sheet.wide { padding-bottom: 40rpx; }
.form-row { display: flex; justify-content: space-between; align-items: center; margin-top: 24rpx; gap: 20rpx; }
.form-row .sub { flex: 0 0 90rpx; }
.picker-value { background: #0E141D; border: 1rpx solid #232D3B; border-radius: 12rpx; padding: 14rpx 24rpx; color: #E8EDF2; font-size: 26rpx; }
.textarea { height: 120rpx; }
.photo { width: 180rpx; height: 180rpx; border-radius: 16rpx; border: 1rpx solid #232D3B; }
.route-map { width: 100%; height: 520rpx; border-radius: 16rpx; margin-top: 16rpx; }
.mileage-box { margin-top: 18rpx; display: flex; align-items: baseline; gap: 16rpx; }
.mileage-num { font-size: 44rpx; font-weight: 800; color: #22C55E; }
</style>
