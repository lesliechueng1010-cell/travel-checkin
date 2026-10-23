<template>
  <view class="page">
    <!-- 封面区 · 有实拍图时照片横幅（云存储远程加载），否则保持渐变头部 -->
    <view class="city-cover" :class="{ 'has-photo': showPhoto }" :style="coverStyle">
      <image
        v-if="showPhoto"
        class="cover-photo"
        :src="photoSrc"
        mode="aspectFill"
        @error="onPhotoError"
      />
      <view v-if="showPhoto" class="cover-scrim"></view>
      <view class="cover-inner">
        <text class="cover-prov">{{ city.prov }}</text>
        <text class="cover-name">{{ city.name }}</text>
        <text v-if="guide.partial" class="chip orange cover-chip">内容补充中</text>
        <view class="cover-actions">
          <button class="btn sm primary checkin-btn" @tap="openCheckin">
            {{ visited ? '已打卡 ✓（修改）' : '打卡 ✓' }}
          </button>
          <button class="btn sm" :class="wished ? 'warn' : 'ghost'" @tap="toggleWish">
            {{ wished ? '★ 已想去' : '☆ 想去' }}
          </button>
          <button class="btn sm ghost" @tap="openNav">🧭 导航</button>
        </view>
        <view class="cover-visited" v-if="visitedInfo">
          <text v-if="visitedInfo.source === 'import'" class="chip orange">补录</text>
          打卡于 {{ visitedInfo.date || '日期未填' }}<text v-if="visitedInfo.note"> · {{ visitedInfo.note }}</text>
        </view>
      </view>
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

    <!-- 打卡成功光点反馈（1s 内结束） -->
    <view class="checkin-fx" v-if="fxShow">
      <view class="fx-ring"></view>
      <view class="fx-spark s1"></view>
      <view class="fx-spark s2"></view>
      <view class="fx-spark s3"></view>
      <view class="fx-spark s4"></view>
    </view>

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
import tmap, { mergeRoutePoints } from '../../utils/tmap.js';
import cache from '../../utils/cache.js';
import api from '../../api/index.js';
import { PHOTO_BASE, PHOTO_EXT, CITY_PHOTOS } from '../../data/photos.js';
import { SAFETY_DISCLAIMER } from '../../config.js';

/**
 * 多段道路线拼接为一条 polyline
 * 1.6.0：实现已提到 utils/tmap.js 的 mergeRoutePoints（行程页共用），此处仅引用，行为不变
 */

export default {
  data() {
    return {
      fxShow: false,
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
      photoFailed: false,
      photoSrc: '',
      DISCLAIMER: SAFETY_DISCLAIMER
    };
  },
  onLoad(query) {
    const name = decodeURIComponent(query.name || '');
    const city = findCity(name);
    if (!city) { uni.showToast({ title: '城市不存在', icon: 'none' }); setTimeout(() => uni.navigateBack(), 800); return; }
    this.city = city;
    this.loadGuide();
    this.resolvePhoto();
    this.refreshState();
  },
  onShow() { this.refreshState(); },
  computed: {
    coverStyle() {
      const name = (this.city && this.city.name) || '';
      let h = 0;
      for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
      const hue = 175 + (h % 40);
      const hue2 = 32 + (h % 25);
      return {
        background: `linear-gradient(145deg, hsl(${hue}, 42%, 18%) 0%, hsl(${hue}, 38%, 12%) 55%, hsl(${hue2}, 55%, 22%) 100%)`
      };
    },
    /* ---------- 1.5.0 实拍头图 ---------- */
    photoMeta() {
      return CITY_PHOTOS[this.city.name] || null;
    },
    /** PHOTO_BASE 为空（未传图）或该城无图时不拼 URL，也不发任何图片请求 */
    photoUrl() {
      const m = this.photoMeta;
      if (!PHOTO_BASE || !m || !m.slug) return '';
      return PHOTO_BASE + m.slug + PHOTO_EXT;
    },
    showPhoto() {
      return !!this.photoSrc && !this.photoFailed;
    },
  },
  methods: {
    /** 图片加载失败：回退渐变头部，不白屏不报错 */
    onPhotoError() {
      this.photoFailed = true;
    },
    /** 头图取链：云存储私有权限下直读 cloud:// 被拒，改走云函数换临时 HTTPS 链接 */
    async resolvePhoto() {
      const fid = this.photoUrl;
      if (!fid) return;
      const url = await api.fetchPhotoUrl(fid);
      if (url) this.photoSrc = url;
      else this.photoFailed = true;
    },
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
        date: (this.visitedInfo && this.visitedInfo.date) || new Date().toISOString().slice(0, 10),
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
      this.fxShow = true;
      setTimeout(() => { this.fxShow = false; }, 900);
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
      const plan = kind === 'hike' ? tmap.walking : tmap.driving;
      const roadMode = kind === 'hike' ? 'walking' : 'driving';
      // 逐段规划：每一段都拿到道路线才采用；任一段失败 / 无 Key → 整条回退直线虚线
      // （不做「前面实线后面虚线」的混搭，也不给直线距离贴「实时计算」的标签）
      let segs = null;
      if (tmap.hasKey() && pts.length > 1) {
        const acc = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const r = await plan(
            { lat: pts[i].lat, lng: pts[i].lng },
            { lat: pts[i + 1].lat, lng: pts[i + 1].lng }
          );
          if (!r || !r.points || r.points.length < 2) { acc.length = 0; break; }
          acc.push(r);
        }
        segs = acc.length === pts.length - 1 ? acc : null;
      }
      let km = 0, mode = 'straight', line = null;
      if (segs && segs.length) {
        // 各段真实里程求和；各段坐标串首尾衔接，去掉重复的衔接点
        km = segs.reduce((s, r) => s + r.km, 0);
        mode = roadMode;
        line = mergeRoutePoints(segs.map(s => s.points));
      } else {
        for (let i = 0; i < pts.length - 1; i++) km += haversine(pts[i], pts[i + 1]);
        line = pts.map(p => ({ latitude: p.lat, longitude: p.lng }));
      }
      const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
      this.routePreview = {
        name: route.n,
        center: { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 },
        scale: kind === 'hike' ? 12 : 8,
        markers: pts.map((p, i) => ({
          id: i, latitude: p.lat, longitude: p.lng, width: 18, height: 18,
          iconPath: i === 0 ? '/static/icons/dot_green.png' : '/static/icons/dot_blue.png',
          callout: { content: p.n, display: 'ALWAYS', fontSize: 10, bgColor: 'rgba(9,30,52,0.94)', color: '#F2EDE3', padding: 5, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(217,179,106,0.45)' }
        })),
        polyline: [{
          points: line,
          color: '#D9B36A', width: 4, dottedLine: mode === 'straight'
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
/* 封面渐变区 · 底部罩色改深海蓝 */
.city-cover {
  position: relative;
  padding: 48rpx 28rpx 36rpx;
  margin-bottom: 8rpx;
  overflow: hidden;
}
.city-cover::after {
  content: '';
  position: absolute; left: 0; right: 0; bottom: 0; height: 120rpx;
  background: linear-gradient(180deg, transparent, rgba(10,30,52,0.92));
  pointer-events: none;
}
.cover-inner { position: relative; z-index: 1; }

/* 1.5.0 实拍头图：440rpx 照片横幅 + 纵向渐变罩，文字压在横幅下部 */
.city-cover.has-photo {
  height: 440rpx;
  padding: 0 28rpx 30rpx;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.city-cover.has-photo::after { display: none; }
.cover-photo {
  position: absolute; left: 0; top: 0;
  width: 100%; height: 440rpx;
}
.cover-scrim {
  position: absolute; left: 0; top: 0;
  width: 100%; height: 440rpx;
  background: linear-gradient(180deg, rgba(6,20,38,0.25) 0%, rgba(6,20,38,0) 45%, rgba(10,30,52,0.96) 100%);
  pointer-events: none;
}
.cover-prov {
  display: block;
  font-size: 24rpx;
  color: rgba(242,237,227,0.62);
  letter-spacing: 4rpx;
  margin-bottom: 8rpx;
}
.cover-name {
  display: block;
  font-size: 56rpx;
  font-weight: 800;
  color: #F2EDE3;
  line-height: 1.15;
  text-shadow: 0 4rpx 22rpx rgba(0,0,0,0.42);
  margin-bottom: 12rpx;
}
.cover-chip { margin-top: 8rpx; }
.cover-actions {
  display: flex; gap: 14rpx; margin: 28rpx 0 12rpx; flex-wrap: wrap;
}
.cover-actions .btn { flex: 0 0 auto; }
.checkin-btn {
  min-width: 200rpx;
  box-shadow: 0 8rpx 26rpx rgba(217,179,106,0.36);
}
.cover-visited {
  font-size: 22rpx;
  color: rgba(242,237,227,0.62);
  margin-top: 6rpx;
}
/* 封面在深色底上，补录角标用香槟金 */
.cover-visited .chip {
  background: rgba(217,179,106,0.16);
  border-color: rgba(217,179,106,0.55);
  color: #E7C98C;
  margin-right: 8rpx;
}

/* 分区卡片内微调（玻璃底：文字统一浅色） */
.guide-text { color: rgba(242,237,227,0.62); font-size: 26rpx; line-height: 1.8; margin-top: 10rpx; display: block; }
.chips-row { display: flex; flex-wrap: wrap; }
.spot { padding: 18rpx 0; border-bottom: 1rpx solid rgba(245,240,230,0.08); }
.spot:last-child { border-bottom: none; }
.spot-name { display: block; font-size: 28rpx; color: #F2EDE3; margin-bottom: 6rpx; font-weight: 500; }
.route-box {
  background: rgba(245,240,230,0.045);
  border-radius: 24rpx;
  padding: 22rpx;
  margin-top: 16rpx;
  border: 1rpx solid rgba(245,240,230,0.09);
}
.route-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10rpx; }
.route-name { font-size: 27rpx; font-weight: 600; color: #F2EDE3; }
.food-row { display: flex; flex-wrap: wrap; margin-top: 12rpx; }
.shop-list { margin-top: 16rpx; }
.shop { padding: 16rpx 0; border-bottom: 1rpx solid rgba(245,240,230,0.08); }
.shop-name { font-size: 27rpx; color: #F2EDE3; }

/* 安全卡 · 暗底暖红不刺眼 */
.safety-box { margin-top: 14rpx; }
.safety-item { color: rgba(242,237,227,0.62); font-size: 25rpx; line-height: 1.85; margin-top: 8rpx; }
.danger-text { color: #E3A49A; font-size: 26rpx; line-height: 1.75; }

/* 弹层 · 玻璃面板 */
.mask {
  position: fixed; inset: 0;
  background: rgba(4,12,22,0.66);
  z-index: 30;
  display: flex; align-items: flex-end;
}
.sheet {
  width: 100%;
  background: rgba(9, 30, 52, 0.97);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 34rpx 34rpx 0 0;
  border-top: 1rpx solid rgba(245,240,230,0.14);
  padding: 34rpx 30rpx 50rpx;
  color: #F2EDE3;
  box-shadow: 0 -12rpx 44rpx rgba(0,0,0,0.4);
}
.sheet .h2 { color: #F2EDE3; }
.sheet.wide { padding-bottom: 40rpx; }
.form-row {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 24rpx; gap: 20rpx;
}
.form-row .sub { flex: 0 0 90rpx; color: rgba(242,237,227,0.55); }
.picker-value {
  background: rgba(245,240,230,0.05);
  border: 1rpx solid rgba(245,240,230,0.16);
  border-radius: 999rpx; padding: 14rpx 26rpx;
  color: #F2EDE3; font-size: 26rpx;
}
.textarea { height: 120rpx; }
.photo {
  width: 180rpx; height: 180rpx;
  border-radius: 20rpx;
  border: 1rpx solid rgba(245,240,230,0.14);
}
.route-map { width: 100%; height: 520rpx; border-radius: 24rpx; margin-top: 16rpx; }
.mileage-box { margin-top: 18rpx; display: flex; align-items: baseline; gap: 16rpx; }
.mileage-num { font-size: 46rpx; font-weight: 800; color: #D9B36A; }

/* 打卡成功 · 香槟金光点扩散（≤1s） */
.checkin-fx {
  position: fixed; inset: 0; z-index: 40;
  pointer-events: none;
  display: flex; align-items: center; justify-content: center;
}
.fx-ring {
  width: 40rpx; height: 40rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(217,179,106,0.9);
  animation: ringOut 0.85s ease-out forwards;
}
.fx-spark {
  position: absolute;
  width: 10rpx; height: 10rpx;
  border-radius: 50%;
  background: #E7C98C;
  box-shadow: 0 0 14rpx #D9B36A;
  animation: sparkFly 0.8s ease-out forwards;
}
.fx-spark.s1 { --dx: -80rpx; --dy: -60rpx; animation-delay: 0.05s; }
.fx-spark.s2 { --dx: 90rpx; --dy: -50rpx; animation-delay: 0.08s; }
.fx-spark.s3 { --dx: -70rpx; --dy: 70rpx; animation-delay: 0.1s; }
.fx-spark.s4 { --dx: 75rpx; --dy: 65rpx; animation-delay: 0.12s; }
@keyframes ringOut {
  0% { transform: scale(0.3); opacity: 1; }
  100% { transform: scale(6); opacity: 0; }
}
@keyframes sparkFly {
  0% { transform: translate(0,0) scale(1); opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; }
}
</style>