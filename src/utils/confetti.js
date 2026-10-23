/**
 * 抽卡彩带 · canvas 2d 礼花喷射引擎（纯前端，无图片素材、无第三方库）
 *
 * 视觉效果：
 * - 页面底部左右两个喷口，分别向斜上方内侧喷发，两股在画面中部拱形交汇；
 * - 纸片带初速度（向上为主 + 水平朝内分量）、重力、空气阻力、左右飘动、自旋转；
 * - 单次约 90 片，小矩形为主、混少量圆点；生命末期淡出；
 * - 鲜艳庆典配色（高饱和彩虹色），香槟金最多占一成点缀。
 *
 * 生命周期约束：
 * - 单次时长约 2s；粒子自然消亡或到时长即停帧，不留空转的 rAF / 定时器；
 * - playConfetti 内部先 stop 上一轮，连续抽卡不叠层；
 * - 页面 onHide / onUnload 必须调用 clearConfetti() 停引擎、清帧。
 *
 * 仅用于想去页抽卡定格这一处，不接到打卡等其它动作上。
 */

/** 鲜艳庆典配色：高饱和，深色背景上醒目跳脱 */
export const CONFETTI_COLORS = [
  '#FF4757', // 红
  '#FF9F43', // 橙
  '#FFD32A', // 黄
  '#2ED573', // 绿
  '#54A0FF', // 蓝
  '#A55EEA', // 紫
  '#FD79A8'  // 粉
];

/** 香槟金：只作点缀，最多占一成，不参与主色轮转 */
export const CONFETTI_ACCENT = '#D9B36A';

/** 单次喷射纸片数（左右喷口各半） */
export const CONFETTI_COUNT = 90;

/** 整段时长（ms）；粒子自然消亡会更早收帧 */
export const CONFETTI_DURATION = 2000;

/** 香槟金占比上限（一成） */
const ACCENT_RATIO = 0.1;

/** 重力加速度 px/s² */
const GRAVITY = 1100;

/** 空气阻力（按 60fps 归一的衰减系数） */
const AIR_DRAG = 0.965;

/** 喷口水平位置（占画布宽度比例）：左下 / 右下 */
const NOZZLE_LEFT = 0.1;
const NOZZLE_RIGHT = 0.9;

/** 当前帧句柄：{ id, mode: 'canvas' | 'window' | 'timer', canvas } */
let frame = null;
/** 引擎是否已停止（停止后 pending 的帧回调直接返回，不再续帧） */
let stopped = true;

function nowMs() {
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/** 排一帧：优先用 canvas 自带的 requestAnimationFrame（mp-weixin 2d canvas） */
function schedule(canvas, cb) {
  if (canvas && typeof canvas.requestAnimationFrame === 'function') {
    return { id: canvas.requestAnimationFrame(cb), mode: 'canvas', canvas };
  }
  if (typeof requestAnimationFrame === 'function') {
    return { id: requestAnimationFrame(cb), mode: 'window', canvas: null };
  }
  return { id: setTimeout(cb, 16), mode: 'timer', canvas: null };
}

/** 撤掉一帧，按排帧方式来撤 */
function unschedule(f) {
  if (!f) return;
  if (f.mode === 'canvas') {
    if (f.canvas && typeof f.canvas.cancelAnimationFrame === 'function') {
      f.canvas.cancelAnimationFrame(f.id);
    }
  } else if (f.mode === 'window') {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(f.id);
  } else {
    clearTimeout(f.id);
  }
}

/**
 * 生成一次喷射的粒子（双喷口、斜向内上方）
 * @param {number} width  画布逻辑宽（px）
 * @param {number} height 画布逻辑高（px）
 * @param {number} count  纸片数
 */
export function createBurst(width, height, count = CONFETTI_COUNT) {
  const parts = [];
  const palette = CONFETTI_COLORS;
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0;
    // 喷口：左右各一，水平朝内，形成拱形交汇
    const nozzleX = fromLeft ? width * NOZZLE_LEFT : width * NOZZLE_RIGHT;
    const inward = fromLeft ? 1 : -1;
    // 初速度：向上为主（基速随屏高自适应）+ 水平朝内分量
    const baseSpeed = height * (1.5 + Math.random() * 0.5);
    const angle = ((56 + Math.random() * 24) * Math.PI) / 180; // 与水平面夹角
    const vx = inward * Math.cos(angle) * baseSpeed * 0.55;
    const vy = -Math.sin(angle) * baseSpeed;
    // 配色：七色按序均匀出片，香槟金最多一成点缀
    const color = Math.random() < ACCENT_RATIO ? CONFETTI_ACCENT : palette[i % palette.length];
    const maxLife = 1.45 + Math.random() * 0.55; // 生命 1.45 ~ 2.0s
    parts.push({
      x: nozzleX + (Math.random() - 0.5) * 18,
      y: height - 2,
      vx: vx,
      vy: vy,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() * 2 - 1) * 12, // 自旋转 rad/s
      w: 5 + Math.random() * 5,
      h: 8 + Math.random() * 6,
      shape: Math.random() < 0.18 ? 'circle' : 'rect',
      color: color,
      life: 0,
      maxLife: maxLife,
      swayPhase: Math.random() * Math.PI * 2,
      swayFreq: 2.2 + Math.random() * 3.4, // 左右飘动频率
      swayAmp: 30 + Math.random() * 70, // 左右飘动幅度
      dead: false
    });
  }
  return parts;
}

/**
 * 推进一步物理：重力 + 空气阻力 + 左右飘动 + 自旋转 + 生命周期
 * @returns {number} 仍存活的粒子数
 */
export function stepParticles(parts, dt, width, height) {
  let alive = 0;
  const drag = Math.pow(AIR_DRAG, dt * 60);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.dead) continue;
    p.life += dt;
    if (p.life >= p.maxLife) {
      p.dead = true; // 生命耗尽
      continue;
    }
    p.vy += GRAVITY * dt; // 重力：到顶后回落
    p.vx *= drag;
    p.vy *= drag;
    p.swayPhase += p.swayFreq * dt;
    p.x += p.vx * dt + Math.sin(p.swayPhase) * p.swayAmp * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.y > height + 60 || p.x < -100 || p.x > width + 100) {
      p.dead = true; // 出界
      continue;
    }
    alive++;
  }
  return alive;
}

/** 绘制当前帧：清屏后按粒子状态落笔，生命末期淡出 */
export function drawParticles(ctx, parts, width, height) {
  ctx.clearRect(0, 0, width, height);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.dead) continue;
    const fadeFrom = p.maxLife * 0.65;
    const alpha = p.life <= fadeFrom
      ? 1
      : Math.max(0, (p.maxLife - p.life) / (p.maxLife - fadeFrom));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    if (p.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, p.w * 0.45, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    ctx.restore();
  }
}

/**
 * 播放一次礼花喷射
 * @param {Object} opts
 * @param {Object} opts.canvas  canvas 节点（可选，用于 requestAnimationFrame）
 * @param {Object} opts.ctx     2d context（必需）
 * @param {number} opts.width   逻辑宽 px
 * @param {number} opts.height  逻辑高 px
 * @param {number} [opts.count] 纸片数
 * @param {Function} [opts.onEnd] 播完回调（页面据此隐藏 canvas）
 */
export function playConfetti(opts) {
  clearConfetti(); // 连续抽卡先停上一轮，不叠层
  const o = opts || {};
  if (!o.ctx || !o.width || !o.height) return null;

  const parts = createBurst(o.width, o.height, o.count || CONFETTI_COUNT);
  const startedAt = nowMs();
  let lastAt = startedAt;
  stopped = false;

  const tick = () => {
    if (stopped) return;
    const t = nowMs();
    const dt = Math.min((t - lastAt) / 1000, 0.05);
    lastAt = t;
    const alive = stepParticles(parts, dt, o.width, o.height);
    drawParticles(o.ctx, parts, o.width, o.height);
    // 粒子自然消亡 / 到达时长 → 停帧，不留空转
    if (alive === 0 || t - startedAt >= CONFETTI_DURATION) {
      o.ctx.clearRect(0, 0, o.width, o.height);
      clearConfetti();
      if (typeof o.onEnd === 'function') o.onEnd();
      return;
    }
    frame = schedule(o.canvas, tick);
  };

  frame = schedule(o.canvas, tick);
  return frame;
}

/**
 * 停止引擎：清掉 rAF / 定时器。
 * 页面 onHide / onUnload 必须调用。
 */
export function clearConfetti() {
  stopped = true;
  unschedule(frame);
  frame = null;
}

/** 语义别名，与 clearConfetti 等价 */
export function stopConfetti() {
  clearConfetti();
}

export default {
  CONFETTI_COLORS,
  CONFETTI_ACCENT,
  CONFETTI_COUNT,
  CONFETTI_DURATION,
  createBurst,
  stepParticles,
  drawParticles,
  playConfetti,
  stopConfetti,
  clearConfetti
};
