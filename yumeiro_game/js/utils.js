/**
 * utils.js —— 通用工具层
 * 职责：
 *   1. Pointer 事件统一抽象（PC 鼠标左键 / 移动端单指触屏 无差别处理）
 *   2. 屏幕 client 坐标 -> 虚拟画布 750x1334 坐标映射
 *   3. 数学插值、Canvas 绘制辅助（随后续阶段按需补充）
 */
(function (global) {
  'use strict';

  /** 固定虚拟分辨率（全游戏所有逻辑坐标均基于此） */
  var VW = 750;
  var VH = 1334;

  /* ---------------- 数学工具 ---------------- */

  function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** 缓动：先快后慢，用于水波纹扩散等柔和动画 */
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /* ---------------- 坐标映射 ---------------- */

  /**
   * 将浏览器 client 坐标映射为虚拟画布坐标。
   * 依据 getBoundingClientRect 实时换算，因此对任意 CSS 缩放、
   * 旋转、Letterboxing 布局均天然准确（阶段 0 验收核心）。
   */
  function toVirtual(canvas, clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width * VW,
      y: (clientY - rect.top) / rect.height * VH
    };
  }

  /* ---------------- Pointer 统一抽象 ---------------- */

  /**
   * attachPointer(canvas, handlers)
   * 统一监听 pointerdown / pointermove / pointerup / pointercancel，
   * 回调统一收到虚拟坐标点 { x, y, id }，业务层无需关心鼠标还是触屏。
   *
   * @param {HTMLCanvasElement} canvas 目标画布
   * @param {Object} handlers { onDown(p), onMove(p), onUp(p) } 均可选
   */
  function attachPointer(canvas, handlers) {
    function bind(domEvent, cbName) {
      canvas.addEventListener(domEvent, function (ev) {
        ev.preventDefault(); // 阻止浏览器默认行为（需配合 CSS touch-action:none）
        if (domEvent === 'pointerdown') {
          // 指针捕获：手指/鼠标滑出画布（如蓄力时滑进 Letterboxing 黑边）也能收到 up/cancel，
          // 防止单指锁 activePointerId 永不清除导致全局点击失灵
          canvas.setPointerCapture(ev.pointerId);
        }
        var p = toVirtual(canvas, ev.clientX, ev.clientY);
        p.id = ev.pointerId;
        if (handlers[cbName]) handlers[cbName](p);
      });
    }
    bind('pointerdown', 'onDown');
    bind('pointermove', 'onMove');
    bind('pointerup', 'onUp');
    bind('pointercancel', 'onUp'); // 系统打断（来电/手势抢占）视同抬手，保证状态机不悬挂

    // 移动端长按会触发右键菜单，禁用之
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* ---------------- Canvas 绘制辅助 ---------------- */

  function fillCircle(ctx, x, y, r, color, alpha) {
    ctx.save();
    ctx.globalAlpha = (alpha == null) ? 1 : alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function strokeCircle(ctx, x, y, r, lineWidth, color, alpha) {
    ctx.save();
    ctx.globalAlpha = (alpha == null) ? 1 : alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- 导出 ---------------- */

  global.Utils = {
    VW: VW,
    VH: VH,
    clamp: clamp,
    lerp: lerp,
    easeOutCubic: easeOutCubic,
    toVirtual: toVirtual,
    attachPointer: attachPointer,
    fillCircle: fillCircle,
    strokeCircle: strokeCircle
  };

})(window);
