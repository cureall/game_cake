/**
 * entities.js —— 游戏实体对象
 * 蓄力条 / 节拍器 / 旋转托盘 / 蛋糕 / 水果 / 客人 / 粒子特效
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

  function ChargeBar(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
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

    // 黄金释放区间（阶段 2 巧克力辅助线的基础）
    var gy = y + h * (1 - C.CHARGE.GOLDEN_MAX);
    var gh = h * (C.CHARGE.GOLDEN_MAX - C.CHARGE.GOLDEN_MIN);
    ctx.fillStyle = 'rgba(255, 214, 120, 0.55)';
    ctx.fillRect(x + 3, gy, w - 6, gh);

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

  /* ================= 节拍驱动器 Metronome ================= */

  function Metronome() {
    this.interval = 60 / C.BEAT.BPM;
    this.t = 0;
    this.rate = 1;   // 阶段 2 牛奶糖缓速：节拍时间流速（1 正常 / 0.6 缓速），由主循环每帧写入
  }

  Metronome.prototype.reset = function () { this.t = 0; };
  Metronome.prototype.update = function (dt) { this.t += dt * this.rate; };
  Metronome.prototype.beatPhase = function () { return this.t / this.interval; };
  Metronome.prototype.nearestIndex = function () { return Math.round(this.beatPhase()); };
  /** 距最近拍点的时间差（秒） */
  Metronome.prototype.distToNearest = function () {
    return Math.abs(this.t - this.nearestIndex() * this.interval);
  };
  /** 拍点脉冲强度 1→0，用于按钮/标记的节拍脉动 */
  Metronome.prototype.pulse = function () {
    var p = this.beatPhase() % 1;
    return Math.max(0, 1 - Math.min(p, 1 - p) * 8);
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

  /** 与 Metronome 同步：每拍转过 360°/每圈花数 → 花必然均匀分布 */
  Turntable.prototype.syncToBeat = function () {
    this.target = TAU / (C.BEAT.FLOWERS_PER_CIRCLE * (60 / C.BEAT.BPM));
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
    this.flowers = [];  // { a: 转盘局部角, tier }
    this.fruits = [];   // { a, r, type } 转盘局部极坐标
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

    // 胚体
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

    // 奶油花环
    for (var i = 0; i < this.flowers.length; i++) {
      var f = this.flowers[i];
      var fx = Math.cos(f.a) * (R * 0.84);
      var fy = Math.sin(f.a) * (R * 0.84);
      drawCreamFlower(ctx, fx, fy, f.tier, this.palette.accent);
    }

    // 水果
    for (var j = 0; j < this.fruits.length; j++) {
      var fr = this.fruits[j];
      var x = Math.cos(fr.a) * fr.r;
      var y = Math.sin(fr.a) * fr.r;
      if (fr.type === 'strawberry') drawStrawberry(ctx, x, y, 1.15);
      else drawMacaron(ctx, x, y, 1.15, this.palette);
    }
  };

  /** 奶油花：六瓣圆花瓣 + 分级花心 */
  function drawCreamFlower(ctx, x, y, tier, accent) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(230, 180, 200, 0.5)';
    ctx.lineWidth = 2;
    for (var i = 0; i < 6; i++) {
      var a = i * TAU / 6;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 11, y + Math.sin(a) * 11, 10, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, TAU);
    ctx.fill();
    // 判定分级花心：Perfect 金星 / Good 粉心 / Cute 灰粉心
    ctx.fillStyle = (tier === 'perfect') ? '#ffc94d' : (tier === 'good' ? accent : '#d8a8bd');
    if (tier === 'perfect') {
      drawStar(ctx, x, y, 9, 4, 0);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, TAU);
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

  /* ================= 导出 ================= */

  global.Entities = {
    roundRect: roundRect,
    drawStar: drawStar,
    drawHeart: drawHeart,
    drawBubble: drawBubble,
    drawStrawberry: drawStrawberry,
    drawMacaron: drawMacaron,
    ChargeBar: ChargeBar,
    Metronome: Metronome,
    Turntable: Turntable,
    Cake: Cake,
    Fruit: Fruit,
    Guest: Guest,
    FX: FX
  };

})(window);
