<template>
  <view class="page">
    <!-- 年份页签：全部 + 打卡记录里的年份（去重、降序），切换后整张海报按该年子集重绘 -->
    <view class="year-bar" v-if="years.length">
      <scroll-view class="year-scroll" scroll-x :show-scrollbar="false">
        <view class="year-chip" :class="{ on: activeYear === null }" @tap="pickYear(null)">全部</view>
        <view
          class="year-chip"
          v-for="y in years"
          :key="y"
          :class="{ on: activeYear === y }"
          @tap="pickYear(y)"
        >{{ y }}</view>
      </scroll-view>
    </view>
    <view class="canvas-wrap">
      <canvas type="2d" id="poster" class="poster-canvas"></canvas>
    </view>
    <view class="actions">
      <button class="btn primary" @tap="draw">{{ drawn ? '重新生成' : '生成海报' }}</button>
      <button class="btn ghost" :disabled="!drawn" @tap="save">保存到相册</button>
      <button class="btn ghost" :disabled="!drawn" open-type="share">分享给好友</button>
    </view>
    <view class="tiny" style="margin:20rpx 24rpx">海报包含旅行里程、探索进度与足迹之最。</view>
  </view>
</template>

<script>
import store from '../../core/store.js';
import { PROVINCES as PROVINCE_LIST } from '../../data/cities.js';
import { CHINA_RINGS, SCS, PROVINCES as OUTLINE_PROVINCES } from '../../data/china-outline.js';
import {
  visitedChrono, travelMileage, explorePct, extremeCities,
  longestLeg, footprintSpanDays, fmtKm
} from '../../core/logic.js';
import { BRAND } from '../../config.js';

const W = 750, H = 1334;

/* 投影范围：经度 73~136、纬度 18~54（线性映射，点位/轮廓/省界共用同一套） */
const LNG_MIN = 73, LNG_MAX = 136, LAT_MIN = 18, LAT_MAX = 54;

/* 地图面板：214~600 */
const PANEL_X = 30, PANEL_Y = 214, PANEL_W = 690, PANEL_H = 386;
/* 面板内绘图区 */
const MAP_X = 56, MAP_Y = 258, MAP_W = 638, MAP_H = 320;

/* 南海诸岛小窗（面板右下角） */
const SCS_X = 592, SCS_Y = 452, SCS_W = 110, SCS_H = 140;
const SCS_LNG_MIN = 105, SCS_LNG_MAX = 122, SCS_LAT_MIN = 2, SCS_LAT_MAX = 24;

const GOLD = '#D9B36A';
const CREAM = '#F2EDE3';

export default {
  data() {
    return { drawn: false, canvas: null, ctx: null, years: [], activeYear: null };
  },
  onShareAppMessage() {
    const span = this.activeYear === null ? '' : this.activeYear + ' 年度 · ';
    return {
      title: BRAND.name + ' · ' + span + '已点亮 ' + Object.keys(store.get().visited || {}).length + ' 座城市',
      path: '/pages/map/map'
    };
  },
  onShow() {
    const visited = store.get().visited || {};
    const ys = collectYears(visited);
    this.years = ys;
    // 当前选中的年份已不存在（数据被改）→ 回到「全部」并重绘
    if (this.activeYear !== null && ys.indexOf(this.activeYear) < 0) {
      this.activeYear = null;
      if (this.drawn) this.draw();
    }
  },
  onReady() { this.draw(); },
  methods: {
    /** 切换年份（null = 全部），整张海报按该年子集重绘 */
    pickYear(y) {
      if (this.activeYear === y) return;
      this.activeYear = y;
      this.draw();
    },
    async draw() {
      const s = store.get();
      const query = uni.createSelectorQuery().in(this);
      const node = await new Promise(resolve => {
        query.select('#poster').fields({ node: true, size: true }).exec(res => resolve(res && res[0]));
      });
      if (!node) return;
      const canvas = node.node;
      const dpr = 2;
      canvas.width = W * dpr / 2;
      canvas.height = H * dpr / 2;
      const ctx = canvas.getContext('2d');
      const k = dpr / 2;
      ctx.scale(k, k);
      this.canvas = canvas;

      /* ---------- 数据：全部 / 指定年份子集（所有指标都由子集重算） ---------- */
      const allVisited = s.visited || {};
      const subset = this.activeYear === null ? allVisited : filterByYear(allVisited, this.activeYear);

      const chrono = visitedChrono(subset);
      const km = travelMileage(subset);
      const pct = explorePct(subset);
      const extreme = extremeCities(subset);
      const leg = longestLeg(subset);
      const spanDays = footprintSpanDays(subset);
      const litProvs = {};
      chrono.forEach(c => { if (c.prov) litProvs[c.prov] = true; });
      const litCount = Object.keys(litProvs).length;

      /* ---------- 背景 ---------- */
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#0A1E34');
      bg.addColorStop(0.5, '#0C2745');
      bg.addColorStop(1, '#0E2C4E');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const glow = ctx.createRadialGradient(W / 2, 330, 50, W / 2, 330, 460);
      glow.addColorStop(0, 'rgba(217,179,106,.22)');
      glow.addColorStop(1, 'rgba(217,179,106,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, 760);

      /* ---------- 顶栏 ---------- */
      ctx.textAlign = 'center';
      ctx.fillStyle = CREAM;
      ctx.font = 'bold 50px sans-serif';
      ctx.fillText(BRAND.name, W / 2, 104);
      ctx.fillStyle = GOLD;
      ctx.font = '28px sans-serif';
      ctx.fillText('足迹报告', W / 2, 146);
      const date = new Date();
      ctx.fillStyle = 'rgba(242,237,227,0.55)';
      ctx.font = '22px sans-serif';
      ctx.fillText(date.getFullYear() + ' 年 ' + (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日', W / 2, 178);
      if (this.activeYear !== null) {
        ctx.fillStyle = 'rgba(217,179,106,0.85)';
        ctx.font = '20px sans-serif';
        ctx.fillText(this.activeYear + ' 年度足迹', W / 2, 204);
      }

      /* ---------- 地图面板 ---------- */
      drawPanel(ctx, PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 24);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(242,237,227,0.45)';
      ctx.font = '22px sans-serif';
      ctx.fillText('足迹星图', 56, 248);

      const projX = lng => MAP_X + ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * MAP_W;
      const projY = lat => MAP_Y + ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * MAP_H;

      /* 城市点位（时间序，带坐标） */
      const pts = chrono
        .filter(c => typeof c.lat === 'number' && typeof c.lng === 'number')
        .map(c => ({ name: c.name, x: projX(c.lng), y: projY(c.lat) }));

      /* 先规划城市名位置（城市名优先占位），省名再避开它们 */
      ctx.font = '20px sans-serif';
      const cityRects = [];
      const cityLabel = pts.map(p => {
        const tw = ctx.measureText(p.name).width;
        const cands = [
          [p.x + 9, p.y - 23],           // 点右上
          [p.x - 9 - tw, p.y - 23],      // 点左上
          [p.x + 9, p.y + 5],            // 点右下
          [p.x - 9 - tw, p.y + 5]        // 点左下
        ];
        for (let i = 0; i < cands.length; i++) {
          const r = { x: cands[i][0], y: cands[i][1], w: tw, h: 20 };
          if (r.x < MAP_X - 6 || r.x + r.w > MAP_X + MAP_W + 6) continue;
          if (cityRects.some(o => rectHit(r, o))) continue;
          cityRects.push(r);
          return r;
        }
        return null;    // 四处都相交 → 只画点不标名
      });

      /* ① 国土轮廓：填充 + 描边 */
      pathRings(ctx, CHINA_RINGS, projX, projY);
      ctx.fillStyle = 'rgba(217,179,106,0.05)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(242,237,227,0.22)';
      ctx.lineWidth = 1.1;
      ctx.stroke();

      /* ② 省界：常描边，已点亮省填充（prov 全名与 PROVINCES.name 匹配） */
      OUTLINE_PROVINCES.forEach(pv => {
        pathRings(ctx, pv.rings, projX, projY);
        if (litProvs[pv.name]) {
          ctx.fillStyle = 'rgba(217,179,106,0.18)';
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(242,237,227,0.10)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      });

      /* ③ 省名标注（已点亮省用金色；与已放标注相交则跳过） */
      ctx.font = '15px sans-serif';
      ctx.textAlign = 'center';
      const provRects = [];
      OUTLINE_PROVINCES.forEach(pv => {
        if (!pv.center) return;
        const cx = projX(pv.center[0]), cy = projY(pv.center[1]);
        const tw = ctx.measureText(pv.name).width;
        const r = { x: cx - tw / 2, y: cy - 9, w: tw, h: 14 };
        if (r.x < MAP_X - 4 || r.x + r.w > MAP_X + MAP_W + 4) return;
        if (provRects.some(o => rectHit(r, o))) return;
        if (cityRects.some(o => rectHit(r, o))) return;
        provRects.push(r);
        ctx.fillStyle = litProvs[pv.name] ? 'rgba(217,179,106,0.95)' : 'rgba(242,237,227,0.38)';
        ctx.fillText(pv.name, cx, cy + 5);
      });

      /* ④ 南海诸岛小窗 */
      ctx.fillStyle = 'rgba(9,25,43,0.94)';
      roundRect(ctx, SCS_X, SCS_Y, SCS_W, SCS_H, 10);
      ctx.fill();

      const scsX = lng => (SCS_X + 7) + ((lng - SCS_LNG_MIN) / (SCS_LNG_MAX - SCS_LNG_MIN)) * (SCS_W - 14);
      const scsY = lat => (SCS_Y + 14) + ((SCS_LAT_MAX - lat) / (SCS_LAT_MAX - SCS_LAT_MIN)) * (SCS_H - 32);

      ctx.save();
      roundRect(ctx, SCS_X, SCS_Y, SCS_W, SCS_H, 10);
      ctx.clip();
      pathRings(ctx, SCS, scsX, scsY);
      ctx.fillStyle = 'rgba(217,179,106,0.05)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(242,237,227,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = 'rgba(242,237,227,0.25)';
      ctx.lineWidth = 1;
      roundRect(ctx, SCS_X, SCS_Y, SCS_W, SCS_H, 10);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(242,237,227,0.45)';
      ctx.font = '13px sans-serif';
      ctx.fillText('南海诸岛', SCS_X + SCS_W / 2, SCS_Y + SCS_H - 7);

      /* ⑤ 弧线 → 金点 → 城市名 */
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - dist * 0.2, b.x, b.y);
        ctx.strokeStyle = 'rgba(217,179,106,0.55)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      pts.forEach(p => {
        ctx.save();
        ctx.shadowColor = 'rgba(217,179,106,0.95)';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#F0D9A4';
        ctx.fill();
        ctx.restore();
      });

      ctx.font = '20px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(242,237,227,0.88)';
      pts.forEach((p, i) => {
        const r = cityLabel[i];
        if (r) ctx.fillText(p.name, r.x, r.y + 15);
      });

      /* ---------- 中段：探索环（带刻度） + 三行数据 ---------- */
      const ringCx = 200, ringCy = 730, ringR = 84;
      ctx.lineWidth = 16;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ringCx, ringCy, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(245,240,230,0.10)';
      ctx.stroke();
      const ratio = Math.max(0, Math.min(1, pct / 100));
      if (ratio > 0) {
        ctx.beginPath();
        ctx.arc(ringCx, ringCy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
        ctx.strokeStyle = GOLD;
        ctx.stroke();
      }
      ctx.lineCap = 'butt';

      /* 环外刻度：0 / 25 / 50 / 75 / 100（顶部起顺时针，口径与进度一致） */
      [0, 25, 50, 75, 100].forEach(v => {
        const a = -Math.PI / 2 + Math.PI * 2 * (v / 100);
        const cosA = Math.cos(a), sinA = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(ringCx + cosA * (ringR + 9), ringCy + sinA * (ringR + 9));
        ctx.lineTo(ringCx + cosA * (ringR + 17), ringCy + sinA * (ringR + 17));
        ctx.strokeStyle = 'rgba(242,237,227,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(242,237,227,0.5)';
        ctx.font = '13px sans-serif';
        const ny = ringCy + sinA * (ringR + 30) + 5;
        // 0 与 100 同在环顶（首尾同点），左右分列，避免互相压字
        if (v === 0) {
          ctx.textAlign = 'right';
          ctx.fillText('0', ringCx - 11, ny);
        } else if (v === 100) {
          ctx.textAlign = 'left';
          ctx.fillText('100', ringCx + 11, ny);
        } else {
          ctx.textAlign = 'center';
          ctx.fillText(String(v), ringCx + cosA * (ringR + 30), ny);
        }
      });

      ctx.textAlign = 'center';
      ctx.fillStyle = GOLD;
      ctx.font = 'bold 38px sans-serif';
      ctx.fillText(pct.toFixed(2) + '%', ringCx, ringCy + 8);
      ctx.fillStyle = 'rgba(242,237,227,0.55)';
      ctx.font = '21px sans-serif';
      ctx.fillText(
        this.activeYear === null ? '探索中国' : this.activeYear + ' · 探索中国',
        ringCx, ringCy + ringR + 60
      );

      const rows = [
        [fmtKm(km), '旅游总里程'],
        [String(chrono.length) + ' 座', '打卡城市'],
        [String(spanDays) + ' 天', '足迹跨度']
      ];
      const rowX0 = 344, rowX1 = 700;
      rows.forEach((r, i) => {
        const cy = 668 + i * 80;
        ctx.fillStyle = 'rgba(242,237,227,0.52)';
        ctx.font = '22px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(r[1], rowX0, cy);
        ctx.fillStyle = GOLD;
        ctx.font = 'bold 40px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(r[0], rowX1, cy + 14);
        if (i < rows.length - 1) {
          ctx.strokeStyle = 'rgba(245,240,230,0.10)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(rowX0, cy + 40);
          ctx.lineTo(rowX1, cy + 40);
          ctx.stroke();
        }
      });

      /* ---------- 下段：统计格 / 提示 ---------- */
      if (chrono.length >= 2 && extreme) {
        const cells = [
          ['最北之城', extreme.north.name],
          ['最南之城', extreme.south.name],
          ['最东之城', extreme.east.name],
          ['最西之城', extreme.west.name],
          ['点亮省份', litCount + '/' + PROVINCE_LIST.length],
          ['单段最远', leg ? leg.from + '→' + leg.to : '—', leg ? leg.km + ' km' : '']
        ];
        const cellW = 337, cellH = 112, gapX = 16, gapY = 14;
        cells.forEach((c, i) => {
          const x = 30 + (i % 2) * (cellW + gapX);
          const y = 890 + Math.floor(i / 2) * (cellH + gapY);
          drawPanel(ctx, x, y, cellW, cellH, 18);
          ctx.textAlign = 'left';
          ctx.fillStyle = 'rgba(242,237,227,0.45)';
          ctx.font = '20px sans-serif';
          ctx.fillText(c[0], x + 22, y + 30);
          ctx.fillStyle = CREAM;
          let fs = 28;
          ctx.font = 'bold ' + fs + 'px sans-serif';
          while (fs > 18 && ctx.measureText(c[1]).width > cellW - 44) {
            fs -= 2;
            ctx.font = 'bold ' + fs + 'px sans-serif';
          }
          ctx.fillText(c[1], x + 22, y + 70);
          if (c[2]) {
            ctx.fillStyle = GOLD;
            ctx.font = '22px sans-serif';
            ctx.fillText(c[2], x + 22, y + 98);
          }
        });
      } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(242,237,227,0.6)';
        ctx.font = '26px sans-serif';
        ctx.fillText('点亮第 2 座城，开启你的旅行里程', W / 2, 980);
      }

      /* ---------- 底部 ---------- */
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(242,237,227,0.42)';
      ctx.font = '18px sans-serif';
      ctx.fillText(
        '数据统计自「' + BRAND.name + '」小程序 · 里程按打卡顺序串联已打卡城市的直线距离估算',
        W / 2, H - 46
      );

      this.drawn = true;
      uni.showToast({ title: '海报已生成', icon: 'success' });
    },
    save() {
      if (!this.canvas) return;
      uni.canvasToTempFilePath({
        canvas: this.canvas,
        success: res => {
          uni.saveImageToPhotosAlbum({
            filePath: res.tempFilePath,
            success: () => uni.showToast({ title: '已保存到相册', icon: 'success' }),
            fail: e => {
              if (String(e.errMsg || '').includes('auth')) {
                uni.showModal({ title: '需要相册权限', content: '请在设置中允许保存到相册', confirmText: '去设置', success: r => { if (r.confirm) uni.openSetting({}); } });
              } else {
                uni.showToast({ title: '保存失败：' + (e.errMsg || ''), icon: 'none' });
              }
            }
          });
        },
        fail: () => uni.showToast({ title: '生成图片失败', icon: 'none' })
      });
    }
  }
};

/* ---------- 年份：从打卡记录的 ts / date 提取 ---------- */
function yearOf(v) {
  const e = v || {};
  if (typeof e.ts === 'number' && e.ts > 0) {
    const y = new Date(e.ts).getFullYear();
    if (y > 1900) return y;
  }
  const m = /^(\d{4})/.exec(String(e.date || ''));
  return m ? Number(m[1]) : null;
}

/** 年份去重 + 降序 */
function collectYears(map) {
  const set = {};
  Object.keys(map || {}).forEach(name => {
    const y = yearOf(map[name]);
    if (y) set[y] = true;
  });
  return Object.keys(set).map(Number).sort((a, b) => b - a);
}

/** 年份子集：只保留该年打卡的城（无 year 信息的城在年份模式下不计入） */
function filterByYear(map, year) {
  const out = {};
  Object.keys(map || {}).forEach(name => {
    if (yearOf(map[name]) === year) out[name] = map[name];
  });
  return out;
}

/* ---------- 绘图工具 ---------- */
function pathRings(ctx, rings, fx, fy) {
  ctx.beginPath();
  (rings || []).forEach(ring => {
    for (let i = 0; i < ring.length; i++) {
      const x = fx(ring[i][0]), y = fy(ring[i][1]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  });
}

/** 矩形相交（含 1px 容差） */
function rectHit(a, b) {
  return !(a.x + a.w + 1 < b.x || b.x + b.w + 1 < a.x || a.y + a.h + 1 < b.y || b.y + b.h + 1 < a.y);
}

/** 圆角面板：玻璃底 + 香槟金细边 */
function drawPanel(ctx, x, y, w, h, r) {
  ctx.fillStyle = 'rgba(245,240,230,0.05)';
  roundRect(ctx, x, y, w, h, r); ctx.fill();
  ctx.strokeStyle = 'rgba(217,179,106,0.20)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, r); ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
</script>

<style scoped>
.year-bar { margin: 20rpx 24rpx 0; }
.year-scroll { white-space: nowrap; }
.year-chip {
  display: inline-block; padding: 8rpx 26rpx; margin-right: 14rpx;
  border-radius: 999rpx; font-size: 24rpx; line-height: 1.4;
  color: rgba(242, 237, 227, 0.62);
  background: rgba(245, 240, 230, 0.06);
  border: 1rpx solid rgba(217, 179, 106, 0.22);
}
.year-chip.on {
  color: #0B1420; font-weight: 600;
  background: #D9B36A; border-color: #D9B36A;
}
.canvas-wrap { display: flex; justify-content: center; padding-top: 20rpx; }
.poster-canvas {
  width: 700rpx; height: 1246rpx;
  border-radius: 20rpx;
  border: 1rpx solid rgba(217,179,106,0.35);
  box-shadow: 0 12rpx 40rpx rgba(0,0,0,0.35);
}
.actions { display: flex; gap: 16rpx; margin: 28rpx 24rpx 0; }
.actions .btn { flex: 1; }
</style>
