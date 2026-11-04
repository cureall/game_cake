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
    barX: 150, barY: 420, barW: 48, barH: 520,  // 蓄力条（左列让给巧克力精灵）
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

  /* ================= 主角天野草莓（视效材料 图3） =================
   * 常驻左下陪伴制作；结算时平滑滑到作品旁"探出头"，头顶气泡夸奖。
   * 目标位按当前状态自动切换（指数平滑趋近），无需逐状态布点。 */
  var ichigo = {
    x: -220, y: 1150, size: 280,
    t: Math.random() * 10,
    sayT: -1, sayDelay: 0, sayText: '',
    nextIdle: 9 + Math.random() * 8,

    target: function () {
      if (Game.name === 'EVALUATION' || Game.name === 'FREE_RESULT') return C.ICHIGO.POS_SHOW;
      if (Game.name === 'TITLE') return { x: -240, y: 1150, size: 280 };   // 封面自带主角，屏外候场
      return C.ICHIGO.POS_HOME;
    },

    update: function (dt) {
      this.t += dt;
      var tg = this.target();
      var k = 1 - Math.exp(-4 * dt);
      this.x += (tg.x - this.x) * k;
      this.y += (tg.y - this.y) * k;
      this.size += (tg.size - this.size) * k;
      if (this.sayDelay > 0) {
        this.sayDelay -= dt;
        if (this.sayDelay <= 0) this.sayT = 0;
      } else if (this.sayT >= 0) {
        this.sayT += dt;
        if (this.sayT > C.ICHIGO.SAY_DUR) this.sayT = -1;
      } else if (Game.name !== 'TITLE' && Game.name !== 'EVALUATION' &&
                 Game.name !== 'FREE_RESULT') {
        this.nextIdle -= dt;   // 制作阶段偶尔自言自语
        if (this.nextIdle <= 0) {
          this.nextIdle = 12 + Math.random() * 10;
          this.sayText = pick(C.ICHIGO.IDLE);
          this.sayT = 0;
        }
      }
    },

    /** 结算亮相：延迟开口夸一句（视效材料：头顶冒出气泡夸奖） */
    cheer: function () {
      this.sayText = pick(C.ICHIGO.SHOW);
      this.sayDelay = C.ICHIGO.SAY_DELAY;
      this.sayT = -1;
    },

    render: function (ctx) {
      if (this.x < -160) return;   // 未入场/封面页不画
      var bob = Math.sin(this.t * 1.5) * 6;
      var cy = this.y + bob;
      var img = E.getSpiritImage('ichigo');
      ctx.save();
      if (img) {
        var w = this.size * img.width / img.height;
        ctx.fillStyle = 'rgba(120, 60, 90, 0.10)';
        ctx.beginPath();
        ctx.ellipse(this.x, this.y + this.size / 2 - 6, w * 0.28, 10, 0, 0, TAU);
        ctx.fill();
        ctx.drawImage(img, this.x - w / 2, cy - this.size / 2, w, this.size);
      } else {
        this.drawFallback(ctx, this.x, cy);
      }
      ctx.restore();
      if (this.sayT >= 0) {
        ctx.save();
        ctx.globalAlpha = Utils.clamp((C.ICHIGO.SAY_DUR - this.sayT) / 0.3, 0, 1);
        E.drawBubble(ctx, Utils.clamp(this.x + 60, 190, 560),
          cy - this.size / 2 - 76, this.sayText, 24);
        ctx.restore();
      }
    },

    /* 无图兜底：简笔小草莓（粉双马尾 + 白厨帽 + 粉裙） */
    drawFallback: function (ctx, cx, cy) {
      var r = this.size * 0.15;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = '#f06292';
      ctx.beginPath(); ctx.arc(-r * 1.4, -r * 0.2, r * 0.55, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 1.4, -r * 0.2, r * 0.55, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fffdf9';
      ctx.beginPath(); ctx.ellipse(0, -r * 1.7, r * 0.8, r * 0.45, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffe4d4';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#5c4033'; ctx.lineWidth = r * 0.09; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.05, r * 0.18, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(r * 0.35, -r * 0.05, r * 0.18, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.fillStyle = 'rgba(255,140,170,0.5)';
      ctx.beginPath(); ctx.ellipse(-r * 0.6, r * 0.35, r * 0.16, r * 0.1, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(r * 0.6, r * 0.35, r * 0.16, r * 0.1, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffb6c1';
      ctx.beginPath();
      ctx.moveTo(-r * 0.85, r * 0.9); ctx.quadraticCurveTo(0, r * 2.2, r * 0.85, r * 0.9);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  };

  /* ---- 牛奶糖缓速魔法（project.md 三.1）----
   * 点击牛奶糖：蛋糕转盘 ω 与节拍流速平滑降低 40%（BGM 阶段 4 接入后同步变速），
   * 持续一个循环 = 当前阶段正常转速转一圈的时长（夹 5~10s）；跨阶段自动终止。 */
  var slowmo = { active: false, t: 0, dur: 0 };

  function baseOmega() {
    if (Game.name === 'PIPE_RHYTHM') return TAU / C.RHYTHM.ROTATION_PERIOD;
    if (Game.name === 'TOPPING_DROP') return TAU / C.TOPPING.SPIN_PERIOD;
    if (Game.name === 'EVALUATION') return 0.35;   // 3D 失败回退 2D 的缓转
    if (Game.name === 'FREE_RESULT') return 0.3;   // 自由关大作 2D 缓转展示
    return 0;   // FREE_STAGE（转盘静止，涂鸦所见即所得）与其余阶段
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
    if (!slowmo.active) return;
    slowmo.t += dt;
    if (slowmo.t >= slowmo.dur) {
      slowmo.active = false;
      log('缓速魔法结束，转速恢复');
    }
  }

  /** 牛奶糖按钮命中检测（裱花/顶料阶段 onDown 优先于玩法点击） */
  function hitCaramel(p) {
    var dx = p.x - spirits.caramel.x, dy = p.y - spirits.caramel.y;
    return dx * dx + dy * dy <= C.SPIRIT.CARAMEL_R * C.SPIRIT.CARAMEL_R;
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

  /* ================= BGM：op ↔ ed 轮播 + 状态分区音量 =================
   * 首次手势解锁自动播放后起播 op.wav，每首播完停 GAP 秒换另一首，
   * 以此循环；制作阶段音量压低，封面/接单/结算平滑恢复正常。 */
  var BGM = {
    tracks: [], idx: 0, gapLeft: -1,   // gapLeft ≥ 0：曲目间隙倒计时中
    live: false, vol: 0,
    NORMAL_STATES: ['TITLE', 'ORDER_SHOW', 'EVALUATION', 'FREE_RESULT'],

    init: function () {
      var self = this;
      ['op', 'ed'].forEach(function (name) {
        var el = new Audio('assets/' + name + '.wav');
        el.preload = 'auto';
        el.addEventListener('ended', function () { self.gapLeft = C.BGM.GAP; });
        self.tracks.push(el);
      });
      // 页面加载即尝试起播：浏览器允许自动播放时首页一打开就有音乐
      this.kick();
      // 被自动播放策略拦截时，页面任意首次手势（任意位置/按键）解锁重试
      ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach(function (ev) {
        document.addEventListener(ev, function () { self.kick(); },
          { passive: true, capture: true });
      });
    },

    /** 幂等：已在播直接返回；play() 被拒置回 live=false 等下次手势 */
    kick: function () {
      if (this.live) return;
      this.live = true;
      this.playCurrent();
    },

    playCurrent: function () {
      var el = this.tracks[this.idx];
      el.volume = Utils.clamp(this.vol, 0, 1);
      var self = this;
      var pr = el.play();
      if (pr && pr.then) {
        pr.then(function () {
          log('BGM ▶ ' + (self.idx === 0 ? 'op' : 'ed') + '.wav');
        }, function () {
          self.live = false;   // 被拦截：等下一次手势再试
        });
      }
    },

    update: function (dt) {
      if (!this.live) return;
      if (this.gapLeft >= 0) {
        this.gapLeft -= dt;
        if (this.gapLeft < 0) {
          this.idx = (this.idx + 1) % this.tracks.length;   // op ↔ ed 轮播
          this.playCurrent();
        }
      }
      var target = this.NORMAL_STATES.indexOf(Game.name) >= 0
        ? C.BGM.NORMAL_VOLUME : C.BGM.DUCK_VOLUME;
      this.vol += (target - this.vol) * Math.min(1, dt * 3);   // 音量平滑过渡
      this.tracks[this.idx].volume = Utils.clamp(this.vol, 0, 1);
    }
  };
  BGM.init();

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
    // 工坊环境底图（视效材料 图2）：全幅铺底，上盖一层淡粉纱
    // 保证悬浮的 Canvas UI 文字对比度；图未就绪/file:// 不安全时退回渐变
    var bg = E.getSpiritImage('bg_kitchen');
    if (bg) {
      ctx.drawImage(bg, 0, 0, 750, 1334);
      ctx.fillStyle = 'rgba(255, 240, 247, 0.22)';
      ctx.fillRect(0, 0, 750, 1334);
      return;
    }
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

  /** 圆形行动按钮（自由工坊"挤奶油/去装饰/完成"，pulse 0~1 控制脉动强度） */
  function drawActionButton(ctx, x, y, r, lines, pulse, now) {
    var beat = 0.5 + 0.5 * Math.sin((now || performance.now()) * 0.005);
    ctx.save();
    ctx.translate(x, y);
    var s = 1 + 0.05 * pulse * beat;
    ctx.scale(s, s);
    var g = ctx.createRadialGradient(0, -r * 0.3, r * 0.2, 0, 0, r);
    g.addColorStop(0, '#ffd0e0');
    g.addColorStop(1, '#ff7fae');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px "PingFang SC", "Microsoft YaHei", sans-serif';
    for (var i = 0; i < lines.length; i++)
      ctx.fillText(lines[i], 0, (i - (lines.length - 1) / 2) * 44);
    ctx.restore();
  }

  /** 胶囊按钮（自由工坊结算双按钮；color 为主色调，now 可选脉动） */
  function drawPillButton(ctx, b, label, color, now) {
    var s = now ? 1 + 0.03 * (0.5 + 0.5 * Math.sin(now * 0.005)) : 1;
    var rw = b.w / 2, rh = b.h / 2, rr = rh;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(-rw + rr, -rh);
    ctx.arcTo(rw, -rh, rw, rh, rr);
    ctx.arcTo(rw, rh, -rw, rh, rr);
    ctx.arcTo(-rw, rh, -rw, -rh, rr);
    ctx.arcTo(-rw, -rh, rw, -rh, rr);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 32px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(label, 0, 2);
    ctx.restore();
  }

  /** 顶视图统一入口：底盘 + 旋转中的蛋糕主体（自由工坊传 plateColor） */
  function renderTurntableScene(ctx, plateScale, plateColor) {
    var s = plateScale || 1;
    var cx = LAYOUT.ttCx, cy = LAYOUT.ttCy;
    E.Turntable.prototype.renderPlate(ctx, cx, cy, LAYOUT.plateR * s, plateColor || Game.order.plate);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.rotate(Game.turntable.angle);
    Game.cake.renderTop(ctx);
    ctx.restore();
  }

  /* ================================================================
   * 状态 0：STATE_TITLE —— 封面标题页（视效材料 图1：官方全家福）
   * 全屏封面 + "开始制作蛋糕"粉色大按钮；图未就绪时渐变 + 大字兜底。
   * ================================================================ */

  var TITLE = {
    btn: { x: 375, y: 1040, w: 500, h: 150 },
    btnDiary: { x: 540, y: 100, w: 350, h: 80 },   // 右上角：草莓的日记本（阶段 4）
    diaryCount: 0,   // 进封面时统计一次，避免 render 每帧读 localStorage

    enter: function () {
      this.diaryCount = loadDiary().length;
    },

    onDown: function (p) {
      // 日记本入口优先判定：命中则翻相册，不开始游戏
      var d = this.btnDiary;
      if (p.x >= d.x - d.w / 2 && p.x <= d.x + d.w / 2 &&
          p.y >= d.y - d.h / 2 && p.y <= d.y + d.h / 2) {
        log('封面：打开草莓的日记本');
        setState('DIARY');
        return;
      }
      // 其余任意点击即开始（零门槛）；大按钮只是视觉引导
      log('封面：点击开始 → 第一单');
      setState('ORDER_SHOW');
    },

    render: function (ctx, now) {
      var img = E.getSpiritImage('bg_title');
      if (img) {
        ctx.drawImage(img, 0, 0, 750, 1334);
      } else {
        // 兜底：渐变 + 大标题（图加载失败/画布不安全时依然可进入游戏）
        var g = ctx.createLinearGradient(0, 0, 0, 1334);
        g.addColorStop(0, '#ffd9e8');
        g.addColorStop(1, '#ffb7cf');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 750, 1334);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = 'bold 88px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.lineWidth = 14;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeText('梦色蛋糕师', 375, 480);
        ctx.fillStyle = '#e2557e';
        ctx.fillText('梦色蛋糕师', 375, 480);
        ctx.font = '34px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#9c5a78';
        ctx.fillText('· 甜点工坊 ·', 375, 552);
        ctx.restore();
      }

      // "开始制作蛋糕"大按钮（脉动，视效材料：居中可爱粉色大按钮）
      var b = this.btn;
      var pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.scale(1 + 0.035 * pulse, 1 + 0.035 * pulse);
      var rw = b.w / 2, rh = b.h / 2, rr = rh;
      ctx.beginPath();
      ctx.moveTo(-rw + rr, -rh);
      ctx.arcTo(rw, -rh, rw, rh, rr);
      ctx.arcTo(rw, rh, -rw, rh, rr);
      ctx.arcTo(-rw, rh, -rw, -rh, rr);
      ctx.arcTo(-rw, -rh, rw, -rh, rr);
      ctx.closePath();
      var g2 = ctx.createLinearGradient(0, -rh, 0, rh);
      g2.addColorStop(0, '#ff9ec4');
      g2.addColorStop(1, '#ff6f9f');
      ctx.fillStyle = g2;
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 52px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('♪ 开始制作蛋糕 ♪', 0, 0);
      ctx.restore();

      // 右上角"日记本"入口（阶段 4：草莓的相册）
      var d = this.btnDiary;
      ctx.save();
      ctx.translate(d.x, d.y);
      roundRectPath(ctx, -d.w / 2, -d.h / 2, d.w, d.h, d.h / 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#f3a8c3';
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 32px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#e2557e';
      ctx.fillText('📖 日记本' + (this.diaryCount > 0 ? ' ·' + this.diaryCount : ''), 0, 2);
      ctx.restore();

      drawHint(ctx, '纯粹的自由烘焙时光', 1270);
    }
  };

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
    power: 0,          // 松手瞬间的最终火候（含精灵吸附补正）
    assisted: false,

    enter: function () {
      resetScore();
      Game.cake = new E.Cake(Game.order);
      this.bar = new E.ChargeBar(LAYOUT.barX, LAYOUT.barY, LAYOUT.barW, LAYOUT.barH);
      this.phase = 'charge';
      this.vy = 0; this.y = 0; this.landT = 0; this.settleT = 0;
      this.power = 0; this.assisted = false;
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
      // 计分：火候越高分越高；黄金区奖励必得（没踩准的部分
      // 由巧克力精灵在松手瞬间静默吸附补正，只有加分、无惩罚）
      var p = this.power;
      this.bakePts = C.SCORE.BAKE_BASE + Math.round(p * 70) + C.SCORE.GOLDEN_BONUS;
      if (this.assisted) {
        spirits.chocolat.nod();
        spirits.chocolat.say(pick(C.SPIRIT.CHOCOLAT.ASSIST));
        Game.fx.text(LAYOUT.plateX, LAYOUT.plateY - Game.cake.height - 80, '巧克力补火候 +' + C.SCORE.GOLDEN_BONUS, '#e8a20c', 44);
      } else {
        spirits.chocolat.nod();
        spirits.chocolat.say(pick(C.SPIRIT.CHOCOLAT.PRAISE));
        Game.fx.text(LAYOUT.plateX, LAYOUT.plateY - Game.cake.height - 80, '黄金火候 +' + C.SCORE.GOLDEN_BONUS, '#e8a20c', 44);
      }
      Game.score.bake = this.bakePts;
      log('烤胚落地：power=' + p.toFixed(2) + (this.assisted ? '（精灵吸附补正）' : '（玩家精准）') + ' → +' + this.bakePts + ' 分');
      Game.fx.burst(LAYOUT.plateX, LAYOUT.plateY - 10, { count: 14, colors: ['#ffd3e2', '#ff8fb5', '#fff'], speed: 260 });
      Game.fx.text(LAYOUT.plateX, LAYOUT.plateY - Game.cake.height - 30, '松软出炉♪', '#e2557e', 40);
    },

    onDown: function () {
      if (this.phase === 'charge') this.bar.start();
    },
    onUp: function () {
      if (this.phase !== 'charge' || !this.bar.holding) return;
      var p = this.bar.release();
      // 巧克力精灵辅助（改版）：不画任何颜色提示，玩家没踩准黄金区时
      // 悄悄把火候吸附到最近的黄金边界再起飞 —— 静默保底黄金加分
      this.assisted = p < C.CHARGE.GOLDEN_MIN || p > C.CHARGE.GOLDEN_MAX;
      if (p < C.CHARGE.GOLDEN_MIN) p = C.CHARGE.GOLDEN_MIN + 0.02;
      else if (p > C.CHARGE.GOLDEN_MAX) p = C.CHARGE.GOLDEN_MAX - 0.02;
      this.power = p;
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
   * 状态 3：STATE_PIPE_RHYTHM —— 旋转裱花（temp2.md 角度判定版）
   * 转盘恒速顺时针无限旋转（RHYTHM.ROTATION_PERIOD 秒/圈），裱花嘴
   * 固定在世界 0°（3 点钟）。点击瞬间把裱花嘴在盘面本地系的投影角
   * 原样落花 —— 点早点晚只改变落点本身，严禁吸附对齐到指示点；
   * 再按与最近指示点的归一化偏差 e = Δθ/步长 ∈ [-0.5, +0.5) 分级。
   * 无限循环补漏：漏掉的槽位等下一圈转到裱花嘴再补，点满 8/8 收工。
   * ================================================================ */

  var PIPE_RHYTHM = {
    slots: null,       // 指示点槽位数组（temp2.md 五：isActive 为未来空拍预留，当前全 true）
    filledCount: 0,
    doneAt: -1,
    DONE_DELAY: 1.0,   // 点满后的停留时长（秒）再进 Step 4

    enter: function () {
      var n = C.RHYTHM.SLOT_COUNT;
      this.slots = [];
      for (var i = 0; i < n; i++) {
        this.slots.push({ id: i, targetAngle: i * 360 / n, isActive: true, filled: false });
      }
      this.filledCount = 0;
      this.doneAt = -1;
      showBanner('Step 3 · 裱花', '圆点对准裱花嘴时点满 ' + n + ' 朵花！', 1.5);
    },

    update: function (dt) {
      if (this.filledCount >= this.slots.length) {
        if (this.doneAt < 0) {
          this.doneAt = Game.t;
          log('裱花点满 ' + this.filledCount + ' 朵，用时 ' + Game.t.toFixed(1) +
            's（约 ' + (Game.t / C.RHYTHM.ROTATION_PERIOD).toFixed(2) + ' 圈）');
        }
        if (Game.t - this.doneAt >= this.DONE_DELAY) setState('TOPPING_DROP');
      }
    },

    onDown: function () {
      // 真实落点（temp2.md 二.3）：裱花嘴世界角恒为 0°，
      // 其盘面本地角 = (0 - θ_disk) mod 360°，直接作为落花角存储，不吸附
      var local = (TAU - Game.turntable.angle) % TAU;

      // 归属最近激活槽位，算归一化偏差 e = Δθ/步长（temp2.md 三）
      var step = TAU / this.slots.length;
      var k = -1, d = 0;
      for (var i = 0; i < this.slots.length; i++) {
        if (!this.slots[i].isActive) continue;
        var dd = Utils.normAngle(local - this.slots[i].targetAngle * Math.PI / 180);
        if (k < 0 || Math.abs(dd) < Math.abs(d)) { k = i; d = dd; }
      }
      var slot = this.slots[k];
      var e = d / step;

      // 槽位防重（temp2.md 四.2）：最近槽位已有花 → 忽略本次点击，不叠花
      if (slot.filled) {
        log('裱花重复槽位 #' + k + '（e=' + e.toFixed(3) + '），忽略');
        Game.fx.text(LAYOUT.btnX, LAYOUT.btnY - 150, '这朵已经有花啦♪', '#b48ead', 30);
        return;
      }
      slot.filled = true;
      this.filledCount++;

      // 分级判定：阈值实时读 Config，控制台调 RHYTHM.PERFECT_WINDOW 立即生效
      var absE = Math.abs(e);
      var tier = absE <= C.RHYTHM.PERFECT_WINDOW ? 'perfect'
               : absE <= C.RHYTHM.GOOD_WINDOW ? 'good' : 'rough';

      // 花按真实局部角落下：rough（偏得离谱）也照画，只是不弹评价文字
      Game.cake.flowers.push({ a: local, tier: tier });
      Game.score.flowers++;

      // 评价文字统一在固定裱花口弹出；e > 0 = 点早（花落在槽位前方），e < 0 = 点晚
      var nx = LAYOUT.ttCx + LAYOUT.nozzleR, ny = LAYOUT.ttCy;
      if (tier === 'perfect') {
        Game.score.perfects++;
        Game.fx.burst(nx, ny, { count: 14, colors: ['#ffc94d', '#ffe6a1', '#ff8fb5', '#fff'], speed: 300 });
        Game.fx.text(nx, ny - 40, 'PERFECT!', '#e8a20c', 42);
      } else if (tier === 'good') {
        Game.fx.burst(nx, ny, { count: 9, colors: ['#ff8fb5', '#ffd3e2'], speed: 230 });
        Game.fx.text(nx, ny - 40, 'GOOD!', '#e2557e', 40);
      }
      log('裱花槽位 #' + k + '：e=' + e.toFixed(3) + '（' + (e >= 0 ? '早' : '晚') + ' ' +
        (Math.abs(d) * 180 / Math.PI).toFixed(1) + '°）判定=' + tier +
        ' 进度 ' + this.filledCount + '/' + this.slots.length);
    },

    render: function (ctx) {
      drawStageTitle(ctx, 'Step 3 / 4 · 节拍裱花 ' + this.filledCount + '/' + this.slots.length);
      renderTurntableScene(ctx, 1);

      // 盘边指示点（temp2.md 二.2）：进入转盘本地系绘制，随盘旋转；
      // 与奶油花共用半径 → 对准时花正好盖住圆点，点偏则肉眼可见地错开。
      // 已填充槽位淡出（花本体即标记），未填充的靠近裱花嘴时点亮。
      var ringR = Game.cake.topRadius * C.RHYTHM.CREAM_RING_FRAC;
      var pulse = 0;
      ctx.save();
      ctx.translate(LAYOUT.ttCx, LAYOUT.ttCy);
      ctx.rotate(Game.turntable.angle);
      for (var i = 0; i < this.slots.length; i++) {
        var s = this.slots[i];
        var la = s.targetAngle * Math.PI / 180;
        var wa = (la + Game.turntable.angle) % TAU;   // 槽位当前世界角
        var dist = Math.min(wa, TAU - wa);            // 距 3 点钟裱花嘴的角距
        var glow = s.filled ? 0 : Math.max(0, 1 - dist * 2.4);
        if (glow > pulse) pulse = glow;
        ctx.beginPath();
        ctx.arc(Math.cos(la) * ringR, Math.sin(la) * ringR, 10 + glow * 8, 0, TAU);
        ctx.fillStyle = s.filled ? 'rgba(216,168,189,0.18)'
          : 'rgba(255,' + Math.round(160 + 60 * glow) + ',' + Math.round(190 + 40 * glow) + ',' + (0.45 + 0.55 * glow) + ')';
        ctx.fill();
      }
      ctx.restore();

      // 固定裱花嘴（3 点钟方向）
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

      // 中央大按钮（有圆点接近裱花嘴时脉动提示）
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
      ctx.fillText('对准圆点按下去♪', LAYOUT.btnX, LAYOUT.btnY + 42);

      // 顶部进度点：与槽位一一对应，补到哪朵亮哪朵
      var total = this.slots.length;
      for (var q = 0; q < total; q++) {
        var dx = 375 + (q - (total - 1) / 2) * 34;
        ctx.beginPath();
        ctx.arc(dx, 95, this.slots[q].filled ? 9 : 7, 0, TAU);
        ctx.fillStyle = this.slots[q].filled ? '#ff8fb5' : 'rgba(200,150,175,0.35)';
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
      ichigo.cheer();   // 主角从旁边滑入，延迟冒泡夸奖（视效材料 图3）
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
        // 阶段 3：每累计 2 单常规订单，插入一次草莓自由工坊（project.md 三.3）
        setState(Game.orderIndex % C.FREE.EVERY === 0 ? 'FREE_STAGE' : 'ORDER_SHOW');
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
        ['完美裱花 ×' + s.perfects, '+' + s.perfects * C.SCORE.PERFECT_BONUS],
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

  /* ================================================================
   * 状态 6：STATE_FREE_STAGE —— 草莓自由工坊（阶段 3，project.md 三.3）
   * 每累计 2 单常规订单进入 1 次。仍走 饼胚→奶油→装饰 三步，
   * 但全部自由操作：烤胚随便蓄力叠层、奶油点/按住拖动随手涂鸦、
   * 装饰随手撒 —— 无订单、无目标刻度、无节拍校准、不判分。
   * 转盘全程静止：落点所见即所得。
   * ================================================================ */

  var SUGAR_COLORS = ['#ffc94d', '#ff8fb5', '#8ed3f0', '#9ee493', '#c9a7f5'];

  var FREE_STAGE = {
    sub: 'bake',                    // bake → cream → topping
    bar: null, settleT: 0,
    colorIdx: 0, lastPt: null, creamFullSaid: false,
    toppingType: 'strawberry', toppingFullSaid: false,
    /* 布局：右下行动按钮（避开转盘）、底部调色盘 / 素材选择 */
    btnNext: { x: 618, y: 1066, r: 86 },
    swatchY: 1215, swatchR: 30, swatchGap: 84,
    matY: 1215, matR: 54, matGap: 150,

    enter: function () {
      Game.cake = new E.Cake(C.FREE.PALETTE);
      Game.cake.height = 0;   // 自由关从 0 层起叠，height = 各层之和
      this.sub = 'bake';
      this.bar = new E.ChargeBar(LAYOUT.barX, LAYOUT.barY, LAYOUT.barW, LAYOUT.barH, false);
      this.settleT = 0;
      this.colorIdx = 0;
      this.lastPt = null;
      this.creamFullSaid = false;
      this.toppingType = 'strawberry';
      this.toppingFullSaid = false;
      spirits.vanilla.say(C.FREE.VANILLA.WELCOME);
      showBanner('草莓自由工坊', '想怎么做都可以♪', 1.6);
    },

    /* ---- 子阶段切换 ---- */
    subTo: function (next) {
      this.sub = next;
      this.lastPt = null;
      if (next === 'cream') {
        spirits.vanilla.say(C.FREE.VANILLA.CREAM);
        showBanner('自由挤奶油♪', '点一点、拖一拖，颜色随便换', 1.5);
      } else if (next === 'topping') {
        spirits.vanilla.say(C.FREE.VANILLA.TOPPING);
        showBanner('自由装饰♪', '草莓 · 马卡龙 · 糖粒，点哪落哪', 1.5);
      }
      log('自由工坊子阶段 → ' + next);
    },

    update: function (dt) {
      if (this.sub === 'bake') {
        this.bar.update(dt);
        this.settleT += dt;
      }
    },

    /* ---- 世界坐标 → 蛋糕局部极坐标（转盘静止，但仍减盘角保持自洽） ---- */
    toLocal: function (p) {
      var dx = p.x - LAYOUT.ttCx, dy = p.y - LAYOUT.ttCy;
      return { a: Math.atan2(dy, dx) - Game.turntable.angle, r: Math.sqrt(dx * dx + dy * dy) };
    },
    onCake: function (p) {
      var dx = p.x - LAYOUT.ttCx, dy = p.y - LAYOUT.ttCy;
      return dx * dx + dy * dy <= Math.pow(Game.cake.topRadius * 0.95, 2);
    },

    /* ---- 挤一朵自由奶油花（伴随撒糖粉粒子群） ---- */
    squeezeCream: function (p) {
      var n = Game.cake.flowers.length;
      if (n >= C.FREE.CREAM_MAX) {
        if (!this.creamFullSaid) {
          this.creamFullSaid = true;
          Game.fx.text(LAYOUT.ttCx, LAYOUT.ttCy - 260, '奶油挤到极限啦♪', '#b48ead', 32);
        }
        return;
      }
      var loc = this.toLocal(p);
      var color = C.FREE.CREAM_COLORS[this.colorIdx];
      Game.cake.flowers.push({
        a: loc.a, r: loc.r, tier: 'free', color: color,
        scale: 0.8 + Math.random() * 0.45
      });
      Game.fx.burst(p.x, p.y, {
        count: 4, colors: [color, '#ffffff', '#ffe6a1'],
        speed: 110, shape: 'circle', size: 5, grav: 260
      });
    },

    /* ---- 投放顶料：草莓 / 马卡龙（跟手缩放随机）/ 糖粒（一次一小撮星） ---- */
    dropTopping: function (p) {
      var used = Game.cake.fruits.length + this.sugarDrops();
      if (used >= C.FREE.TOPPING_MAX) {
        if (!this.toppingFullSaid) {
          this.toppingFullSaid = true;
          Game.fx.text(LAYOUT.ttCx, LAYOUT.ttCy - 260, '装饰位满啦，已经很华丽♪', '#b48ead', 32);
        }
        return;
      }
      var loc = this.toLocal(p);
      if (this.toppingType === 'sugar') {
        for (var k = 0; k < C.FREE.SUGAR_PER_DROP; k++) {
          Game.cake.sugars.push({
            a: loc.a + (Math.random() - 0.5) * 0.3,
            r: Math.min(loc.r + (Math.random() - 0.5) * 46, Game.cake.topRadius * 0.95),
            color: SUGAR_COLORS[Math.floor(Math.random() * SUGAR_COLORS.length)],
            size: 6 + Math.random() * 6, rot: Math.random() * TAU
          });
        }
        Game.fx.burst(p.x, p.y, {
          count: 8, colors: SUGAR_COLORS, speed: 160, shape: 'star', size: 7, grav: 300
        });
      } else {
        Game.cake.fruits.push({
          a: loc.a, r: loc.r, type: this.toppingType,
          scale: 0.85 + Math.random() * 0.5
        });
        Game.fx.burst(p.x, p.y, {
          count: 8, colors: ['#ff8fb5', '#ffe6a1', '#ffffff'], speed: 180, grav: 300
        });
      }
    },
    sugarDrops: function () {
      // 糖粒按"每次一撮"计数：用 5 颗一撮折算
      return Math.ceil(Game.cake.sugars.length / C.FREE.SUGAR_PER_DROP);
    },

    /* ---- 命中检测 ---- */
    hitBtn: function (p) {
      var b = this.btnNext;
      var dx = p.x - b.x, dy = p.y - b.y;
      return dx * dx + dy * dy <= b.r * b.r;
    },
    hitSwatch: function (p) {
      for (var i = 0; i < C.FREE.CREAM_COLORS.length; i++) {
        var x = 375 + (i - (C.FREE.CREAM_COLORS.length - 1) / 2) * this.swatchGap;
        var dx = p.x - x, dy = p.y - this.swatchY;
        if (dx * dx + dy * dy <= Math.pow(this.swatchR + 16, 2)) return i;
      }
      return -1;
    },
    hitMaterial: function (p) {
      var mats = ['strawberry', 'macaron', 'sugar'];
      for (var i = 0; i < mats.length; i++) {
        var x = 375 + (i - 1) * this.matGap;
        var dx = p.x - x, dy = p.y - this.matY;
        if (dx * dx + dy * dy <= Math.pow(this.matR + 14, 2)) return mats[i];
      }
      return null;
    },

    onDown: function (p) {
      if (this.hitBtn(p)) {
        if (this.sub === 'bake') this.subTo('cream');
        else if (this.sub === 'cream') this.subTo('topping');
        else setState('FREE_RESULT');
        return;
      }
      if (this.sub === 'bake') {
        if (Game.cake.layers.length >= C.FREE.LAYER_MAX) {
          Game.fx.text(LAYOUT.plateX, LAYOUT.plateY - Game.cake.height - 60, '到天花板啦，去挤奶油吧♪', '#b48ead', 30);
          return;
        }
        this.bar.start();
        return;
      }
      if (this.sub === 'cream') {
        var sw = this.hitSwatch(p);
        if (sw >= 0) {
          this.colorIdx = sw;
          Game.fx.burst(375 + (sw - (C.FREE.CREAM_COLORS.length - 1) / 2) * this.swatchGap, this.swatchY,
            { count: 6, colors: [C.FREE.CREAM_COLORS[sw], '#fff'], speed: 120, shape: 'circle', size: 5, grav: 200 });
          return;
        }
      } else if (this.sub === 'topping') {
        var m = this.hitMaterial(p);
        if (m) {
          this.toppingType = m;
          Game.fx.burst(p.x, p.y, { count: 6, colors: ['#ff8fb5', '#fff'], speed: 120, shape: 'circle', size: 5, grav: 200 });
          return;
        }
      }
      if (this.onCake(p)) {
        if (this.sub === 'cream') { this.squeezeCream(p); this.lastPt = p; }
        else if (this.sub === 'topping') { this.dropTopping(p); this.lastPt = p; }
      }
    },

    onMove: function (p) {
      if (!this.lastPt) return;
      var dx = p.x - this.lastPt.x, dy = p.y - this.lastPt.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var step = this.sub === 'cream' ? C.FREE.CREAM_STEP : C.FREE.TOPPING_STEP;
      if (dist >= step && this.onCake(p)) {
        if (this.sub === 'cream') this.squeezeCream(p);
        else this.dropTopping(p);
        this.lastPt = p;
      }
    },

    onUp: function () {
      if (this.sub === 'bake') {
        if (!this.bar.holding) return;
        var pow = this.bar.release();
        if (Game.cake.layers.length >= C.FREE.LAYER_MAX) return;
        var h = Utils.lerp(C.FREE.LAYER_H_MIN, C.FREE.LAYER_H_MAX, pow);
        Game.cake.layers.push({ h: h });
        Game.cake.height += h;
        this.settleT = 0;
        var n = Game.cake.layers.length;
        Game.fx.burst(LAYOUT.plateX, LAYOUT.plateY - Game.cake.height, {
          count: 10, colors: ['#ffe9d2', '#ffd3e2', '#ffffff'], speed: 220, shape: 'circle', size: 7
        });
        Game.fx.text(LAYOUT.plateX, LAYOUT.plateY - Game.cake.height - 46, '第 ' + n + ' 层♪', '#e2557e', 38);
        if (n >= C.FREE.LAYER_MAX) spirits.vanilla.say('直通天际！再也高不动啦♪');
        else if (Math.random() < 0.4) spirits.vanilla.say(pick(C.SPIRIT.VANILLA.CHEER));
        log('自由烤胚：第 ' + n + ' 层 h=' + h.toFixed(0) + '（power=' + pow.toFixed(2) + '）');
      } else {
        this.lastPt = null;
      }
    },

    render: function (ctx, now) {
      if (this.sub === 'bake') this.renderBake(ctx, now);
      else if (this.sub === 'cream') this.renderCream(ctx, now);
      else this.renderTopping(ctx, now);
    },

    /* ---- 子阶段 1：自由烤胚（侧视，反复蓄力叠层，无黄金区无判定） ---- */
    renderBake: function (ctx, now) {
      var n = Game.cake.layers.length;
      drawStageTitle(ctx, '自由工坊 · 烤胚 ' + n + '/' + C.FREE.LAYER_MAX + ' 层');
      // 操作台 + 盘子（同常规烤胚画面）
      ctx.fillStyle = '#f7d9e5';
      ctx.fillRect(0, LAYOUT.plateY, 750, 1334 - LAYOUT.plateY);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(0, LAYOUT.plateY, 750, 14);
      ctx.fillStyle = Game.cake.palette.plate;
      ctx.beginPath();
      ctx.ellipse(LAYOUT.plateX, LAYOUT.plateY + 10, 210, 34, 0, 0, TAU);
      ctx.fill();

      // 已叠各层（新层落地弹跳）
      if (n > 0) {
        var sy = 1 - 0.3 * Math.exp(-5 * this.settleT) * Math.cos(15 * this.settleT);
        var sx = 1 + (1 - sy) * 0.8;
        Game.cake.renderSide(ctx, LAYOUT.plateX, LAYOUT.plateY, sx, sy);
      }

      // 蓄力条（自由版：无黄金区）+ 读数
      this.bar.render(ctx, now);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 30px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#b06f92';
      ctx.fillText(Math.round(this.bar.display * 100) + '%', LAYOUT.barX + 24, LAYOUT.barY - 18);
      ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText('火力', LAYOUT.barX + 24, LAYOUT.barY + LAYOUT.barH + 34);
      ctx.restore();

      if (n >= C.FREE.LAYER_MAX) drawHint(ctx, '到天花板啦！点右下按钮去挤奶油♪');
      else if (n === 0) drawHint(ctx, '长按蓄力烤出一层，想叠几层叠几层');
      else drawHint(ctx, '继续长按再叠一层，或点右下按钮去挤奶油');
      drawActionButton(ctx, this.btnNext.x, this.btnNext.y, this.btnNext.r,
        ['挤奶油♪'], n >= C.FREE.LAYER_MAX ? 1 : 0.6, now);
      renderSpirits(ctx, ['vanilla']);
    },

    /* ---- 子阶段 2：自由挤奶油（顶视，盘静止，点击/拖动涂鸦） ---- */
    renderCream: function (ctx, now) {
      var n = Game.cake.flowers.length;
      drawStageTitle(ctx, '自由工坊 · 挤奶油 ' + n + '/' + C.FREE.CREAM_MAX);
      renderTurntableScene(ctx, 1, Game.cake.palette.plate);

      // 调色盘（当前色放大高亮）
      for (var i = 0; i < C.FREE.CREAM_COLORS.length; i++) {
        var x = 375 + (i - (C.FREE.CREAM_COLORS.length - 1) / 2) * this.swatchGap;
        var sel = i === this.colorIdx;
        var r = this.swatchR * (sel ? 1.2 : 1);
        ctx.beginPath();
        ctx.arc(x, this.swatchY, r, 0, TAU);
        ctx.fillStyle = C.FREE.CREAM_COLORS[i];
        ctx.fill();
        ctx.lineWidth = sel ? 6 : 3;
        ctx.strokeStyle = sel ? '#e2557e' : 'rgba(180,120,150,0.4)';
        ctx.stroke();
      }
      drawHint(ctx, '点住拖动随手挤花，点色盘换颜色♪', 1300);
      drawActionButton(ctx, this.btnNext.x, this.btnNext.y, this.btnNext.r,
        ['去装饰♪'], 0.6, now);
      renderSpirits(ctx, ['vanilla']);
    },

    /* ---- 子阶段 3：自由装饰（草莓 / 马卡龙 / 糖粒，跟手投放） ---- */
    renderTopping: function (ctx, now) {
      var used = Game.cake.fruits.length + this.sugarDrops();
      drawStageTitle(ctx, '自由工坊 · 装饰 ' + used + '/' + C.FREE.TOPPING_MAX);
      renderTurntableScene(ctx, 1, Game.cake.palette.plate);

      // 素材选择钮：草莓 / 马卡龙 / 糖粒
      var mats = ['strawberry', 'macaron', 'sugar'];
      for (var i = 0; i < mats.length; i++) {
        var x = 375 + (i - 1) * this.matGap;
        var sel = mats[i] === this.toppingType;
        ctx.beginPath();
        ctx.arc(x, this.matY, this.matR * (sel ? 1.12 : 1), 0, TAU);
        ctx.fillStyle = sel ? '#fff' : 'rgba(255,255,255,0.72)';
        ctx.fill();
        ctx.lineWidth = sel ? 6 : 3;
        ctx.strokeStyle = sel ? '#e2557e' : 'rgba(180,120,150,0.4)';
        ctx.stroke();
        if (mats[i] === 'strawberry') E.drawStrawberry(ctx, x, this.matY, 1.35);
        else if (mats[i] === 'macaron') E.drawMacaron(ctx, x, this.matY, 1.35);
        else {
          E.drawStar(ctx, x, this.matY, 22, 10, -Math.PI / 2);
          ctx.fillStyle = '#ffc94d';
          ctx.fill();
        }
      }
      drawHint(ctx, '选好素材，点住蛋糕随手撒♪', 1300);
      drawActionButton(ctx, this.btnNext.x, this.btnNext.y, this.btnNext.r,
        ['完成♪'], 1, now);
      renderSpirits(ctx, ['vanilla']);
    }
  };

  /* ================================================================
   * 状态 7：STATE_FREE_RESULT —— 自由工坊结算（只有彩虹屁）
   * 全屏撒花 + 立绘弹出 + 彩虹屁矩阵称号 + 赞美短评 +
   * 【收入日记相册】（toDataURL 存 localStorage，阶段 4 翻看）
   * ================================================================ */

  var FREE_RESULT = {
    title: '', praise: '', metrics: null, saved: false,
    confettiIdx: 0,
    CONFETTI_AT: [0.15, 0.9, 1.7],      // 全屏撒花时间点（秒）
    btnDiary: { x: 200, y: 1200, w: 320, h: 96 },
    btnGo: { x: 548, y: 1200, w: 320, h: 96 },
    READY_T: 1.5,

    enter: function () {
      this.metrics = this.collectMetrics();
      this.title = this.buildTitle();
      this.praise = pick(C.FREE.PRAISE);
      this.saved = false;
      this.confettiIdx = 0;
      // 三精灵排排站立绘弹出（project.md：结算立绘弹出）
      var EV = C.SPIRIT.POS.EVAL;
      spirits.vanilla.setPos(EV.vanilla);
      spirits.chocolat.setPos(EV.chocolat);
      spirits.caramel.setPos(EV.caramel);
      spirits.vanilla.bounce(0.1);
      spirits.chocolat.bounce(0.4);
      spirits.caramel.bounce(0.7);
      spirits.vanilla.say(C.FREE.VANILLA.DONE);
      ichigo.cheer();   // 主角滑到作品旁探出头 + 冒泡夸奖
      log('自由工坊结算：' + JSON.stringify(this.metrics) + ' → 称号「' + this.title + '」');
    },

    exit: function () { restoreSpiritPos(); },

    /** 指标采集：层数 / 奶油数 / 实际用色数 / 水果数 / 糖粒数 */
    collectMetrics: function () {
      var cake = Game.cake;
      var colors = [];
      for (var i = 0; i < cake.flowers.length; i++) {
        if (cake.flowers[i].color && colors.indexOf(cake.flowers[i].color) < 0)
          colors.push(cake.flowers[i].color);
      }
      return {
        layers: cake.layers.length,
        creams: cake.flowers.length,
        colors: colors.length,
        fruits: cake.fruits.length,
        sugars: cake.sugars.length
      };
    },

    /** 彩虹屁矩阵（project.md 三.3）：前缀(层数) + 中缀(奶油数) + 主体(色彩/顶料特征) */
    buildTitle: function () {
      var m = this.metrics;
      var prefix = '', middle = '';
      for (var i = 0; i < C.FREE.PREFIX_RULES.length; i++)
        if (m.layers >= C.FREE.PREFIX_RULES[i].min) { prefix = C.FREE.PREFIX_RULES[i].text; break; }
      for (var j = 0; j < C.FREE.MIDDLE_RULES.length; j++)
        if (m.creams >= C.FREE.MIDDLE_RULES[j].min) { middle = C.FREE.MIDDLE_RULES[j].text; break; }
      var mainKey;
      if (m.colors >= 4) mainKey = 'rainbow';
      else if (m.fruits + Math.ceil(m.sugars / C.FREE.SUGAR_PER_DROP) >= 12) mainKey = 'fruitBox';
      else if (m.colors === 3) mainKey = 'macaron';
      else if (m.fruits >= 8) mainKey = 'fruitTower';
      else if (m.colors === 2) mainKey = 'duo';
      else mainKey = 'classic';
      return prefix + middle + C.FREE.MAIN[mainKey];
    },

    update: function (dt) {
      // 定点全屏撒花（花瓣星 + 爱心心混搭）
      if (this.confettiIdx < this.CONFETTI_AT.length &&
          Game.t >= this.CONFETTI_AT[this.confettiIdx]) {
        this.confettiIdx++;
        var y = 200 + this.confettiIdx * 60;
        Game.fx.burst(375, y, {
          count: 26, colors: ['#ffc94d', '#ff8fb5', '#b8e6ff', '#c9a7f5', '#fff'],
          speed: 460, shape: 'star', size: 10, grav: 380
        });
        Game.fx.burst(180, y + 120, {
          count: 12, colors: ['#ff8fb5', '#ffd3e2'], speed: 380, shape: 'heart', size: 11, grav: 350
        });
        Game.fx.burst(570, y + 120, {
          count: 12, colors: ['#8ed3f0', '#c9a7f5'], speed: 380, shape: 'heart', size: 11, grav: 350
        });
      }
    },

    /** 收入日记相册：蛋糕特写 → JPEG dataURL → localStorage（阶段 4 相册翻看） */
    saveDiary: function () {
      if (this.saved) { showBanner('已经在相册里啦♪', '', 1.4); return; }
      try {
        var S = 480;   // 特写正方形画布
        var off = document.createElement('canvas');
        off.width = off.height = S;
        var c2 = off.getContext('2d');
        c2.fillStyle = '#fff6f9';
        c2.fillRect(0, 0, S, S);
        var pr = S * 0.46;
        E.Turntable.prototype.renderPlate(c2, S / 2, S / 2, pr, Game.cake.palette.plate);
        c2.save();
        c2.translate(S / 2, S / 2);
        var sc = pr * 0.92 / Game.cake.topRadius;
        c2.scale(sc, sc);
        Game.cake.renderTop(c2);
        c2.restore();
        // 只含几何图形 → file:// 下画布不被污染，toDataURL 安全
        var url = off.toDataURL('image/jpeg', 0.72);
        var diary = [];
        try { diary = JSON.parse(localStorage.getItem(C.FREE.DIARY_KEY) || '[]'); } catch (e) { /* 损坏则重建 */ }
        diary.push({ ts: Date.now(), title: this.title, img: url });
        while (diary.length > C.FREE.DIARY_MAX) diary.shift();
        localStorage.setItem(C.FREE.DIARY_KEY, JSON.stringify(diary));
        this.saved = true;
        showBanner('已收入日记相册♪', '可以在封面的「日记本」里翻看♪', 1.8);
        log('日记相册：已保存第 ' + diary.length + ' 篇（' + this.title + '）');
      } catch (err) {
        showBanner('相册保存失败…', '浏览器存储可能已满', 1.8);
        log('日记相册保存失败：' + (err && err.message));
      }
    },

    onDown: function (p) {
      if (Game.t < this.READY_T) return;
      var d = this.btnDiary, g = this.btnGo;
      if (p.x >= d.x - d.w / 2 && p.x <= d.x + d.w / 2 &&
          p.y >= d.y - d.h / 2 && p.y <= d.y + d.h / 2) {
        this.saveDiary();
      } else if (p.x >= g.x - g.w / 2 && p.x <= g.x + g.w / 2 &&
                 p.y >= g.y - g.h / 2 && p.y <= g.y + g.h / 2) {
        setState('ORDER_SHOW');
      }
    },

    render: function (ctx, now) {
      var t = Game.t, m = this.metrics;
      drawStageTitle(ctx, '自由工坊 · 大作发表');

      // 作品 2D 缓转展示
      ctx.save();
      ctx.translate(375, 470);
      var pop = Utils.clamp(t / 0.6, 0, 1);
      var sc = Utils.lerp(0.5, 0.84, Utils.easeOutCubic(pop));
      ctx.scale(sc, sc);
      ctx.translate(-375, -470);
      E.Turntable.prototype.renderPlate(ctx, 375, 470, 250, Game.cake.palette.plate);
      ctx.translate(375, 470);
      ctx.rotate(Game.turntable.angle);
      Game.cake.renderTop(ctx);
      ctx.restore();

      // 彩虹屁称号（本关核心输出）+ 赞美短评
      if (t > 0.7) {
        var k = Utils.clamp((t - 0.7) / 0.4, 0, 1);
        ctx.save();
        ctx.globalAlpha = k;
        ctx.translate(375, 780);
        ctx.scale(Utils.lerp(1.3, 1, Utils.easeOutCubic(k)), Utils.lerp(1.3, 1, Utils.easeOutCubic(k)));
        ctx.textAlign = 'center';
        ctx.font = 'bold 46px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.lineWidth = 10;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.strokeText('「' + this.title + '」', 0, 0);
        ctx.fillStyle = '#d1547f';
        ctx.fillText('「' + this.title + '」', 0, 0);
        ctx.restore();
      }
      if (t > 1.0) E.drawBubble(ctx, 375, 830, this.praise, 26);

      // 创作指标小字（称号的依据，透明可查）
      if (t > 1.2) {
        ctx.save();
        ctx.globalAlpha = Utils.clamp((t - 1.2) / 0.3, 0, 1);
        ctx.textAlign = 'center';
        ctx.font = '26px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#b06f92';
        ctx.fillText(m.layers + ' 层饼胚 · ' + m.creams + ' 朵奶油 · ' + m.colors +
          ' 种配色 · ' + (m.fruits + m.sugars) + ' 个装饰', 375, 1010);
        ctx.restore();
      }

      // 双按钮：收入日记相册 / 继续接单
      if (t > this.READY_T) {
        drawPillButton(ctx, this.btnDiary, this.saved ? '已收入相册 ✓' : '收入日记相册', '#8ed3f0');
        drawPillButton(ctx, this.btnGo, '继续接单 ♪', '#ff8fb5', now);
      }

      renderSpirits(ctx, ['vanilla', 'chocolat', 'caramel']);
    }
  };

  /* ================================================================
   * 状态 8：STATE_DIARY —— 草莓的日记本（阶段 4：本地相册翻看）
   * 从封面进入，网格翻看 localStorage 里的自由工坊大作缩略图；
   * 点击缩略图放大（称号 + 日期），支持单删与清空；返回封面。
   * ================================================================ */

  function loadDiary() {
    try {
      var d = JSON.parse(localStorage.getItem(C.FREE.DIARY_KEY) || '[]');
      return Array.isArray(d) ? d : [];
    } catch (e) { return []; }   // 数据损坏视作空相册
  }

  function fmtDate(ts) {
    var d = new Date(ts), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '.' + p2(d.getMonth() + 1) + '.' + p2(d.getDate()) +
      ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  var DIARY = {
    list: null, imgs: null,      // 元数据数组 / Image 缓存（退出释放）
    view: 'grid', detail: -1,    // grid | detail；detail 为当前索引
    GRID: { x0: 79, y0: 250, size: 176, gap: 32, cols: 3 },   // 网格布局（3 列整体居中）
    btnBack: { x: 375, y: 1250, w: 400, h: 92 },
    btnDel: { x: 545, y: 1170, w: 250, h: 84 },      // 详情页：删除这一篇
    btnDelOk: { x: 375, y: 1050, w: 320, h: 88 },    // 确认弹层：真的删
    btnDelNo: { x: 375, y: 1150, w: 320, h: 88 },    // 确认弹层：先留着
    confirmIdx: -1,              // 待确认删除的索引（-1 = 弹层关闭）

    enter: function () {
      this.list = loadDiary();
      this.imgs = [];
      for (var i = 0; i < this.list.length; i++) {
        var img = new Image();
        img.src = this.list[i].img;
        this.imgs.push(img);   // dataURL 解码快，直接预载入
      }
      this.view = 'grid';
      this.detail = -1;
      this.confirmIdx = -1;
      showBanner('草莓的日记本', this.list.length ? '共 ' + this.list.length + ' 篇大作' : '', 1.2);
    },

    exit: function () {
      this.list = null;   // 释放 Image 引用，交给 GC
      this.imgs = null;
    },

    persist: function () {
      localStorage.setItem(C.FREE.DIARY_KEY, JSON.stringify(this.list));
      // 删光最后一篇时连键一起移除，保持存储干净
      if (!this.list.length) localStorage.removeItem(C.FREE.DIARY_KEY);
    },

    removeAt: function (idx) {
      this.list.splice(idx, 1);
      this.imgs.splice(idx, 1);
      this.persist();
      this.confirmIdx = -1;
      if (this.detail >= this.list.length) this.detail = this.list.length - 1;
      if (this.detail < 0) this.view = 'grid';
      showBanner('撕掉了这一页~', '', 1.1);
      log('日记相册：删除后余 ' + this.list.length + ' 篇');
    },

    /** 网格页第 i 格命中检测 */
    hitCell: function (p) {
      var G = this.GRID;
      for (var i = 0; i < this.list.length; i++) {
        var col = i % G.cols, row = Math.floor(i / G.cols);
        var x = G.x0 + col * (G.size + G.gap), y = G.y0 + row * (G.size + G.gap + 18);
        if (p.x >= x - 8 && p.x <= x + G.size + 8 &&
            p.y >= y - 8 && p.y <= y + G.size + 8) return i;
      }
      return -1;
    },

    hitRect: function (p, b) {
      return p.x >= b.x - b.w / 2 && p.x <= b.x + b.w / 2 &&
             p.y >= b.y - b.h / 2 && p.y <= b.y + b.h / 2;
    },

    onDown: function (p) {
      if (this.confirmIdx >= 0) {   // 删除确认弹层打开时只响应两个按钮
        if (this.hitRect(p, this.btnDelOk)) this.removeAt(this.confirmIdx);
        else if (this.hitRect(p, this.btnDelNo)) this.confirmIdx = -1;
        return;
      }
      if (this.view === 'grid') {
        if (this.hitRect(p, this.btnBack)) { setState('TITLE'); return; }
        var cell = this.hitCell(p);
        if (cell >= 0) {
          this.detail = cell;
          this.view = 'detail';
          this.detailAt = Game.t;   // 子视图切换时刻（Game.t 仅 setState 清零）
          Game.fx.burst(p.x, p.y, { count: 8, colors: ['#ff8fb5', '#fff', '#ffe6a1'], speed: 200 });
        }
      } else {
        if (this.hitRect(p, this.btnDel)) { this.confirmIdx = this.detail; return; }
        this.view = 'grid';   // 点其它任意处（含返回）回网格
      }
    },

    render: function (ctx, now) {
      drawStageTitle(ctx, '草莓的日记本');
      if (this.view === 'grid') this.renderGrid(ctx, now);
      else this.renderDetail(ctx, now);
      if (this.confirmIdx >= 0) this.renderConfirm(ctx, now);
    },

    /* ---- 网格页：缩略图宫格 + 底部返回 ---- */
    renderGrid: function (ctx, now) {
      if (!this.list.length) {
        // 空态：治愈系引导，不给任何挫败感
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '34px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#b06f92';
        ctx.fillText('日记本还是空白的~', 375, 520);
        ctx.fillText('打完 2 单订单进入自由工坊，', 375, 590);
        ctx.fillText('做出蛋糕后点「收入日记相册」♪', 375, 644);
        ctx.restore();
        var bob = Math.sin(now * 0.002) * 10;
        E.drawStrawberry(ctx, 375, 780 + bob, 2.6);
        drawPillButton(ctx, this.btnBack, '回封面 ♪', '#ff8fb5', now);
        return;
      }
      var G = this.GRID;
      for (var i = 0; i < this.list.length; i++) {
        var col = i % G.cols, row = Math.floor(i / G.cols);
        var x = G.x0 + col * (G.size + G.gap), y = G.y0 + row * (G.size + G.gap + 18);
        // 相纸底框（白边 + 轻微交错旋转，像贴在日记本上）
        ctx.save();
        ctx.translate(x + G.size / 2, y + G.size / 2);
        ctx.rotate(((i % 2 === 0) ? -1 : 1) * 0.025);
        ctx.fillStyle = '#fff';
        roundRectPath(ctx, -G.size / 2 - 8, -G.size / 2 - 8, G.size + 16, G.size + 16, 14);
        ctx.fill();
        ctx.strokeStyle = '#eebbc9';
        ctx.lineWidth = 3;
        ctx.stroke();
        var img = this.imgs[i];
        if (img && img.complete && img.naturalWidth) {
          ctx.drawImage(img, -G.size / 2, -G.size / 2, G.size, G.size);
        } else {
          ctx.fillStyle = '#f4dde6';
          ctx.fillRect(-G.size / 2, -G.size / 2, G.size, G.size);
        }
        ctx.restore();
        // 称号截断（最多 9 字，超出省略）
        var t = this.list[i].title || '';
        if (t.length > 9) t = t.slice(0, 9) + '…';
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '20px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#9c5a78';
        ctx.fillText(t, x + G.size / 2, y + G.size + 24);
        ctx.restore();
      }
      drawHint(ctx, '点击照片可以放大看 ♪', 1170);
      drawPillButton(ctx, this.btnBack, '回封面 ♪', '#ff8fb5', now);
    },

    /* ---- 详情页：大图 + 称号 + 日期 + 删除 ---- */
    renderDetail: function (ctx, now) {
      var e = this.list[this.detail];
      if (!e) { this.view = 'grid'; return; }
      var pop = Utils.clamp((Game.t - (this.detailAt || 0)) / 0.3, 0, 1);

      // 大图（带白框的拍立得）
      var S = 560;
      var cx = 375, cy = 470 + (1 - Utils.easeOutCubic(pop)) * 40;
      ctx.save();
      ctx.globalAlpha = pop;
      ctx.translate(cx, cy);
      ctx.rotate(Math.sin(now * 0.001) * 0.008);   // 轻微摇曳
      ctx.fillStyle = '#fff';
      roundRectPath(ctx, -S / 2 - 14, -S / 2 - 14, S + 28, S + 28, 18);
      ctx.fill();
      ctx.strokeStyle = '#eebbc9';
      ctx.lineWidth = 4;
      ctx.stroke();
      var img = this.imgs[this.detail];
      if (img && img.complete && img.naturalWidth) {
        ctx.drawImage(img, -S / 2, -S / 2, S, S);
      } else {
        ctx.fillStyle = '#f4dde6';
        ctx.fillRect(-S / 2, -S / 2, S, S);
      }
      ctx.restore();

      // 称号 + 日期
      ctx.save();
      ctx.globalAlpha = pop;
      ctx.textAlign = 'center';
      ctx.font = 'bold 40px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText('「' + e.title + '」', 375, 810);
      ctx.fillStyle = '#d1547f';
      ctx.fillText('「' + e.title + '」', 375, 810);
      ctx.font = '26px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#b06f92';
      ctx.fillText(fmtDate(e.ts), 375, 864);
      ctx.restore();

      drawHint(ctx, '点击空白处返回相册', 1000);
      drawPillButton(ctx, this.btnDel, '撕掉这一页', '#b06f92');
      drawPillButton(ctx, this.btnBack, '回相册 ♪', '#ff8fb5', now);
    },

    /* ---- 删除确认弹层（防误删，但文案依然可爱不吓人） ---- */
    renderConfirm: function (ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(60, 35, 52, 0.35)';
      ctx.fillRect(0, 0, 750, 1334);
      ctx.translate(375, 975);
      var w = 560, h = 440;
      roundRectPath(ctx, -w / 2, -h / 2, w, h, 30);
      ctx.fillStyle = '#fff8fb';
      ctx.fill();
      ctx.strokeStyle = '#eebbc9';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 38px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#d1547f';
      ctx.fillText('要撕掉这一页吗？', 0, -h / 2 + 76);
      ctx.font = '27px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#9c5a78';
      ctx.fillText('这份大作会从日记本里消失哦', 0, -h / 2 + 138);
      ctx.restore();
      drawPillButton(ctx, this.btnDelOk, '撕掉它', '#ff8fb5');
      drawPillButton(ctx, this.btnDelNo, '先留着', '#b8e6ff');
    }
  };

  /* 圆角矩形路径（相对当前原点，供日记本卡片/弹层复用） */
  function roundRectPath(ctx, x, y, w, h, r) {
    E.roundRect(ctx, x, y, w, h, r);
  }

  /* ================= 状态表 ================= */

  var States = {
    TITLE: TITLE,
    DIARY: DIARY,
    ORDER_SHOW: ORDER_SHOW,
    BAKE_CHARGE: BAKE_CHARGE,
    PIPE_RHYTHM: PIPE_RHYTHM,
    TOPPING_DROP: TOPPING_DROP,
    EVALUATION: EVALUATION,
    FREE_STAGE: FREE_STAGE,
    FREE_RESULT: FREE_RESULT
  };

  /* ================= 统一指针路由（单指游戏） ================= */

  var activePointerId = null;
  Utils.attachPointer(canvas, {
    onDown: function (p) {
      BGM.kick();   // 首次手势解锁 BGM 自动播放
      if (activePointerId !== null) return;   // 忽略多余手指
      activePointerId = p.id;
      if (Game.cur && Game.cur.onDown) Game.cur.onDown(p);
    },
    onMove: function (p) {
      // 仅活动指针的按住拖动才转发（自由工坊涂鸦用）
      if (p.id !== activePointerId) return;
      if (Game.cur && Game.cur.onMove) Game.cur.onMove(p);
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

  /* rAF 停摆看门狗：WebView 被遮挡/最小化时 requestAnimationFrame 可能被
   * 合成器完全节流（页面 JS 仍认为 visible），游戏会"冻住"——触摸还响应
   * 但画面不动。1.5s 无新帧则改用 setTimeout 驱动，保证可玩性。 */
  var rafKilled = false;
  var lastFrameAt = performance.now();

  function scheduleFrame() {
    if (!rafKilled) requestAnimationFrame(frame);
    else setTimeout(function () { frame(performance.now()); }, 16);   // rAF 会自动传时间戳，setTimeout 必须手动补
  }

  setInterval(function () {
    if (!rafKilled && performance.now() - lastFrameAt > 1500) {
      rafKilled = true;
      scheduleFrame();
    }
  }, 500);

  function frame(now) {
    lastFrameAt = now;
    var dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if (dt > 0) fpsSmooth = fpsSmooth * 0.95 + (1 / dt) * 0.05;

    Game.t += dt;
    BGM.update(dt);
    if (Game.cur) {
      if (Game.cur.update) Game.cur.update(dt);
      Game.fx.update(dt);
      updateBanner(dt);
      updateSpirits(dt);
      ichigo.update(dt);
      updateSlowmo(dt);
      // 转盘目标转速统一在此驱动（缓速 ×0.6 平滑趋近由 Turntable.update 内建 lerp 实现）；
      // 各状态 enter 里的 target 赋值仅作首帧兜底
      var factor = slowmo.active ? 1 - C.SPIRIT.SLOW.REDUCE : 1;
      Game.turntable.target = baseOmega() * factor;
      Game.turntable.update(dt);
    }

    var sx = canvas.width / Utils.VW;
    var sy = canvas.height / Utils.VH;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);

    renderBackground(ctx, now);
    if (Game.cur && Game.cur.render) Game.cur.render(ctx, now);
    ichigo.render(ctx);   // 主角：场景之上、粒子特效之下（结算页会被 3D 层压住形成"探出头"构图）
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

    scheduleFrame();
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
  } else if (/[?&]step=free/.test(location.search)) {
    // 调试直跳：自由工坊（阶段 3），无需先打两单常规订单
    setState('FREE_STAGE');
  } else {
    setState('TITLE');   // 封面 → 点击开始 → 第一单
  }
  requestAnimationFrame(frame);

})(window);
