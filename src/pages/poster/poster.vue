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
    <view class="tiny" style="margin:20rpx 24rpx">海报含已打卡统计、省份点亮进度与打卡城市墙。</view>
  </view>
</template>

<script>
import store from '../../core/store.js';
import { PROVINCES, citiesOfProv } from '../../data/cities.js';
import { BRAND } from '../../config.js';

const W = 750, H = 1334;

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
      const st = store.getStats();
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

      // 背景
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#0A1F2C');
      bg.addColorStop(0.5, '#0D2535');
      bg.addColorStop(1, '#122E3E');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // 装饰光晕
      const glow = ctx.createRadialGradient(W / 2, 300, 50, W / 2, 300, 420);
      glow.addColorStop(0, 'rgba(232,168,56,.28)');
      glow.addColorStop(1, 'rgba(232,168,56,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, 700);

      // 标题
      ctx.textAlign = 'center';
      ctx.fillStyle = '#F5F0E6';
      ctx.font = 'bold 52px sans-serif';
      ctx.fillText(BRAND.name, W / 2, 130);
      ctx.fillStyle = '#E8A838';
      ctx.font = '30px sans-serif';
      ctx.fillText(BRAND.slogan, W / 2, 185);
      const date = new Date();
      ctx.fillStyle = '#8A9BA8';
      ctx.font = '22px sans-serif';
      ctx.fillText(date.getFullYear() + ' 年 ' + (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日', W / 2, 228);

      // 统计块
      const y0 = 280;
      const cards = [
        [String(st.visitedCount), '已打卡城市'],
        [st.pct + '%', '点亮占比'],
        [st.provDone + '/' + st.provinces.length, '点亮省份']
      ];
      cards.forEach((c, i) => {
        const x = 30 + i * ((W - 60) / 3) + (W - 60) / 6;
        ctx.fillStyle = 'rgba(245,240,230,0.1)';
        roundRect(ctx, 30 + i * ((W - 60) / 3), y0, (W - 60) / 3 - 16, 170, 20);
        ctx.fill();
        ctx.strokeStyle = 'rgba(232,168,56,0.35)';
        ctx.lineWidth = 1.5;
        roundRect(ctx, 30 + i * ((W - 60) / 3), y0, (W - 60) / 3 - 16, 170, 20);
        ctx.stroke();
        ctx.fillStyle = '#E8A838';
        ctx.font = 'bold 54px sans-serif';
        ctx.fillText(c[0], x - 8, y0 + 85);
        ctx.fillStyle = '#8A9BA8';
        ctx.font = '22px sans-serif';
        ctx.fillText(c[1], x - 8, y0 + 130);
      });

      // 省份进度条（前 12 名）
      ctx.textAlign = 'left';
      let y = 520;
      ctx.fillStyle = '#F5F0E6';
      ctx.font = 'bold 32px sans-serif';
      ctx.fillText('省份点亮进度', 40, y);
      y += 30;
      st.provinces.slice(0, 12).forEach((p) => {
        y += 46;
        ctx.fillStyle = '#F5F0E6';
        ctx.font = '24px sans-serif';
        const pname = p.prov.length > 8 ? p.prov.slice(0, 8) : p.prov;
        ctx.fillText(pname, 40, y);
        ctx.fillStyle = 'rgba(245,240,230,0.12)';
        roundRect(ctx, 260, y - 20, 380, 18, 9); ctx.fill();
        if (p.pct > 0) {
          ctx.fillStyle = '#E8A838';
          roundRect(ctx, 260, y - 20, Math.max(18, 380 * p.pct / 100), 18, 9); ctx.fill();
        }
        ctx.fillStyle = '#8A9BA8';
        ctx.font = '22px sans-serif';
        ctx.fillText(p.visited + '/' + p.total, 660, y);
      });

      // 城市墙
      y += 60;
      ctx.fillStyle = '#F5F0E6';
      ctx.font = 'bold 32px sans-serif';
      ctx.fillText('我的足迹城市墙', 40, y);
      y += 44;
      const visited = Object.keys(s.visited);
      if (visited.length) {
        let x = 40;
        ctx.font = '24px sans-serif';
        visited.slice(0, 90).forEach((name) => {
          const w2 = ctx.measureText(name).width + 28;
          if (x + w2 > W - 40) { x = 40; y += 52; }
          if (y > H - 120) return;
          ctx.fillStyle = 'rgba(232,168,56,.18)';
          roundRect(ctx, x, y - 24, w2, 40, 20); ctx.fill();
          ctx.fillStyle = '#E8A838';
          ctx.fillText(name, x + 14, y + 4);
          x += w2 + 10;
        });
      } else {
        ctx.fillStyle = '#8A9BA8';
        ctx.font = '24px sans-serif';
        ctx.fillText('还没有打卡城市，快去点亮第一座吧', 40, y);
      }

      // 底部
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8A9BA8';
      ctx.font = '22px sans-serif';
      ctx.fillText('数据统计自「' + BRAND.name + '」小程序', W / 2, H - 50);

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
  border: 1rpx solid rgba(232,168,56,0.25);
  box-shadow: 0 12rpx 40rpx rgba(0,0,0,0.35);
}
.actions { display: flex; gap: 16rpx; margin: 28rpx 24rpx 0; }
.actions .btn { flex: 1; }
</style>
