<template>
  <view class="page">
    <!-- 路径一：照片一键识别 -->
    <view class="card">
      <view class="row">
        <text class="h3">① 照片一键识别</text>
        <text class="tiny" v-if="photoTotal">已选 {{ photoTotal }} 张</text>
      </view>
      <text class="tip">
        只在本机读取照片里的 GPS 与拍摄时间，匹配城市库。<text class="strong">照片本体绝不上传、也不联网</text>，解析完即丢弃。
        一次最多 20 张，可多次添加。
      </text>
      <button class="btn primary" style="margin-top:18rpx" @tap="pickPhotos">＋ 选照片识别</button>

      <view class="stat-box" v-if="photoTotal">
        <text class="stat-line">已解析 {{ photoParsed }} 张 · 识别到 {{ photoCityCount }} 座城市待确认</text>
        <text class="stat-skip" v-if="skipNoGps">· {{ skipNoGps }} 张无位置信息已跳过</text>
        <text class="stat-skip" v-if="skipFar">· {{ skipFar }} 张坐标离城市库任何城市都超过 {{ matchKm }}km，已跳过</text>
        <text class="stat-skip" v-if="skipVisited">· {{ skipVisited }} 张所在城市已点亮，自动排除</text>
        <text class="stat-skip" v-if="skipNoDate">· {{ skipNoDate }} 张识别到城市但没有拍摄时间，年份留空</text>
        <text class="stat-skip" v-if="skipUnsupported">· {{ skipUnsupported }} 张格式不支持或无 EXIF（如 PNG / HEIC 原图），已跳过</text>
      </view>
    </view>

    <!-- 路径二：点选补录 -->
    <view class="card">
      <view class="row">
        <text class="h3">② 点选补录</text>
        <text class="tiny" v-if="pickCount">{{ pickCount }} 座已勾选</text>
      </view>
      <input
        class="input search-input"
        :value="kw"
        placeholder="搜城市名，如：喀什 / 大理 / 平遥"
        confirm-type="search"
        @input="onSearch"
      />
      <text class="tip" v-if="!kw.trim()">先选省份，再勾城市；同一座城市重复点选即取消。</text>

      <!-- 搜索结果 -->
      <view v-if="kw.trim()">
        <view v-if="!searchList.length" class="empty">没找到这个城市</view>
        <view class="city-line" v-for="c in searchList" :key="c.name" @tap="toggleCity(c.name)">
          <text class="check" :class="{ on: !!pendingMap[c.name] }">{{ pendingMap[c.name] ? '☑' : '☐' }}</text>
          <text class="city-text" :class="{ done: !!visited[c.name] }">{{ c.name }}</text>
          <text class="city-prov">{{ c.prov }}</text>
          <text class="chip" v-if="visited[c.name]">已点亮</text>
        </view>
      </view>

      <!-- 省 → 市 两级 -->
      <view v-else>
        <view class="prov-grid">
          <view
            class="prov-cell"
            :class="{ active: curProv === p }"
            v-for="p in provinces"
            :key="p"
            @tap="curProv = curProv === p ? '' : p"
          >{{ shortProv(p) }}</view>
        </view>
        <view class="city-list" v-if="curProv">
          <view class="city-line" v-for="c in curProvCities" :key="c.name" @tap="toggleCity(c.name)">
            <text class="check" :class="{ on: !!pendingMap[c.name] }">{{ pendingMap[c.name] ? '☑' : '☐' }}</text>
            <text class="city-text" :class="{ done: !!visited[c.name] }">{{ c.name }}</text>
            <text class="chip" v-if="visited[c.name]">已点亮</text>
          </view>
        </view>
        <view class="empty" v-else>上面选一个省份查看城市</view>
      </view>
    </view>

    <!-- 待导入汇总 -->
    <view class="card">
      <view class="row">
        <text class="h3">③ 待导入城市（{{ pending.length }}）</text>
        <text class="tiny link" v-if="pending.length" @tap="clearPending">全部清空</text>
      </view>

      <view v-if="!pending.length" class="empty">还没有待导入的城市，用上面任意一种方式添加</view>

      <view class="pend-row" v-for="(p, i) in pending" :key="p.name">
        <view class="pend-main">
          <text class="pend-name">{{ p.name }}</text>
          <text class="pend-sub">{{ p.prov }} · {{ viaLabel(p.via) }}</text>
        </view>
        <view class="year-box">
          <input
            class="year-input"
            type="number"
            maxlength="4"
            :value="p.year"
            placeholder="年份"
            @input="e => onYear(i, e)"
          />
          <text class="year-unit">年</text>
        </view>
        <text class="pend-del" @tap="removePending(i)">✕</text>
      </view>

      <button
        class="btn primary import-btn"
        :class="{ disabled: !pending.length }"
        @tap="confirmImport"
      >确认导入{{ pending.length ? '（' + pending.length + ' 座）' : '' }}</button>
      <text class="tip foot-tip">
        年份可留空（留空则不写日期）。导入后写入打卡记录并标注「补录 · 历史足迹导入」，已点亮的城市不会重复导入。
      </text>
    </view>
  </view>
</template>

<script>
import store from '../../core/store.js';
import { PROVINCES, citiesOfProv, searchCity, findCity } from '../../data/cities.js';
import { GPS_MATCH_KM, matchCityWithin } from '../../core/logic.js';
import { parseExif } from '../../utils/exif.js';

const VIA_LABEL = { photo: '照片识别', pick: '点选补录', both: '照片 + 点选' };
const shortProv = p => p.replace(/省|市|自治区|特别行政区|壮族|回族|维吾尔/g, '');

/** 本地读文件为 ArrayBuffer（不经过网络） */
function readFileBuffer(filePath) {
  return new Promise(resolve => {
    try {
      if (typeof wx === 'undefined' || !wx.getFileSystemManager) return resolve(null);
      wx.getFileSystemManager().readFile({
        filePath,
        success: res => resolve(res.data || null),
        fail: () => resolve(null)
      });
    } catch (e) { resolve(null); }
  });
}

export default {
  data() {
    return {
      matchKm: GPS_MATCH_KM,
      photoTotal: 0,
      photoParsed: 0,
      skipNoGps: 0,
      skipFar: 0,
      skipVisited: 0,
      skipNoDate: 0,
      skipUnsupported: 0,
      pending: [],
      visited: {},
      provinces: PROVINCES,
      curProv: '',
      kw: '',
      searchList: []
    };
  },
  computed: {
    pendingMap() {
      const m = {};
      this.pending.forEach(p => { m[p.name] = true; });
      return m;
    },
    pickCount() {
      return this.pending.filter(p => p.via === 'pick' || p.via === 'both').length;
    },
    photoCityCount() {
      return this.pending.filter(p => p.via === 'photo' || p.via === 'both').length;
    },
    curProvCities() {
      return this.curProv ? citiesOfProv(this.curProv) : [];
    }
  },
  onLoad() {
    this.refreshVisited();
  },
  onShow() {
    this.refreshVisited();
    // 已点亮的城市从待导入里剔除（例如在详情页刚打过卡）
    this.pending = this.pending.filter(p => !this.visited[p.name]);
  },
  methods: {
    viaLabel(v) { return VIA_LABEL[v] || '点选补录'; },
    shortProv(p) { return shortProv(p); },
    refreshVisited() { this.visited = store.get().visited || {}; },

    /* ---------- 路径一：照片识别 ---------- */
    pickPhotos() {
      // 单次最多 20 张，可多次追加
      const count = 20;
      const onPaths = paths => this.handleFiles(paths || []);
      // 优先 chooseMedia（原图），老基础库退回 chooseImage
      if (typeof wx !== 'undefined' && wx.chooseMedia) {
        wx.chooseMedia({
          count,
          mediaType: ['image'],
          sizeType: ['original'],
          sourceType: ['album', 'camera'],
          success: res => onPaths((res.tempFiles || []).map(f => f.tempFilePath)),
          fail: () => {}
        });
        return;
      }
      uni.chooseImage({
        count,
        sizeType: ['original'],
        sourceType: ['album', 'camera'],
        success: res => onPaths(res.tempFilePaths),
        fail: () => {}
      });
    },

    async handleFiles(paths) {
      const list = paths.slice(0, 20);
      if (!list.length) return;
      uni.showLoading({ title: '本地解析中', mask: true });
      try {
        for (let i = 0; i < list.length; i++) {
          this.photoTotal++;
          const buf = await readFileBuffer(list[i]);
          if (!buf) { this.skipUnsupported++; continue; }
          let ex;
          try { ex = parseExif(buf); } catch (e) { ex = { ok: false, reason: 'parse-error' }; }
          if (!ex || !ex.ok) {
            if (ex && ex.reason === 'no-gps') this.skipNoGps++;
            else this.skipUnsupported++;
            continue;
          }
          this.photoParsed++;
          const hit = matchCityWithin({ lat: ex.lat, lng: ex.lng });
          if (!hit) { this.skipFar++; continue; }
          const name = hit.city.name;
          if (this.visited[name]) { this.skipVisited++; continue; }
          const year = ex.date ? ex.date.slice(0, 4) : '';
          if (!year) this.skipNoDate++;
          const r = this.addPending(name, year, 'photo');
          if (r === 'visited') this.skipVisited++;
        }
      } finally {
        uni.hideLoading();
      }
      if (!this.photoCityCount && this.photoTotal) {
        uni.showToast({ title: '这些照片没能识别出可导入的城市', icon: 'none', duration: 2200 });
      }
    },

    /* ---------- 待导入维护 ---------- */
    addPending(name, year, via) {
      const city = findCity(name);
      if (!city) return 'unknown';
      if (this.visited[name]) return 'visited';
      const idx = this.pending.findIndex(p => p.name === name);
      if (idx >= 0) {
        const it = this.pending[idx];
        if (year) {
          // 同一城市多张照片取最早年份（首次到访）
          if (!it.year || Number(year) < Number(it.year)) it.year = year;
        }
        if (it.via !== via) it.via = 'both';
        return 'merged';
      }
      this.pending.push({ name, prov: city.prov, year: year || '', via });
      return 'added';
    },
    toggleCity(name) {
      const i = this.pending.findIndex(p => p.name === name);
      if (i >= 0) { this.pending.splice(i, 1); return; }
      if (this.visited[name]) {
        uni.showToast({ title: name + ' 已点亮过', icon: 'none' });
        return;
      }
      const r = this.addPending(name, '', 'pick');
      if (r === 'visited') uni.showToast({ title: name + ' 已点亮过', icon: 'none' });
    },
    onSearch(e) {
      const kw = (e.detail.value || '').trim();
      this.kw = e.detail.value || '';
      this.searchList = kw ? searchCity(kw) : [];
    },
    onYear(i, e) {
      const v = String(e.detail.value || '').replace(/\D/g, '').slice(0, 4);
      if (this.pending[i]) this.pending[i].year = v;
    },
    removePending(i) {
      this.pending.splice(i, 1);
    },
    clearPending() {
      this.pending = [];
    },

    /* ---------- 确认导入 ---------- */
    confirmImport() {
      if (!this.pending.length) {
        uni.showToast({ title: '还没有待导入的城市', icon: 'none' });
        return;
      }
      const withYear = this.pending.filter(p => /^\d{4}$/.test(String(p.year || ''))).length;
      const total = this.pending.length;
      uni.showModal({
        title: '确认导入',
        content: '将点亮 ' + total + ' 座城市（' + withYear + ' 座带年份，' +
          (total - withYear) + ' 座年份留空）。已点亮的城市会自动跳过。',
        confirmText: '确认导入',
        success: r => {
          if (!r.confirm) return;
          const res = store.importFootprints(this.pending.map(p => ({ city: p.name, year: p.year })));
          this.pending = [];
          this.refreshVisited();
          if (res.imported > 0) {
            uni.showToast({ title: '已点亮 ' + res.imported + ' 座新城市', icon: 'none', duration: 2200 });
            setTimeout(() => { uni.navigateBack(); }, 1200);
          } else {
            uni.showToast({ title: '没有新增城市（都已点亮过）', icon: 'none', duration: 2000 });
          }
        }
      });
    }
  }
};
</script>

<style scoped>
.tip {
  display: block; margin-top: 12rpx;
  font-size: 22rpx; color: #7A8B98; line-height: 1.6;
}
.strong { color: #B87A12; font-weight: 600; }
.stat-box {
  margin-top: 18rpx; padding: 18rpx 20rpx;
  background: rgba(13, 37, 53, 0.06); border-radius: 14rpx;
}
.stat-line { display: block; font-size: 24rpx; color: #1A2A32; font-weight: 500; }
.stat-skip { display: block; margin-top: 6rpx; font-size: 21rpx; color: #8A9BA8; line-height: 1.5; }

.search-input { margin-top: 18rpx; }

/* 省份宫格 */
.prov-grid {
  display: flex; flex-direction: row; flex-wrap: wrap;
  margin-top: 18rpx;
}
.prov-cell {
  width: 25%; flex: 0 0 25%;
  box-sizing: border-box;
  padding: 14rpx 6rpx;
  margin-bottom: 10rpx;
  text-align: center;
  font-size: 24rpx; color: #3A4A55;
  background: rgba(26, 42, 50, 0.05);
  border: 1rpx solid transparent;
  border-radius: 12rpx;
}
.prov-cell.active {
  background: rgba(232, 168, 56, 0.20);
  border-color: rgba(196, 138, 26, 0.45);
  color: #B87A12; font-weight: 600;
}

/* 城市行：弹性硬化，右侧徽标不被挤掉 */
.city-list { margin-top: 8rpx; max-height: 720rpx; overflow-y: auto; }
.city-line {
  display: flex; flex-direction: row; align-items: center;
  width: 100%; min-width: 0;
  padding: 20rpx 0;
  border-bottom: 1rpx solid rgba(26, 42, 50, 0.08);
}
.check { flex: 0 0 auto; width: 44rpx; font-size: 30rpx; color: #8A9BA8; }
.check.on { color: #C48A1A; }
.city-text {
  flex: 1 1 0%; min-width: 0; display: block;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font-size: 28rpx; color: #1A2A32;
}
.city-text.done { color: #8A9BA8; text-decoration: line-through; }
.city-prov {
  flex: 0 0 auto; margin-left: 12rpx;
  font-size: 21rpx; color: #8A9BA8;
  max-width: 40%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.city-line .chip { flex: 0 0 auto; margin-left: 12rpx; margin-right: 0; }

/* 待导入行 */
.pend-row {
  display: flex; flex-direction: row; align-items: center;
  width: 100%; min-width: 0;
  padding: 18rpx 0; border-bottom: 1rpx solid rgba(26, 42, 50, 0.08);
}
.pend-main { flex: 1 1 0%; min-width: 0; }
.pend-name { display: block; font-size: 28rpx; color: #1A2A32; font-weight: 500; }
.pend-sub {
  display: block; margin-top: 4rpx; font-size: 21rpx; color: #8A9BA8;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.year-box {
  flex: 0 0 auto; display: flex; flex-direction: row; align-items: center;
  margin-left: 12rpx;
  background: rgba(26, 42, 50, 0.06); border-radius: 10rpx; padding: 6rpx 12rpx;
}
.year-input { width: 100rpx; text-align: right; font-size: 26rpx; color: #1A2A32; }
.year-unit { font-size: 22rpx; color: #8A9BA8; margin-left: 4rpx; }
.pend-del { flex: 0 0 auto; margin-left: 14rpx; padding: 8rpx; font-size: 24rpx; color: #B54A3C; }

.import-btn { margin-top: 24rpx; }
.foot-tip { margin-top: 14rpx; }
.link { color: #C48A1A; }
</style>
