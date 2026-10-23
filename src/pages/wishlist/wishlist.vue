<template>
  <view class="page">
    <!-- 离你最近的未打卡城市 -->
    <view class="card" v-if="nearest">
      <text class="tiny">离你最近的未打卡城市</text>
      <view class="row" style="margin-top:12rpx">
        <view>
          <text class="h2">{{ nearest.name }}</text>
          <text class="sub" style="display:block;margin-top:6rpx">{{ nearest.prov }} · 约 {{ fmtDist(nearest.dist) }}</text>
        </view>
        <button class="btn primary sm" @tap="goDetail(nearest.name)">去看看</button>
      </view>
    </view>

    <view class="card">
      <view class="row">
        <text class="h3">想去清单（{{ list.length }}）</text>
        <text class="tiny" v-if="hasLoc">按距离排序</text>
      </view>

      <!-- 清单非空：列表照旧 -->
      <view class="wish-row" v-for="c in list" :key="c.name">
        <view @tap="goDetail(c.name)">
          <text class="wish-name">{{ c.name }}</text>
          <text class="tiny" style="display:block;margin-top:4rpx">
            {{ c.prov }}<text v-if="c.dist !== null"> · 约 {{ fmtDist(c.dist) }}</text>
          </text>
        </view>
        <view class="wish-actions">
          <button class="btn sm ghost" @tap="addTrip(c)">＋行程</button>
          <button class="btn sm danger" @tap="removeWish(c.name)">移除</button>
        </view>
      </view>

      <!-- 清单非空：底部紧凑入口，点开展开同款抽卡 -->
      <view class="draw-entry" v-if="list.length && !drawOpen" @tap="openDraw">
        🎲 还没想好下一站？抽一座城
      </view>

      <!-- 抽卡机：空状态自动展示；非空时由入口展开。两处共用同一块逻辑 -->
      <view class="draw-machine" v-if="drawOpen">
        <!-- 默认态 -->
        <view v-if="!rolling && !drawn" class="draw-idle">
          <text class="draw-hint">还没想好下一站？</text>
          <text class="draw-sub">让运气替你做一次决定</text>
          <button class="btn primary draw-btn" @tap="draw">🎲 抽一座城</button>
        </view>

        <!-- 滚动中 -->
        <view v-else-if="rolling" class="draw-rolling">
          <text class="draw-city rolling">{{ rollName }}</text>
          <text class="draw-tip">正在为你挑选…</text>
        </view>

        <!-- 定格 -->
        <view v-else class="draw-result">
          <text class="draw-city">{{ drawn.name }}</text>
          <text class="draw-prov">{{ drawn.prov }}</text>
          <view class="draw-meta">
            <text v-if="drawn.dist !== null" class="meta-chip">距你约 {{ fmtDist(drawn.dist) }}</text>
            <text v-if="drawn.days" class="meta-chip">建议 {{ drawn.days }} 天</text>
            <text v-if="drawn.season" class="meta-chip">最佳 {{ drawn.season }}</text>
          </view>
          <text class="draw-summary" v-if="drawn.summary">{{ drawn.summary }}</text>
          <view class="draw-actions">
            <button class="btn sm" :class="isWished(drawn.name) ? 'ghost' : 'primary'" @tap="addDrawnWish">
              {{ isWished(drawn.name) ? '✓ 已在想去清单' : '＋ 收入想去' }}
            </button>
            <button class="btn sm ghost" @tap="draw">再抽一次</button>
            <button class="btn sm ghost" @tap="goDetail(drawn.name)">去看看</button>
          </view>
        </view>
      </view>
    </view>

    <!-- 正当时令（仅清单为空时显示；匹配 0 则整区隐藏） -->
    <view class="card" v-if="!list.length && seasonal.length">
      <text class="h3">🍂 正当时令 · {{ month }}月</text>
      <scroll-view scroll-x class="seasonal-scroll" :show-scrollbar="false">
        <view class="seasonal-track">
          <view class="postcard" v-for="c in seasonal" :key="c.name" @tap="goDetail(c.name)">
            <text class="pc-city">{{ c.name }}</text>
            <text class="pc-season">{{ c.season }}</text>
            <text class="pc-summary">{{ c.summary }}</text>
            <button class="btn sm" :class="isWished(c.name) ? 'ghost' : 'primary'" @tap.stop="quickWish(c.name)">
              {{ isWished(c.name) ? '✓ 想去' : '＋想去' }}
            </button>
          </view>
        </view>
      </scroll-view>
    </view>

    <view class="notice" style="margin: 0 24rpx">提示：允许定位后，清单会按离你的距离由近到远排序，并推荐最近的未去城市。</view>

    <!-- 抽卡彩带层：pointer-events:none 不挡操作，播完自动隐藏 -->
    <view class="confetti-layer" v-if="confettiOn">
      <view class="confetti-piece" v-for="p in confettiParts" :key="p.id" :style="pieceStyle(p)"></view>
    </view>
  </view>
</template>

<script>
import store from '../../core/store.js';
import { findCity, CITIES } from '../../data/cities.js';
import { GUIDES } from '../../data/guides.js';
import { haversine, drawPool, seasonalCities } from '../../core/logic.js';
import confetti from '../../utils/confetti.js';

export default {
  data() {
    return {
      list: [],
      nearest: null,
      hasLoc: false,
      month: new Date().getMonth() + 1,
      seasonal: [],
      drawOpen: false,
      rolling: false,
      drawn: null,
      rollName: '',
      confettiOn: false,
      confettiParts: []
    };
  },
  onShow() {
    confetti.clearConfetti();
    this.confettiOn = false;
    this.refresh();
  },
  onHide() {
    this.stopRoll();
    confetti.clearConfetti();
    this.confettiOn = false;
  },
  onUnload() {
    this.stopRoll();
    confetti.clearConfetti();
    this.confettiOn = false;
  },
  methods: {
    refresh() {
      const s = store.get();
      const loc = s.lastLoc;
      this.hasLoc = !!loc;
      const items = (s.wishlist || [])
        .map(n => findCity(n))
        .filter(Boolean)
        .map(c => ({ ...c, dist: loc ? Math.round(haversine(loc, c)) : null }));
      if (loc) items.sort((a, b) => a.dist - b.dist);
      this.list = items;

      if (loc) {
        const un = CITIES.filter(c => !s.visited[c.name])
          .map(c => ({ ...c, dist: Math.round(haversine(loc, c)) }))
          .sort((a, b) => a.dist - b.dist);
        this.nearest = un[0] || null;
      } else {
        this.nearest = null;
      }

      // 空清单 → 自动展开抽卡机；正当时令只在空清单时给出
      if (!items.length) this.drawOpen = true;
      this.seasonal = items.length
        ? []
        : seasonalCities(this.month, s.visited || {}).map(n => ({
            name: n,
            season: (GUIDES[n] || {}).season || '',
            summary: (GUIDES[n] || {}).summary || ''
          }));
    },
    fmtDist(km) { return km >= 1000 ? (km / 1000).toFixed(2) + ' 千km' : km + ' km'; },
    goDetail(name) { uni.navigateTo({ url: '/pages/city/detail?name=' + encodeURIComponent(name) }); },
    openDraw() { this.drawOpen = true; },
    isWished(name) { return (store.get().wishlist || []).includes(name); },

    /* ---------- 抽卡机 ---------- */
    draw() {
      const s = store.get();
      const pool = drawPool(s.visited || {});
      if (!pool.length) {
        uni.showToast({ title: '全部城市都点亮了', icon: 'none' });
        return;
      }
      this.stopRoll();
      this.drawn = null;
      this.rolling = true;
      this.rollName = pool[Math.floor(Math.random() * pool.length)];
      this._pool = pool;
      this._tick = 0;
      this._rollStart = Date.now();
      // 快速滚动约 1.2s，越接近结束换字越慢，最后定格
      this._timer = setInterval(() => {
        const t = Date.now() - this._rollStart;
        if (t >= 1200) { this.finishDraw(); return; }
        this._tick++;
        const gap = t < 500 ? 1 : t < 800 ? 2 : t < 1000 ? 4 : 6;
        if (this._tick % gap === 0) this.rollName = pool[Math.floor(Math.random() * pool.length)];
      }, 50);
    },
    stopRoll() {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    },
    finishDraw() {
      this.stopRoll();
      const pool = this._pool || [];
      if (!pool.length) { this.rolling = false; return; }
      const name = pool[Math.floor(Math.random() * pool.length)];
      const c = findCity(name);
      const g = GUIDES[name];
      const s = store.get();
      const loc = s.lastLoc;
      const dist = loc && c ? Math.round(haversine(loc, c)) : null;
      // 无攻略（扩池）时只留省份/距离，不编造亮点
      this.drawn = {
        name,
        prov: (c && c.prov) || (g && g.prov) || '',
        dist,
        days: g ? g.days : null,
        season: g ? g.season : '',
        summary: g ? g.summary : ''
      };
      this.rolling = false;
      this.playConfetti();
    },
    addDrawnWish() {
      if (!this.drawn) return;
      if (!this.isWished(this.drawn.name)) {
        store.toggleWish(this.drawn.name);
        uni.showToast({ title: '已收入想去清单', icon: 'none' });
      }
      this.refresh();
    },
    quickWish(name) {
      if (!this.isWished(name)) {
        store.toggleWish(name);
        uni.showToast({ title: '已收入想去清单', icon: 'none' });
      }
      this.refresh();
    },

    /* ---------- 彩带 ---------- */
    playConfetti() {
      confetti.clearConfetti();
      this.confettiOn = false;                 // 先撤下上一轮，避免叠层
      this.confettiParts = confetti.confettiPieces();
      const show = () => {
        this.confettiOn = true;
        confetti.playConfetti(() => { this.confettiOn = false; });
      };
      if (this.$nextTick) this.$nextTick(show);
      else setTimeout(show, 0);
    },
    pieceStyle(p) {
      return 'left:' + p.left + '%;background:' + p.color +
        ';width:' + p.width + 'rpx;height:' + p.height + 'rpx' +
        ';animation-delay:' + p.delay + 'ms;animation-duration:' + p.duration + 'ms' +
        ';--drift:' + p.drift + 'rpx;--rot:' + p.rot + 'deg;';
    },

    /* ---------- 列表操作 ---------- */
    removeWish(name) {
      store.toggleWish(name);
      this.refresh();
      uni.showToast({ title: '已从想去清单移除', icon: 'none' });
    },
    addTrip(c) {
      uni.switchTab({ url: '/pages/trip/trip' });
      uni.setStorageSync('tf_trip_pending', c.name);
      uni.showToast({ title: '已带去行程页，点「添加到行程」', icon: 'none' });
    }
  }
};
</script>

<style scoped>
.wish-row {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 12rpx; padding: 22rpx 22rpx;
  border-radius: 24rpx;
  background: rgba(245, 240, 230, 0.05);
  border: 1rpx solid rgba(245, 240, 230, 0.10);
}
.wish-row:first-of-type { margin-top: 16rpx; }
.wish-name { font-size: 30rpx; color: #F2EDE3; font-weight: 500; }
.wish-actions { display: flex; gap: 12rpx; }

/* 1.4.0 抽卡机：深海蓝玻璃 + 香槟金 */
.draw-entry {
  margin-top: 18rpx; padding: 20rpx 22rpx;
  text-align: center;
  border-radius: 22rpx;
  border: 1rpx dashed rgba(217, 179, 106, 0.4);
  color: #D9B36A; font-size: 24rpx;
}
.draw-machine {
  margin-top: 18rpx; padding: 34rpx 24rpx;
  border-radius: 28rpx;
  background: linear-gradient(180deg, rgba(217, 179, 106, 0.10), rgba(9, 30, 52, 0.35));
  border: 1rpx solid rgba(217, 179, 106, 0.26);
  text-align: center;
}
.draw-idle, .draw-rolling, .draw-result { display: flex; flex-direction: column; align-items: center; }
.draw-hint { font-size: 30rpx; color: #F2EDE3; font-weight: 600; }
.draw-sub { font-size: 23rpx; color: rgba(242, 237, 227, 0.5); margin-top: 8rpx; }
.draw-btn { margin-top: 26rpx; min-width: 320rpx; }
.draw-city { font-size: 60rpx; font-weight: 800; color: #D9B36A; letter-spacing: 2rpx; }
.draw-city.rolling { min-height: 76rpx; }
.draw-tip { font-size: 23rpx; color: rgba(242, 237, 227, 0.5); margin-top: 10rpx; }
.draw-prov { font-size: 24rpx; color: rgba(242, 237, 227, 0.6); margin-top: 8rpx; }
.draw-meta { display: flex; flex-wrap: wrap; justify-content: center; gap: 12rpx; margin-top: 18rpx; }
.meta-chip {
  font-size: 22rpx; color: rgba(242, 237, 227, 0.72);
  padding: 8rpx 18rpx; border-radius: 999rpx;
  background: rgba(245, 240, 230, 0.06);
  border: 1rpx solid rgba(245, 240, 230, 0.12);
}
.draw-summary {
  font-size: 24rpx; line-height: 1.6; color: rgba(242, 237, 227, 0.78);
  margin-top: 18rpx; text-align: left;
}
.draw-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12rpx; margin-top: 26rpx; }

/* 1.4.0 正当时令：横向明信片 */
.seasonal-scroll { margin-top: 18rpx; white-space: nowrap; }
.seasonal-track { display: inline-block; white-space: nowrap; padding-bottom: 6rpx; }
.postcard {
  display: inline-block; white-space: normal; vertical-align: top;
  width: 300rpx; margin-right: 16rpx; padding: 24rpx;
  border-radius: 24rpx;
  background: rgba(245, 240, 230, 0.05);
  border: 1rpx solid rgba(245, 240, 230, 0.12);
}
.postcard:last-child { margin-right: 0; }
.pc-city { display: block; font-size: 32rpx; font-weight: 700; color: #F2EDE3; }
.pc-season { display: block; font-size: 22rpx; color: #D9B36A; margin-top: 8rpx; }
.pc-summary {
  font-size: 22rpx; color: rgba(242, 237, 227, 0.6);
  margin-top: 10rpx; line-height: 1.5;
  white-space: normal;
  overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}

/* 彩带层：整屏、不挡操作 */
.confetti-layer {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0;
  z-index: 999; pointer-events: none; overflow: hidden;
}
.confetti-piece {
  position: absolute; top: -30rpx;
  border-radius: 2rpx;
  opacity: 0.95;
  animation-name: confetti-fall;
  animation-timing-function: ease-in;
  animation-fill-mode: forwards;
}
@keyframes confetti-fall {
  0% { transform: translate3d(0, -12vh, 0) rotate(0deg); opacity: 0; }
  10% { opacity: 0.95; }
  100% { transform: translate3d(var(--drift, 0rpx), 104vh, 0) rotate(var(--rot, 360deg)); opacity: 0.85; }
}
</style>
