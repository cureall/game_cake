本文件随时更新，如果不是特别指定则不用看

# 需求指令：在 Step 4/4 结算展示页实现 3D 蛋糕旋转展台

## 一、 背景与约束（红线不可逾越）
1. **禁止引入构建工具**：保持项目当前的无 npm / 无构建流程纯静态架构。
2. **轻量引入依赖**：仅允许在 `index.html` 中通过 CDN `<script>` 标签单文件引入 Three.js（推荐 `https://lf26-cdn-tos.bytecdntp.com/cdn/expire-1-M/three.js/r128/three.min.js`），严禁使用 npm install。
3. **保持端兼容**：严格限制在现有 `750x1334` 居中视口容器内，不得破坏现有的 PC 居中 Letterboxing 与手机全屏触摸逻辑。
4. **状态隔离**：Step 1~3 的核心玩法代码严禁破坏，仅在进入 Step 4（展示结算阶段）时激活 3D 渲染，离开 Step 4 时必须彻底释放 WebGL 资源。

---

## 二、 核心任务拆解

### 任务 1：定义 `cakeData` 数据契约
请在 Step 1~3 结束时，将玩家制作的蛋糕参数整理为一个标准数据对象并传递给 Step 4：
```javascript
const cakeData = {
  flavor: 'strawberry', // 'strawberry' | 'chocolate' | 'matcha'
  heightRatio: 1.0,     // 0.6 ~ 1.4（由 Step 1 蓄力时长决定）
  creamType: 'vanilla', // 奶油颜色/类型
  creams: [             // Step 2 记录的奶油花角度分布
    { angle: 0 }, { angle: Math.PI / 4 }, ...
  ],
  toppings: [           // Step 3 投放的水果/装饰相对坐标
    { type: 'strawberry', x: 0, z: 0 },
    { type: 'macaron', x: 30, z: -20 }
  ]
};
```

### 任务 2：新建独立模块 `js/cake3d.js`
封装一个轻量级的 3D 蛋糕渲染控制器 `Cake3DViewer`：
1. **容器挂载**：在现有的游戏容器内创建独立 `<canvas id="cake3d-canvas">`，绝对定位覆盖，层级设为展示面板背景层（位于背景图之上、UI 文字/评分弹窗之下），确保不遮挡结算文字与按钮。
2. **动漫赛璐珞画风（Toon Shader）**：
   - 材质全部使用 `THREE.MeshToonMaterial`。
   - 配置高饱和度、柔和的马卡龙色系（草莓粉 `#FFB7C5`、奶油白 `#FFFDF8`、巧克力棕 `#5C3A21`、抹茶绿 `#9CAF88`）。
   - 灯光配置：1 个强环境光（AmbientLight，强度 0.8，色调温暖）+ 1 个 45 度侧上方聚光/平行光（DirectionalLight，强度 0.6）。
3. **程序化拼装 3D 模型**（放入同一个 `cakeGroup`）：
   - **底盘**：带金边的白瓷圆盘（扁平圆柱）。
   - **蛋糕胚**：圆柱体（`CylinderGeometry`），半径约 80，高度按 `heightRatio` 伸缩。
   - **装裱奶油花**：根据 `cakeData.creams` 的角度，在蛋糕胚顶部边缘生成一圈紧密贴合的半球或小泡芙（`SphereGeometry` 压扁）。
   - **顶料**：将草莓（红色圆锥+绿色五角叶片）或马卡龙（双层扁圆球）放置在顶面。
4. **交互与动效**：
   - **自动巡航**：蛋糕托盘以微小角速度持续自转（`cakeGroup.rotation.y += 0.008`）。
   - **单指/鼠标旋转**：通过 `pointerdown` / `pointermove` 监听 X 轴位移差，允许玩家水平拖拽自由旋转 360° 细细欣赏。
   - **入场动画**：蛋糕生成瞬间带有一个弹性下落动画（从 y+50 弹跳落到底盘上）。
5. **资源释放（Dispose）**：
   - 提供 `destroy()` 方法，停止 `requestAnimationFrame`，遍历清理场景中所有 mesh 的 `geometry` 和 `material`，移除 dom 节点，防止手机内存泄漏。

### 任务 3：主流程接入（FSM 状态机）
1. 在状态机进入 `STATE_EVALUATION`（Step 4）时：
   - 实例化 `Cake3DViewer` 并传入本次制作的 `cakeData`。
   - 触发 3D 渲染与文字评语弹窗。
2. 玩家点击“再来一个”或“下一关”退出 Step 4 时：
   - 显式调用 `Cake3DViewer.destroy()`。
   - 切回 Step 1。

---

## 三、 验收标准（Checklist）
1. [ ] **依赖干净**：只在 `index.html` 引入了一行 Three.js CDN，没有引入额外 npm 包或外部 3D 模型文件（全程序化生成，极速加载）。
2. [ ] **多端触控**：在 PC 端用鼠标拖拽可以平滑旋转蛋糕；在手机触摸屏上滑动可以自由旋转，且不会触发页面下拉刷新。
3. [ ] **视觉匹配**：蛋糕呈现日系二次元卡通质感，色彩明亮甜美，阴影干净利落，符合《梦色蛋糕师》的氛围。
4. [ ] **无内存泄漏**：连续打完 5 关，多次进出 Step 4，帧率稳定在 60fps，控制台无 WebGL context lost 警告。