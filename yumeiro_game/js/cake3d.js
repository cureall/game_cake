/**
 * cake3d.js —— Step 4 结算展示：3D 蛋糕旋转展台（Cake3DViewer）
 *
 * 依赖：index.html 中的 Three.js r128 CDN 单文件（无 npm / 无构建流程）。
 * 生命周期：new Cake3DViewer(container, cakeData) → destroy()（彻底释放 WebGL 资源）。
 *
 * cakeData 契约（由 main.js 在 Step 1~3 结束时组装）：
 *   { flavor: 'strawberry'|'chocolate'|'matcha',
 *     heightRatio: 0.6~1.4,
 *     creamType: 'vanilla',
 *     creams:   [{ angle, tier }],
 *     toppings: [{ type: 'strawberry'|'macaron', x, z }] }
 *
 * 画风：日系赛璐珞（MeshToonMaterial + 程序化三阶梯度图，全程序化建模，无外部素材）。
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  /* ================= 马卡龙色板（高饱和、柔和） ================= */

  var COLORS = {
    strawberry: 0xffb7c5,   // 草莓粉
    chocolate: 0x5c3a21,    // 巧克力棕
    matcha: 0x9caf88,       // 抹茶绿
    cream: 0xfffdf8,        // 奶油白
    plate: 0xffffff,        // 白瓷
    gold: 0xe8b84b,         // 金边
    berry: 0xff4d6d,        // 草莓红
    leaf: 0x59b95e,         // 叶绿
    macaronTop: 0xf7c8dd,   // 马卡龙粉壳
    macaronFill: 0xfff6fa   // 马卡龙夹心
  };

  /* ================= 世界尺寸常量 ================= */

  var GEO = {
    plateR: 100, plateH: 12,    // 白瓷底盘
    bodyR: 74,                  // 蛋糕胚半径
    capR: 80, capH: 14,         // 奶油顶盖
    dollopR: 19,                // 奶油花球半径
    dropFrom: 130               // 入场下落起始高度
  };

  /* 展示安全框（虚拟 750x1334 屏坐标）：3D 蛋糕投影必须整体落在框内。
   * 框上沿避开顶部标题(y48)与“保存成果”按钮(底 y198)，下沿避开星星(y730)/称号(y812)/明细(y866+)。
   * 取景按包围球自适应（球对旋转不变 → 自转/拖拽任意角度永不超框），
   * 未来大蛋糕/超高/超胖蛋糕都会被等比缩到框内显示。 */
  var FRAME = { cx: 375, cy: 432, halfW: 310, halfH: 228, pad: 0.92 };

  /* ================= 工具 ================= */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /** 弹跳落地缓动（蛋糕入场） */
  function easeOutBounce(t) {
    var n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }

  /* ================= Cake3DViewer ================= */

  function Cake3DViewer(container, cakeData) {
    if (!global.THREE) throw new Error('THREE.js 未加载（CDN 失败？）');
    if (!container) throw new Error('缺少挂载容器');

    this.data = cakeData || {};
    this.container = container;
    this.disposed = false;
    this._mats = [];          // 登记所有材质，便于统一 dispose

    /* 交互与动效状态 */
    this.spin = 0;            // 展台自转角（rad）
    this.autoSpeed = 0.48;    // 自转角速度 rad/s（≈0.008/帧 @60fps）
    this.dragId = null;       // 当前拖拽指针 id
    this.dragMoved = false;
    this.lastX = 0;
    this.downX = 0;
    this.entryT = -0.12;      // 入场动画计时（先悬停一瞬再落下）
    this._last = performance.now();
    this._rafId = 0;

    this._buildDom();
    this._buildScene();
    this._bindEvents();

    var self = this;
    (function loop(now) {
      if (self.disposed) return;
      var dt = Math.min((now - self._last) / 1000, 0.05);
      self._last = now;
      self._tick(dt);
      self._rafId = requestAnimationFrame(loop);
    })(this._last);
  }

  /* ---------------- DOM：透明覆盖画布（点击穿透） ----------------
   * 3D 画布铺满整个 750x1334 游戏区（与 2D 主画布对齐），
   * pointer-events:none → 结算文字/按钮的点击仍由 2D 画布接管；
   * 拖拽旋转事件监听挂在 container（事件从 2D 画布冒泡而来）。 */

  Cake3DViewer.prototype._buildDom = function () {
    var prev = this.container.style.position;
    this._prevContainerPos = prev;
    if (!prev || prev === 'static') this.container.style.position = 'relative';

    var gameCanvas = document.getElementById('game-canvas');
    this.gameCanvas = gameCanvas;

    var cv = document.createElement('canvas');
    cv.id = 'cake3d-canvas';
    var s = cv.style;
    s.position = 'absolute';
    s.left = '0';
    s.top = '0';
    s.pointerEvents = 'none';
    s.touchAction = 'none';
    s.zIndex = '5';
    this.container.appendChild(cv);
    this.canvas = cv;
  };

  /** 与 2D 主画布像素级对齐（Letterboxing / 旋转屏均实时跟随） */
  Cake3DViewer.prototype._syncRect = function () {
    if (this.disposed) return;
    var cr = this.gameCanvas.getBoundingClientRect();
    var kr = this.container.getBoundingClientRect();
    var s = this.canvas.style;
    s.left = (cr.left - kr.left) + 'px';
    s.top = (cr.top - kr.top) + 'px';
    s.width = cr.width + 'px';
    s.height = cr.height + 'px';
    if (cr.width < 2 || cr.height < 2) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(cr.width, cr.height, false);
    this.camera.aspect = cr.width / cr.height;
    this.camera.updateProjectionMatrix();
    this._fitCamera();   // 画布比例变化后重新取景（依赖 aspect）
  };

  /** 自适应取景：按包围球 + 展示安全框计算相机位置与对准点。
   *  垂直/水平两个方向分别求“包围球恰好入框”的最小距离取大者，
   *  再把视线中心对到蛋糕中心下方 → 蛋糕投影中心恰好落在 FRAME.cy（整体上移）。 */
  Cake3DViewer.prototype._fitCamera = function () {
    if (this.disposed || !this._sphere) return;
    var s = this._sphere, cam = this.camera;
    var tanHalf = Math.tan(cam.fov * Math.PI / 360);
    // 屏幕基准：可视半高(世界) = D·tanHalf ↔ 667px；可视半宽 = D·tanHalf·aspect ↔ 375px
    var dV = s.r * 667 / (tanHalf * FRAME.halfH * FRAME.pad);
    var dH = s.r * 375 / (tanHalf * cam.aspect * FRAME.halfW * FRAME.pad);
    var dist = Math.max(500, Math.min(Math.max(dV, dH), 4000));
    var el = 33 * Math.PI / 180;                                   // 33° 仰角环绕
    var drop = dist * tanHalf * (667 - FRAME.cy) / 667;            // 画面上移量的世界补偿
    cam.position.set(s.x, s.y + dist * Math.sin(el), s.z + dist * Math.cos(el));
    cam.lookAt(s.x, s.y - drop, s.z);
    cam.updateProjectionMatrix();
  };

  /* ---------------- 场景与灯光 ---------------- */

  Cake3DViewer.prototype._buildScene = function () {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);          // 透明底：透出 2D 粉色背景
    this.renderer.outputEncoding = THREE.sRGBEncoding; // 明亮甜美的马卡龙发色
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 750 / 1334, 10, 5000);
    // 相机取景由 _fitCamera() 按包围球 + FRAME 自适应完成（见 _syncRect 尾部）

    /* 赛璐珞三阶梯度图：程序化 DataTexture，无外部文件 */
    var steps = new Uint8Array([120, 190, 255]);
    var fmt = this.renderer.capabilities.isWebGL2 ? THREE.RedFormat : THREE.LuminanceFormat;
    var grad = new THREE.DataTexture(steps, steps.length, 1, fmt);
    grad.minFilter = THREE.NearestFilter;
    grad.magFilter = THREE.NearestFilter;
    grad.needsUpdate = true;
    this.gradientMap = grad;

    /* 灯光：暖环境光 0.8 + 45° 侧上方向光 0.6（投影干净利落） */
    this.scene.add(new THREE.AmbientLight(0xfff2e2, 0.8));
    var dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(320, 480, 260);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -240;
    dir.shadow.camera.right = 240;
    dir.shadow.camera.top = 260;
    dir.shadow.camera.bottom = -160;
    dir.shadow.camera.near = 100;
    dir.shadow.camera.far = 1500;
    dir.shadow.bias = -0.0006;
    this.scene.add(dir);

    /* root：整体（含托盘）持续自转；cakeBody：蛋糕本体做入场下落 */
    this.root = new THREE.Group();
    this.cakeBody = new THREE.Group();
    this.root.add(this.cakeBody);
    this.scene.add(this.root);

    this._buildPlate();
    this._buildCake();

    /* 建模完成后测量包围球（含底盘）：球对任意旋转角不变，
     * 以此为基准自适应取景，保证自转/拖拽到任何角度投影都不出安全框 */
    var box = new THREE.Box3().setFromObject(this.root);
    var ctr = box.getCenter(new THREE.Vector3());
    this._sphere = {
      x: ctr.x, y: ctr.y, z: ctr.z,
      r: box.getSize(new THREE.Vector3()).length() / 2
    };

    this._syncRect();
  };

  /** 统一 Toon 材质工厂（登记以便销毁） */
  Cake3DViewer.prototype._mat = function (hex) {
    var m = new THREE.MeshToonMaterial({ color: hex, gradientMap: this.gradientMap });
    this._mats.push(m);
    return m;
  };

  /* ---------------- 程序化建模 ---------------- */

  /** 带金边的白瓷圆盘（扁平圆柱 + 金色环边） */
  Cake3DViewer.prototype._buildPlate = function () {
    var plate = new THREE.Mesh(
      new THREE.CylinderGeometry(GEO.plateR, GEO.plateR * 0.94, GEO.plateH, 48),
      this._mat(COLORS.plate)
    );
    plate.position.y = GEO.plateH / 2;
    plate.receiveShadow = true;
    this.root.add(plate);

    var rim = new THREE.Mesh(
      new THREE.TorusGeometry(GEO.plateR - 3, 3.2, 12, 64),
      this._mat(COLORS.gold)
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = GEO.plateH - 1;
    this.root.add(rim);
  };

  /** 蛋糕胚 + 奶油顶盖 + 奶油花环 + 顶料（全部挂到 cakeBody） */
  Cake3DViewer.prototype._buildCake = function () {
    var d = this.data;
    var hRatio = clamp(Number(d.heightRatio) || 1, 0.6, 1.4);
    var bodyH = 46 + 86 * hRatio;                       // 0.6→98，1.4→166
    var sponge = COLORS[d.flavor] || COLORS.strawberry;
    var y0 = GEO.plateH;                                // 胚体底面 = 盘面
    var topY = y0 + bodyH + GEO.capH;                   // 蛋糕顶面高度

    // 蛋糕胚
    var body = new THREE.Mesh(
      new THREE.CylinderGeometry(GEO.bodyR, GEO.bodyR, bodyH, 48),
      this._mat(sponge)
    );
    body.position.y = y0 + bodyH / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.cakeBody.add(body);

    // 奶油顶盖（略大于胚体，衔接垂滴感）
    var cap = new THREE.Mesh(
      new THREE.CylinderGeometry(GEO.capR, GEO.capR * 0.96, GEO.capH, 48),
      this._mat(COLORS.cream)
    );
    cap.position.y = y0 + bodyH + GEO.capH / 2;
    cap.castShadow = true;
    cap.receiveShadow = true;                            // 接住顶料投影
    this.cakeBody.add(cap);

    // 装裱奶油花：按 creams 角度沿顶部边缘一圈压扁半球（小泡芙）
    var creams = d.creams || [];
    for (var i = 0; i < creams.length; i++) {
      var a = creams[i].angle || 0;
      var dollop = new THREE.Mesh(
        new THREE.SphereGeometry(GEO.dollopR, 20, 14),
        this._mat(COLORS.cream)
      );
      dollop.scale.set(1, 0.62, 1);
      dollop.position.set(
        Math.cos(a) * (GEO.bodyR - 6),
        topY - GEO.dollopR * 0.62 - 2,
        Math.sin(a) * (GEO.bodyR - 6)
      );
      dollop.castShadow = true;
      this.cakeBody.add(dollop);
    }

    // 顶料：草莓（红圆锥 + 绿五角叶片）/ 马卡龙（双层扁圆球）
    var tops = d.toppings || [];
    for (var j = 0; j < tops.length; j++) {
      var t = tops[j] || {};
      var g = new THREE.Group();
      g.position.set(Number(t.x) || 0, topY - 2, Number(t.z) || 0);
      g.rotation.y = Math.random() * TAU;
      if (t.type === 'macaron') this._buildMacaron(g);
      else this._buildStrawberry(g);
      this.cakeBody.add(g);
    }
  };

  /** 草莓：红色圆锥 + 绿色五角叶片 */
  Cake3DViewer.prototype._buildStrawberry = function (g) {
    var fruit = new THREE.Mesh(
      new THREE.ConeGeometry(11, 26, 16),
      this._mat(COLORS.berry)
    );
    fruit.position.y = 13;
    fruit.castShadow = true;
    g.add(fruit);

    for (var i = 0; i < 5; i++) {
      var holder = new THREE.Group();
      holder.rotation.y = i * TAU / 5;
      var leaf = new THREE.Mesh(
        new THREE.ConeGeometry(4, 11, 6),
        this._mat(COLORS.leaf)
      );
      leaf.position.set(9, 2.5, 0);
      leaf.rotation.z = -1.25;   // 平展开向外
      leaf.scale.set(1, 1, 0.45);
      holder.add(leaf);
      g.add(holder);
    }
  };

  /** 马卡龙：双层扁圆球 + 白色夹心 */
  Cake3DViewer.prototype._buildMacaron = function (g) {
    var shellGeo = new THREE.SphereGeometry(12, 20, 14);
    var fillGeo = new THREE.CylinderGeometry(12.4, 12.4, 7, 20);

    var top = new THREE.Mesh(shellGeo, this._mat(COLORS.macaronTop));
    top.scale.set(1, 0.42, 1);
    top.position.y = 4.5;
    top.castShadow = true;
    g.add(top);

    var fill = new THREE.Mesh(fillGeo, this._mat(COLORS.macaronFill));
    g.add(fill);

    var bottom = new THREE.Mesh(shellGeo, this._mat(COLORS.macaronTop));
    bottom.scale.set(1, 0.42, 1);
    bottom.position.y = -4.5;
    bottom.castShadow = true;
    g.add(bottom);
  };

  /* ---------------- 交互：单指/鼠标水平拖拽旋转 ---------------- */

  Cake3DViewer.prototype._bindEvents = function () {
    var self = this;

    this._onDown = function (ev) {
      if (self.disposed || self.dragId !== null) return;   // 单指游戏，忽略多余手指
      self.dragId = ev.pointerId;
      self.lastX = ev.clientX;
      self.downX = ev.clientX;
      self.dragMoved = false;
    };
    this._onMove = function (ev) {
      if (self.disposed || ev.pointerId !== self.dragId) return;
      var dx = ev.clientX - self.lastX;
      self.lastX = ev.clientX;
      if (!self.dragMoved && Math.abs(ev.clientX - self.downX) > 6) self.dragMoved = true;
      if (self.dragMoved) self.spin += dx * 0.012;         // X 轴位移差 → 水平旋转 360°
    };
    this._onUp = function (ev) {
      if (ev.pointerId !== self.dragId) return;
      self.dragId = null;
      self.dragMoved = false;
    };
    this._onResize = function () { self._syncRect(); };

    this.container.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
  };

  /* ---------------- 帧循环 ---------------- */

  Cake3DViewer.prototype._tick = function (dt) {
    // 自动巡航：未拖拽时以微小角速度持续自转
    if (this.dragId === null) this.spin += this.autoSpeed * dt;
    this.root.rotation.y = this.spin % TAU;

    // 入场动画：从高处弹性下落到底盘上
    this.entryT += dt;
    var k = this.entryT / 0.78;
    if (k <= 0) this.cakeBody.position.y = GEO.dropFrom;
    else if (k >= 1) this.cakeBody.position.y = 0;
    else this.cakeBody.position.y = GEO.dropFrom * (1 - easeOutBounce(k));

    this.renderer.render(this.scene, this.camera);
  };

  /* ---------------- 资源彻底释放 ---------------- */

  Cake3DViewer.prototype.destroy = function () {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this._rafId);

    this.container.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);

    // 遍历清理所有 mesh 的 geometry / material / texture
    if (this.scene) {
      this.scene.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          var mats = Array.isArray(o.material) ? o.material : [o.material];
          for (var i = 0; i < mats.length; i++) {
            if (mats[i].map) mats[i].map.dispose();
            mats[i].dispose();
          }
        }
      });
    }
    if (this.gradientMap) this.gradientMap.dispose();
    this._mats.length = 0;

    // 释放 WebGL 上下文（防手机端多次进出 Step 4 内存泄漏）
    try {
      if (this.renderer) {
        this.renderer.dispose();
        if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
      }
    } catch (e) { /* 上下文已丢失时忽略 */ }
    this.renderer = null;
    this.scene = null;
    this.camera = null;

    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    if (this.container) this.container.style.position = this._prevContainerPos;
  };

  /* ================= 导出 ================= */

  global.Cake3DViewer = Cake3DViewer;

})(window);
