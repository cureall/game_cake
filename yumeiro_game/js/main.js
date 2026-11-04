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

  /* ================= 甜点精灵与牛奶糖缓速（阶段 2） ================= */

  E.preloadSpirits();
  var spirits = {
    vanilla: new E.Spirit('vanilla', C.SPIRIT.POS.vanilla.x, C.SPIRIT.POS.vanilla.y, C.SPIRIT.POS.vanilla.size),
    chocolat: new E.Spirit('chocolat', C.SPIRIT.POS.chocolat.x, C.SPIRIT.POS.chocolat.y, C.SPIRIT.POS.chocolat.size),
    caramel: new E.Spirit('caramel', C.SPIRIT.POS.caramel.x, C.SPIRIT.POS.caramel.y, C.SPIRIT.POS.caramel.size)
  };

  function updateSpirits(dt) {
    spirits.vanilla.update(dt);
    spirits.chocolat.update(dt);
    spirits.caramel.update(dt);
  }

  function restoreSpiritPos() {
    spirits.vanilla.setPos(C.SPIRIT.POS.vanilla);
    spirits.chocolat.setPos(C.SPIRIT.POS.chocolat);
    spirits.caramel.setPos(C.SPIRIT.POS.caramel);
  }

  /** 在场精灵渲染（画在场景内容之上、FX 粒子之下）；牛奶糖缓速中附带剩余时长光环 */
  function renderSpirits(ctx, keys) {
    for (var i = 0; i < keys.length; i++) {
      var s = spirits[keys[i]];
      if (!s) continue;
      if (keys[i] === 'caramel' && slowmo.active) {
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.25 * Math.sin(performance.now() * 0.006);
        ctx.strokeStyle = '#7fd4cb';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(s.x, s.y, C.SPIRIT.CARAMEL_R - 6, -Math.PI / 2,
          -Math.PI / 2 + TAU * (1 - slowmo.t / slowmo.dur));
        ctx.stroke();
        ctx.restore();
      }
      s.render(ctx);
    }
  }

  /* ---- 牛奶糖缓速魔法（project.md 三.1）----
   * 点击牛奶糖：蛋糕转盘 ω 与节拍流速平滑降低 40%（BGM 阶段 4 接入后同步变速），
   * 持续一个循环 = 当前阶段正常转速转一圈的时长（夹 5~10s）；跨阶段自动终止。 */
  var slowmo = { active: false, t: 0, dur: 0 };

  function baseOmega() {
    if (Game.name === 'PIPE_RHYTHM')
      return TAU / (C.BEAT.FLOWERS_PER_CIRCLE * (60 / C.BEAT.BPM));
    if (Game.name === 'TOPPING_DROP') return TAU / C.TOPPING.SPIN_PERIOD;
    if (Game.name === 'EVALUATION') return 0.35;   // 3D 失败回退 2D 的缓转
    return 0;
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function triggerSlowmo() {
    if (slowmo.active) {
      spirits.caramel.bounce();
      Game.fx.text(spirits.caramel.x, spirits.caramel.y - 110, '魔法进行中♪', '#4db6ac', 28);
      return;
    }
    slowmo.active = true;
    slowmo.t = 0;
    slowmo.dur = Utils.clamp(TAU / baseOmega(), C.SPIRIT.SLOW.MIN_DURATION, C.SPIRIT.SLOW.MAX_DURATION);
    spirits.caramel.bounce();
    spirits.caramel.say(pick(C.SPIRIT.CARAMEL.SLOW));
    log('牛奶糖缓速魔法：' + slowmo.dur.toFixed(1) + 's（转速×' + (1 - C.SPIRIT.SLOW.REDUCE) + '）');
  }

  function updateSlowmo(dt) {
    if (!slowmo.active) { Game.metronome.rate = 1; return; }
    slowmo.t += dt;
    if (slowmo.t >= slowmo.dur) {
      slowmo.active = false;
      Game.metronome.rate = 1;
      log('缓速魔法结束，转速恢复');
      return;
    }
    Game.metronome.rate = 1 - C.SPIRIT.SLOW.REDUCE;
  }

  /** 牛奶糖按钮命中检测（裱花/顶料阶段 onDown 优先于玩法点击） */
  function hitCaramel(p) {
    var dx = p.x - spirits.caramel.x, dy = p.y - spirits.caramel.y;
    return dx * dx + dy * dy <= C.SPIRIT.CARAMEL_R * C.SPIRIT.CARAMEL_R;
  }

  /** 香草挥棒撒金粉：兜底触发的统一视觉（project.md 三.1 香草"撒金粉"粒子） */
  function vanillaRescue(wordPool) {
    spirits.vanilla.bounce();
    if (wordPool) spirits.vanilla.say(pick(wordPool));
    Game.fx.burst(spirits.vanilla.x, spirits.vanilla.y, {
      count: 12, colors: ['#ffd700', '#ffe6a1', '#ffb6c1'], speed: 240, shape: 'circle'
    });
  }

  /** 缓速中：屏幕四周柔和青色光晕，暗示时间流速变慢 */
  function renderSlowmoVeil(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(140, 205, 200, 0.30)';
    ctx.lineWidth = 26;
    ctx.strokeRect(13, 13, 750 - 26, 1334 - 26);
    ctx.strokeStyle = 'rgba(140, 205, 200, 0.15)';
    ctx.lineWidth = 58;
    ctx.strokeRect(29, 29, 750 - 58, 1334 - 58);
    ctx.restore();
  }

  function setState(name) {
    if (Game.cur && Game.cur.exit) Game.cur.exit();
    slowmo.active = false;   // 缓速魔法不跨阶段延续（project.md：持续一个循环）
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
      spirits.vanilla.say(C.SPIRIT.VANILLA.HELLO);
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
      renderSpirits(ctx, ['vanilla']);
    },
    onDown: function () { setState('BAKE_CHARGE'); }
  };

  /* ================================================================
   * 状态 2：STATE_BAKE_CHARGE —— 长按蓄力烤胚
   * ================================================================ */

  var BAKE_CHARGE = {
    phase: 'charge',   // charge → fly → settle
    bar: null, vy: 0, y: 0, landT: 0, settleT: 0, bakePts: 0,
    goldenSaid: false,

    enter: function () {
      resetScore();
      Game.cake = new E.Cake(Game.order);
      this.bar = new E.ChargeBar(LAYOUT.barX, LAYOUT.barY, LAYOUT.barW, LAYOUT.barH);
      this.phase = 'charge';
      this.vy = 0; this.y = 0; this.landT = 0; this.settleT = 0;
      this.goldenSaid = false;
      showBanner('Step 2 · 烤胚', '长按屏幕蓄力，松手落盘！', 1.4);
    },

    update: function (dt) {
      this.bar.update(dt);
      var cfg = C.CHARGE;
      if (this.phase === 'charge') {
        // 蓄力时蛋糕胚实时长高（手感反馈）
        Game.cake.height = Utils.lerp(cfg.MIN_HEIGHT, cfg.MAX_HEIGHT, this.bar.power);
        // 巧克力辅助线（project.md 三.1）：长按首次进入黄金区间 →
        // 点头发光 + 台词 + "Perfect 时机"提示，每次蓄力只提示一次
        if (!this.goldenSaid && this.bar.holding) {
          var p = this.bar.power;
          if (p >= cfg.GOLDEN_MIN && p <= cfg.GOLDEN_MAX) {
            this.goldenSaid = true;
            spirits.chocolat.nod();
            spirits.chocolat.say(pick(C.SPIRIT.CHOCOLAT.GOLDEN));
            Game.fx.text(375, 330, 'Perfect 时机！', '#e8a20c', 44);
            log('巧克力辅助：进入黄金区间 power=' + p.toFixed(2));
          }
        }
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
        spirits.chocolat.nod();
        spirits.chocolat.say(pick(C.SPIRIT.CHOCOLAT.PRAISE));
        Game.fx.text(LAYOUT.plateX, LAYOUT.plateY - Game.cake.height - 80, '黄金火候 +' + C.SCORE.GOLDEN_BONUS, '#e8a20c', 44);
      } else {
        // 香草兜底（project.md 三.1）：火候偏小 / 过猛都不惩罚，
        // 香草挥棒撒金粉，把结果改写成可爱（评分照常保底加分）
        vanillaRescue(p < C.CHARGE.GOLDEN_MIN ? C.SPIRIT.VANILLA.SMALL : C.SPIRIT.VANILLA.CHEER);
      }
      Game.score.bake = this.bakePts;
      log('烤胚落地：power=' + p.toFixed(2) + (golden ? '（黄金区间）' : '（香草兜底）') + ' → +' + this.bakePts + ' 分');
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
      renderSpirits(ctx, ['vanilla', 'chocolat']);
    }
  };

  /* ================================================================
   * 状态 3：STATE_PIPE_RHYTHM —— 节拍裱花
   * 不限时：只要没点满 TOTAL_BEATS 朵，转盘就不停转，
   * 漏掉的拍可以在下一圈同一位置补救；圈数不影响评分。
   * ================================================================ */

  var PIPE_RHYTHM = {
    placedSet: null, placedCount: 0, doneAt: -1, vanillaSaid: 0,

    enter: function () {
      Game.metronome.reset();
      Game.turntable.syncToBeat();
      this.placedSet = {};
      this.placedCount = 0;
      this.doneAt = -1;
      this.vanillaSaid = 0;   // 香草兜底台词限流：一阶段最多说 2 次，避免刷屏
      showBanner('Step 3 · 裱花', '跟着♪节拍点满 ' + C.BEAT.TOTAL_BEATS + ' 朵奶油花！', 1.5);
    },

    update: function (dt) {
      Game.metronome.update(dt);   // 转盘由主循环统一驱动，此处不重复 update
      // 点满即收：不再按固定时长结束，漏拍者下一圈继续（圈数不限、不计入评分）
      if (this.placedCount >= C.BEAT.TOTAL_BEATS) {
        if (this.doneAt < 0) {
          this.doneAt = Game.t;
          log('裱花点满 ' + C.BEAT.TOTAL_BEATS + ' 朵，用时 ' + Game.t.toFixed(1) + 's（' + (Game.t / Game.metronome.interval / C.BEAT.FLOWERS_PER_CIRCLE).toFixed(2) + ' 圈）');
        }
        if (Game.t - this.doneAt >= 0.6) setState('TOPPING_DROP');
      }
    },

    onDown: function (p) {
      // 牛奶糖缓速按钮优先判定（点击头像不挤奶油）
      if (hitCaramel(p)) { triggerSlowmo(); return; }
      var m = Game.metronome;
      var raw = m.nearestIndex();
      // 拍位按总拍数取模：下一圈（乃至第 N 圈）转到同一位置即可补救这一拍
      var idx = raw % C.BEAT.TOTAL_BEATS;
      if (this.placedSet[idx]) {
        // 该拍已有花（本圈或此前圈点过）：不惩罚，轻声提示
        log('裱花重复拍点 #' + idx + '（原拍 ' + raw + '），忽略');
        Game.fx.text(LAYOUT.btnX, LAYOUT.btnY - 150, '这一拍有花啦♪', '#b48ead', 30);
        return;
      }
      this.placedSet[idx] = true;
      this.placedCount++;
      if (raw >= C.BEAT.TOTAL_BEATS) log('跨圈补救：第 ' + (Math.floor(raw / C.BEAT.FLOWERS_PER_CIRCLE) + 1) + ' 圈补上拍 #' + idx);

      // 判定分级：点歪不改失败 —— 香草强制挥棒，把一切偏差兜底改写为 Cute（project.md 三.1）
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
        // Cute 不是失败：香草挥棒撒金粉 + 台词鼓励（台词限流），转盘上的花照常绽放
        vanillaRescue(this.vanillaSaid < 2 ? (this.vanillaSaid++, C.SPIRIT.VANILLA.CHEER) : null);
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

      // 顶部进度点：已放朵数（不再随时间走，漏拍不亮、补上才亮）
      var total = C.BEAT.TOTAL_BEATS;
      var done = this.placedCount;
      for (var k = 0; k < total; k++) {
        var dx = 375 + (k - (total - 1) / 2) * 34;
        ctx.beginPath();
        ctx.arc(dx, 95, k < done ? 9 : 7, 0, TAU);
        ctx.fillStyle = k < done ? '#ff8fb5' : 'rgba(200,150,175,0.35)';
        ctx.fill();
      }

      drawHint(ctx, '点击屏幕任意位置挤出奶油花');
      renderSpirits(ctx, ['vanilla', 'caramel']);
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
      // 牛奶糖缓速按钮优先判定（转盘太快时可先点她减速再瞄准）
      if (hitCaramel(p)) { triggerSlowmo(); return; }
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
      renderSpirits(ctx, ['vanilla', 'caramel']);
    }
  };

  /* ================================================================
   * 状态 5：STATE_EVALUATION —— 甜蜜结算（只有夸奖）
   * ================================================================ */

  var EVALUATION = {
    total: 0, stars: 1, title: '', praise: '', readyT: 0,
    viewer3d: null,                        // 3D 展台实例（cake3d.js，退出时 destroy）
    btn2: { x: 560, y: 1200, r: 105 },   // “再来一块”按钮（渲染与点击判定共用）
    btnSave: { x: 622, y: 168, w: 196, h: 60 },   // “保存成果”小胶囊按钮（右上角）

    enter: function () {
      var s = Game.score;
      s.even = this.calcEvenBonus();
      s.total = s.bake + s.flowers * C.SCORE.FLOWER + s.perfects * C.SCORE.PERFECT_BONUS + s.fruits * C.SCORE.FRUIT + s.even;
      this.total = s.total;
      this.stars = s.total >= C.STAR_THRESHOLD[0] ? 3 : s.total >= C.STAR_THRESHOLD[1] ? 2 : 1;
      this.title = C.TITLES[this.stars];
      this.praise = C.GUEST.PRAISE[Math.floor(Math.random() * C.GUEST.PRAISE.length)];
      this.readyT = 0.3 + 5 * 0.22 + 0.15 + 0.7 + 0.5;
      log('结算：总分=' + this.total + '（含均匀度 +' + s.even + '） 星=' + this.stars + ' 称号=' + this.title);
      this.startShowcase();
      showBanner('完成♪', '客人超级满意！', 1.4);
      Game.fx.burst(375, 480, { count: 24, colors: ['#ffc94d', '#ff8fb5', '#b8e6ff', '#fff'], speed: 420 });
      // 三精灵共同大赞（project.md 三.2：结算时客人与精灵共同大赞）：
      // 挪到结算位排排站，延迟依次弹跳；香草代表发言
      var EV = C.SPIRIT.POS.EVAL;
      spirits.vanilla.setPos(EV.vanilla);
      spirits.chocolat.setPos(EV.chocolat);
      spirits.caramel.setPos(EV.caramel);
      spirits.vanilla.bounce(0.10);
      spirits.chocolat.bounce(0.35);
      spirits.caramel.bounce(0.60);
      spirits.vanilla.say(C.SPIRIT.VANILLA.DONE);
    },

    exit: function () {
      this.destroyShowcase();   // 离开 Step 4：彻底释放 WebGL 资源
      restoreSpiritPos();       // 精灵回到常驻位
    },

    /* ---- 3D 展台接入（new.md 任务 3）----
     * 进入结算：组装 cakeData 并实例化 Cake3DViewer；
     * THREE 缺失 / WebGL 创建失败时回退 2D 俯视缓缓旋转（保证可玩性）。 */
    startShowcase: function () {
      this.destroyShowcase();
      try {
        this.viewer3d = new global.Cake3DViewer(
          document.getElementById('game-container'), this.buildCakeData());
        log('3D 展台已挂载：flavor=' + this.viewer3d.data.flavor +
          ' heightRatio=' + this.viewer3d.data.heightRatio.toFixed(2));
      } catch (err) {
        this.viewer3d = null;
        Game.turntable.target = 0.35;   // 回退 2D：缓缓旋转展示
        log('3D 展台不可用，回退 2D 展示：' + (err && err.message));
      }
    },

    destroyShowcase: function () {
      if (this.viewer3d) {
        this.viewer3d.destroy();
        this.viewer3d = null;
        log('3D 展台已销毁，WebGL 资源释放完毕');
      }
    },

    /* ---- 保存成果：合成 2D 主画布 + 3D 展台 → PNG ----
     * 优先用 File System Access API 弹“另存为”（Chrome/Edge，可直选 html 所在目录）；
     * 不支持（file:// 打开等）时回退浏览器下载。 */
    capture: function () {
      var w = canvas.width, h = canvas.height;
      var out = document.createElement('canvas');
      out.width = w; out.height = h;
      var c2 = out.getContext('2d');
      c2.drawImage(canvas, 0, 0);
      var v = this.viewer3d;
      if (v && !v.disposed && v.renderer) {
        // WebGL 默认渲染后即清缓冲：截图前同步补渲染一帧再立即取图，保证 3D 不空白
        try { v.renderer.render(v.scene, v.camera); } catch (e) { /* 已销毁则忽略 */ }
        c2.drawImage(v.canvas, 0, 0, w, h);
      }
      var d = new Date(), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
      var stamp = '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) +
        p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());

      /* 安卓手机（默认浏览器）：必须在本点击手势的同步调用栈内完成下载——
       * toBlob 是异步回调，等它返回时 user activation 已过期，移动浏览器会静默拦截。
       * 用同步 toDataURL 触发 <a download>，正常情况直接静默存入浏览器默认下载目录；
       * 个别浏览器弹“确认下载”属系统行为，用户点确认即存。 */
      if (/Android/i.test(navigator.userAgent)) {
        try {
          var url = out.toDataURL('image/png');
          var ad = document.createElement('a');
          ad.href = url;
          ad.download = 'yumeiro_cake_' + stamp + '.png';
          document.body.appendChild(ad);
          ad.click();
          document.body.removeChild(ad);
          showBanner('成果已经保存~', '', 2.0);   // 浮动提示 2 秒后消失
          log('成果图已触发保存（安卓下载目录）：' + ad.download);
          return;
        } catch (e) {
          log('安卓同步下载被拦，回退通用流程：' + (e && e.message));
        }
      }

      /* PC / 兜底：异步 toBlob（桌面浏览器不依赖手势，无拦截问题） */
      var self = this;
      var name = '蛋糕成果_' + stamp + '.png';
      if (!out.toBlob) { log('当前浏览器不支持 toBlob，无法导出'); return; }
      out.toBlob(function (blob) {
        if (blob) self.savePng(blob, name);
      }, 'image/png');
    },

    savePng: function (blob, name) {
      var self = this;
      if (window.showSaveFilePicker) {
        window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'PNG 图片', accept: { 'image/png': ['.png'] } }]
        }).then(function (h) {
          return h.createWritable().then(function (wr) {
            return wr.write(blob).then(function () { return wr.close(); });
          });
        }).then(function () {
          showBanner('保存成功♪', name, 1.6);
          log('成果图已保存：' + name);
        }).catch(function (err) {
          if (err && err.name !== 'AbortError') log('保存失败：' + (err && err.message));
        });
      } else {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
        showBanner('已导出♪', '图片已开始下载', 1.6);
        log('成果图已触发下载：' + name);
      }
    },

    /* ---- cakeData 数据契约（new.md 任务 1）----
     * Step 1~3 成果 → Step 4 渲染参数：
     * flavor 取订单序，heightRatio 由蓄力高度线性映射到 0.6~1.4，
     * creams / toppings 为蛋糕局部极坐标 → 顶面直角坐标（3D 半径 74）。 */
    buildCakeData: function () {
      var cake = Game.cake;
      var FLAVORS = ['strawberry', 'matcha', 'chocolate'];   // 对应 C.ORDERS 顺序
      var idx = C.ORDERS.indexOf(Game.order);
      var heightRatio = Utils.clamp(
        0.6 + (cake.height - C.CHARGE.MIN_HEIGHT) /
          (C.CHARGE.MAX_HEIGHT - C.CHARGE.MIN_HEIGHT) * 0.8, 0.6, 1.4);
      var creams = [], toppings = [];
      for (var i = 0; i < cake.flowers.length; i++) {
        creams.push({ angle: cake.flowers[i].a, tier: cake.flowers[i].tier });
      }
      for (var j = 0; j < cake.fruits.length; j++) {
        var fr = cake.fruits[j];
        var r3 = fr.r / cake.topRadius * 74;   // 虚拟顶半径 205 → 3D 胚半径 74
        toppings.push({ type: fr.type, x: Math.cos(fr.a) * r3, z: Math.sin(fr.a) * r3 });
      }
      return {
        flavor: FLAVORS[idx] || 'strawberry',
        heightRatio: heightRatio,
        creamType: 'vanilla',
        creams: creams,
        toppings: toppings
      };
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
      // 保存成果：胶囊按钮矩形命中
      var sb = this.btnSave;
      if (p.x >= sb.x - sb.w / 2 && p.x <= sb.x + sb.w / 2 &&
          p.y >= sb.y - sb.h / 2 && p.y <= sb.y + sb.h / 2) {
        this.capture();
        return;
      }
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

      // 作品展示：优先 3D 旋转展台（WebGL 透明画布覆盖在背景之上、UI 之下）；
      // 未挂载 3D（CDN 失败等）时回退 2D 俯视缓缓旋转
      if (!this.viewer3d) {
        ctx.save();
        ctx.translate(375, 480);
        ctx.scale(0.86, 0.86);
        ctx.translate(-375, -480);
        E.Turntable.prototype.renderPlate(ctx, 375, 480, 250, Game.order.plate);
        ctx.translate(375, 480);
        ctx.rotate(Game.turntable.angle);
        Game.cake.renderTop(ctx);
        ctx.restore();
      }

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

      // 客人夸奖：气泡只显示 1 秒即淡出，避免挡住下方“甜蜜分”
      if (t > this.readyT - 0.4 && t < this.readyT + 0.6) {
        Game.guest.render(ctx, 108, 1200, 0.85);
        var fade = Utils.clamp((this.readyT + 0.6 - t) / 0.25, 0, 1);   // 末尾 0.25s 淡出
        ctx.save();
        ctx.globalAlpha = fade;
        E.drawBubble(ctx, 300, 1080, this.praise, 24);
        ctx.restore();
      }

      // 保存成果小按钮（右上角胶囊，与“再来一块”同时出现）
      if (t > this.readyT) {
        var sb = this.btnSave;
        var rw = sb.w / 2, rh = sb.h / 2, rr = rh;
        ctx.save();
        ctx.translate(sb.x, sb.y);
        ctx.beginPath();
        ctx.moveTo(-rw + rr, -rh);
        ctx.arcTo(rw, -rh, rw, rh, rr);
        ctx.arcTo(rw, rh, -rw, rh, rr);
        ctx.arcTo(-rw, rh, -rw, -rh, rr);
        ctx.arcTo(-rw, -rh, rw, -rh, rr);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#f0a7c0';
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 28px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#e2557e';
        ctx.fillText('保存成果', 0, 2);
        ctx.restore();
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

      renderSpirits(ctx, ['vanilla', 'chocolat', 'caramel']);
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
      updateSpirits(dt);
      updateSlowmo(dt);
      // 转盘目标转速统一在此驱动（缓速 ×0.6 平滑趋近由 Turntable.update 内建 lerp 实现）；
      // 各状态 enter 里的 syncToBeat / target 赋值仅作首帧兜底
      var factor = slowmo.active ? 1 - C.SPIRIT.SLOW.REDUCE : 1;
      Game.turntable.target = baseOmega() * factor;
      Game.turntable.update(dt);
    }

    var sx = canvas.width / Utils.VW;
    var sy = canvas.height / Utils.VH;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);

    renderBackground(ctx, now);
    if (Game.cur && Game.cur.render) Game.cur.render(ctx, now);
    Game.fx.render(ctx);
    renderBanner(ctx);
    if (slowmo.active) renderSlowmoVeil(ctx);

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

  /* ---- 调试直跳：URL 带 ?step=4 时跳过 Step 1~3，用模拟蛋糕直接进结算 ----
   * 仅用于预览/调试 3D 展台（cake3d.js），无参数时流程完全不变。 */
  if (/[?&]step=4/.test(location.search)) {
    Game.order = C.ORDERS[0];
    Game.cake = new E.Cake(Game.order);
    Game.cake.height = 300;                        // 中等偏上 → heightRatio ≈ 1.18
    for (var di = 0; di < 8; di++)                 // 8 朵裱花，内外圈交替
      Game.cake.flowers.push({ a: di / 8 * TAU, tier: di % 2 });
    for (var dj = 0; dj < 5; dj++)                 // 5 个顶料，草莓/马卡龙交替均匀摆放
      Game.cake.fruits.push({ a: dj / 5 * TAU + 0.3, r: 150, type: dj % 2 ? 'macaron' : 'strawberry' });
    Game.score.bake = 120; Game.score.flowers = 8; Game.score.perfects = 5; Game.score.fruits = 5;
    setState('EVALUATION');
  } else {
    setState('ORDER_SHOW');
  }
  requestAnimationFrame(frame);

})(window);
