<template>
  <view class="page">
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
import { PROVINCES } from '../../data/cities.js';
import {
  visitedChrono, travelMileage, explorePct, extremeCities,
  longestLeg, footprintSpanDays, stats, fmtKm
} from '../../core/logic.js';
import { BRAND } from '../../config.js';

const W = 750, H = 1334;

/* 星图投影范围：经度 73~136、纬度 18~54（仅线性投影，不引入任何地图数据/轮廓） */
const LNG_MIN = 73, LNG_MAX = 136, LAT_MIN = 18, LAT_MAX = 54;
/* 星图绘制区（面板内留边距） */
const MAP_X = 56, MAP_Y = 296, MAP_W = 638, MAP_H = 238;

const GOLD = '#D9B36A';
const CREAM = '#F2EDE3';

export default {
  data() { return { drawn: false, canvas: null, ctx: null }; },
  onShareAppMessage() {
    return {
      title: BRAND.name + ' · 我已点亮 ' + store.getStats().visitedCount + ' 座城市',
      path: '/pages/map/map'
    };
  },
  onReady() { this.draw(); },
  methods: {
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

      /* ---------- 本地数据（全部来自打卡记录，不引入外部指标） ---------- */
      const chrono = visitedChrono(s.visited || {});
      const km = travelMileage(s.visited || {});
      const pct = explorePct(s.visited || {});
      const extreme = extremeCities(s.visited || {});
      const leg = longestLeg(s.visited || {});
      const spanDays = footprintSpanDays(s.visited || {});
      const provHit = stats(s.visited || {}).provinces.filter(p => p.visited > 0).length;

      /* ---------- 背景 ---------- */
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#0A1E34');
      bg.addColorStop(0.5, '#0C2745');
      bg.addColorStop(1, '#0E2C4E');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const glow = ctx.createRadialGradient(W / 2, 300, 50, W / 2, 300, 420);
      glow.addColorStop(0, 'rgba(217,179,106,.26)');
      glow.addColorStop(1, 'rgba(217,179,106,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, 700);

      /* ---------- 顶栏 ---------- */
      ctx.textAlign = 'center';
      ctx.fillStyle = CREAM;
      ctx.font = 'bold 52px sans-serif';
      ctx.fillText(BRAND.name, W / 2, 118);
      ctx.fillStyle = GOLD;
      ctx.font = '30px sans-serif';
      ctx.fillText('足迹报告', W / 2, 170);
      const date = new Date();
      ctx.fillStyle = 'rgba(242,237,227,0.55)';
      ctx.font = '22px sans-serif';
      ctx.fillText(date.getFullYear() + ' 年 ' + (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日', W / 2, 208);

      /* ---------- 星图区 ---------- */
      drawPanel(ctx, 30, 240, 690, 320, 24);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(242,237,227,0.45)';
      ctx.font = '22px sans-serif';
      ctx.fillText('足迹星图', 56, 278);

      // 淡经纬网格（白色 alpha 0.04）
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 6; i++) {
        const gx = MAP_X + (MAP_W / 6) * i;
        ctx.beginPath(); ctx.moveTo(gx, MAP_Y); ctx.lineTo(gx, MAP_Y + MAP_H); ctx.stroke();
      }
      for (let j = 0; j <= 4; j++) {
        const gy = MAP_Y + (MAP_H / 4) * j;
        ctx.beginPath(); ctx.moveTo(MAP_X, gy); ctx.lineTo(MAP_X + MAP_W, gy); ctx.stroke();
      }

      // 经纬度线性投影
      const projX = lng => MAP_X + ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * MAP_W;
      const projY = lat => MAP_Y + ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * MAP_H;
      const pts = chrono
        .filter(c => typeof c.lat === 'number' && typeof c.lng === 'number')
        .map(c => ({ name: c.name, x: projX(c.lng), y: projY(c.lat) }));

      // 时间序相邻城市：二次贝塞尔弧线，控制点取中点上偏该段距离 20%
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2 - dist * 0.2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cx, cy, b.x, b.y);
        ctx.strokeStyle = 'rgba(217,179,106,0.55)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // 金点（带外发光）+ 城市名
      ctx.font = '20px sans-serif';
      pts.forEach(p => {
        ctx.save();
        ctx.shadowColor = 'rgba(217,179,106,0.95)';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#F0D9A4';
        ctx.fill();
        ctx.restore();
        const roomRight = p.x < MAP_X + MAP_W - 76;
        ctx.textAlign = roomRight ? 'left' : 'right';
        ctx.fillStyle = 'rgba(242,237,227,0.88)';
        // 顶部极端纬度的点：标签下移，避免压到面板标题
        const ly = Math.max(p.y - 8, MAP_Y + 22);
        ctx.fillText(p.name, p.x + (roomRight ? 11 : -11), ly);
      });

      /* ---------- 中段：探索环 + 三行数据 ---------- */
      const ringCx = 200, ringCy = 700, ringR = 96;
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

      ctx.textAlign = 'center';
      ctx.fillStyle = GOLD;
      ctx.font = 'bold 42px sans-serif';
      ctx.fillText(pct.toFixed(2) + '%', ringCx, ringCy + 8);
      ctx.fillStyle = 'rgba(242,237,227,0.55)';
      ctx.font = '24px sans-serif';
      ctx.fillText('探索中国', ringCx, ringCy + ringR + 44);

      const rows = [
        [fmtKm(km), '旅游总里程'],
        [String(chrono.length) + ' 座', '打卡城市'],
        [String(spanDays) + ' 天', '足迹跨度']
      ];
      const rowX0 = 344, rowX1 = 700;
      rows.forEach((r, i) => {
        const cy = 622 + i * 78;
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
          ctx.moveTo(rowX0, cy + 42);
          ctx.lineTo(rowX1, cy + 42);
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
          ['点亮省份', provHit + '/' + PROVINCES.length],
          ['单段最远', (leg ? leg.from + '→' + leg.to : '—'), (leg ? leg.km + ' km' : '')]
        ];
        const cellW = 337, cellH = 104, gapX = 16, gapY = 12;
        cells.forEach((c, i) => {
          const x = 30 + (i % 2) * (cellW + gapX);
          const y = 872 + Math.floor(i / 2) * (cellH + gapY);
          drawPanel(ctx, x, y, cellW, cellH, 18);
          ctx.textAlign = 'left';
          ctx.fillStyle = 'rgba(242,237,227,0.45)';
          ctx.font = '20px sans-serif';
          ctx.fillText(c[0], x + 22, y + 30);
          ctx.fillStyle = CREAM;
          ctx.font = 'bold 30px sans-serif';
          ctx.fillText(c[1], x + 22, y + 68);
          if (c[2]) {
            ctx.fillStyle = GOLD;
            ctx.font = '22px sans-serif';
            ctx.fillText(c[2], x + 22, y + 94);
          }
        });
      } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(242,237,227,0.6)';
        ctx.font = '26px sans-serif';
        ctx.fillText('点亮第 2 座城，开启你的旅行里程', W / 2, 960);
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
.canvas-wrap { display: flex; justify-content: center; padding-top: 24rpx; }
.poster-canvas {
  width: 700rpx; height: 1246rpx;
  border-radius: 20rpx;
  border: 1rpx solid rgba(217,179,106,0.35);
  box-shadow: 0 12rpx 40rpx rgba(0,0,0,0.35);
}
.actions { display: flex; gap: 16rpx; margin: 28rpx 24rpx 0; }
.actions .btn { flex: 1; }
</style>
