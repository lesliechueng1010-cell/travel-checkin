/**
 * 抽卡彩带（纯前端 CSS 粒子，无图片素材、无第三方库）
 *
 * 设计：页面渲染一层 pointer-events:none 的固定浮层，里面按 confettiPieces()
 * 生成的参数摆放若干纸带；纸带用 CSS keyframes 从顶部飘落并轻微摆动。
 *
 * 仅用于想去页抽卡定格这一处，不接到打卡等其它动作上。
 *
 * 生命周期约束：
 * - playConfetti 内部只保留一个隐藏定时器，重复播放会先 clear 再设，绝不叠层。
 * - 页面 onHide / onUnload 必须调用 clearConfetti() 清理定时器。
 */
const COLORS = ['#D9B36A', '#E8CE9A', '#9FC3E0', '#F2EDE3', '#E08A72'];

/** 彩带整段时长（ms），与 KEYFRAMES 的飘落时长对应 */
export const CONFETTI_DURATION = 1800;

let hideTimer = null;

/**
 * 生成一批纸带参数（位置 / 颜色 / 时长 / 摆动幅度 / 旋转角度）
 * @param {number} n 纸带数量
 */
export function confettiPieces(n = 28) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      id: i,
      left: 2 + Math.round(Math.random() * 96),               // 2% ~ 98%
      delay: Math.round(Math.random() * 300),                 // ms
      duration: 1200 + Math.round(Math.random() * 300),       // ms
      drift: Math.round((Math.random() * 2 - 1) * 120),       // rpx，左右摆动
      rot: Math.round(Math.random() * 720),                   // deg
      width: 8 + Math.round(Math.random() * 8),               // rpx
      height: 12 + Math.round(Math.random() * 10),            // rpx
      color: COLORS[i % COLORS.length]
    });
  }
  return arr;
}

/**
 * 播放一次彩带：CONFETTI_DURATION 后回调隐藏。
 * 连续抽卡时先清掉上一轮定时器，避免叠层。
 * @param {Function} onEnd 播放结束回调（把浮层隐藏）
 */
export function playConfetti(onEnd) {
  clearConfetti();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (typeof onEnd === 'function') onEnd();
  }, CONFETTI_DURATION);
  return hideTimer;
}

/** 清理彩带定时器（页面 onHide / onUnload 调用） */
export function clearConfetti() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

export default { confettiPieces, playConfetti, clearConfetti, CONFETTI_DURATION };
