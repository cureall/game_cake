/**
 * main.js —— 主循环（Game Loop）与状态机路由（FSM）
 * 常规订单流转（project.md 三.2）：
 *   ORDER_SHOW → BAKE_CHARGE → PIPE_RHYTHM → TOPPING_DROP → EVALUATION → (下一单)
 * 阶段 1：全部使用 Canvas 几何图形，追求单手 1 分钟顺畅闭环的手感。
 */
(function (global) {
  'use strict';

  var Utils = global.Utils;
  var C = global.Config;
  var E = global.Entities;
  var TAU = Math.PI * 2;

  /* 开发期调试日志：统一前缀，稳定后置 Config.DEBUG = false 即静默 */
  function log() {
    if (!C.DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[yumeiro]');
    console.log.apply(console, args);
  }

  var canvas = document.getElementById('game-canvas');
  var ctx = canvas.getContext('2d');

  /* ================= 高分屏适配（阶段 0 沉淀） ================= */

  function fitBackingStore() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }
  window.addEventListener('resize', fitBackingStore);
  window.addEventListener('orientationchange', function () { setTimeout(fitBackingStore, 150); });
  fitBackingStore();

  /* ================= 布局常量（虚拟坐标 750x1334） ================= */

  var LAYOUT = {
    plateX: 375, plateY: 1010,          // 侧视图：蛋糕落点（烤胚阶段）
    barX: 84, barY: 420, barW: 48, barH: 520,   // 蓄力条
    ttCx: 375, ttCy: 650, plateR: 295,  // 顶视图：转盘
    nozzleR: 338,                       // 裱花口（固定屏幕右侧 3 点钟方向）
    btnX: 375, btnY: 1105, btnR: 115,   // 裱花大按钮
    prepY: 340                          // 顶料准备位 y（x 恒为屏幕正中 375，位于蛋糕上方）
  };

  /* ================= 全局游戏对象 ================= */

  var Game = {
    name: '', cur: null, t: 0,             // 当前状态与状态内计时
    orderIndex: 0, order: null,
    cake: null,
    turntable: new E.Turntable(),
    metronome: new E.Metronome(),
    guest: new E.Guest(),
    fx: new E.FX(),
    score: null
  };

  function resetScore() {
    Game.score = { bake: 0, flowers: 0, perfects: 0, fruits: 0, even: 0, total: 0 };
  }

  function setState(name) {
    if (Game.cur && Game.cur.exit) Game.cur.exit();
    Game.name = name;
    Game.cur = States[name];
    Game.t = 0;
    log('状态切换 → ' + name);
    if (Game.cur.enter) Game.cur.enter();
  }

  /* ================= 横幅提示 ================= */

  var banner = { t: 0, dur: 0, text: '', sub: '' };
  function showBanner(text, sub, dur) {
    banner.text = text; banner.sub = sub || '';
    banner.t = 0; banner.dur = dur || 1.3;
  }
  function updateBanner(dt) { if (banner.dur > 0) banner.t += dt; }
  function renderBanner(ctx) {
    if (banner.dur <= 0 || banner.t >= banner.dur) return;
    var t = banner.t;
    var aIn = Utils.clamp(t / 0.22, 0, 1);
    var aOut = Utils.clamp((banner.dur - t) / 0.28, 0, 1);
    var alpha = Math.min(aIn, aOut);
    var scale = 0.8 + 0.2 * Utils.easeOutCubic(aIn);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(375, 400);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 60px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeText(banner.text, 0, 0);
    ctx.fillStyle = '#e2557e';
    ctx.fillText(banner.text, 0, 0);
    if (banner.sub) {
      ctx.font = '30px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.lineWidth = 6;
      ctx.strokeText(banner.sub, 0, 58);
      ctx.fillStyle = '#9c5a78';
      ctx.fillText(banner.sub, 0, 58);
    }
    ctx.restore();
  }

  /* ================= 背景装饰 ================= */

  var bgDots = [];
  for (var bi = 0; bi < 26; bi++) {
    bgDots.push({
      x: Math.random() * 750,
      y: 120 + Math.random() * 1150,
      r: 6 + Math.random() * 16,
      ph: Math.random() * TAU
    });
  }

  function renderBackground(ctx, now) {
    var g = ctx.createLinearGradient(0, 0, 0, 1334);
    g.addColorStop(0, '#fff6f9');
    g.addColorStop(1, '#ffe0ec');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 750, 1334);
    ctx.fillStyle = 'rgba(255, 205, 224, 0.35)';
    for (var i = 0; i < bgDots.length; i++) {
      var d = bgDots[i];
      ctx.beginPath();
      ctx.arc(d.x + Math.sin(now * 0.0004 + d.ph) * 8, d.y, d.r, 0, TAU);
      ctx.fill();
    }
  }

  /* ================= 通用 UI 小件 ================= */

  function drawStageTitle(ctx, str) {
    ctx.save();
    ctx.font = '26px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c58cab';
    ctx.fillText(str, 375, 48);
    ctx.restore();
  }

  function drawHint(ctx, str, y) {
    ctx.save();
    var a = 0.75 + 0.25 * Math.sin(performance.now() * 0.004);
    ctx.globalAlpha = a;
    ctx.font = '28px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#b06f92';
    ctx.fillText(str, 375, y || 1275);
    ctx.restore();
  }

  /** 顶视图统一入口：底盘 + 旋转中的蛋糕主体 */
  function renderTurntableScene(ctx, plateScale) {
    var s = plateScale || 1;
    var cx = LAYOUT.ttCx, cy = LAYOUT.ttCy;
    E.Turntable.prototype.renderPlate(ctx, cx, cy, LAYOUT.plateR * s, Game.order.plate);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.rotate(Game.turntable.angle);
    Game.cake.renderTop(ctx);
    ctx.restore();
  }

  /* ================================================================
   * 状态 1：STATE_ORDER_SHOW —— 客人提出需求
   * ================================================================ */

  var ORDER_SHOW = {
    enter: function () {
      Game.order = C.ORDERS[Game.orderIndex % C.ORDERS.length];
      var line = C.GUEST.HELLO[Math.floor(Math.random() * C.GUEST.HELLO.length)];
      this.line = line.replace('{cake}', Game.order.name);
      showBanner('新订单♪', Game.order.name, 1.2);
    },
    update: function (dt) { Game.guest.update(dt); },
    render: function (ctx) {
      drawStageTitle(ctx, 'Step 1 / 4 · 接单');
      // 对话气泡 + 客人
      E.drawBubble(ctx, 375, 150, this.line, 30);
      Game.guest.render(ctx, 375, 470, 1.7);
      // 订单卡
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 54px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#e2557e';
      ctx.fillText(Game.order.name, 375, 700);
      ctx.font = '30px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#9c5a78';
      ctx.fillText('“' + Game.order.desc + '”', 375, 756);
      ctx.restore();
      drawHint(ctx, '点击屏幕开始制作 ♪', 900);
    },
    onDown: function () { setState('BAKE_CHARGE'); }
  };

  /* ================================================================
   * 状态 2：STATE_BAKE_CHARGE —— 长按蓄力烤胚
   * ================================================================ */

  var BAKE_CHARGE = {
    phase: 'charge',   // charge → fly → settle
    bar: null, vy: 0, y: 0, landT: 0, settleT: 0, bakePts: 0,

    enter: function () {
      resetScore();
      Game.cake = new E.Cake(Game.order);
      this.bar = new E.ChargeBar(LAYOUT.barX, LAYOUT.barY, LAYOUT.barW, LAYOUT.barH);
      this.phase = 'charge';
      this.vy = 0; this.y = 0; this.landT = 0; this.settleT = 0;
      showBanner('Step 2 · 烤胚', '长按屏幕蓄力，松手落盘！', 1.4);
    },

    update: function (dt) {
      this.bar.update(dt);
      var cfg = C.CHARGE;
      if (this.phase === 'charge') {
        // 蓄力时蛋糕胚实时长高（手感反馈）
        Game.cake.height = Utils.lerp(cfg.MIN_HEIGHT, cfg.MAX_HEIGHT, this.bar.power);
      } else if (this.phase === 'fly') {
        // 上抛 + 重力下落
        this.y += this.vy * dt;
        this.vy -= cfg.GRAVITY * dt;
        if (this.y <= 0 && this.vy < 0) {
          this.y = 0;
          if (this.vy < -760) {           // 大高度：弹跳一次，更松软
            this.vy = -this.vy * 0.22;
            Game.fx.burst(LAYOUT.plateX, LAYOUT.plateY, { count: 8, colors: ['#ffe9d2', '#ffd3e2'], speed: 150, shape: 'circle', size: 7 });
          } else {
            this.phase = 'settle';
            this.landT = 0;
            this.onLanded();
          }
        }
      } else if (this.phase === 'settle') {
        this.landT += dt;
        this.settleT += dt;
        if (this.settleT >= cfg.SETTLE_TIME) setState('PIPE_RHYTHM');
      }
    },

    onLanded: function () {
      // 计分：power 越高分越高；黄金区间额外奖励（只有加分）
      var p = this.bar.power;
      this.bakePts = C.SCORE.BAKE_BASE + Math.round(p * 70);
      var golden = p >= C.CHARGE.GOLDEN_MIN && p <= C.CHARGE.GOLDEN_MAX;
      if (golden) {
        this.bakePts += C.SCORE.GOLDEN_BONUS;
        Game.fx.text(LAYOUT.plateX, LAYOUT.plateY - Game.cake.height - 80, '黄金火候 +' + C.SCORE.GOLDEN_BONUS, '#e8a20c', 44);
      }
      Game.score.bake = this.bakePts;
      log('烤胚落地：power=' + p.toFixed(2) + (golden ? '（黄金区间）' : '') + ' → +' + this.bakePts + ' 分');
      Game.fx.burst(LAYOUT.plateX, LAYOUT.plateY - 10, { count: 14, colors: ['#ffd3e2', '#ff8fb5', '#fff'], speed: 260 });
      Game.fx.text(LAYOUT.plateX, LAYOUT.plateY - Game.cake.height - 30, '松软出炉♪', '#e2557e', 40);
    },

    onDown: function () {
      if (this.phase === 'charge') this.bar.start();
    },
    onUp: function () {
      if (this.phase !== 'charge' || !this.bar.holding) return;
      var p = this.bar.release();
      // 弹起再落回：跳一跳手感
      this.vy = 280 + 520 * p;
      this.y = 0;
      this.phase = 'fly';
    },

    render: function (ctx, now) {
      drawStageTitle(ctx, 'Step 2 / 4 · 烤胚');
      // 操作台
      ctx.fillStyle = '#f7d9e5';
      ctx.fillRect(0, LAYOUT.plateY, 750, 1334 - LAYOUT.plateY);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(0, LAYOUT.plateY, 750, 14);
      // 盘子
      ctx.fillStyle = Game.order.plate;
      ctx.beginPath();
      ctx.ellipse(LAYOUT.plateX, LAYOUT.plateY + 10, 210, 34, 0, 0, TAU);
      ctx.fill();

      // 蛋糕胚
      var sx = 1, sy = 1;
      var bottomY = LAYOUT.plateY;
      if (this.phase === 'charge') {
        // 蓄力预览：果冻微颤
        sy = 1 + 0.028 * Math.sin(now * 0.016) * this.bar.power;
        sx = 1 - (sy - 1) * 0.7;
      } else if (this.phase === 'fly') {
        bottomY = LAYOUT.plateY - this.y;
        var stretch = Utils.clamp(Math.abs(this.vy) * 0.00012, 0, 0.14);
        sy = 1 + stretch; sx = 1 - stretch * 0.6;
      } else {
        // 落地压扁回弹（阻尼振荡）
        sy = 1 - 0.34 * Math.exp(-5 * this.landT) * Math.cos(15 * this.landT);
        sx = 1 + (1 - sy) * 0.8;
      }
      Game.cake.renderSide(ctx, LAYOUT.plateX, bottomY, sx, sy);

      // 蓄力条 + 读数
      this.bar.render(ctx, now);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 30px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#b06f92';
      ctx.fillText(Math.round(this.bar.display * 100) + '%', LAYOUT.barX + 24, LAYOUT.barY - 18);
      ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText('火力', LAYOUT.barX + 24, LAYOUT.barY + LAYOUT.barH + 34);
      ctx.restore();

      if (this.phase === 'charge') drawHint(ctx, '长按屏幕蓄力 · 松手落盘');
    }
  };

  /* ================================================================
   * 状态 3：STATE_PIPE_RHYTHM —— 节拍裱花
   * ================================================================ */

  var PIPE_RHYTHM = {
    placedSet: null, placedCount: 0,

    enter: function () {
      Game.metronome.reset();
      Game.turntable.syncToBeat();
      this.placedSet = {};
      this.placedCount = 0;
      showBanner('Step 3 · 裱花', '跟着♪节拍点击屏幕！', 1.5);
    },

    update: function (dt) {
      Game.metronome.update(dt);   // 转盘由主循环统一驱动，此处不重复 update
      var totalT = C.BEAT.TOTAL_BEATS * Game.metronome.interval;
      if (Game.t >= totalT + 0.55) setState('TOPPING_DROP');
    },

    onDown: function () {
      var m = Game.metronome;
      var idx = m.nearestIndex();
      if (idx > C.BEAT.TOTAL_BEATS - 1) return;
      if (this.placedSet[idx]) {
        // 该拍已放花：不惩罚，轻声提示
        log('裱花重复拍点 #' + idx + '，忽略');
        Game.fx.text(LAYOUT.btnX, LAYOUT.btnY - 150, '这一拍有花啦♪', '#b48ead', 30);
        return;
      }
      this.placedSet[idx] = true;
      this.placedCount++;

      // 判定分级（阶段 2 香草将把负面判定统一改写为 Cute）
      var d = m.distToNearest();
      var tier = d <= C.BEAT.WINDOW_PERFECT ? 'perfect' : d <= C.BEAT.WINDOW_GOOD ? 'good' : 'cute';
      Game.cake.flowers.push({ a: TAU - (Game.turntable.angle % TAU), tier: tier });

      log('裱花拍点 #' + idx + '：偏差=' + d.toFixed(3) + 's 判定=' + tier);
      Game.score.flowers++;
      if (tier === 'perfect') Game.score.perfects++;

      // 特效：裱花口位于固定屏幕位（转盘 3 点钟方向）
      var nx = LAYOUT.ttCx + LAYOUT.nozzleR, ny = LAYOUT.ttCy;
      if (tier === 'perfect') {
        Game.fx.burst(nx, ny, { count: 14, colors: ['#ffc94d', '#ffe6a1', '#fff'], speed: 300 });
        Game.fx.text(nx, ny - 40, 'Perfect!', '#e8a20c', 42);
      } else if (tier === 'good') {
        Game.fx.burst(nx, ny, { count: 9, colors: ['#ff8fb5', '#ffd3e2'], speed: 230 });
        Game.fx.text(nx, ny - 40, 'Good!', '#e2557e', 40);
      } else {
        Game.fx.burst(nx, ny, { count: 6, colors: ['#c9a7d6', '#ecd9f2'], speed: 180, shape: 'circle' });
        Game.fx.text(nx, ny - 40, 'Cute~', '#a06fb5', 38);
      }
    },

    render: function (ctx) {
      drawStageTitle(ctx, 'Step 3 / 4 · 节拍裱花 ' + this.placedCount + '/' + C.BEAT.TOTAL_BEATS);
      var m = Game.metronome;

      renderTurntableScene(ctx, 1);

      // 节拍点标记环（随转盘旋转，靠近裱花口时点亮）
      var n = C.BEAT.FLOWERS_PER_CIRCLE;
      for (var i = 0; i < n; i++) {
        var wa = (Game.turntable.angle + i * TAU / n) % TAU;
        var dist = Math.min(wa, TAU - wa);
        var glow = Math.max(0, 1 - dist * 2.4);
        var r = 10 + glow * 8;
        ctx.beginPath();
        ctx.arc(LAYOUT.ttCx + Math.cos(wa) * 252, LAYOUT.ttCy + Math.sin(wa) * 252, r, 0, TAU);
        ctx.fillStyle = 'rgba(255,' + Math.round(160 + 60 * glow) + ',' + Math.round(190 + 40 * glow) + ',' + (0.45 + 0.55 * glow) + ')';
        ctx.fill();
      }

      // 固定裱花口（3 点钟方向）
      var pulse = m.pulse();
      var nx = LAYOUT.ttCx + LAYOUT.nozzleR, ny = LAYOUT.ttCy;
      ctx.save();
      ctx.translate(nx, ny);
      ctx.scale(1 + 0.25 * pulse, 1 + 0.25 * pulse);
      ctx.fillStyle = '#e2557e';
      ctx.beginPath();
      ctx.moveTo(-14, -16); ctx.lineTo(14, 0); ctx.lineTo(-14, 16);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(14, 0, 10, 0, TAU);
      ctx.fill();
      ctx.restore();

      // 中央大按钮（随节拍脉动）
      var br = LAYOUT.btnR * (1 + 0.06 * pulse);
      var g = ctx.createRadialGradient(LAYOUT.btnX, LAYOUT.btnY - br * 0.3, br * 0.2, LAYOUT.btnX, LAYOUT.btnY, br);
      g.addColorStop(0, '#ffb3cd');
      g.addColorStop(1, '#ff6f9f');
      ctx.beginPath();
      ctx.arc(LAYOUT.btnX, LAYOUT.btnY, br, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 52px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('裱花！', LAYOUT.btnX, LAYOUT.btnY - 8);
      ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText('♪ 跟上节拍 ♪', LAYOUT.btnX, LAYOUT.btnY + 42);

      // 顶部节拍进度点
      var total = C.BEAT.TOTAL_BEATS;
      var done = Utils.clamp(Math.round(m.beatPhase()), 0, total);
      for (var k = 0; k < total; k++) {
        var dx = 375 + (k - (total - 1) / 2) * 34;
        ctx.beginPath();
        ctx.arc(dx, 95, k < done ? 9 : 7, 0, TAU);
        ctx.fillStyle = k < done ? '#ff8fb5' : 'rgba(200,150,175,0.35)';
        ctx.fill();
      }

      drawHint(ctx, '点击屏幕任意位置挤出奶油花');
    }
  };

  /* ================================================================
   * 状态 4：STATE_TOPPING_DROP —— 顶料摆放（所见即所得）
   * 规则：蛋糕保持缓速旋转；所有顶料共用屏幕正中准备位；
   * 点击后落在准备位正下方的奶油内芯圆弧上（世界 12 点方向），
   * 落在蛋糕上的相对位置由落地瞬间的盘角决定 → 分布恒在一个圆上。
   * ================================================================ */

  var TOPPING_DROP = {
    queue: null, idx: 0, doneAt: -1, ringR: 0,

    enter: function () {
      // 转盘不停：从裱花节拍转速平滑过渡到缓速展示转速
      Game.turntable.target = TAU / C.TOPPING.SPIN_PERIOD;
      this.ringR = Game.cake.topRadius * C.TOPPING.RING_FRAC;   // 落点圆弧 = 奶油内芯圆
      this.queue = [];
      for (var i = 0; i < C.TOPPING.COUNT; i++) {
        var type = Math.random() < 0.6 ? 'strawberry' : 'macaron';
        var f = new E.Fruit(type, i);
        f.fx = LAYOUT.ttCx;      // 准备位：屏幕正中，蛋糕上方同一位置
        f.fy = LAYOUT.prepY;
        f.x = f.fx; f.y = f.fy;
        this.queue.push(f);
      }
      this.idx = 0;
      this.doneAt = -1;
      showBanner('Step 4 · 顶料', '蛋糕在转，看准时机点屏幕！', 1.4);
      log('顶料开始：转速 ' + C.TOPPING.SPIN_PERIOD + 's/圈，落环半径 ' + this.ringR.toFixed(0) + 'px');
    },

    update: function (dt) {
      for (var i = 0; i < this.queue.length; i++) {
        var f = this.queue[i];
        var was = f.state;
        f.update(dt);
        if (was === 'falling' && f.state === 'landed') this.onFruitLanded(f);
      }
      if (this.idx >= C.TOPPING.COUNT && this.doneAt < 0) this.doneAt = Game.t;
      if (this.doneAt > 0 && Game.t - this.doneAt >= 0.8) setState('EVALUATION');
    },

    onFruitLanded: function (f) {
      // 落点固定在世界 12 点方向（-90°）的内芯圆弧上；
      // 挂到蛋糕的局部角 = 世界角 - 落地瞬间盘角 → 盘转到哪就落在哪
      var worldA = -Math.PI / 2;
      var localA = worldA - Game.turntable.angle;
      Game.cake.fruits.push({ a: localA, r: this.ringR, type: f.type });
      Game.score.fruits++;
      Game.fx.burst(f.target.x, f.target.y, { count: 10, colors: ['#ff8fb5', '#ffe6a1', '#fff'], speed: 230 });
      Game.fx.text(f.target.x, f.target.y - 50, '+' + C.SCORE.FRUIT, '#e2557e', 36);
      var deg = ((localA % TAU) + TAU) % TAU / TAU * 360;
      log('顶料着陆：盘角=' + (Game.turntable.angle % TAU).toFixed(2) +
        ' → 蛋糕局部 ' + deg.toFixed(0) + '°，已放 ' + Game.score.fruits + '/' + C.TOPPING.COUNT);
    },

    onDown: function (p) {
      var f = this.queue[this.idx];
      if (!f || f.state !== 'float') {
        log('顶料点击忽略：#' + this.idx + ' 状态=' + (f ? f.state : '队列已空'));
        return;
      }
      // 落点：准备位正下方的内芯圆弧顶点（世界 12 点方向，不随点击位置变）
      f.drop({ x: LAYOUT.ttCx, y: LAYOUT.ttCy - this.ringR });
      this.idx++;
      log('顶料落下 ' + this.idx + '/' + C.TOPPING.COUNT + '，点击时盘角=' + (Game.turntable.angle % TAU).toFixed(2));
    },

    render: function (ctx) {
      drawStageTitle(ctx, 'Step 4 / 4 · 顶料 ' + Game.score.fruits + '/' + C.TOPPING.COUNT);
      renderTurntableScene(ctx, 1);

      // 落点指示圈（准备位正下方的内芯圆弧处，提示顶料将落在这里）
      ctx.save();
      ctx.setLineDash([7, 9]);
      ctx.lineDashOffset = -performance.now() * 0.02;
      ctx.strokeStyle = 'rgba(226, 85, 126, 0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(LAYOUT.ttCx, LAYOUT.ttCy - this.ringR, 26, 0, TAU);
      ctx.stroke();
      ctx.restore();

      // 待投放水果（仅当前一个，其余共用同一准备位不重复绘制）+ 下落中的
      for (var i = 0; i < this.queue.length; i++) {
        var f = this.queue[i];
        if (f.state === 'float' && i === this.idx) {
          f.render(ctx, 1.25);
          // 头顶小箭头提示
          var ay = f.y - 58 + Math.sin(performance.now() * 0.006) * 6;
          ctx.fillStyle = '#e2557e';
          ctx.beginPath();
          ctx.moveTo(f.x, ay + 16);
          ctx.lineTo(f.x - 13, ay);
          ctx.lineTo(f.x + 13, ay);
          ctx.closePath();
          ctx.fill();
        } else if (f.state === 'falling') {
          f.render(ctx, 1.15);
        }
        // landed 的已转挂到蛋糕，不再单独绘制
      }

      drawHint(ctx, '点一点，把顶料撒到蛋糕上');
    }
  };

  /* ================================================================
   * 状态 5：STATE_EVALUATION —— 甜蜜结算（只有夸奖）
   * ================================================================ */

  var EVALUATION = {
    total: 0, stars: 1, title: '', praise: '', readyT: 0,
    btn2: { x: 560, y: 1200, r: 105 },   // “再来一块”按钮（渲染与点击判定共用）

    enter: function () {
      Game.turntable.target = 0.35;   // 缓缓旋转展示
      var s = Game.score;
      s.even = this.calcEvenBonus();
      s.total = s.bake + s.flowers * C.SCORE.FLOWER + s.perfects * C.SCORE.PERFECT_BONUS + s.fruits * C.SCORE.FRUIT + s.even;
      this.total = s.total;
      this.stars = s.total >= C.STAR_THRESHOLD[0] ? 3 : s.total >= C.STAR_THRESHOLD[1] ? 2 : 1;
      this.title = C.TITLES[this.stars];
      this.praise = C.GUEST.PRAISE[Math.floor(Math.random() * C.GUEST.PRAISE.length)];
      this.readyT = 0.3 + 5 * 0.22 + 0.15 + 0.7 + 0.5;
      log('结算：总分=' + this.total + '（含均匀度 +' + s.even + '） 星=' + this.stars + ' 称号=' + this.title);
      showBanner('完成♪', '客人超级满意！', 1.4);
      Game.fx.burst(375, 480, { count: 24, colors: ['#ffc94d', '#ff8fb5', '#b8e6ff', '#fff'], speed: 420 });
    },

    /** 顶料均匀度：所有水果恒落在同一圆环上，看局部角的相邻间隔是否接近整圆/n。
     *  均匀加分，不均匀不扣分（零惩罚原则）。 */
    calcEvenBonus: function () {
      var fruits = Game.cake.fruits;
      var n = fruits.length;
      if (n < 2) return 0;
      var as = [];
      for (var i = 0; i < n; i++) as.push(((fruits[i].a % TAU) + TAU) % TAU);
      as.sort(function (x, y) { return x - y; });
      var gaps = [];
      for (var j = 0; j < n; j++) {
        var g = as[(j + 1) % n] - as[j];
        if (j === n - 1) g += TAU;   // 首尾环绕间隔
        gaps.push(g);
      }
      var spread = (Math.max.apply(null, gaps) - Math.min.apply(null, gaps)) / TAU;   // 0=完美均匀
      var pts = spread <= C.TOPPING.EVEN_SPREAD_PERFECT ? C.TOPPING.EVEN_BONUS
        : spread <= C.TOPPING.EVEN_SPREAD_GOOD ? C.TOPPING.EVEN_BONUS_HALF : 0;
      log('均匀度：相邻间隔差=' + (spread * 100).toFixed(1) + '% → +' + pts +
        '（各间隔°=' + gaps.map(function (g) { return Math.round(g / TAU * 360); }).join(',') + '）');
      return pts;
    },

    onDown: function (p) {
      if (Game.t < this.readyT) return;
      // 再来一块：圆形按钮的外接矩形判定（渲染与判定共用 btn2，防止再次错位）
      var b = this.btn2, r = b.r;
      if (p.x >= b.x - r && p.x <= b.x + r && p.y >= b.y - r && p.y <= b.y + r) {
        log('再来一块：命中 (' + p.x.toFixed(0) + ', ' + p.y.toFixed(0) + ') → 下一单');
        Game.orderIndex++;
        setState('ORDER_SHOW');
      } else {
        log('结算点击落空：(' + p.x.toFixed(0) + ', ' + p.y.toFixed(0) + ')，按钮区 x∈[' + (b.x - r) + ',' + (b.x + r) + '] y∈[' + (b.y - r) + ',' + (b.y + r) + ']');
      }
    },

    render: function (ctx, now) {
      drawStageTitle(ctx, '甜蜜结算');
      var t = Game.t;
      var s = Game.score;

      // 作品展示（缓缓旋转）
      ctx.save();
      ctx.translate(375, 480);
      ctx.scale(0.86, 0.86);
      ctx.translate(-375, -480);
      E.Turntable.prototype.renderPlate(ctx, 375, 480, 250, Game.order.plate);
      ctx.translate(375, 480);
      ctx.rotate(Game.turntable.angle);
      Game.cake.renderTop(ctx);
      ctx.restore();

      // 星星逐颗弹出
      for (var i = 0; i < 3; i++) {
        var tk = (t - (1.6 + i * 0.18)) / 0.35;
        if (tk < 0) continue;
        var lit = i < this.stars;
        var k = Utils.clamp(tk, 0, 1);
        var sc = k >= 1 ? 1 : Utils.lerp(0.2, 1.25, Utils.easeOutCubic(k));
        var sx = 375 + (i - 1) * 92;
        ctx.save();
        ctx.translate(sx, 730);
        ctx.rotate(lit ? Math.sin(now * 0.003 + i) * 0.08 : 0);
        ctx.scale(sc, sc);
        E.drawStar(ctx, 0, 0, 34, 15, -Math.PI / 2);
        ctx.fillStyle = lit ? '#ffc94d' : '#e9d3de';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.restore();
      }

      // 称号
      if (t > 1.4) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = 'bold 46px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#e2557e';
        ctx.fillText(this.title, 375, 812);
        ctx.restore();
      }

      // 得分明细（逐条浮现 + 总分滚动）
      var lines = [
        ['松软烤胚', '+' + s.bake],
        ['奶油花 ×' + s.flowers, '+' + s.flowers * C.SCORE.FLOWER],
        ['节拍 Perfect ×' + s.perfects, '+' + s.perfects * C.SCORE.PERFECT_BONUS],
        ['顶料水果 ×' + s.fruits, '+' + s.fruits * C.SCORE.FRUIT],
        ['摆放均匀', s.even > 0 ? '+' + s.even : '—']
      ];
      ctx.save();
      ctx.textAlign = 'left';
      ctx.font = '28px "PingFang SC", "Microsoft YaHei", sans-serif';
      for (var li = 0; li < lines.length; li++) {
        var lk = (t - 0.3 - li * 0.22) / 0.25;
        if (lk <= 0) break;
        ctx.globalAlpha = Utils.clamp(lk, 0, 1);
        var ly = 866 + li * 42;
        ctx.fillStyle = '#9c5a78';
        ctx.fillText(lines[li][0], 150, ly);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#e2557e';
        ctx.fillText(lines[li][1], 600, ly);
        ctx.textAlign = 'left';
      }
      ctx.restore();

      var tk2 = Utils.clamp((t - (0.3 + 5 * 0.22 + 0.15)) / 0.7, 0, 1);
      if (tk2 > 0) {
        var shown = Math.round(this.total * Utils.easeOutCubic(tk2));
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = 'bold 64px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.lineWidth = 8;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeText(shown + ' 甜蜜分', 375, 1092);
        ctx.fillStyle = '#d1547f';
        ctx.fillText(shown + ' 甜蜜分', 375, 1092);
        ctx.restore();
      }

      // 客人夸奖
      if (t > this.readyT - 0.4) {
        Game.guest.render(ctx, 108, 1200, 0.85);
        E.drawBubble(ctx, 300, 1080, this.praise, 24);
      }

      // 再来一块按钮
      if (t > this.readyT) {
        var pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
        var b2 = this.btn2;
        ctx.save();
        ctx.translate(b2.x, b2.y);
        ctx.scale(1 + 0.04 * pulse, 1 + 0.04 * pulse);
        var g2 = ctx.createRadialGradient(0, -30, 20, 0, 0, b2.r + 5);
        g2.addColorStop(0, '#ffd0e0');
        g2.addColorStop(1, '#ff7fae');
        ctx.beginPath();
        ctx.arc(0, 0, b2.r, 0, TAU);
        ctx.fillStyle = g2;
        ctx.fill();
        ctx.lineWidth = 7;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 40px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText('再来', 0, -14);
        ctx.fillText('一块！', 0, 32);
        ctx.restore();
      }
    }
  };

  /* ================= 状态表 ================= */

  var States = {
    ORDER_SHOW: ORDER_SHOW,
    BAKE_CHARGE: BAKE_CHARGE,
    PIPE_RHYTHM: PIPE_RHYTHM,
    TOPPING_DROP: TOPPING_DROP,
    EVALUATION: EVALUATION
  };

  /* ================= 统一指针路由（单指游戏） ================= */

  var activePointerId = null;
  Utils.attachPointer(canvas, {
    onDown: function (p) {
      if (activePointerId !== null) return;   // 忽略多余手指
      activePointerId = p.id;
      if (Game.cur && Game.cur.onDown) Game.cur.onDown(p);
    },
    onUp: function (p) {
      if (p.id !== activePointerId) return;
      activePointerId = null;
      if (Game.cur && Game.cur.onUp) Game.cur.onUp(p);
    }
  });

  /* ================= 主循环 ================= */

  var lastTime = performance.now();
  var fpsSmooth = 60;

  function frame(now) {
    var dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if (dt > 0) fpsSmooth = fpsSmooth * 0.95 + (1 / dt) * 0.05;

    Game.t += dt;
    if (Game.cur) {
      if (Game.cur.update) Game.cur.update(dt);
      Game.fx.update(dt);
      updateBanner(dt);
      Game.turntable.update(dt);
    }

    var sx = canvas.width / Utils.VW;
    var sy = canvas.height / Utils.VH;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);

    renderBackground(ctx, now);
    if (Game.cur && Game.cur.render) Game.cur.render(ctx, now);
    Game.fx.render(ctx);
    renderBanner(ctx);

    // 常驻探针（沿用阶段 0）
    ctx.save();
    ctx.font = '20px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(180, 120, 150, 0.55)';
    ctx.fillText('FPS ' + Math.round(fpsSmooth), 14, 1330 - 12);
    ctx.restore();

    requestAnimationFrame(frame);
  }

  resetScore();
  setState('ORDER_SHOW');
  requestAnimationFrame(frame);

})(window);
