<template>
  <view class="page map-page">
    <map
      id="tfmap"
      class="the-map"
      :latitude="mapCenter.lat"
      :longitude="mapCenter.lng"
      :scale="viewMode === 'nation' ? 4 : 7"
      :markers="markers"
      :polyline="polyline"
      :show-location="true"
      @markertap="onMarkerTap"
    />

    <!-- 顶部统计栏 · 毛玻璃悬浮卡 -->
    <view class="stats-bar">
      <view class="stats-inner">
        <view class="stat-main">
          <view class="stat-num-wrap">
            <text class="stat-num">{{ st.visitedCount }}</text>
            <text class="stat-unit">城</text>
          </view>
          <view class="stat-meta">
            <text class="stat-cap">已打卡 / {{ st.total }}</text>
            <text class="stat-sub">点亮 {{ st.pct }}% · 省份 {{ st.provDone }}/{{ st.provinces.length }}</text>
          </view>
        </view>
        <view class="stat-actions">
          <view class="search-box" v-if="!showSearch" @tap="showSearch = true">🔍 搜城市</view>
          <input v-else class="search-input" v-model="kw" placeholder="输入城市名，如：喀什 / 大理" confirm-type="search" @confirm="doSearch" />
        </view>
      </view>
      <view class="progress-track">
        <view class="progress-fill" :style="{ width: Math.min(100, st.pct) + '%' }"></view>
      </view>
    </view>

    <!-- 回到全国 -->
    <view class="back-nation" v-if="viewMode === 'province'" @tap="backNation">⬅ 返回全国</view>

    <!-- 定位打卡提示 -->
    <view class="loc-banner" v-if="locCity && !visited[locCity.name]" @tap="goDetail(locCity.name)">
      📍 定位显示你在 <text class="brand-text">{{ locCity.name }}</text>（约 {{ locCity.dist }}km）· 去打卡 →
    </view>

    <!-- 底部可折叠抽屉：默认收起只露标题栏，展开高度不超过 40vh（地图至少保留 60%） -->
    <view class="bottom-sheet" :class="{ open: sheetOpen }">
      <view class="sheet-handle" @tap="toggleSheet">
        <view class="handle-left">
          <view class="sheet-title-row">
            <text class="sheet-icon">▣</text>
            <text class="sheet-title">{{ sheetTitle }}</text>
          </view>
          <text class="sheet-summary">{{ sheetSummary }}</text>
        </view>
        <view class="handle-right">
          <text class="sheet-arrow" :class="{ rotate: sheetOpen }">▴</text>
        </view>
      </view>
      <scroll-view scroll-y class="sheet-body" :class="{ show: sheetOpen }">
        <view v-if="viewMode === 'nation'">
          <view class="prov-row" v-for="p in st.provinces" :key="p.prov" @tap="drill(p.prov)">
            <view class="prov-head">
              <text class="prov-name">{{ p.prov }}</text>
              <text class="prov-count">{{ p.visited }}/{{ p.total }}</text>
            </view>
            <view class="bar"><view :style="{ width: p.pct + '%' }"></view></view>
          </view>
        </view>
        <view v-else>
          <view class="city-row" v-for="c in provCities" :key="c.name" @tap="goDetail(c.name)">
            <text class="city-name" :class="{ visited: !!visited[c.name] }">{{ visited[c.name] ? '✅ ' : '⬜ ' }}{{ c.name }}</text>
            <view class="city-right">
              <text v-if="wished(c.name)" class="chip orange">想去</text>
              <text class="city-arrow">›</text>
            </view>
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script>
import store from '../../core/store.js';
import { PROVINCES, CITIES, citiesOfProv, searchCity, findCity } from '../../data/cities.js';
import { locateCity } from '../../core/logic.js';

const SHEET_KEY = 'tf.mapSheetOpen';

const ICON = {
  visited: '/static/icons/dot_green.png',
  wish: '/static/icons/dot_orange.png',
  none: '/static/icons/dot_gray.png',
  provZero: '/static/icons/dot_gray.png',
  provPart: '/static/icons/dot_orange.png',
  provDone: '/static/icons/dot_green.png'
};

/* 全国视图气泡用单字简称 + 数字，缓解中部气泡重叠 */
const PROV_ABBR = {
  '北京市': '京', '天津市': '津', '上海市': '沪', '重庆市': '渝',
  '河北省': '冀', '山西省': '晋', '辽宁省': '辽', '吉林省': '吉', '黑龙江省': '黑',
  '江苏省': '苏', '浙江省': '浙', '安徽省': '皖', '福建省': '闽', '江西省': '赣', '山东省': '鲁',
  '河南省': '豫', '湖北省': '鄂', '湖南省': '湘', '广东省': '粤', '海南省': '琼',
  '四川省': '川', '贵州省': '贵', '云南省': '滇', '陕西省': '陕', '甘肃省': '甘', '青海省': '青',
  '内蒙古自治区': '蒙', '广西壮族自治区': '桂', '西藏自治区': '藏',
  '宁夏回族自治区': '宁', '新疆维吾尔自治区': '新',
  '香港特别行政区': '港', '澳门特别行政区': '澳', '台湾省': '台'
};
const provAbbr = p => PROV_ABBR[p] || p.replace(/省|市|自治区|特别行政区|壮族|回族|维吾尔|区$/g, '');

export default {
  data() {
    return {
      viewMode: 'nation',
      curProv: '',
      visited: {},
      wish: [],
      st: { visitedCount: 0, total: 0, pct: 0, provDone: 0, provinces: [] },
      locCity: null,
      sheetOpen: false,
      showSearch: false,
      kw: '',
      polyline: []
    };
  },
  computed: {
    mapCenter() {
      if (this.viewMode === 'province') {
        const cap = citiesOfProv(this.curProv).find(c => c.cap) || citiesOfProv(this.curProv)[0];
        return { lat: cap.lat, lng: cap.lng };
      }
      return { lat: 35.4, lng: 104.9 };
    },
    provCities() {
      const list = citiesOfProv(this.curProv);
      const v = this.visited;
      return list.slice().sort((a, b) => {
        const av = v[a.name] ? 0 : 1, bv = v[b.name] ? 0 : 1;
        return av - bv || a.name.localeCompare(b.name, 'zh');
      });
    },
    sheetTitle() {
      return this.viewMode === 'nation' ? '各省进度' : this.curProv + ' · 城市列表';
    },
    sheetSummary() {
      if (this.viewMode === 'nation') {
        return '已点亮 ' + this.st.visitedCount + '/' + this.st.total + ' 城 · ' + this.st.pct + '%';
      }
      const list = this.provCities;
      const done = list.filter(c => this.visited[c.name]).length;
      return done + '/' + list.length + ' 城已打卡';
    },
    markers() {
      if (this.viewMode === 'nation') {
        return PROVINCES.map((p, i) => {
          const cities = citiesOfProv(p);
          const done = cities.filter(c => this.visited[c.name]).length;
          const cap = cities.find(c => c.cap) || cities[0];
          const icon = done === 0 ? ICON.provZero : (done >= cities.length ? ICON.provDone : ICON.provPart);
          return {
            id: i, latitude: cap.lat, longitude: cap.lng, iconPath: icon, width: 20, height: 20,
            joinCluster: false,
            callout: {
              content: provAbbr(p) + ' ' + done + '/' + cities.length,
              display: 'ALWAYS', fontSize: 9, borderRadius: 4, bgColor: 'rgba(10,31,44,0.88)', color: '#F5F0E6', padding: 3, borderWidth: 1, borderColor: 'rgba(232,168,56,0.35)'
            }
          };
        });
      }
      const cities = citiesOfProv(this.curProv);
      return cities.map((c, i) => {
        const icon = this.visited[c.name] ? ICON.visited : (this.wish.includes(c.name) ? ICON.wish : ICON.none);
        return {
          id: 1000 + i, latitude: c.lat, longitude: c.lng, iconPath: icon, width: 22, height: 22,
          callout: { content: c.name + (this.visited[c.name] ? ' ✓' : ''), display: 'BYCLICK', fontSize: 11, borderRadius: 6, bgColor: 'rgba(10,31,44,0.92)', color: '#F5F0E6', padding: 5, borderWidth: 1, borderColor: 'rgba(245,240,230,0.2)' }
        };
      });
    }
  },
  onLoad() {
    // 记住用户上一次的展开 / 收起状态
    try { const v = uni.getStorageSync(SHEET_KEY); if (v === '1') this.sheetOpen = true; } catch (e) {}
  },
  onShow() {
    this.refresh();
    this.tryLocate();
  },
  methods: {
    toggleSheet() {
      this.sheetOpen = !this.sheetOpen;
      try { uni.setStorageSync(SHEET_KEY, this.sheetOpen ? '1' : '0'); } catch (e) {}
    },
    refresh() {
      const s = store.get();
      this.visited = s.visited;
      this.wish = s.wishlist || [];
      this.st = store.getStats();
    },
    tryLocate() {
      uni.getLocation({
        type: 'gcj02',
        success: loc => {
          store.setLastLoc({ lat: loc.latitude, lng: loc.longitude });
          const near = locateCity({ lat: loc.latitude, lng: loc.longitude });
          if (near) this.locCity = near;
        },
        fail: () => {}
      });
    },
    onMarkerTap(e) {
      const id = e.detail && (e.detail.markerId !== undefined ? e.detail.markerId : e.detail.markerID);
      if (this.viewMode === 'nation') {
        const p = PROVINCES[id];
        if (p) this.drill(p);
      } else {
        const c = citiesOfProv(this.curProv)[id - 1000];
        if (c) this.goDetail(c.name);
      }
    },
    drill(prov) {
      this.viewMode = 'province';
      this.curProv = prov;
      this.sheetOpen = true;
    },
    backNation() {
      this.viewMode = 'nation';
      this.curProv = '';
    },
    goDetail(name) { uni.navigateTo({ url: '/pages/city/detail?name=' + encodeURIComponent(name) }); },
    wished(name) { return this.wish.includes(name); },
    doSearch() {
      const hit = searchCity(this.kw.trim());
      if (!hit.length) { uni.showToast({ title: '没找到这个城市', icon: 'none' }); return; }
      if (hit.length === 1) { this.goDetail(hit[0].name); return; }
      const c = findCity(this.kw.trim()) || hit[0];
      this.goDetail(c.name);
    }
  }
};
</script>

<style scoped>
.map-page { position: relative; height: 100vh; overflow: hidden; }
.the-map { width: 100%; height: 100vh; }

/* 顶部毛玻璃悬浮统计卡 */
.stats-bar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 5;
  padding: 70rpx 24rpx 12rpx;
  background: linear-gradient(180deg, rgba(10,31,44,.88) 50%, rgba(10,31,44,0));
}
.stats-inner {
  background: rgba(13, 37, 53, 0.72);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1rpx solid rgba(245, 240, 230, 0.14);
  border-radius: 20rpx;
  padding: 22rpx 26rpx 18rpx;
  display: flex; align-items: center; justify-content: space-between;
  box-shadow: 0 10rpx 32rpx rgba(0,0,0,0.28);
}
.stat-main { display: flex; align-items: center; gap: 18rpx; }
.stat-num-wrap { display: flex; align-items: baseline; gap: 4rpx; }
.stat-num {
  font-size: 60rpx; font-weight: 800; line-height: 1;
  color: #E8A838;
  text-shadow: 0 2rpx 12rpx rgba(232,168,56,0.35);
}
.stat-unit { font-size: 22rpx; color: #C48A1A; font-weight: 600; }
.stat-meta { display: flex; flex-direction: column; gap: 4rpx; }
.stat-cap { display: block; font-size: 24rpx; color: #F5F0E6; font-weight: 500; }
.stat-sub { display: block; font-size: 20rpx; color: #8A9BA8; }
.stat-actions { text-align: right; }
.search-box {
  font-size: 22rpx; color: #C8D0D8;
  background: rgba(245,240,230,0.08);
  border: 1rpx solid rgba(245,240,230,0.12);
  border-radius: 14rpx; padding: 12rpx 20rpx;
}
.search-input {
  width: 260rpx;
  background: rgba(10,31,44,0.5);
  border: 1rpx solid rgba(245,240,230,0.18);
  border-radius: 14rpx; padding: 10rpx 16rpx;
  font-size: 22rpx; color: #F5F0E6;
}

/* 渐变进度条 */
.progress-track {
  margin-top: 14rpx;
  height: 10rpx;
  border-radius: 999rpx;
  background: rgba(245,240,230,0.1);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: 999rpx;
  background: linear-gradient(90deg, #C48A1A 0%, #E8A838 55%, #F0C060 100%);
  box-shadow: 0 0 12rpx rgba(232,168,56,0.45);
  transition: width 0.4s ease;
}

.back-nation {
  position: absolute; top: 230rpx; left: 24rpx; z-index: 5;
  background: rgba(13,37,53,0.88);
  border: 1rpx solid rgba(245,240,230,0.18);
  color: #F5F0E6;
  font-size: 24rpx; border-radius: 999rpx; padding: 12rpx 28rpx;
  box-shadow: 0 4rpx 16rpx rgba(0,0,0,0.2);
}
.loc-banner {
  position: absolute; top: 230rpx; right: 24rpx; z-index: 5; max-width: 58%;
  background: rgba(232,168,56,0.16);
  border: 1rpx solid rgba(232,168,56,0.42);
  color: #F5F0E6;
  font-size: 22rpx; border-radius: 16rpx; padding: 14rpx 20rpx;
  box-shadow: 0 4rpx 16rpx rgba(0,0,0,0.18);
}

/* 底部抽屉 */
.bottom-sheet {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 6;
  background: rgba(13, 37, 53, 0.96);
  border-radius: 28rpx 28rpx 0 0;
  border-top: 1rpx solid rgba(245,240,230,0.12);
  max-height: 40vh;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 -8rpx 32rpx rgba(0,0,0,0.3);
}
.sheet-handle {
  flex: 0 0 auto; max-height: 8vh; padding: 18rpx 28rpx;
  display: flex; justify-content: space-between; align-items: center;
}
.handle-left { display: flex; flex-direction: column; gap: 4rpx; min-width: 0; }
.sheet-title-row { display: flex; align-items: center; gap: 10rpx; }
.sheet-icon { font-size: 22rpx; color: #E8A838; }
.sheet-title { font-size: 26rpx; color: #F5F0E6; font-weight: 600; }
.sheet-summary { font-size: 20rpx; color: #8A9BA8; }
.handle-right { flex: 0 0 auto; padding-left: 16rpx; }
.sheet-arrow {
  display: inline-block; font-size: 24rpx; color: #8A9BA8;
  transition: transform .28s ease, opacity .2s ease; opacity: .9;
}
.sheet-arrow.rotate { transform: rotate(180deg); }
.sheet-body {
  flex: 1 1 auto; max-height: 0; opacity: 0;
  overflow: hidden; overflow-x: hidden;
  transition: max-height .28s ease, opacity .22s ease;
}
.sheet-body.show { max-height: 32vh; opacity: 1; padding: 0 28rpx 30rpx; overflow-x: hidden; }

/* 省份行 · 半透明胶囊感
   布局硬化：省名占剩余宽度（可单行省略），数字列固定宽度不参与压缩，
   保证 320 / 375 / 430 屏宽下右侧「已点亮/总数」都不会被挤出屏幕 */
.prov-row { padding: 16rpx 0; }
.prov-head {
  display: flex; flex-direction: row; align-items: center;
  width: 100%; min-width: 0;
}
.prov-name {
  flex: 1 1 0%; min-width: 0; display: block;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font-size: 26rpx; color: #F5F0E6;
  background: rgba(245, 240, 230, 0.08);
  border: 1rpx solid rgba(245, 240, 230, 0.12);
  border-radius: 999rpx;
  padding: 6rpx 18rpx;
}
.prov-count {
  flex: 0 0 auto; margin-left: 16rpx;
  font-size: 22rpx; color: #8A9BA8;
  white-space: nowrap; text-align: right;
  font-variant-numeric: tabular-nums;
}
.prov-row .bar { margin-top: 12rpx; }

/* 省视图城市行：同样的弹性硬化，城市名可省略，右侧徽标/箭头永不被挤掉 */
.city-row {
  display: flex; flex-direction: row; align-items: center;
  width: 100%; min-width: 0;
  padding: 22rpx 0;
  border-bottom: 1rpx solid rgba(245, 240, 230, 0.08);
}
.city-name {
  flex: 1 1 0%; min-width: 0; display: block;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font-size: 28rpx; color: #8A9BA8;
}
.city-name.visited { color: #E8A838; font-weight: 500; }
.city-right {
  flex: 0 0 auto; margin-left: 16rpx;
  display: flex; flex-direction: row; align-items: center;
}
.city-arrow {
  flex: 0 0 auto; font-size: 22rpx; color: #8A9BA8; margin-left: 8rpx;
}
</style>