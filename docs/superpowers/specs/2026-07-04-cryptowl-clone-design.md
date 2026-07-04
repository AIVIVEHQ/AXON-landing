# CryptOwl 官网 1:1 复刻模板 — 实施计划

## Context

为土豆系加密项目储备一个高端落地页模板：1:1 复刻 https://cryptowl.io 的视觉与滚动动效（暗黑线框 + GSAP 滚动叙事「时光隧道」），但代码全部自己重写为干净的纯静态 HTML/CSS/JS。文案与品牌先保留原站内容作占位，以后按项目换皮（换皮点集中）。

已确认的决定：
- **路线 A 参考重写**：读原站编译产物提取精确动画参数，代码自写（不搬运压缩代码）
- **纯静态无构建**：HTML + CSS + 原生 ES modules + GSAP CDN，可直接托管 Vercel/GitHub Pages
- **全部 8 个场景**一次做完；**响应式照抄**原站（移动优先，断点 42/48/64/75/120/160rem）
- **新独立目录** `~/Desktop/土豆/cryptowl-template`，独立 git 仓库

## 参考资料（实施时先就位）

- 原站 37 个编译产物已下载于本会话 scratchpad：`/private/tmp/claude-501/-Users-ericc-Desktop----ILITY/212d1d2c-9b88-421b-816b-eb38fcbe02d2/scratchpad/cryptowl-assets/`
  （scratchpad 是会话级的，实施第 0 步就把它拷进仓库 `reference/` 目录并 gitignore；若已丢失，按 `https://cryptowl.io/_astro/<文件名>` 重新下载，文件清单见 `index.astro_astro_type_script_index_0_lang.D_pSJ7E7.js` 开头的 `__vite__mapDeps`）
- 关键参考文件：`rewind-transition`（穿门转场）、`timeReplay`（时间回放）、`strategyFocalLight` / `focalLightCanvas`（光晕 canvas）、`controlScene`、`analyticsScene`、`sceneBridge` 及各 `*Bridge`（场景衔接）、`sceneReveal`（通用入场）、`ScrollSmoother`、`motionPreference`、`device-quality`
- 活站对照：https://cryptowl.io （注意：它用 ScrollSmoother，JS 直接 scrollTo 会被平滑层拉回，真实对照请用滚轮/键盘）

## 技术栈

- GSAP 3.13+（CDN）：核心 + ScrollTrigger + ScrollSmoother + SplitText（2025 年起全部免费）
- 2 个 canvas 自写模块：K线渲染引擎、焦点光晕
- 字体：原站 Gilroy（display 300/900）、Biotif（body 400/700）、IBM Plex Mono 均为商业字体（Plex Mono 除外，它是开源的）。模板用免费替代：**Poppins**（display）+ **Inter**（body）+ **IBM Plex Mono**（mono），`@font-face` 集中在 `css/tokens.css`，以后买了授权换 woff2 即可

## 设计 Tokens（从原站 CSS 提取，写入 css/tokens.css）

```css
--color-base: #07090d;        /* 页面底色 */
--color-base-deep: #03060b;
--color-contrast: #f8fdff;    /* 主文字 */
--color-accent: #7ce6ff;      /* 青色强调 */
--color-accent-muted: #96cdde;
--color-visual-accent: #2eafff;        /* 线框/图形蓝 */
--color-visual-accent-strong: #1c83d8;
--color-visual-accent-soft: #bdf7ff;
--color-market-long: #7ee2f4;  /* K线阳线（青） */
--color-market-short: #4179de; /* K线阴线（蓝） */
--color-status-positive: #7ed6a3;  /* PnL 绿 */
--color-status-negative: #e87684;
--color-surface: #0c121b;
--radius-pill 按钮胶囊、玻璃面板 rgb(base/.5) 等见原站 BaseDocument.css
```

## 文件布局

```
cryptowl-template/
├── index.html              # 8 个 <section> 语义骨架 + header + footer
├── css/
│   ├── tokens.css          # 设计变量 + @font-face（换皮点①）
│   ├── base.css            # reset、排版、按钮、eyebrow、玻璃面板
│   ├── header.css
│   └── scenes/             # 每场景一个文件（hero.css、question.css、strategy.css、
│                           #   time-replay.css、control.css、analytics.css、
│                           #   product-entry.css、exit.css）
├── js/
│   ├── main.js             # 入口：注册插件、ScrollSmoother、按序初始化各场景
│   ├── config.js           # 品牌名/链接/文案常量（换皮点②）
│   ├── lib/
│   │   ├── candles.js      # canvas K线引擎：种子伪随机 OHLC、生长动画、时间窗口裁剪、DPR 自适应
│   │   ├── focal-light.js  # 径向光晕 canvas（hero 穿门 + strategy 轨道）
│   │   └── reveal.js       # SplitText 逐字/逐词 reveal、eyebrow 打字、通用 sceneReveal 封装
│   └── scenes/             # 每场景一个模块 + bridges.js（场景间转场衔接）
├── assets/logo.svg          # 占位 logo（换皮点③）
├── fonts/*.woff2
├── reference/               # 原站产物（gitignored，仅本地参考）
└── docs/superpowers/specs/2026-07-04-cryptowl-clone-design.md
```

## 8 场景动效规格

页面总滚动高度约 10400px（835px 视口下），结构：hero(835, pin) → question(pin ~835) → strategy(835 可视, pin 滚动 ~2964) → time-replay(835 可视, pin 滚动 ~1962) → control(835) → analytics(1050) → product-entry(1265) → exit(512)。

1. **Hero `#hero`** — 载入 boot 时间线（非滚动驱动）：黑场 → 中央一道竖光缝 → 线框拱门在透视空间自我绘制（SVG stroke-dashoffset draw）+ 地面网格 → 标题 SplitText 逐字浮现（"Strategy Through" 细体灰 + "Time" 特大 900 白）→ 两侧 canvas K线从中间向外「生长」→ 右侧价格轴 60K–74K 淡入 → tagline "Build now · Rewind history · Watch it live" 逐词 → "View product" 胶囊 CTA → 底部 "PAST ‹‹ REWIND ›› NOW" 时间轴。滚动离开 = 穿门转场：拱门 perspective 放大越过相机、中央焦点光晕增强、hero 元素淡出（参考 rewind-transition.js）。
2. **Gate question `#question`**（pin）— 黑场 + 焦点光晕，两行先后 reveal："Before live, every strategy faces one question." → "What would your strategy have done?"
3. **Strategy `#strategy`**（pin + scrub ~3000px）— 分屏：左侧 eyebrow "LOGIC BEFORE PROOF"（mono、字距大）+ 大标题 "Build the logic."（自下而上逐行 reveal）+ 副文案；中央轨道图（两圈同心圆 + 光点沿轨道运行，canvas）；左右各 4 张玻璃表单卡随 scrub 依次 stagger 入场：Market context/Timing/Capital/Exit targets ‖ Engine mode/Direction/Entry conditions/Decision logic。
4. **Time replay `#time-replay`**（pin + scrub ~2000px，招牌场景）— 大标题逐词随滚动 reveal "Run it through history."；全宽 canvas K线图；一个日期窗口选区（两个白色端点 + 高亮带）随 scrub 沿时间轴滑动（Jan 2–16 → … → Dec 8–22），底部 stats 行（Net PnL / ROI / Win rate / Trades）数字随窗口滚动更新（绿色 mono）；末段过渡为 "Or watch it live."，stats 切换为 Open PnL / ROI / Active Strategy（timeReplayRangeTransition + timeReplayToControlBridge 参考）。
5. **Control `#control`** — 分屏：eyebrow "CAMPAIGN-LEVEL CONTROL" + "Control above action." + 副文案；右侧玻璃面板内 5 张状态卡竖排时间线（All strategies live / Fast drop detected / Fast rally detected / Manual campaign pause / Pause window ended），滚动内高亮项轮转（当前卡亮、其余暗），左列脉冲圆点 + 卡右侧动态点阵。
6. **Analytics `#analytics`** — 居中 eyebrow "PERFORMANCE ROLLUP"；节点汇总图：上排 5 个 Strategies 小节点，下排 3 个 Campaigns 大节点，SVG 贝塞尔曲线连接、入场时 stroke-draw + 节点 pop（stagger）。
7. **Product entry `#product-entry`** — eyebrow "PRODUCT PROOF" + "The workspace behind the motion." + 副文案 + 5 个能力标签（Build strategy / Run history / Watch live / Read analytics / Control campaign）+ View product / Contact team CTA，向下滚动进入视口时 sceneReveal 入场。
8. **Exit `#exit`** — eyebrow "READY TO START" + "Start with a strategy you can inspect." + 副文案 + 2 CTA（Try with virtual balance / Contact team）+ footer（© 2026 占位品牌 · Home/Product/Contact）。

## 全局动效系统

- **ScrollSmoother** 包裹 `#smooth-wrapper > #smooth-content`，smooth≈1；所有 ScrollTrigger 挂其上
- **场景桥 bridges.js**：相邻场景转场重叠（前场景淡出/位移未完成时后场景已开始入场），对照原站 `*Bridge` 模块
- **reveal.js**：SplitText 封装（chars/words/lines 三种粒度 + 常用 ease/stagger 预设，从原站产物提取具体数值）
- **K线数据**：种子伪随机 OHLC 生成器（固定 seed 保证每次加载一致，区间 60K–74K，含趋势段与回调段，风格对照原站）
- **降级**：`matchMedia('(prefers-reduced-motion: reduce)')` 时跳过 pin/scrub，场景静态平铺直接可读（原站 motionPreference 思路）；触屏减短 pin 距离
- **性能**：canvas DPR 上限 2、离屏停画（IntersectionObserver）、resize 用 ScrollTrigger.refresh 协调

## 实施步骤

0. **仓库就位**：mkdir + git init；拷贝 scratchpad 参考产物到 `reference/`（写 .gitignore）；将本设计整理为 `docs/superpowers/specs/2026-07-04-cryptowl-clone-design.md` 首次 commit
1. **骨架**：index.html 8 sections + tokens/base/header CSS + 字体接入 + GSAP CDN + ScrollSmoother 跑通（能平滑滚完 8 个空场景）
2. **两个 canvas 引擎**：lib/candles.js（静态渲染→生长动画→窗口裁剪）、lib/focal-light.js
3. **Hero**：boot 时间线 + 拱门 SVG + 两侧K线 + 穿门转场（第一个验收里程碑，要求与原站并排逐帧接近）
4. **Question + Strategy**：gate 文案 reveal；分屏卡片 scrub stagger + 轨道光点
5. **Time replay**（核心）：逐词标题 + 窗口滑动 + stats 联动 + "Or watch it live." 切换
6. **Control + Analytics**：状态卡轮转；节点图 stroke-draw
7. **Product entry + Exit**：sceneReveal 入场 + footer
8. **响应式 + 降级 + 打磨**：按原站断点走查 375/768/1024/1456/1920；reduced-motion；最终逐场景对照修参数

每步完成即本地起服务用 Chrome 对照原站同位置滚动截图（见验证）。

## 验证

- `python3 -m http.server` 起本地站，Chrome MCP 打开双 tab（本地 + cryptowl.io）
- 在 12 个滚动检查点（hero boot 完成、穿门中、question、strategy 三阶段、time-replay 三阶段、control、analytics、exit）分别截图并排对比
- 375px 宽（iPhone）走查全页；滚轮/键盘/锚点均可达底
- DevTools 模拟 prefers-reduced-motion 检查降级
- Lighthouse 性能抽查（canvas 页面帧率、CLS）

## 风险与注意

- **版权**：设计/动效为参考重写（代码自有）；但原站英文文案与 CryptOwl 名称仅作模板占位，任何项目对外上线前必须替换文案、品牌名、logo。fonts 用免费替代而非搬运原站 woff2
- **字体非像素级一致**（Gilroy/Biotif 为商业字体），如需完全一致需购买授权后替换 woff2（换皮点①已预留）
- ScrollSmoother 在 iOS/触屏的表现与桌面有差异——原站亦然，以原站行为为对齐基准
