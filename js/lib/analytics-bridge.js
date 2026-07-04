// control → analytics 桥接，对照原站 controlToAnalyticsBridge 逐值移植。
// 三段滚动驱动：
//   1) 策略点 dot 从 control-field 飞入 analytics 节点图（fixed 图层 + 矩形插值）；
//   2) 接近 analytics-flow 时一次性准备几何（节点半径、曲线路径、初始隐藏态）；
//   3) rollup scrub：策略曲线 → campaign 环/核心 → campaign 曲线 → user 环/核心，
//      同时联动 zone label 与 8 项 metric 的分窗渐入。
import { BREAKPOINTS, matches } from '../config.js';
import {
  byDatasetOrder,
  clamp01,
  createFixedLayer,
  createSpans,
  easeOutCubic,
  interpolateRect,
  lerp,
  onPageHideRebind,
  progressBetween,
  squareRect,
} from './bridge-utils.js';

const CORE_RATIO = { campaign: 0.36, user: 0.34 };

const clampValue = (value, min, max) => Math.min(Math.max(value, min), max);
const round2 = (value) => Math.round(value * 100) / 100;
const remSize = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/** clamp(vw 值, minRem, maxRem)，与 CSS clamp() 对齐。 */
const clampVw = (minRem, vw, maxRem) => {
  const rem = remSize();
  const size = window.innerWidth * (vw / 100);
  return clampValue(size, minRem * rem, maxRem * rem);
};

const nodeSize = (kind) => {
  const wide = matches(BREAKPOINTS.wideScene);
  if (kind === 'user') return wide ? clampVw(5, 3.45, 6.85) : clampVw(4, 8.2, 5.6);
  return wide ? clampVw(2.45, 1.8, 3.45) : clampVw(2, 4.1, 3);
};

const radiusSignature = (kind, scaleX, scaleY) => {
  const radius = nodeSize(kind) / 2;
  return [round2(radius / scaleX), round2(radius / scaleY)].join(',');
};

const geometrySignature = (svg) => {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  if (!rect.width || !rect.height || !viewBox.width || !viewBox.height) return 'empty';
  const scaleX = rect.width / viewBox.width;
  const scaleY = rect.height / viewBox.height;
  return [
    round2(rect.width),
    round2(rect.height),
    round2(viewBox.x),
    round2(viewBox.y),
    round2(viewBox.width),
    round2(viewBox.height),
    radiusSignature('campaign', scaleX, scaleY),
    radiusSignature('user', scaleX, scaleY),
  ].join(':');
};

const readNumber = (element, name) => {
  const value = Number.parseFloat(element.getAttribute(`data-${name}`) ?? '');
  return Number.isFinite(value) ? value : 0;
};

const readPoint = (element, name) => {
  const [x = 0, y = 0] = (element.getAttribute(`data-${name}`) ?? '')
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part));
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
};

/** 从节点中心沿 toward 方向到椭圆边缘的交点。 */
const ellipseEdgePoint = (node, toward) => {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  if (!dx && !dy) return { x: node.x, y: node.y };
  const scale = 1 / Math.sqrt((dx * dx) / (node.rx * node.rx) + (dy * dy) / (node.ry * node.ry));
  return { x: node.x + dx * scale, y: node.y + dy * scale };
};

const ringPath = (rx, ry) =>
  `M 0 ${-ry} A ${rx} ${ry} 0 1 1 0 ${ry} A ${rx} ${ry} 0 1 1 0 ${-ry}`;

const cubicPath = (from, c1, c2, to) =>
  `M${from.x} ${from.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`;

const writeDrawPoint = (element, key, point) => {
  element.setAttribute(`data-analytics-draw-${key}`, `${point.x} ${point.y}`);
};

/** 按视觉尺寸换算节点椭圆半径并写回 SVG，返回 id → 节点几何 Map。 */
const measureNodes = (svg, nodeElements) => {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const map = new Map();
  if (!rect.width || !rect.height || !viewBox.width || !viewBox.height) return map;
  const scaleX = rect.width / viewBox.width;
  const scaleY = rect.height / viewBox.height;
  nodeElements.forEach((element) => {
    const id = element.dataset.analyticsNodeId;
    const kind = element.dataset.analyticsNodeKind;
    if (!id || !kind) return;
    const plate = element.querySelector('[data-analytics-node-plate]');
    const ring = element.querySelector('[data-analytics-node-ring]');
    const core = element.querySelector('[data-analytics-node-core]');
    if (!plate || !ring || !core) return;
    const radius = nodeSize(kind) / 2;
    const coreRadius = radius * CORE_RATIO[kind];
    const rx = radius / scaleX;
    const ry = radius / scaleY;
    const coreRx = coreRadius / scaleX;
    const coreRy = coreRadius / scaleY;
    plate.setAttribute('rx', String(rx));
    plate.setAttribute('ry', String(ry));
    ring.setAttribute('d', ringPath(rx, ry));
    core.setAttribute('rx', String(coreRx));
    core.setAttribute('ry', String(coreRy));
    map.set(id, {
      core,
      id,
      kind,
      plate,
      ring,
      rx,
      ry,
      x: readNumber(element, 'analytics-node-x'),
      y: readNumber(element, 'analytics-node-y'),
    });
  });
  return map;
};

/** 端点吸附到节点椭圆边缘后重写曲线 d 与 draw 坐标。 */
const layoutLinks = (links, nodeMap) => {
  links.forEach((link) => {
    const c1 = readPoint(link, 'c1');
    const c2 = readPoint(link, 'c2');
    const startNode = link.dataset.startNode ? nodeMap.get(link.dataset.startNode) : undefined;
    const endNode = link.dataset.endNode ? nodeMap.get(link.dataset.endNode) : undefined;
    const from = startNode ? ellipseEdgePoint(startNode, c1) : readPoint(link, 'from');
    const to = endNode ? ellipseEdgePoint(endNode, c2) : readPoint(link, 'to');
    writeDrawPoint(link, 'from', from);
    writeDrawPoint(link, 'c1', c1);
    writeDrawPoint(link, 'c2', c2);
    writeDrawPoint(link, 'to', to);
    link.setAttribute('d', cubicPath(from, c1, c2, to));
  });
};

const MIN_VISIBLE = 0.025;
const COMPLETE = 0.985;
const SAMPLE_COUNT = { desktop: 80, touch: 40 };
const RENDER_EPSILON = 5e-4;

/** 椭圆环按进度的部分弧线（从 12 点方向顺时针）。 */
const ringArcPath = (rx, ry, rawProgress) => {
  const progress = clamp01(rawProgress);
  if (progress >= COMPLETE) return ringPath(rx, ry);
  const angle = progress * Math.PI * 2;
  const endX = Math.sin(angle) * rx;
  const endY = -Math.cos(angle) * ry;
  const largeArc = progress > 0.5 ? 1 : 0;
  return `M 0 ${-ry} A ${rx} ${ry} 0 ${largeArc} 1 ${endX} ${endY}`;
};

const drawRing = (ring, rawProgress, rx, ry) => {
  const progress = clamp01(rawProgress);
  const visible = progressBetween(progress, MIN_VISIBLE, 1);
  const complete = progress >= COMPLETE || visible >= 0.999;
  ring.removeAttribute('stroke-dasharray');
  ring.removeAttribute('stroke-dashoffset');
  ring.removeAttribute('pathLength');
  ring.setAttribute('d', complete ? ringPath(rx, ry) : ringArcPath(rx, ry, visible));
  window.gsap.set(ring, { autoAlpha: visible > 0 ? 1 : 0 });
};

const readDrawPoint = (element, key) => {
  const [x = 0, y = 0] = (element.getAttribute(`data-analytics-draw-${key}`) ?? '')
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part));
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
};

const readDrawPoints = (path) => ({
  control1: readDrawPoint(path, 'c1'),
  control2: readDrawPoint(path, 'c2'),
  from: readDrawPoint(path, 'from'),
  to: readDrawPoint(path, 'to'),
});

const cubicPointAt = (points, rawT) => {
  const t = clamp01(rawT);
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return {
    x: points.from.x * uuu + points.control1.x * 3 * uu * t + points.control2.x * 3 * u * tt + points.to.x * ttt,
    y: points.from.y * uuu + points.control1.y * 3 * uu * t + points.control2.y * 3 * u * tt + points.to.y * ttt,
  };
};

const cubicPathOf = (points) =>
  `M${points.from.x} ${points.from.y}C${points.control1.x} ${points.control1.y} ${points.control2.x} ${points.control2.y} ${points.to.x} ${points.to.y}`;

const scalePoint = (point, scale) => ({ x: point.x * scale.scaleX, y: point.y * scale.scaleY });

const sampleCount = () => (matches(BREAKPOINTS.tabletAndBelow) ? SAMPLE_COUNT.touch : SAMPLE_COUNT.desktop);

const svgScale = (svg) => {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  if (!rect.width || !rect.height || !viewBox.width || !viewBox.height) {
    return { scaleX: 1, scaleY: 1 };
  }
  return { scaleX: rect.width / viewBox.width, scaleY: rect.height / viewBox.height };
};

/** 沿曲线均匀采样，按视觉长度累计，供部分绘制截断用。 */
const samplePath = (path, scale) => {
  const points = readDrawPoints(path);
  const count = sampleCount();
  const start = points.from;
  const samples = [{ point: start, visualLength: 0 }];
  let total = 0;
  let previous = scalePoint(start, scale);
  for (let i = 1; i <= count; i += 1) {
    const point = cubicPointAt(points, i / count);
    const scaled = scalePoint(point, scale);
    total += Math.hypot(scaled.x - previous.x, scaled.y - previous.y);
    samples.push({ point, visualLength: total });
    previous = scaled;
  }
  return { fullPathData: cubicPathOf(points), path, samples, totalVisualLength: total };
};

/** 截断到目标视觉长度的折线 path data。 */
const partialPathData = (drawable, rawProgress) => {
  const first = drawable.samples[0];
  if (!first) return drawable.fullPathData;
  const progress = clamp01(rawProgress);
  if (progress >= COMPLETE) return drawable.fullPathData;
  const targetLength = drawable.totalVisualLength * progress;
  const points = [first.point];
  for (let i = 1; i < drawable.samples.length; i += 1) {
    const sample = drawable.samples[i];
    if (!sample) continue;
    if (sample.visualLength < targetLength) {
      points.push(sample.point);
      continue;
    }
    const previous = drawable.samples[i - 1];
    if (!previous) {
      points.push(sample.point);
      break;
    }
    const span = sample.visualLength - previous.visualLength;
    const t = span > 0 ? (targetLength - previous.visualLength) / span : 0;
    points.push({
      x: lerp(previous.point.x, sample.point.x, t),
      y: lerp(previous.point.y, sample.point.y, t),
    });
    break;
  }
  if (points.length === 1) return `M${first.point.x} ${first.point.y}`;
  const head = first.point;
  const rest = points.slice(1);
  return `M${head.x} ${head.y}${rest.map((p) => `L${p.x} ${p.y}`).join('')}`;
};

const renderLinks = (drawables, rawProgress) => {
  const progress = clamp01(rawProgress);
  const visible = progressBetween(progress, MIN_VISIBLE, 1);
  const complete = progress >= COMPLETE || visible >= 0.999;
  drawables.forEach((drawable) => {
    const previous = drawable.renderedProgress;
    const next = complete ? 1 : progress;
    if (previous !== undefined && Math.abs(next - previous) < RENDER_EPSILON) return;
    drawable.renderedProgress = next;
    drawable.path.setAttribute('d', complete ? drawable.fullPathData : partialPathData(drawable, visible));
    window.gsap.set(drawable.path, { autoAlpha: visible > 0 ? 1 : 0 });
  });
};

const SELECTORS = {
  analyticsMetric: '.analytics-metric',
  analyticsFlow: '.analytics-flow',
  analyticsScene: '.analytics-scene',
  analyticsSvg: '.analytics-flow__svg',
  campaignLink: '[data-analytics-link="campaign"]',
  campaignNode: '[data-analytics-campaign]',
  controlField: '.control-field',
  controlPoint: '[data-control-bridge-point]',
  controlScene: '.control-scene',
  strategyLink: '[data-analytics-link="strategy"]',
  strategyTarget: '[data-analytics-entry-point]',
  userNode: '[data-analytics-user-node]',
  zoneLabel: '.analytics-zone-label',
};

const POINT_ORDER = ['one', 'two', 'three', 'four', 'five'];
// 策略点 → 目标节点错位映射（视觉上交叉飞行）
const TARGET_BY_POINT = { five: 'four', four: 'five', one: 'three', three: 'one', two: 'two' };
const BRIDGE_START = 'bottom 90%';
const BRIDGE_END = 'top 72%';
const BRIDGE_COMPLETE = 0.985;
const APPROACH_START = 'top 125%';
const ROLLUP_START = 'top 60%';
const ROLLUP_MIN_LENGTH = 360;
const METRICS_HIDE_BELOW = 0.7;
const METRICS_DONE_AT = 0.985;
const LABELS_DONE_AT = 0.85;
const DOT_CLASS = 'control-analytics-bridge__dot';

let teardown;

const byControlOrder = byDatasetOrder('controlBridgePoint', POINT_ORDER, 0);
const byEntryOrder = byDatasetOrder('analyticsEntryPoint', POINT_ORDER, 0);

const setDotRect = (dot, rect, alpha) => {
  window.gsap.set(dot, {
    autoAlpha: alpha,
    height: rect.height,
    width: rect.width,
    x: rect.left,
    y: rect.top,
  });
};

/** 第 index 项在 [start+index*gap, start+index*gap+span] 窗口内的缓动进度。 */
const staggeredWindow = (progress, start, span, index = 0, gap = 0) =>
  easeOutCubic(progressBetween(progress, start + index * gap, start + index * gap + span));

const rollupLength = (flow) => Math.max(ROLLUP_MIN_LENGTH, flow.offsetHeight / 2 + window.innerHeight * 0.12);

const measurePlacement = (element) => {
  const rect = element.getBoundingClientRect();
  const size = Math.max(1, rect.width, rect.height, element.offsetWidth, element.offsetHeight);
  return squareRect(rect, size);
};

export const setupControlToAnalyticsBridge = () => {
  teardown?.();
  const { gsap, ScrollTrigger } = window;
  const controlScene = document.querySelector(SELECTORS.controlScene);
  const analyticsScene = document.querySelector(SELECTORS.analyticsScene);
  const flow = analyticsScene?.querySelector(SELECTORS.analyticsFlow);
  const svg = analyticsScene?.querySelector(SELECTORS.analyticsSvg);
  const controlField = controlScene?.querySelector(SELECTORS.controlField);
  const controlPoints = Array.from(controlScene?.querySelectorAll(SELECTORS.controlPoint) ?? []).sort(byControlOrder);
  const entryTargets = Array.from(analyticsScene?.querySelectorAll(SELECTORS.strategyTarget) ?? []).sort(byEntryOrder);
  const strategyLinks = Array.from(analyticsScene?.querySelectorAll(SELECTORS.strategyLink) ?? []);
  const campaignLinks = Array.from(analyticsScene?.querySelectorAll(SELECTORS.campaignLink) ?? []);
  const campaignNodes = Array.from(analyticsScene?.querySelectorAll(SELECTORS.campaignNode) ?? []);
  const userNode = analyticsScene?.querySelector(SELECTORS.userNode);
  const metrics = Array.from(analyticsScene?.querySelectorAll(SELECTORS.analyticsMetric) ?? []);
  const zoneLabels = Array.from(analyticsScene?.querySelectorAll(SELECTORS.zoneLabel) ?? []);
  if (
    !controlScene || !analyticsScene || !flow || !svg || !controlField || !userNode
    || controlPoints.length !== entryTargets.length || entryTargets.length === 0
  ) return;

  const targetById = new Map(entryTargets.map((el) => [el.dataset.analyticsEntryPoint, el]));
  const rawPairs = controlPoints.map((controlPoint) => {
    const pointId = controlPoint.dataset.controlBridgePoint;
    const targetId = pointId ? TARGET_BY_POINT[pointId] : undefined;
    const target = targetId ? targetById.get(targetId) : undefined;
    return target ? { controlPoint, target } : undefined;
  });
  if (rawPairs.some((pair) => !pair)) return;
  const pairs = rawPairs;

  const layer = createFixedLayer('controlAnalyticsBridge', '9');
  const dots = createSpans(pairs, layer, DOT_CLASS, ({ controlPoint }) => ({
    side: controlPoint.dataset.side ?? 'long',
  }));
  const allLinks = [...strategyLinks, ...campaignLinks];

  let strategyDrawables = [];
  let campaignDrawables = [];
  let nodeMap = new Map();
  let placementsCache;
  let placementFrame = 0;
  let lastRollupProgress = -1;
  let labelsDone = false;
  let metricsHidden = true;
  let metricsDone = false;
  let prepared = false;
  let preparedSignature = '';

  const currentSignature = () =>
    [geometrySignature(svg), sampleCount(), strategyLinks.length, campaignNodes.length, campaignLinks.length].join(':');

  const resetPlacementCache = () => {
    placementFrame = 0;
    placementsCache = undefined;
  };
  const cancelPlacementFrame = () => {
    if (placementFrame !== 0) window.cancelAnimationFrame(placementFrame);
    resetPlacementCache();
  };
  // 起终点矩形按帧缓存：同一帧多次 update 只测量一次
  const placements = () => {
    if (placementsCache) return placementsCache;
    placementsCache = {
      sourcePlacements: pairs.map(({ controlPoint }) => measurePlacement(controlPoint)),
      targetPlacements: pairs.map(({ target }) => measurePlacement(target)),
    };
    if (placementFrame === 0) placementFrame = window.requestAnimationFrame(resetPlacementCache);
    return placementsCache;
  };

  const prepareGeometry = (signature) => {
    lastRollupProgress = -1;
    labelsDone = false;
    metricsHidden = true;
    metricsDone = false;
    nodeMap = measureNodes(svg, [...campaignNodes, userNode]);
    layoutLinks(allLinks, nodeMap);
    const scale = svgScale(svg);
    allLinks.forEach((path) => path.removeAttribute('pathLength'));
    strategyDrawables = strategyLinks.map((path) => samplePath(path, scale));
    campaignDrawables = campaignLinks.map((path) => samplePath(path, scale));
    renderLinks(strategyDrawables, 0);
    renderLinks(campaignDrawables, 0);
    Array.from(nodeMap.values()).forEach((node) => {
      node.ring.removeAttribute('pathLength');
      node.ring.removeAttribute('stroke-dasharray');
      node.ring.removeAttribute('stroke-dashoffset');
      node.ring.setAttribute('d', ringArcPath(node.rx, node.ry, 0));
      gsap.set(node.ring, { autoAlpha: 0 });
    });
    gsap.set(campaignNodes, { autoAlpha: 1 });
    gsap.set([...nodeMap.values()].map((node) => node.plate), { autoAlpha: 0 });
    gsap.set([...nodeMap.values()].map((node) => node.core), { autoAlpha: 0 });
    gsap.set(zoneLabels, { autoAlpha: 0, y: 6 });
    gsap.set(userNode, { autoAlpha: 1 });
    gsap.set(metrics, { autoAlpha: 0, y: 8 });
    prepared = true;
    preparedSignature = signature;
    analyticsScene.dataset.analyticsRollupMotion = 'ready';
  };

  const prepareIfNeeded = () => {
    const signature = currentSignature();
    if (prepared && signature === preparedSignature) return;
    prepareGeometry(signature);
  };

  const setBridgeState = (progress) => {
    const moving = progress > 0 && progress < BRIDGE_COMPLETE;
    const complete = progress >= BRIDGE_COMPLETE;
    controlField.dataset.controlAnalyticsBridgeState = moving ? 'moving' : '';
    analyticsScene.dataset.analyticsBridgeState = complete ? 'complete' : 'pending';
    if (!moving) delete controlField.dataset.controlAnalyticsBridgeState;
  };

  const renderDots = (rawProgress) => {
    const progress = clamp01(rawProgress);
    if (progress <= 0) {
      setBridgeState(progress);
      cancelPlacementFrame();
      gsap.set(dots, { autoAlpha: 0 });
      return;
    }
    if (progress >= BRIDGE_COMPLETE) {
      setBridgeState(progress);
      gsap.set(dots, { autoAlpha: 0 });
      return;
    }
    const { sourcePlacements, targetPlacements } = placements();
    setBridgeState(progress);
    dots.forEach((dot, index) => {
      const source = sourcePlacements[index];
      const target = targetPlacements[index];
      if (!source || !target) return;
      setDotRect(dot, interpolateRect(source, target, progress), 1);
    });
  };

  const paintNode = (node, ringProgress, coreAlpha) => {
    if (!node) return;
    drawRing(node.ring, ringProgress, node.rx, node.ry);
    gsap.set(node.plate, { autoAlpha: 0 });
    gsap.set(node.core, { autoAlpha: coreAlpha });
  };

  const renderZoneLabels = (progress, force = false) => {
    if (!force && progress >= LABELS_DONE_AT && labelsDone) return;
    const alphas = [
      easeOutCubic(progressBetween(progress, 0, 0.12)),
      easeOutCubic(progressBetween(progress, 0.32, 0.46)),
      easeOutCubic(progressBetween(progress, 0.72, 0.84)),
    ];
    zoneLabels.forEach((label, index) => {
      const alpha = alphas[index] ?? 0;
      gsap.set(label, { autoAlpha: alpha, y: lerp(6, 0, alpha) });
    });
    labelsDone = progress >= LABELS_DONE_AT;
  };

  const renderMetrics = (progress, force = false) => {
    if (!force && progress < METRICS_HIDE_BELOW && metricsHidden) return;
    if (!force && progress >= METRICS_DONE_AT && metricsDone) return;
    metrics.forEach((metric, index) => {
      const alpha = staggeredWindow(progress, 0.72, 0.18, index, 0.012);
      gsap.set(metric, { autoAlpha: alpha, y: lerp(8, 0, alpha) });
    });
    metricsHidden = progress < METRICS_HIDE_BELOW;
    metricsDone = progress >= METRICS_DONE_AT;
  };

  const renderRollup = (rawProgress, { force = false } = {}) => {
    const progress = clamp01(rawProgress);
    if (!force && Math.abs(progress - lastRollupProgress) < RENDER_EPSILON) return;
    lastRollupProgress = progress;
    const strategyDraw = easeOutCubic(progressBetween(progress, 0.04, 0.34));
    const campaignRing = easeOutCubic(progressBetween(progress, 0.22, 0.46));
    const campaignCore = easeOutCubic(progressBetween(progress, 0.34, 0.48));
    const campaignDraw = easeOutCubic(progressBetween(progress, 0.44, 0.74));
    const userRing = easeOutCubic(progressBetween(progress, 0.62, 0.88));
    const userCore = easeOutCubic(progressBetween(progress, 0.76, 0.9));
    renderLinks(strategyDrawables, strategyDraw);
    renderLinks(campaignDrawables, campaignDraw);
    renderZoneLabels(progress, force);
    campaignNodes.forEach((element) => {
      paintNode(nodeMap.get(element.dataset.analyticsNodeId ?? ''), campaignRing, campaignCore);
    });
    paintNode(nodeMap.get(userNode.dataset.analyticsNodeId ?? ''), userRing, userCore);
    renderMetrics(progress, force);
  };

  const prepareAndReset = () => {
    prepareIfNeeded();
    renderRollup(0, { force: true });
  };

  const updateRollup = (rawProgress, options = {}) => {
    const progress = clamp01(rawProgress);
    if (!prepared && progress <= 0) return;
    if (!prepared) prepareAndReset();
    renderRollup(progress, options);
  };

  renderDots(0);

  // ① control 底部 → analytics-flow 顶部：dot 飞行
  const bridgeTrigger = ScrollTrigger.create({
    trigger: controlScene,
    start: BRIDGE_START,
    endTrigger: flow,
    end: BRIDGE_END,
    scrub: true,
    onRefreshInit: () => {
      delete controlField.dataset.controlAnalyticsBridgeState;
      cancelPlacementFrame();
    },
    onLeave: () => renderDots(1),
    onLeaveBack: () => renderDots(0),
    onRefresh: ({ progress }) => renderDots(progress),
    onUpdate: ({ progress }) => renderDots(progress),
  });

  // ② 提前一屏准备几何（只需一次）
  const approachTrigger = ScrollTrigger.create({
    trigger: flow,
    start: APPROACH_START,
    once: true,
    onEnter: () => prepareAndReset(),
    onEnterBack: () => prepareAndReset(),
  });

  // ③ rollup scrub：曲线绘制 + 节点点亮 + label/metric 渐入
  const rollupTrigger = ScrollTrigger.create({
    trigger: flow,
    start: ROLLUP_START,
    end: () => `+=${rollupLength(flow)}`,
    scrub: true,
    onRefreshInit: () => {
      if (prepared) prepareIfNeeded();
    },
    onLeave: () => updateRollup(1, { force: true }),
    onLeaveBack: () => updateRollup(0, { force: true }),
    onRefresh: ({ progress }) => updateRollup(progress, { force: true }),
    onUpdate: ({ progress }) => updateRollup(progress),
  });

  const unbindPageHide = onPageHideRebind(() => teardown, setupControlToAnalyticsBridge);
  teardown = () => {
    unbindPageHide();
    bridgeTrigger.kill();
    approachTrigger.kill();
    rollupTrigger.kill();
    cancelPlacementFrame();
    layer.remove();
    delete controlField.dataset.controlAnalyticsBridgeState;
    delete analyticsScene.dataset.analyticsBridgeState;
    delete analyticsScene.dataset.analyticsRollupMotion;
    gsap.set([...dots, ...allLinks, ...campaignNodes, ...zoneLabels, userNode, ...metrics], { clearProps: 'all' });
    gsap.set([...nodeMap.values()].flatMap((node) => [node.plate, node.ring, node.core]), { clearProps: 'all' });
    strategyDrawables = [];
    campaignDrawables = [];
    nodeMap.clear();
    prepared = false;
    preparedSignature = '';
    teardown = undefined;
  };
};
