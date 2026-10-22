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
          <!-- 返回全国：收进标题栏，仅省视图显示（点按不触发抽屉展开/收起） -->
          <view class="back-pill" v-if="viewMode === 'province'" @tap.stop="backNation">⬅ 返回全国</view>
          <text class="sheet-arrow" :class="{ rotate: sheetOpen }">▴</text>
        </view>
      </view>
      <scroll-view scroll-y class="sheet-body" :class="{ show: sheetOpen }">
        <view v-if="viewMode === 'nation'">
          <view class="prov-row" v-for="p in st.provinces" :key="p.prov" @tap="drill(p.prov)">
            <view class="prov-head">
              <text class="prov-name">{{ p.prov }}</text>
              <text class="prov-count">{{ p.visited }}/{{ p.total }}</text>
              <text class="prov-arrow">›</text>
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
import { CITIES, citiesOfProv, searchCity, findCity } from '../../data/cities.js';
import { locateCity } from '../../core/logic.js';

const SHEET_KEY = 'tf.mapSheetOpen';

const ICON = {
  visited: '/static/icons/dot_green.png',   // 香槟金实心点（已打卡）
  none: '/static/icons/dot_gray.png'        // 灰蓝小点（未打卡，无文字）
};

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
      const v = this.visited;
      if (this.viewMode === 'nation') {
        // 全国视图：只给已打卡城市亮金点，不挂任何文字气泡（各省进度气泡已全部移除）
        return CITIES.filter(c => !!v[c.name]).map((c, i) => ({
          id: 5000 + i, latitude: c.lat, longitude: c.lng,
          iconPath: ICON.visited, width: 18, height: 18,
          joinCluster: false, zIndex: 2
        }));
      }
      const cities = citiesOfProv(this.curProv);
      return cities.map((c, i) => {
        const done = !!v[c.name];
        const m = {
          id: 1000 + i, latitude: c.lat, longitude: c.lng,
          // 已打卡：金点 + 点按看城市名；未打卡：只剩一个无文字浅灰小点
          iconPath: done ? ICON.visited : ICON.none,
          width: done ? 22 : 12, height: done ? 22 : 12,
          joinCluster: false, zIndex: done ? 2 : 1
        };
        if (done) {
          m.callout = {
            content: c.name, display: 'BYCLICK', fontSize: 11, borderRadius: 8,
            bgColor: 'rgba(9,30,52,0.94)', color: '#F2EDE3',
            padding: 6, borderWidth: 1, borderColor: 'rgba(217,179,106,0.55)'
          };
        }
        return m;
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
        // 全国视图的标记就是已打卡城市本身，点开城市详情
        const list = CITIES.filter(c => !!this.visited[c.name]);
        const c = list[id - 5000];
        if (c) this.goDetail(c.name);
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

/* 顶部统计卡 · 玻璃大圆角 + 香槟金大数字 */
.stats-bar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 5;
  padding: 70rpx 24rpx 12rpx;
  background: linear-gradient(180deg, rgba(10,30,52,0.94) 55%, rgba(10,30,52,0));
}
.stats-inner {
  background: rgba(9, 30, 52, 0.88);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1rpx solid rgba(245, 240, 230, 0.14);
  border-radius: 32rpx;
  padding: 24rpx 28rpx 20rpx;
  display: flex; align-items: center; justify-content: space-between;
  box-shadow: 0 14rpx 38rpx rgba(0, 0, 0, 0.32);
}
.stat-main { display: flex; align-items: center; gap: 18rpx; }
.stat-num-wrap { display: flex; align-items: baseline; gap: 4rpx; }
.stat-num {
  font-size: 64rpx; font-weight: 800; line-height: 1;
  color: #D9B36A;
  text-shadow: 0 4rpx 18rpx rgba(217, 179, 106, 0.32);
}
.stat-unit { font-size: 22rpx; color: #B8934F; font-weight: 600; }
.stat-meta { display: flex; flex-direction: column; gap: 4rpx; }
.stat-cap { display: block; font-size: 24rpx; color: #F2EDE3; font-weight: 500; }
.stat-sub { display: block; font-size: 20rpx; color: rgba(242, 237, 227, 0.55); }
.stat-actions { text-align: right; }
.search-box {
  font-size: 22rpx; color: #D9B36A;
  background: rgba(217, 179, 106, 0.10);
  border: 1rpx solid rgba(217, 179, 106, 0.42);
  border-radius: 999rpx; padding: 12rpx 24rpx;
}
.search-input {
  width: 260rpx;
  background: rgba(245, 240, 230, 0.06);
  border: 1rpx solid rgba(245, 240, 230, 0.16);
  border-radius: 999rpx; padding: 10rpx 22rpx;
  font-size: 22rpx; color: #F2EDE3;
}

/* 渐变进度条 · 香槟金 */
.progress-track {
  margin-top: 16rpx;
  height: 10rpx;
  border-radius: 999rpx;
  background: rgba(245, 240, 230, 0.10);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: 999rpx;
  background: linear-gradient(90deg, #B8934F 0%, #D9B36A 55%, #E7C98C 100%);
  box-shadow: 0 0 14rpx rgba(217, 179, 106, 0.42);
  transition: width 0.4s ease;
}

/* 定位提示 · 独立玻璃胶囊（金字、单行不换行） */
.loc-banner {
  position: absolute; top: 232rpx; left: 24rpx; right: 24rpx; z-index: 5;
  display: block;
  background: rgba(9, 30, 52, 0.88);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1rpx solid rgba(217, 179, 106, 0.42);
  color: #D9B36A;
  font-size: 22rpx; border-radius: 999rpx; padding: 16rpx 26rpx;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  box-shadow: 0 10rpx 26rpx rgba(0, 0, 0, 0.26);
}
.loc-banner .brand-text { color: #E7C98C; font-weight: 600; }

/* 底部抽屉 · 玻璃面板 */
.bottom-sheet {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 6;
  background: rgba(9, 30, 52, 0.94);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 34rpx 34rpx 0 0;
  border-top: 1rpx solid rgba(245, 240, 230, 0.14);
  max-height: 40vh;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 -12rpx 40rpx rgba(0, 0, 0, 0.34);
}
.sheet-handle {
  flex: 0 0 auto; max-height: 8vh; padding: 20rpx 28rpx;
  display: flex; justify-content: space-between; align-items: center;
}
.handle-left { flex: 1 1 auto; display: flex; flex-direction: column; gap: 4rpx; min-width: 0; }
.sheet-title-row { display: flex; align-items: center; gap: 10rpx; min-width: 0; }
.sheet-icon { flex: 0 0 auto; font-size: 22rpx; color: #D9B36A; }
.sheet-title {
  flex: 0 1 auto; min-width: 0;
  font-size: 26rpx; color: #F2EDE3; font-weight: 600;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.sheet-summary {
  font-size: 20rpx; color: rgba(242, 237, 227, 0.55);
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.handle-right {
  flex: 0 0 auto; padding-left: 16rpx;
  display: flex; flex-direction: row; align-items: center; gap: 14rpx;
}
/* 返回全国小胶囊（原顶部悬浮按钮收进标题栏） */
.back-pill {
  font-size: 20rpx; color: #D9B36A; line-height: 1.4;
  background: rgba(217, 179, 106, 0.10);
  border: 1rpx solid rgba(217, 179, 106, 0.42);
  border-radius: 999rpx; padding: 6rpx 18rpx;
  white-space: nowrap;
}
.sheet-arrow {
  display: inline-block; font-size: 24rpx; color: rgba(242, 237, 227, 0.55);
  transition: transform .28s ease, opacity .2s ease; opacity: .9;
}
.sheet-arrow.rotate { transform: rotate(180deg); }
.sheet-body {
  flex: 1 1 auto; max-height: 0; opacity: 0;
  overflow: hidden; overflow-x: hidden;
  transition: max-height .28s ease, opacity .22s ease;
}
.sheet-body.show { max-height: 32vh; opacity: 1; padding: 0 24rpx 32rpx; overflow-x: hidden; }

/* 省份行 · 独立圆角玻璃卡（行距 12rpx）
   布局沿用 1.0.4 的绝对定位：计数 position:absolute 钉右，脱离文档流、宽度固定，
   任何屏宽都不会被挤出屏幕；省名给计数与行尾箭头预留固定空间，超出单行省略。 */
.prov-row {
  position: relative;
  padding: 20rpx 22rpx;
  margin-bottom: 12rpx;
  border-radius: 24rpx;
  background: rgba(245, 240, 230, 0.055);
  border: 1rpx solid rgba(245, 240, 230, 0.10);
  overflow: hidden;
}
.prov-row:last-child { margin-bottom: 0; }
.prov-head { position: relative; }
.prov-name {
  display: block; margin-right: 168rpx;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font-size: 27rpx; color: #F2EDE3; font-weight: 500;
}
.prov-count {
  position: absolute; right: 40rpx; top: 50%; transform: translateY(-50%);
  width: 110rpx; text-align: right; white-space: nowrap;
  font-size: 22rpx; color: rgba(242, 237, 227, 0.55);
  font-variant-numeric: tabular-nums;
}
.prov-arrow {
  position: absolute; right: 0; top: 50%; transform: translateY(-50%);
  font-size: 26rpx; color: #D9B36A; line-height: 1;
}
.prov-row .bar { margin-top: 16rpx; height: 8rpx; }

/* 省视图城市行：同样绝对定位钉右，城市名预留 90rpx，右侧徽标/箭头永不被挤掉 */
.city-row {
  position: relative;
  padding: 22rpx 22rpx;
  margin-bottom: 10rpx;
  border-radius: 22rpx;
  background: rgba(245, 240, 230, 0.045);
  border: 1rpx solid rgba(245, 240, 230, 0.08);
  overflow: hidden;
}
.city-name {
  display: block; margin-right: 90rpx;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font-size: 28rpx; color: rgba(242, 237, 227, 0.65);
}
.city-name.visited { color: #D9B36A; font-weight: 500; }
.city-right {
  position: absolute; right: 14rpx; top: 50%; transform: translateY(-50%);
  display: flex; flex-direction: row; align-items: center;
  white-space: nowrap;
}
/* 右列整体收在 90rpx 预留区内：徽标在此处用紧凑规格，避免压到城市名 */
.city-right .chip { font-size: 20rpx; padding: 2rpx 10rpx; margin-right: 6rpx; }
.city-arrow {
  flex: 0 0 auto; font-size: 22rpx; color: rgba(242, 237, 227, 0.45); margin-left: 8rpx;
}
</style>