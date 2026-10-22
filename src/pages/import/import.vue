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
        JPEG 与 iPhone 的 HEIC 原图都支持。一次最多 20 张，可多次添加。
      </text>
      <button class="btn primary" style="margin-top:18rpx" @tap="pickPhotos">＋ 选照片识别</button>
      <text class="tip" style="display:block;margin-top:14rpx">
        若照片识别不到位置，多半是微信选图时剥离了定位；请把原图以文件形式发到微信，再从下方『③ 从微信文件导入』选，可完整保留定位。
      </text>

      <view class="stat-box" v-if="photoTotal">
        <text class="stat-line">已解析 {{ photoParsed }} 张 · 识别到 {{ photoCityCount }} 座城市待确认</text>
        <text class="stat-skip" v-if="skipNoGps">· {{ skipNoGps }} 张无位置信息已跳过</text>
        <text class="stat-skip" v-if="skipFar">· {{ skipFar }} 张坐标离城市库任何城市都超过 {{ matchKm }}km，已跳过</text>
        <text class="stat-skip" v-if="skipVisited">· {{ skipVisited }} 张所在城市已点亮，自动排除</text>
        <text class="stat-skip" v-if="skipNoDate">· {{ skipNoDate }} 张识别到城市但没有拍摄时间，年份留空</text>
        <text class="stat-skip" v-if="skipUnsupported">· {{ skipUnsupported }} 张格式不支持或读不到 EXIF（如 PNG / WebP / 截屏 / 损坏的 HEIC），已跳过</text>
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

    <!-- 路径三：从微信文件导入轨迹 -->
    <view class="card">
      <view class="row">
        <text class="h3">③ 从微信文件导入</text>
        <text class="tiny" v-if="fileTotal">已选 {{ fileTotal }} 个文件</text>
      </view>
      <text class="tip">
        支持 <text class="strong">GPX / KML</text> 轨迹文件（运动 App、码表、Google Earth 导出的都行），也支持
        <text class="strong">HEIC / JPEG 照片原图</text>——以文件形式发来的原图不经微信加工，定位信息完整保留。
        把文件发给自己或任意聊天后从这里选。全程只在本机读取，<text class="strong">不联网、不上传、不留副本</text>。
        一次最多 20 个，每个轨迹文件最多取 5000 个轨迹点。
      </text>
      <button class="btn ghost" style="margin-top:18rpx" @tap="pickTrackFiles">＋ 从聊天文件导入</button>

      <view class="stat-box" v-if="fileTotal">
        <text class="stat-line">已读 {{ fileParsed }} 个文件 · 识别到 {{ fileCityCount }} 座城市待确认</text>
        <text class="stat-skip" v-if="skipFileNoPoints">· {{ skipFileNoPoints }} 个文件里没找到轨迹点（不是 GPX / KML，或内容为空）</text>
        <text class="stat-skip" v-if="skipFileNoCity">· {{ skipFileNoCity }} 个文件的轨迹点离城市库任何城市都超过 {{ matchKm }}km，已跳过</text>
        <text class="stat-skip" v-if="skipFileExt">· {{ skipFileExt }} 个文件不是支持的轨迹 / 图片文件，已跳过</text>
        <text class="stat-skip" v-if="skipFileRead">· {{ skipFileRead }} 个文件读不出来，已跳过</text>
        <text class="stat-skip" v-if="skipFileVisited">· {{ skipFileVisited }} 座城市已点亮，自动排除</text>
        <text class="stat-skip" v-if="kmlNoDateTip">· KML 不带时间信息，年份留空，可在下面手填</text>
      </view>
    </view>

    <!-- 待导入汇总 -->
    <view class="card">
      <view class="row">
        <text class="h3">④ 待导入城市（{{ pending.length }}）</text>
        <text class="tiny link" v-if="pending.length" @tap="clearPending">全部清空</text>
      </view>

      <view v-if="!pending.length" class="empty">还没有待导入的城市，用上面任意一种方式添加</view>
      <view class="pend-row" v-for="(p, i) in pending" :key="p.name">
        <view class="pend-main">
          <text class="pend-name">{{ p.name }}</text>
          <text class="pend-sub">{{ p.prov }} · {{ viaLabel(p.src) }}</text>
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
import { parseTrackFile, citiesFromPoints } from '../../utils/track.js';

const VIA_META = { photo: '照片识别', pick: '点选补录', file: '轨迹文件' };
const VIA_ORDER = ['photo', 'pick', 'file'];
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

/** 本地按 utf-8 读文件为文本（GPX / KML，同样不经过网络） */
function readFileText(filePath) {
  return new Promise(resolve => {
    try {
      if (typeof wx === 'undefined' || !wx.getFileSystemManager) return resolve(null);
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: 'utf-8',
        success: res => resolve(typeof res.data === 'string' ? res.data : null),
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
      // 轨迹文件通道
      fileTotal: 0,
      fileParsed: 0,
      skipFileNoPoints: 0,
      skipFileNoCity: 0,
      skipFileExt: 0,
      skipFileRead: 0,
      skipFileVisited: 0,
      kmlNoDateTip: false,
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
      return this.pending.filter(p => (p.src || []).includes('pick')).length;
    },
    photoCityCount() {
      return this.pending.filter(p => (p.src || []).includes('photo')).length;
    },
    fileCityCount() {
      return this.pending.filter(p => (p.src || []).includes('file')).length;
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
    viaLabel(src) {
      const list = Array.isArray(src) ? src : [];
      const labels = VIA_ORDER.filter(k => list.includes(k)).map(k => VIA_META[k]);
      return labels.length ? labels.join(' + ') : '点选补录';
    },
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

    async handleFiles(paths, opts = {}) {
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
      if (!opts.silentToast && !this.photoCityCount && this.photoTotal) {
        uni.showToast({ title: '这些照片没能识别出可导入的城市', icon: 'none', duration: 2200 });
      }
    },

    /* ---------- 路径三：微信文件（GPX / KML 轨迹 + HEIC / JPEG 照片原图） ---------- */
    pickTrackFiles() {
      if (typeof wx === 'undefined' || !wx.chooseMessageFile) {
        uni.showToast({ title: '当前微信版本不支持从聊天文件导入', icon: 'none' });
        return;
      }
      // 轨迹 .gpx / .kml + 照片原图 .heic / .heif / .jpg / .jpeg，单次最多 20 个，可多次追加
      wx.chooseMessageFile({
        count: 20,
        type: 'file',
        extension: ['gpx', 'kml', 'heic', 'heif', 'jpg', 'jpeg'],
        success: res => this.handleTrackFiles(res.tempFiles || []),
        fail: () => {}
      });
    },

    async handleTrackFiles(files) {
      const list = (files || []).filter(f => f && f.path).slice(0, 20);
      if (!list.length) return;
      const citiesBefore = this.fileCityCount + this.photoCityCount;
      const imagePaths = [];
      uni.showLoading({ title: '本地解析文件', mask: true });
      try {
        for (const f of list) {
          this.fileTotal++;
          const name = f.name || '';
          // 照片原图：先攒下，循环后并入照片通道（同一套 parseExif + 匹配 + 确认清单）
          if (/\.(heic|heif|jpe?g)$/i.test(name)) { imagePaths.push(f.path); continue; }
          if (!/\.(gpx|kml)$/i.test(name)) { this.skipFileExt++; continue; }
          const text = await readFileText(f.path);
          if (!text) { this.skipFileRead++; continue; }

          let parsed;
          try { parsed = parseTrackFile(name, text); } catch (e) { parsed = { points: [], total: 0 }; }
          if (!parsed.points || !parsed.points.length) { this.skipFileNoPoints++; continue; }

          // 逐点复用 logic 的城市匹配，汇总成城市集合（每城取最早轨迹日期）
          const cities = citiesFromPoints(parsed.points, loc => matchCityWithin(loc));
          if (!cities.length) { this.skipFileNoCity++; continue; }

          this.fileParsed++;
          if (parsed.format === 'kml') this.kmlNoDateTip = true;   // KML 无时间信息，提示年份可手填
          cities.forEach(c => {
            const r = this.addPending(c.name, c.date ? c.date.slice(0, 4) : '', 'file');
            if (r === 'visited') this.skipFileVisited++;
          });
        }
      } finally {
        uni.hideLoading();
      }
      // 以文件形式发来的照片原图不经微信选图加工，parseExif 能读到完整定位
      if (imagePaths.length) await this.handleFiles(imagePaths, { silentToast: true });
      if (this.fileCityCount + this.photoCityCount === citiesBefore) {
        uni.showToast({ title: '这些文件没能匹配到城市', icon: 'none', duration: 2200 });
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
        // 同一城市多次命中取最早年份（首次到访）
        if (year && (!it.year || Number(year) < Number(it.year))) it.year = year;
        if (!Array.isArray(it.src)) it.src = [];
        if (!it.src.includes(via)) it.src.push(via);
        return 'merged';
      }
      this.pending.push({ name, prov: city.prov, year: year || '', src: [via] });
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
  font-size: 22rpx; color: rgba(242, 237, 227, 0.55); line-height: 1.6;
}
.strong { color: #D9B36A; font-weight: 600; }
/* 统计提示区 · 玻璃卡 */
.stat-box {
  margin-top: 18rpx; padding: 20rpx 22rpx;
  background: rgba(245, 240, 230, 0.05);
  border: 1rpx solid rgba(245, 240, 230, 0.10);
  border-radius: 24rpx;
}
.stat-line { display: block; font-size: 24rpx; color: #F2EDE3; font-weight: 500; }
.stat-skip { display: block; margin-top: 6rpx; font-size: 21rpx; color: rgba(242, 237, 227, 0.48); line-height: 1.5; }

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
  font-size: 24rpx; color: rgba(242, 237, 227, 0.62);
  background: rgba(245, 240, 230, 0.05);
  border: 1rpx solid transparent;
  border-radius: 16rpx;
}
.prov-cell.active {
  background: rgba(217, 179, 106, 0.14);
  border-color: rgba(217, 179, 106, 0.55);
  color: #D9B36A; font-weight: 600;
}

/* 城市行：弹性硬化，右侧徽标不被挤掉 */
.city-list { margin-top: 8rpx; max-height: 720rpx; overflow-y: auto; }
.city-line {
  display: flex; flex-direction: row; align-items: center;
  width: 100%; min-width: 0;
  padding: 20rpx 16rpx;
  margin-bottom: 8rpx;
  border-radius: 18rpx;
  background: rgba(245, 240, 230, 0.035);
}
.check { flex: 0 0 auto; width: 44rpx; font-size: 30rpx; color: rgba(242, 237, 227, 0.38); }
.check.on { color: #D9B36A; }
.city-text {
  flex: 1 1 0%; min-width: 0; display: block;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font-size: 28rpx; color: #F2EDE3;
}
.city-text.done { color: rgba(242, 237, 227, 0.38); text-decoration: line-through; }
.city-prov {
  flex: 0 0 auto; margin-left: 12rpx;
  font-size: 21rpx; color: rgba(242, 237, 227, 0.48);
  max-width: 40%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.city-line .chip { flex: 0 0 auto; margin-left: 12rpx; margin-right: 0; }

/* 待导入行 */
.pend-row {
  display: flex; flex-direction: row; align-items: center;
  width: 100%; min-width: 0;
  padding: 18rpx 16rpx; margin-bottom: 8rpx;
  border-radius: 20rpx;
  background: rgba(245, 240, 230, 0.045);
}
.pend-main { flex: 1 1 0%; min-width: 0; }
.pend-name { display: block; font-size: 28rpx; color: #F2EDE3; font-weight: 500; }
.pend-sub {
  display: block; margin-top: 4rpx; font-size: 21rpx; color: rgba(242, 237, 227, 0.48);
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.year-box {
  flex: 0 0 auto; display: flex; flex-direction: row; align-items: center;
  margin-left: 12rpx;
  background: rgba(245, 240, 230, 0.06);
  border: 1rpx solid rgba(245, 240, 230, 0.12);
  border-radius: 999rpx; padding: 6rpx 14rpx;
}
.year-input { width: 100rpx; text-align: right; font-size: 26rpx; color: #F2EDE3; }
.year-unit { font-size: 22rpx; color: rgba(242, 237, 227, 0.55); margin-left: 4rpx; }
.pend-del { flex: 0 0 auto; margin-left: 14rpx; padding: 8rpx; font-size: 24rpx; color: #E3A49A; }

.import-btn { margin-top: 24rpx; }
.foot-tip { margin-top: 14rpx; }
.link { color: #D9B36A; }
</style>
