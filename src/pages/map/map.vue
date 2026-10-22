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

    <!-- 顶部统计栏 -->
    <view class="stats-bar">
      <view class="stats-inner">
        <view class="stat-main">
          <text class="stat-num">{{ st.visitedCount }}</text>
          <view>
            <text class="stat-cap">已打卡城市 / {{ st.total }}</text>
            <text class="stat-sub">点亮 {{ st.pct }}% · 点亮省份 {{ st.provDone }}/{{ st.provinces.length }}</text>
          </view>
        </view>
        <view class="stat-actions">
          <view class="search-box" v-if="!showSearch" @tap="showSearch = true">🔍 搜城市</view>
          <input v-else class="search-input" v-model="kw" placeholder="输入城市名，如：喀什 / 大理" confirm-type="search" @confirm="doSearch" />
        </view>
      </view>
    </view>

    <!-- 回到全国 -->
    <view class="back-nation" v-if="viewMode === 'province'" @tap="backNation">⬅ 返回全国</view>

    <!-- 定位打卡提示 -->
    <view class="loc-banner" v-if="locCity && !visited[locCity.name]" @tap="goDetail(locCity.name)">
      📍 定位显示你在 <text class="brand-text">{{ locCity.name }}</text>（约 {{ locCity.dist }}km）· 去打卡 →
    </view>

    <!-- 底部面板 -->
    <view class="bottom-sheet" :class="{ open: sheetOpen }">
      <view class="sheet-handle" @tap="sheetOpen = !sheetOpen">
        <text class="sheet-title">{{ viewMode === 'nation' ? '各省进度（点亮城市数 / 总数）' : curProv + ' · 城市列表' }}</text>
        <text class="tiny">{{ sheetOpen ? '收起 ▾' : '展开 ▴' }}</text>
      </view>
      <scroll-view scroll-y class="sheet-body">
        <view v-if="viewMode === 'nation'">
          <view class="prov-row" v-for="p in st.provinces" :key="p.prov" @tap="drill(p.prov)">
            <view class="row">
              <text class="prov-name">{{ p.prov }}</text>
              <text class="tiny">{{ p.visited }}/{{ p.total }}</text>
            </view>
            <view class="bar"><view :style="{ width: p.pct + '%' }"></view></view>
          </view>
        </view>
        <view v-else>
          <view class="city-row row" v-for="c in provCities" :key="c.name" @tap="goDetail(c.name)">
            <text class="city-name" :class="{ visited: !!visited[c.name] }">
              {{ visited[c.name] ? '✅ ' : '⬜ ' }}{{ c.name }}
            </text>
            <view>
              <text v-if="wished(c.name)" class="chip orange">想去</text>
              <text class="tiny"> ›</text>
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

const ICON = {
  visited: '/static/icons/dot_green.png',
  wish: '/static/icons/dot_orange.png',
  none: '/static/icons/dot_gray.png',
  provZero: '/static/icons/dot_gray.png',
  provPart: '/static/icons/dot_orange.png',
  provDone: '/static/icons/dot_green.png'
};

const PROV_SHORT = {
  '北京市': '北京', '天津市': '天津', '上海市': '上海', '重庆市': '重庆',
  '内蒙古自治区': '内蒙古', '广西壮族自治区': '广西', '西藏自治区': '西藏',
  '宁夏回族自治区': '宁夏', '新疆维吾尔自治区': '新疆',
  '香港特别行政区': '香港', '澳门特别行政区': '澳门', '台湾省': '台湾'
};
const provShort = p => PROV_SHORT[p] || p.replace(/省$/, '');

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
            callout: { content: provShort(p) + ' ' + done + '/' + cities.length, display: 'ALWAYS', fontSize: 10, borderRadius: 6, bgColor: '#10161F', color: '#E8EDF2', padding: 4 }
          };
        });
      }
      const cities = citiesOfProv(this.curProv);
      return cities.map((c, i) => {
        const icon = this.visited[c.name] ? ICON.visited : (this.wish.includes(c.name) ? ICON.wish : ICON.none);
        return {
          id: 1000 + i, latitude: c.lat, longitude: c.lng, iconPath: icon, width: 22, height: 22,
          callout: { content: c.name + (this.visited[c.name] ? ' ✓' : ''), display: 'BYCLICK', fontSize: 11, borderRadius: 6, bgColor: '#10161F', color: '#E8EDF2', padding: 5 }
        };
      });
    }
  },
  onShow() {
    this.refresh();
    this.tryLocate();
  },
  methods: {
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
.stats-bar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 5;
  padding: 70rpx 24rpx 16rpx;
  background: linear-gradient(180deg, rgba(11,15,20,.96) 60%, rgba(11,15,20,0));
}
.stats-inner { background: rgba(21,27,36,.92); border: 1rpx solid #232D3B; border-radius: 20rpx; padding: 20rpx 24rpx; display: flex; align-items: center; justify-content: space-between; }
.stat-main { display: flex; align-items: center; gap: 16rpx; }
.stat-num { font-size: 56rpx; font-weight: 800; color: #22C55E; }
.stat-cap { display: block; font-size: 24rpx; color: #E8EDF2; }
.stat-sub { display: block; font-size: 20rpx; color: #A8B3BF; }
.stat-actions { text-align: right; }
.search-box { font-size: 22rpx; color: #A8B3BF; background: #1A2230; border-radius: 12rpx; padding: 12rpx 20rpx; }
.search-input { width: 260rpx; background: #0E141D; border: 1rpx solid #2C3948; border-radius: 12rpx; padding: 10rpx 16rpx; font-size: 22rpx; color: #E8EDF2; }
.back-nation {
  position: absolute; top: 210rpx; left: 24rpx; z-index: 5;
  background: rgba(21,27,36,.95); border: 1rpx solid #2C3948; color: #E8EDF2;
  font-size: 24rpx; border-radius: 999rpx; padding: 10rpx 28rpx;
}
.loc-banner {
  position: absolute; top: 210rpx; right: 24rpx; z-index: 5; max-width: 60%;
  background: rgba(34,197,94,.16); border: 1rpx solid rgba(34,197,94,.5); color: #E8EDF2;
  font-size: 22rpx; border-radius: 16rpx; padding: 14rpx 20rpx;
}
.bottom-sheet {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 6;
  background: #10161F; border-radius: 28rpx 28rpx 0 0; border-top: 1rpx solid #232D3B;
  max-height: 56vh; display: flex; flex-direction: column;
}
.sheet-handle { padding: 22rpx 28rpx; display: flex; justify-content: space-between; align-items: center; }
.sheet-title { font-size: 26rpx; color: #E8EDF2; font-weight: 600; }
.sheet-body { flex: 1; max-height: 48vh; padding: 0 28rpx 30rpx; }
.prov-row { padding: 16rpx 0; }
.prov-name { font-size: 26rpx; color: #E8EDF2; }
.city-row { padding: 22rpx 0; border-bottom: 1rpx solid #1B2432; }
.city-name { font-size: 28rpx; color: #A8B3BF; }
.city-name.visited { color: #E8EDF2; }
</style>
