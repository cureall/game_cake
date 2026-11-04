/**
 * entities.js —— 游戏实体对象
 * 蓄力条 / 旋转托盘 / 蛋糕 / 水果 / 客人 / 粒子特效
 * 全部基于虚拟坐标系 750x1334，使用 Canvas 原生几何图形绘制（无外部素材）。
 */
(function (global) {
  'use strict';

  var U = global.Utils;
  var C = global.Config;
  var TAU = Math.PI * 2;

  /* ================= 通用绘制小工具 ================= */

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));   // 半径必须非负，否则 arcTo 抛 IndexSizeError
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawStar(ctx, x, y, R, r, rot) {
    rot = rot || 0;
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var ang = rot + i * Math.PI / 5 - Math.PI / 2;
      var rad = (i % 2 === 0) ? R : r;
      var px = x + Math.cos(ang) * rad;
      var py = y + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawHeart(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.3, y - s * 0.1, x - s * 0.6, y - s, x, y - s * 0.3);
    ctx.bezierCurveTo(x + s * 0.6, y - s, x + s * 1.3, y - s * 0.1, x, y + s * 0.9);
    ctx.closePath();
  }

  /* ================= 蓄力条 ================= */

  /* showGolden=false 供自由工坊使用：只看蓄力读数，无黄金区高亮 */
  function ChargeBar(x, y, w, h, showGolden) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.showGolden = showGolden !== false;
    this.power = 0;    // 真实蓄力值 0~1（松手瞬间定格，决定胚体高度）
    this.display = 0;  // 显示值（松手后阻尼弹簧回落）
    this.vel = 0;
    this.holding = false;
  }

  ChargeBar.prototype.start = function () {
    if (!this.holding) { this.holding = true; this.power = 0; }
  };

  ChargeBar.prototype.update = function (dt) {
    if (this.holding) {
      this.power = U.clamp(this.power + dt / C.CHARGE.MAX_TIME, 0, 1);
      this.display = this.power;
    } else if (this.display > 0 || Math.abs(this.vel) > 0.001) {
      // 松手回弹：阻尼弹簧物理
      var acc = -90 * this.display - 9 * this.vel;
      this.vel += acc * dt;
      this.display += this.vel * dt;
      if (this.display < 0) { this.display = 0; this.vel = 0; }
    }
  };

  ChargeBar.prototype.release = function () {
    this.holding = false;
    return this.power;
  };

  ChargeBar.prototype.reset = function () {
    this.power = 0; this.display = 0; this.vel = 0; this.holding = false;
  };

  ChargeBar.prototype.render = function (ctx, t) {
    var x = this.x, y = this.y, w = this.w, h = this.h;
    // 接近蓄满时轻微颤抖，强化张力
    var shake = (this.holding && this.power > 0.92) ? Math.sin(t * 42) * 1.6 : 0;
    ctx.save();
    ctx.translate(shake, 0);

    // 底槽
    roundRect(ctx, x, y, w, h, w / 2);
    ctx.fillStyle = '#f4dde6';
    ctx.fill();
    ctx.strokeStyle = '#e3b8c8';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 黄金释放区间（黄色高亮带；自由工坊隐藏；补分吸附由精灵松手时静默完成）
    if (this.showGolden) {
      var gy = y + h * (1 - C.CHARGE.GOLDEN_MAX);
      var gh = h * (C.CHARGE.GOLDEN_MAX - C.CHARGE.GOLDEN_MIN);
      ctx.fillStyle = 'rgba(255, 214, 120, 0.55)';
      ctx.fillRect(x + 3, gy, w - 6, gh);
      // 蓄力中且当前值处于黄金区间 → 双层描边光晕脉冲
      if (this.holding && this.power >= C.CHARGE.GOLDEN_MIN && this.power <= C.CHARGE.GOLDEN_MAX) {
        var pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.012);
        ctx.strokeStyle = 'rgba(255, 190, 60, ' + (0.30 + 0.28 * pulse).toFixed(3) + ')';
        ctx.lineWidth = 8 + 5 * pulse;
        roundRect(ctx, x + 2, gy - 5, w - 4, gh + 10, w / 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 242, 200, ' + (0.65 + 0.35 * pulse).toFixed(3) + ')';
        ctx.lineWidth = 3;
        roundRect(ctx, x + 3, gy, w - 6, gh, w / 2);
        ctx.stroke();
      }
    }

    // 填充柱
    var fh = h * U.clamp(this.display, 0, 1);
    if (fh > 3) {   // 必须 > 3：圆角矩形高度为 fh-3，保证恒正
      var g = ctx.createLinearGradient(0, y + h, 0, y + h - fh);
      g.addColorStop(0, '#ff8fb5');
      g.addColorStop(1, '#ffd3e2');
      roundRect(ctx, x + 3, y + h - fh, w - 6, fh - 3, (w - 6) / 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();
  };

  /* ================= 旋转托盘 ================= */

  function Turntable() {
    this.angle = 0;   // 当前旋转角（rad）
    this.omega = 0;   // 当前角速度
    this.target = 0;  // 目标角速度（平滑趋近，供缓速/停转复用）
  }

  Turntable.prototype.update = function (dt) {
    this.omega = U.lerp(this.omega, this.target, 1 - Math.exp(-3 * dt));
    this.angle = (this.angle + this.omega * dt) % TAU;
  };

  /** 顶视图托盘底盘 */
  Turntable.prototype.renderPlate = function (ctx, cx, cy, R, plateColor) {
    // 阴影
    ctx.fillStyle = 'rgba(120, 60, 90, 0.10)';
    ctx.beginPath();
    ctx.ellipse(cx + 10, cy + 16, R, R * 0.92, 0, 0, TAU);
    ctx.fill();
    // 盘体
    ctx.fillStyle = plateColor;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.72, 0, TAU);
    ctx.fill();
  };

  /* ================= 蛋糕 ================= */

  function Cake(palette) {
    this.palette = palette;
    this.height = C.CHARGE.MIN_HEIGHT;
    this.width = 250;
    this.topRadius = 205;
    this.flowers = [];  // { a: 转盘局部角, tier }；自由工坊另带 { r, color, scale }
    this.fruits = [];   // { a, r, type } 转盘局部极坐标（自由工坊另带 scale）
    this.layers = [];   // 自由工坊多层胚 [{ h }]，空 = 常规单层（height 即总高）
    this.sugars = [];   // 自由工坊糖粒星 { a, r, color, size, rot }
  }

  /** 侧视图：底部锚点 (bx, by)，sx/sy 为压扁拉伸系数 */
  Cake.prototype.renderSide = function (ctx, bx, by, sx, sy) {
    sx = sx || 1; sy = sy || 1;
    var w = this.width, h = this.height;
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(sx, sy);

    // 落地阴影
    ctx.fillStyle = 'rgba(120, 60, 90, 0.12)';
    ctx.beginPath();
    ctx.ellipse(0, 4, w * 0.62, 16, 0, 0, TAU);
    ctx.fill();

    // 胚体（自由工坊多层胚逐层绘制，层间夹奶油线；常规单层保持原视觉）
    if (this.layers.length > 0) {
      var acc = 0;
      for (var li = 0; li < this.layers.length; li++) {
        var lh = this.layers[li].h;
        var ly = -h + acc;
        roundRect(ctx, -w / 2, ly, w, lh, li === 0 ? 24 : 8);
        ctx.fillStyle = li % 2 === 0 ? this.palette.sponge : '#f8e3ca';
        ctx.fill();
        ctx.strokeStyle = 'rgba(180, 120, 140, 0.25)';
        ctx.lineWidth = 3;
        ctx.stroke();
        // 每层两颗烘焙气孔
        ctx.fillStyle = 'rgba(190, 130, 100, 0.16)';
        for (var pi = 0; pi < 2; pi++) {
          ctx.beginPath();
          ctx.arc(-w / 2 + 62 + pi * 128 + (li % 2) * 30, ly + lh * 0.58, 5, 0, TAU);
          ctx.fill();
        }
        acc += lh;
      }
      // 层间奶油夹心（层体全部画完再补线，避免被上一层覆盖）
      acc = 0;
      for (var mi = 1; mi < this.layers.length; mi++) {
        acc += this.layers[mi - 1].h;
        ctx.fillStyle = this.palette.cream;
        roundRect(ctx, -w / 2 - 4, -h + acc - 5, w + 8, 11, 5);
        ctx.fill();
      }
    } else {
      roundRect(ctx, -w / 2, -h, w, h, 24);
      ctx.fillStyle = this.palette.sponge;
      ctx.fill();
      ctx.strokeStyle = 'rgba(180, 120, 140, 0.25)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // 烘焙气孔纹理
      ctx.fillStyle = 'rgba(190, 130, 100, 0.16)';
      for (var i = 0; i < 8; i++) {
        var px = -w / 2 + 28 + (i % 4) * 62 + (i > 3 ? 24 : 0);
        var py = -h + 34 + Math.floor(i / 4) * Math.min(h - 60, 90);
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, TAU);
        ctx.fill();
      }
    }

    // 顶部奶油盖 + 垂滴
    ctx.fillStyle = this.palette.cream;
    roundRect(ctx, -w / 2 - 8, -h - 26, w + 16, 34, 17);
    ctx.fill();
    for (var d = 0; d < 3; d++) {
      var dx = -w / 2 + 30 + d * (w - 60) / 2;
      ctx.beginPath();
      ctx.arc(dx, -h + 8, 13, 0, Math.PI);
      ctx.fill();
    }

    // 顶饰草莓
    drawStrawberry(ctx, 0, -h - 40, 1.1);

    ctx.restore();
  };

  /** 顶视图（在已 translate+rotate 到转盘中心的 ctx 中，圆心 0,0 调用） */
  Cake.prototype.renderTop = function (ctx) {
    var R = this.topRadius;
    // 奶油顶面
    ctx.fillStyle = this.palette.cream;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.palette.sponge;
    ctx.lineWidth = 10;
    ctx.stroke();
    // 海绵内芯
    ctx.fillStyle = this.palette.sponge;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.7, 0, TAU);
    ctx.fill();

    // 奶油花环（半径与 Step 3 指示点共用同一配置，花才能正好盖住圆点；
    // 自由工坊的花自带 r/color/scale，随手涂在哪里就画在哪里）
    var ringR = R * C.RHYTHM.CREAM_RING_FRAC;
    for (var i = 0; i < this.flowers.length; i++) {
      var f = this.flowers[i];
      var fr2 = (f.r != null) ? f.r : ringR;
      var fx = Math.cos(f.a) * fr2;
      var fy = Math.sin(f.a) * fr2;
      drawCreamFlower(ctx, fx, fy, f.tier, this.palette.accent, f.color, f.scale);
    }

    // 自由工坊糖粒星（贴在奶油面上不随判定，只负责闪）
    for (var si = 0; si < this.sugars.length; si++) {
      var sg = this.sugars[si];
      drawStar(ctx, Math.cos(sg.a) * sg.r, Math.sin(sg.a) * sg.r, sg.size, sg.size * 0.45, sg.rot);
      ctx.fillStyle = sg.color;
      ctx.fill();
    }

    // 水果
    for (var j = 0; j < this.fruits.length; j++) {
      var fr = this.fruits[j];
      var x = Math.cos(fr.a) * fr.r;
      var y = Math.sin(fr.a) * fr.r;
      var sc = fr.scale || 1.15;
      if (fr.type === 'strawberry') drawStrawberry(ctx, x, y, sc);
      else drawMacaron(ctx, x, y, sc);
    }
  };

  /** 奶油花：六瓣圆花瓣 + 分级花心
   *  color/scale 供自由工坊彩色涂鸦花使用，缺省保持常规白色小花 */
  function drawCreamFlower(ctx, x, y, tier, accent, color, scale) {
    color = color || '#ffffff';
    scale = scale || 1;
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(230, 180, 200, 0.5)';
    ctx.lineWidth = 2;
    for (var i = 0; i < 6; i++) {
      var a = i * TAU / 6;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 11 * scale, y + Math.sin(a) * 11 * scale, 10 * scale, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, 9 * scale, 0, TAU);
    ctx.fill();
    // 判定分级花心：Perfect 金星 / Good·自由花 粉心 / 其余（含 rough）灰粉心
    ctx.fillStyle = (tier === 'perfect') ? '#ffc94d' : (tier === 'good' || tier === 'free') ? accent : '#d8a8bd';
    if (tier === 'perfect') {
      drawStar(ctx, x, y, 9 * scale, 4 * scale, 0);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 6.5 * scale, 0, TAU);
    }
    ctx.fill();
    ctx.restore();
  }

  /* ================= 水果图标 ================= */

  function drawStrawberry(ctx, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    // 果身
    ctx.beginPath();
    ctx.moveTo(0, 14);
    ctx.bezierCurveTo(-13, 5, -12, -9, 0, -9);
    ctx.bezierCurveTo(12, -9, 13, 5, 0, 14);
    ctx.closePath();
    ctx.fillStyle = '#ff4d6d';
    ctx.fill();
    // 籽
    ctx.fillStyle = '#ffe1e9';
    var seeds = [[-6, 1], [6, 1], [0, 7], [-4, -4], [4, -4]];
    for (var i = 0; i < seeds.length; i++) {
      ctx.beginPath();
      ctx.ellipse(seeds[i][0], seeds[i][1], 1.6, 2.4, 0, 0, TAU);
      ctx.fill();
    }
    // 蒂叶
    ctx.fillStyle = '#59b95e';
    for (var k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(k * 7, -13);
      ctx.lineTo(k * 3, -6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMacaron(ctx, x, y, s, palette) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = '#f7c8dd';
    ctx.beginPath();
    ctx.arc(0, -5, 11, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff6fa';
    roundRect(ctx, -11, -4, 22, 9, 4);
    ctx.fill();
    ctx.fillStyle = '#f7c8dd';
    ctx.beginPath();
    ctx.arc(0, 6, 11, 0, TAU);
    ctx.fill();
    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.ellipse(-4, -8, 4, 2.4, -0.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ================= 水果实体（顶料阶段） ================= */

  function Fruit(type, idx) {
    this.type = type;
    this.state = 'float';   // float → falling → landed
    this.seed = Math.random() * TAU;
    this.t = 0;
    this.fx = 0; this.fy = 0;   // 漂浮基准位
    this.x = 0; this.y = 0;
    this.start = null; this.target = null;
  }

  Fruit.prototype.update = function (dt) {
    this.t += dt;
    if (this.state === 'float') {
      this.x = this.fx + Math.sin(this.t * 1.6 + this.seed) * 13;
      this.y = this.fy + Math.sin(this.t * 2.3 + this.seed) * 9;
    } else if (this.state === 'falling') {
      var k = Math.min(this.t / C.TOPPING.FALL_TIME, 1);
      this.x = U.lerp(this.start.x, this.target.x, k);
      this.y = U.lerp(this.start.y, this.target.y, k * k);  // easeIn：加速坠落
      if (k >= 1) { this.state = 'landed'; this.t = 0; }
    }
    // landed 后由 main 转挂到蛋糕局部坐标并移除
  };

  Fruit.prototype.drop = function (target) {
    this.start = { x: this.x, y: this.y };
    this.target = target;
    this.t = 0;
    this.state = 'falling';
  };

  Fruit.prototype.render = function (ctx, scale) {
    var s = scale || 1;
    var squash = 1;
    if (this.state === 'falling') squash = 1.12;
    if (this.state === 'landed') squash = 1 - 0.3 * Math.exp(-6 * this.t) * Math.cos(18 * this.t);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(s, s * squash);
    ctx.translate(-this.x, -this.y);
    if (this.type === 'strawberry') drawStrawberry(ctx, this.x, this.y, 1.6);
    else drawMacaron(ctx, this.x, this.y, 1.6);
    ctx.restore();
  };

  /* ================= 客人 ================= */

  function Guest() { this.t = Math.random() * 10; }
  Guest.prototype.update = function (dt) { this.t += dt; };

  Guest.prototype.render = function (ctx, x, y, scale) {
    scale = scale || 1;
    var bob = Math.sin(this.t * 2.2) * 5;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.scale(scale, scale);
    // 脸
    ctx.fillStyle = '#ffe3c8';
    ctx.beginPath();
    ctx.arc(0, 0, 46, 0, TAU);
    ctx.fill();
    // 刘海
    ctx.fillStyle = '#8a5a44';
    ctx.beginPath();
    ctx.arc(0, -12, 44, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -46, 34, 0, Math.PI);
    ctx.fill();
    // 开心眯眼
    ctx.strokeStyle = '#5c4033';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(-17, 4, 8, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(17, 4, 8, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    // 腮红
    ctx.fillStyle = 'rgba(255, 140, 170, 0.5)';
    ctx.beginPath();
    ctx.ellipse(-28, 16, 8, 5, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(28, 16, 8, 5, 0, 0, TAU);
    ctx.fill();
    // 微笑
    ctx.strokeStyle = '#c96b7d';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 14, 12, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.restore();
  };

  /** 对话气泡：自动按 14 字换行 */
  function drawBubble(ctx, x, y, text, fontSize) {
    fontSize = fontSize || 28;
    ctx.save();
    ctx.font = fontSize + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
    var lines = [];
    var per = 14;
    for (var i = 0; i < text.length; i += per) lines.push(text.slice(i, i + per));
    var lineH = fontSize * 1.45;
    var w = 0;
    for (var j = 0; j < lines.length; j++) {
      w = Math.max(w, ctx.measureText(lines[j]).width);
    }
    w += 56;
    var h = lines.length * lineH + 34;
    var bx = x - w / 2, by = y;
    // 气泡体
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.strokeStyle = '#eebbc9';
    ctx.lineWidth = 3;
    roundRect(ctx, bx, by, w, h, 26);
    ctx.fill();
    ctx.stroke();
    // 尾巴
    ctx.beginPath();
    ctx.moveTo(x - 14, by + h - 2);
    ctx.lineTo(x - 26, by + h + 22);
    ctx.lineTo(x + 6, by + h - 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fill();
    // 文本
    ctx.fillStyle = '#8a4a63';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var k = 0; k < lines.length; k++) {
      ctx.fillText(lines[k], x, by + 28 + lineH * k + lineH / 2 - 6);
    }
    ctx.restore();
  }

  /* ================= 粒子与飘字特效 ================= */

  function FX() { this.items = []; }

  FX.prototype.burst = function (x, y, opts) {
    opts = opts || {};
    var count = opts.count || 10;
    var colors = opts.colors || ['#ffd3e2', '#ff8fb5', '#ffc94d', '#b8e6ff'];
    var speed = opts.speed || 240;
    for (var i = 0; i < count; i++) {
      var a = Math.random() * TAU;
      var spd = speed * (0.4 + Math.random() * 0.6);
      this.items.push({
        kind: 'p', shape: opts.shape || 'star',
        x: x, y: y,
        vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 70,
        grav: opts.grav == null ? 420 : opts.grav,
        life: 0, dur: 0.55 + Math.random() * 0.35,
        size: (opts.size || 9) * (0.7 + Math.random() * 0.6),
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 8
      });
    }
  };

  FX.prototype.text = function (x, y, str, color, size) {
    this.items.push({
      kind: 't', x: x, y: y, vy: -78,
      life: 0, dur: 0.95, str: str,
      color: color || '#e2557e', size: size || 40
    });
  };

  FX.prototype.update = function (dt) {
    for (var i = this.items.length - 1; i >= 0; i--) {
      var it = this.items[i];
      it.life += dt;
      if (it.life >= it.dur) { this.items.splice(i, 1); continue; }
      if (it.kind === 'p') {
        it.vy += it.grav * dt;
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        it.rot += it.vr * dt;
      } else {
        it.y += it.vy * dt;
        it.vy *= (1 - 2.2 * dt);
      }
    }
  };

  FX.prototype.render = function (ctx) {
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      var k = it.life / it.dur;
      ctx.save();
      ctx.globalAlpha = 1 - k * k;
      if (it.kind === 'p') {
        ctx.fillStyle = it.color;
        var s = it.size * (1 - k * 0.5);
        if (it.shape === 'star') {
          drawStar(ctx, it.x, it.y, s, s * 0.45, it.rot);
        } else if (it.shape === 'heart') {
          drawHeart(ctx, it.x, it.y, s);
        } else {
          ctx.beginPath();
          ctx.arc(it.x, it.y, s * 0.6, 0, TAU);
        }
        ctx.fill();
      } else {
        var pop = 1 + 0.25 * Math.sin(Math.min(k * 3, 1) * Math.PI);
        ctx.translate(it.x, it.y);
        ctx.scale(pop, pop);
        ctx.font = 'bold ' + it.size + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeText(it.str, 0, 0);
        ctx.fillStyle = it.color;
        ctx.fillText(it.str, 0, 0);
      }
      ctx.restore();
    }
  };

  /* ================= 图像资产（阶段 2 精灵 + 视效材料 6 图） =================
   * 素材为 assets/ 下透明底立绘与环境底图；加载失败、或画布会被污染
   * （file:// 直开时 drawImage 本地图片 → toDataURL 抛 SecurityError，
   * "保存成果"功能失效）时自动退回 Canvas 简笔形象/渐变兜底，双击 index.html 一切功能照常。 */

  var SPIRIT_IMGS = {};

  function preloadSpirits() {
    var defs = [
      ['vanilla', 'assets/fairy_vanilla.png'],
      ['chocolat', 'assets/fairy_chocolat.png'],
      ['caramel', 'assets/fairy_caramel.png'],
      ['ichigo', 'assets/ichigo.png'],          // 主角天野草莓（视效材料 图3）
      ['bg_title', 'assets/bg_title.jpg'],      // 封面全家福（图1，TITLE 全屏）
      ['bg_kitchen', 'assets/bg_kitchen.jpg']   // 工坊环境底图（图2，全局背景）
    ];
    for (var i = 0; i < defs.length; i++) {
      (function (key, src) {
        var img = new Image();
        img.onload = function () {
          try {
            var probe = document.createElement('canvas');
            probe.width = probe.height = 2;
            var pc = probe.getContext('2d');
            pc.drawImage(img, 0, 0);
            pc.getImageData(0, 0, 1, 1);   // 画布被污染时在此抛 SecurityError
            SPIRIT_IMGS[key] = img;
          } catch (e) { /* file:// 等场景：弃用 PNG，保持简笔兜底 */ }
        };
        img.src = src;   // onerror 同样静默：兜底形象始终可用
      })(defs[i][0], defs[i][1]);
    }
  }

  /** 取已通过污染探测、可安全 drawImage 的图（未加载/不安全返回 null） */
  function getSpiritImage(key) { return SPIRIT_IMGS[key] || null; }

  /** 精灵实体：常驻 sin 浮动 + 机制触发的弹跳 / 说话 / 点头
   *  三个临时状态均为 >=0 计时，超时自动归位 -1。 */
  function Spirit(key, x, y, size) {
    this.key = key;            // 'vanilla' | 'chocolat' | 'caramel'
    this.x = x; this.y = y;    // 常驻锚点（虚拟坐标）
    this.size = size;          // 显示高度 px
    this.t = Math.random() * 10;
    this.bounceT = -1;         // 弹跳（放大回弹 0.55s，负值 = 延迟出发）
    this.talkT = -1;           // 说话（头顶气泡 2.2s）
    this.talkText = '';
    this.nodT = -1;            // 点头 + 发光（巧克力黄金区，1.2s）
  }

  Spirit.prototype.setPos = function (p) {
    this.x = p.x; this.y = p.y;
    if (p.size) this.size = p.size;
  };

  Spirit.prototype.bounce = function (delay) { this.bounceT = -(delay || 0); };
  Spirit.prototype.say = function (text) { this.talkT = 0; this.talkText = text; };
  Spirit.prototype.nod = function () { this.nodT = 0; };

  Spirit.prototype.update = function (dt) {
    this.t += dt;
    if (this.bounceT > -1) {   // -1 为归位值；延迟中的负值也要持续累加
      this.bounceT += dt;
      if (this.bounceT > 0.55) this.bounceT = -1;
    }
    if (this.talkT >= 0) {
      this.talkT += dt;
      if (this.talkT > 2.2) this.talkT = -1;
    }
    if (this.nodT >= 0) {
      this.nodT += dt;
      if (this.nodT > 1.2) this.nodT = -1;
    }
  };

  Spirit.prototype.render = function (ctx) {
    var bob = Math.sin(this.t * 1.7) * 7;   // 待机正弦漂浮
    var scale = 1, nod = 0;

    // 点头发光光环（巧克力：黄金火候点亮）
    if (this.nodT > 0) {
      var glow = 0.5 * Math.max(0, 1 - this.nodT / 1.2);
      ctx.save();
      ctx.globalAlpha = glow;
      for (var g = 3; g >= 1; g--) {
        ctx.beginPath();
        ctx.arc(this.x, this.y + bob, this.size * (0.55 + g * 0.1), 0, TAU);
        ctx.fillStyle = '#ffe6a1';
        ctx.fill();
      }
      ctx.restore();
      nod = Math.sin(this.nodT * 10) * 0.14;
    }
    if (this.bounceT > 0) {
      var k = Math.min(this.bounceT / 0.55, 1);
      scale = 1 + 0.38 * Math.sin(k * Math.PI);
    }

    ctx.save();
    ctx.translate(this.x, this.y + bob);
    ctx.rotate(nod);
    ctx.scale(scale, scale);
    var img = SPIRIT_IMGS[this.key];
    if (img) {
      var w = this.size * img.width / img.height;
      ctx.drawImage(img, -w / 2, -this.size / 2, w, this.size);
    } else {
      drawSpiritFace(ctx, this.key, this.size);
    }
    ctx.restore();

    // 头顶台词气泡（末端 0.3s 淡出；左右夹逼防出屏）
    // BUBBLE_ANCHOR 覆盖位：贴着力度条的精灵把气泡平移到空白区，避免遮挡力度条
    if (this.talkT >= 0) {
      ctx.save();
      ctx.globalAlpha = U.clamp((2.2 - this.talkT) / 0.3, 0, 1);
      var ba = C.SPIRIT.BUBBLE_ANCHOR && C.SPIRIT.BUBBLE_ANCHOR[this.key];
      var bx = ba ? ba.x : U.clamp(this.x, 190, 560);
      var by = ba ? ba.y + bob : this.y - this.size / 2 - 92 + bob;
      drawBubble(ctx, bx, by, this.talkText, 22);
      ctx.restore();
    }
  };

  /* ---- Canvas 简笔兜底形象（project.md 三.1 的极简抽象技巧） ---- */

  function faceCommon(ctx, r, skin) {
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,140,170,0.45)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.62, r * 0.38, r * 0.2, r * 0.13, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.62, r * 0.38, r * 0.2, r * 0.13, 0, 0, TAU);
    ctx.fill();
  }

  function drawSpiritFace(ctx, key, h) {
    var r = h * 0.22;
    ctx.save();
    ctx.lineCap = 'round';
    if (key === 'vanilla') {
      // 金色双马尾小球 + 白色高筒帽 + 红草莓徽章
      ctx.fillStyle = '#f7d358';
      ctx.beginPath(); ctx.arc(-r * 1.5, -r * 0.1, r * 0.62, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 1.5, -r * 0.1, r * 0.62, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fffdf9';
      roundRect(ctx, -r * 0.72, -r * 2.35, r * 1.44, r * 1.1, r * 0.3);
      ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, -r * 2.3, r * 0.72, r * 0.34, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e60039';
      ctx.beginPath(); ctx.arc(0, -r * 1.95, r * 0.16, 0, TAU); ctx.fill();
      faceCommon(ctx, r, '#ffe4d4');
      // 元气眯眼 + 张嘴笑
      ctx.strokeStyle = '#5c4033'; ctx.lineWidth = r * 0.09;
      ctx.beginPath(); ctx.arc(-r * 0.38, -r * 0.05, r * 0.2, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(r * 0.38, -r * 0.05, r * 0.2, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, r * 0.32, r * 0.22, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    } else if (key === 'chocolat') {
      // 深棕双钻头卷（下宽三角）
      ctx.fillStyle = '#3e2723';
      ctx.beginPath();
      ctx.moveTo(-r * 1.05, -r * 0.7); ctx.lineTo(-r * 2.0, r * 1.5); ctx.lineTo(-r * 0.8, r * 1.2);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r * 1.05, -r * 0.7); ctx.lineTo(r * 2.0, r * 1.5); ctx.lineTo(r * 0.8, r * 1.2);
      ctx.closePath(); ctx.fill();
      // 深棕刘海 + 白帽
      ctx.beginPath(); ctx.arc(0, -r * 0.42, r, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
      ctx.fillStyle = '#fffdf9';
      roundRect(ctx, -r * 0.66, -r * 2.25, r * 1.32, r * 1.0, r * 0.28);
      ctx.fill();
      faceCommon(ctx, r, '#f4dcc4');
      // 傲娇吊眼 + 下撇扁嘴
      ctx.strokeStyle = '#5c2e1e'; ctx.lineWidth = r * 0.09;
      ctx.beginPath(); ctx.moveTo(-r * 0.55, -r * 0.12); ctx.lineTo(-r * 0.2, -r * 0.02); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.55, -r * 0.12); ctx.lineTo(r * 0.2, -r * 0.02); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.18, r * 0.42); ctx.lineTo(r * 0.18, r * 0.42); ctx.stroke();
    } else {
      // caramel：波波头 + 内卷发尾 + 呆毛 + 焦糖蝴蝶结
      ctx.strokeStyle = '#c68642'; ctx.lineWidth = r * 0.12;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.25); ctx.quadraticCurveTo(r * 0.55, -r * 1.85, r * 0.15, -r * 2.25);
      ctx.stroke();
      ctx.fillStyle = '#c68642';
      ctx.beginPath(); ctx.arc(0, -r * 0.35, r * 1.12, Math.PI, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(-r * 1.02, r * 0.3, r * 0.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 1.02, r * 0.3, r * 0.4, 0, TAU); ctx.fill();
      faceCommon(ctx, r, '#ffe9cf');
      // 八字下垂眼（水绿瞳 + 高光）+ 小圆嘴
      ctx.fillStyle = '#4a8f88';
      ctx.beginPath(); ctx.ellipse(-r * 0.38, -r * 0.05, r * 0.13, r * 0.22, 0.15, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(r * 0.38, -r * 0.05, r * 0.13, r * 0.22, -0.15, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-r * 0.42, -r * 0.13, r * 0.05, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.34, -r * 0.13, r * 0.05, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#b57a52'; ctx.lineWidth = r * 0.08;
      ctx.beginPath(); ctx.arc(0, r * 0.35, r * 0.14, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      // 领口焦糖大蝴蝶结（右下角示意）
      ctx.fillStyle = '#8d5524';
      ctx.beginPath();
      ctx.moveTo(r * 0.55, r * 0.9); ctx.lineTo(r * 1.05, r * 0.62); ctx.lineTo(r * 1.05, r * 1.18);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r * 0.55, r * 0.9); ctx.lineTo(r * 0.05, r * 0.62); ctx.lineTo(r * 0.05, r * 1.18);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d49b5b';
      ctx.beginPath(); ctx.arc(r * 0.55, r * 0.9, r * 0.14, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /* ================= 导出 ================= */

  global.Entities = {
    roundRect: roundRect,
    drawStar: drawStar,
    drawHeart: drawHeart,
    drawBubble: drawBubble,
    drawStrawberry: drawStrawberry,
    drawMacaron: drawMacaron,
    ChargeBar: ChargeBar,
    Turntable: Turntable,
    Cake: Cake,
    Fruit: Fruit,
    Guest: Guest,
    FX: FX,
    Spirit: Spirit,
    preloadSpirits: preloadSpirits,
    getSpiritImage: getSpiritImage
  };

})(window);
