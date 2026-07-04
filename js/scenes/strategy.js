// 策略场景：焦点光 + scrub 入场（见 js/lib/strategy-light.js），
// 以及 strategy → time-replay 的桥接转场（时间光点飞向回放区间条）。
// 桥接对照原站 strategyToTimeReplayBridge 模块，参数逐值一致；
// 其依赖的 sceneBridge / timeReplayRangeTransition 工具按约定内联在本文件。
import { isMotionReduced } from '../lib/motion.js';
import { setupFocalLightCanvas } from '../lib/focal-light.js';
import { setupStrategyFocalLight } from '../lib/strategy-light.js';

// ---- 内联工具（对照原站 sceneBridge 模块） ----

const clamp01 = (value) => Math.min(Math.max(value, 0), 1);
const easeOutCubic = (value) => 1 - (1 - value) ** 3;
const progressInRange = (value, min, max) => clamp01((value - min) / (max - min));
const lerp = (from, to, progress) => from + (to - from) * progress;

/** 以元素中心为基准、边长 size 的正方形 placement；offset 可扣除当前平移量 */
const placementFromElement = (element, size, offset = {}) => {
  const rect = element.getBoundingClientRect();
  return {
    height: size,
    left: rect.left - (offset.x ?? 0) + rect.width / 2 - size / 2,
    top: rect.top - (offset.y ?? 0) + rect.height / 2 - size / 2,
    width: size,
  };
};

const interpolateRect = (from, to, progress) => ({
  height: lerp(from.height, to.height, progress),
  left: lerp(from.left, to.left, progress),
  top: lerp(from.top, to.top, progress),
  width: lerp(from.width, to.width, progress),
});

const offsetTop = (rect, deltaY) => ({ ...rect, top: rect.top + deltaY });

const createFixedLayer = (datasetKey, zIndex = '8') => {
  const layer = document.createElement('div');
  layer.dataset[datasetKey] = 'true';
  Object.assign(layer.style, {
    contain: 'layout style paint',
    inset: '0',
    pointerEvents: 'none',
    position: 'fixed',
    zIndex,
  });
  document.body.appendChild(layer);
  return layer;
};

/** pagehide 时清理，bfcache 恢复时重建 */
const watchPageHide = (getCleanup, resetup) => {
  const onPageHide = (event) => {
    getCleanup()?.();
    if (event.persisted) window.addEventListener('pageshow', resetup, { once: true });
  };
  window.addEventListener('pagehide', onPageHide);
  return () => {
    window.removeEventListener('pagehide', onPageHide);
  };
};

// ---- 区间条收拢/展开（对照原站 timeReplayRangeTransition 模块） ----

const measureRangeCollapse = ({ range, rangeEndpointFrom, rangeEndpointTo }) => {
  const rangeWidth = range.getBoundingClientRect().width;
  const fromWidth = rangeEndpointFrom.getBoundingClientRect().width;
  const toWidth = rangeEndpointTo.getBoundingClientRect().width;
  const safeRange = Math.max(1, rangeWidth);
  const safeFrom = Math.max(1, fromWidth);
  return {
    collapsedScale: safeFrom / safeRange,
    fromCollapseX: Math.max(0, safeRange / 2 - safeFrom / 2),
    toCollapseX: -Math.max(0, safeRange / 2 - Math.max(1, toWidth) / 2),
  };
};

/** 测量缓存：同帧内复用，下一帧失效 */
const createRangeMeasure = (refs) => {
  let cache;
  let rafId = 0;
  const reset = () => {
    rafId = 0;
    cache = undefined;
  };
  return () => {
    if (!cache) {
      cache = measureRangeCollapse(refs);
      if (rafId === 0) rafId = window.requestAnimationFrame(reset);
    }
    return cache;
  };
};

const setRangeCollapsed = (gsap, refs) => {
  const { rangeEndpointFrom, rangeEndpointTo, rangeLabels, rangeLine, rangeLineFill, rangeWindow } = refs;
  const measure = createRangeMeasure(refs);
  const collapsedScale = () => measure().collapsedScale;
  gsap.set(rangeWindow, { opacity: 0, scaleX: collapsedScale, transformOrigin: '50% 50%' });
  gsap.set(rangeLine, { scaleX: collapsedScale, transformOrigin: '50% 50%' });
  gsap.set(rangeLineFill, { opacity: 0 });
  gsap.set(rangeLabels, { opacity: 0, y: -4 });
  gsap.set(rangeEndpointFrom, { x: () => measure().fromCollapseX });
  gsap.set(rangeEndpointTo, { x: () => measure().toCollapseX });
};

const applyRangeTransition = (timeline, refs, direction, position, duration) => {
  const { rangeEndpointFrom, rangeEndpointTo, rangeLabels, rangeLine, rangeLineFill, rangeWindow } = refs;
  const measure = createRangeMeasure(refs);
  const expand = direction === 'expand';
  const labelDuration = duration * 0.22;
  const mainDuration = duration - labelDuration;
  const mainPosition = expand ? position : position + labelDuration;
  const labelPosition = expand ? position + mainDuration : position;
  const collapsedScale = () => measure().collapsedScale;
  const fromCollapseX = () => measure().fromCollapseX;
  const toCollapseX = () => measure().toCollapseX;

  timeline.fromTo(
    rangeWindow,
    { opacity: expand ? 0 : 1, scaleX: expand ? collapsedScale : 1, transformOrigin: '50% 50%' },
    {
      opacity: expand ? 1 : 0,
      scaleX: expand ? 1 : collapsedScale,
      transformOrigin: '50% 50%',
      duration: mainDuration,
      immediateRender: false,
    },
    mainPosition,
  );
  timeline.fromTo(
    rangeLine,
    { scaleX: expand ? collapsedScale : 1, transformOrigin: '50% 50%' },
    {
      scaleX: expand ? 1 : collapsedScale,
      transformOrigin: '50% 50%',
      duration: mainDuration,
      immediateRender: false,
    },
    mainPosition,
  );
  timeline.fromTo(
    rangeLineFill,
    { opacity: expand ? 0 : 1 },
    { opacity: expand ? 1 : 0, duration: mainDuration, immediateRender: false },
    mainPosition,
  );
  timeline.fromTo(
    rangeLabels,
    { opacity: expand ? 0 : 1, y: expand ? -4 : 0 },
    { opacity: expand ? 1 : 0, y: expand ? 0 : -4, duration: labelDuration, immediateRender: false },
    labelPosition,
  );
  timeline.fromTo(
    rangeEndpointFrom,
    { x: expand ? fromCollapseX : 0 },
    { x: expand ? 0 : fromCollapseX, duration: mainDuration, immediateRender: false },
    mainPosition,
  );
  timeline.fromTo(
    rangeEndpointTo,
    { x: expand ? toCollapseX : 0 },
    { x: expand ? 0 : toCollapseX, duration: mainDuration, immediateRender: false },
    mainPosition,
  );
};

// ---- strategy → time-replay 桥接（对照原站 strategyToTimeReplayBridge 模块） ----

const BRIDGE_SELECTORS = {
  metrics: '.time-replay-metrics',
  range: '[data-time-replay-range]',
  rangeEndpointFrom: '.time-replay-range__endpoint--from',
  rangeEndpointTo: '.time-replay-range__endpoint--to',
  rangeLabels: '.time-replay-range__labels',
  rangeLine: '.time-replay-range__line',
  rangeLineFill: '.time-replay-range__line-fill',
  rangeWindow: '.time-replay-range__window',
  strategyDot: '[data-strategy-time-dot]',
  strategyTarget: '.strategy-object__target',
  timeReplayScene: '.time-replay-scene',
  timeReplayChartMount: '.time-replay-scene__chart-mount',
  timeReplayTitleHistory: "[data-time-replay-title='history']",
};

const BRIDGE_START = 'top 82%';
const BRIDGE_END = 'top top';
const DOT_FLIGHT_PORTION = 0.56; // 前 56% 进度：光点飞行；其后：区间条展开
const TITLE_PLAY_PROGRESS = 0.22;
const CHART_FADE_START = 0.34;
const CHART_FADE_END = 0.78;
const TITLE_WORD_Y = '0.34em';
const TITLE_WORD_SCALE = 0.988;
const CHART_SHIFT_Y = 18;
const CHART_SCALE = 0.985;
const RANGE_ALIGN_RATIO = 0.62; // 飞行终点：区间条中心对齐 62% 视口高
const METRICS_START = 0.88;
const METRICS_SPAN = 1 - METRICS_START;
const DOT_CLEAR_PROPS = 'height,left,position,top,transform,width,x,y,zIndex';
const DOT_RESTORED_EVENT = 'cryptowl:strategy-dot-restored';

let bridgeCleanup;

const setupStrategyToTimeReplayBridge = () => {
  if (bridgeCleanup) return;
  const { gsap, ScrollTrigger, SplitText } = window;

  const strategyTarget = document.querySelector(BRIDGE_SELECTORS.strategyTarget);
  const dot = document.querySelector(BRIDGE_SELECTORS.strategyDot);
  const scene = document.querySelector(BRIDGE_SELECTORS.timeReplayScene);
  const metrics = scene?.querySelector(BRIDGE_SELECTORS.metrics);
  const range = scene?.querySelector(BRIDGE_SELECTORS.range);
  const chartMount = scene?.querySelector(BRIDGE_SELECTORS.timeReplayChartMount);
  const titleHistory = scene?.querySelector(BRIDGE_SELECTORS.timeReplayTitleHistory);
  const rangeWindow = scene?.querySelector(BRIDGE_SELECTORS.rangeWindow);
  const rangeLine = scene?.querySelector(BRIDGE_SELECTORS.rangeLine);
  const rangeLineFill = scene?.querySelector(BRIDGE_SELECTORS.rangeLineFill);
  const rangeEndpointFrom = scene?.querySelector(BRIDGE_SELECTORS.rangeEndpointFrom);
  const rangeEndpointTo = scene?.querySelector(BRIDGE_SELECTORS.rangeEndpointTo);
  const rangeLabels = scene?.querySelector(BRIDGE_SELECTORS.rangeLabels);
  if (
    !strategyTarget || !dot || !scene || !metrics || !range || !chartMount || !titleHistory ||
    !rangeWindow || !rangeLine || !rangeLineFill || !rangeEndpointFrom || !rangeEndpointTo || !rangeLabels
  ) {
    return;
  }

  const dotHome = dot.parentElement;
  const dotNext = dot.nextSibling;
  const layer = createFixedLayer('strategyTimeReplayBridge');
  const rangeRefs = { range, rangeEndpointFrom, rangeEndpointTo, rangeLabels, rangeLine, rangeLineFill, rangeWindow };
  const expandTimeline = gsap.timeline({ defaults: { ease: 'none' }, paused: true });

  let titleReveal; // { split, timeline, words }
  let titleSplitFailed = false;
  let dotInLayer = false;
  let dotHiddenForRange = false; // 区间条展开后光点回家但隐藏（由区间端点接棒）
  let titlePlayed = false;

  const getNumber = (element, property) => {
    const value = Number(gsap.getProperty(element, property));
    return Number.isFinite(value) ? value : 0;
  };

  /** 区间条 placement（扣除当前 y 平移，得到 y=0 时的位置） */
  const rangePlacement = (size) => placementFromElement(range, size, { y: getNumber(range, 'y') });

  const flightSize = () => {
    const dotRect = dot.getBoundingClientRect();
    const endpointRect = rangeEndpointFrom.getBoundingClientRect();
    return Math.max(1, Math.max(dotRect.width, endpointRect.width, dot.offsetWidth));
  };

  const alignOffsetY = (rect) => {
    const centerY = rect.top + rect.height / 2;
    const alignedY = window.innerHeight * RANGE_ALIGN_RATIO;
    return Math.min(0, alignedY - centerY);
  };

  const resetTitleWords = (reveal = titleReveal) => {
    gsap.set(titleHistory, { opacity: 1, yPercent: 0 });
    if (reveal) {
      gsap.set(reveal.words, {
        autoAlpha: 0,
        display: 'inline-block',
        scale: TITLE_WORD_SCALE,
        transformOrigin: '50% 70%',
        y: TITLE_WORD_Y,
      });
    }
  };

  const ensureTitleReveal = () => {
    if (titleReveal) return titleReveal;
    if (titleSplitFailed) return undefined;
    if (!SplitText) {
      titleSplitFailed = true;
      return undefined;
    }
    const split = SplitText.create(titleHistory, {
      aria: 'none',
      reduceWhiteSpace: false,
      tag: 'span',
      type: 'words',
      wordsClass: 'time-replay-scene__title-word',
    });
    const words = gsap.utils.toArray(split.words);
    if (words.length === 0) {
      split.revert();
      titleSplitFailed = true;
      return undefined;
    }
    const timeline = gsap.timeline({ defaults: { ease: 'power3.out' }, paused: true });
    titleReveal = { split, timeline, words };
    resetTitleWords(titleReveal);
    timeline.to(words, {
      autoAlpha: 1,
      duration: 0.84,
      scale: 1,
      stagger: { each: 0.052, from: 'start' },
      y: 0,
    });
    return titleReveal;
  };

  applyRangeTransition(expandTimeline, rangeRefs, 'expand', 0, 1);

  const restoreDot = ({ forceVisible = false } = {}) => {
    if (!dotHome) return;
    const wasInLayer = dotInLayer;
    if (dotNext && dotNext.parentElement === dotHome) dotHome.insertBefore(dot, dotNext);
    else dotHome.appendChild(dot);
    dotInLayer = false;
    gsap.set(dot, { ...(forceVisible ? { autoAlpha: 1 } : {}), clearProps: DOT_CLEAR_PROPS });
    if (wasInLayer) window.dispatchEvent(new CustomEvent(DOT_RESTORED_EVENT));
  };

  const placeDotInLayer = (placement) => {
    if (!dotInLayer) {
      layer.appendChild(dot);
      dotInLayer = true;
    }
    dotHiddenForRange = false;
    gsap.set(dot, {
      autoAlpha: 1,
      height: placement.height,
      left: 0,
      position: 'absolute',
      top: 0,
      width: placement.width,
      x: placement.left,
      y: placement.top,
      zIndex: 1,
    });
  };

  const resetState = () => {
    const wasDetached = dotInLayer || dotHiddenForRange;
    const reveal = ensureTitleReveal();
    restoreDot({ forceVisible: wasDetached });
    dotHiddenForRange = false;
    reveal?.timeline.pause(0);
    resetTitleWords(reveal);
    titlePlayed = false;
    expandTimeline.pause(0);
    setRangeCollapsed(gsap, rangeRefs);
    gsap.set(range, { autoAlpha: 0, y: 0 });
    gsap.set(chartMount, { opacity: 0, scale: CHART_SCALE, y: CHART_SHIFT_Y });
    gsap.set(metrics, { opacity: 0 });
  };

  const playTitle = () => {
    if (titlePlayed) return;
    const reveal = ensureTitleReveal();
    if (reveal) {
      titlePlayed = true;
      reveal.timeline.play();
    }
  };

  const reverseTitle = () => {
    if (titlePlayed) {
      titlePlayed = false;
      titleReveal?.timeline.reverse();
    }
  };

  const renderChartAndTitle = (progress) => {
    const reveal = easeOutCubic(progressInRange(progress, CHART_FADE_START, CHART_FADE_END));
    if (progress >= TITLE_PLAY_PROGRESS) playTitle();
    else reverseTitle();
    gsap.set(chartMount, {
      opacity: reveal,
      scale: lerp(CHART_SCALE, 1, reveal),
      y: lerp(CHART_SHIFT_Y, 0, reveal),
    });
  };

  const renderMetrics = (expandProgress) => {
    gsap.set(metrics, { opacity: clamp01((expandProgress - METRICS_START) / METRICS_SPAN) });
  };

  const measureFlight = () => {
    const size = flightSize();
    const sourcePlacement = placementFromElement(strategyTarget, size);
    const restingPlacement = rangePlacement(size);
    const rangeStartOffsetY = alignOffsetY(restingPlacement);
    return {
      rangeStartOffsetY,
      sourcePlacement,
      targetPlacement: offsetTop(restingPlacement, rangeStartOffsetY),
    };
  };

  const render = (rawProgress) => {
    const progress = clamp01(rawProgress);
    if (progress <= 0) {
      resetState();
      return;
    }
    const { rangeStartOffsetY, sourcePlacement, targetPlacement } = measureFlight();
    renderChartAndTitle(progress);
    if (progress < DOT_FLIGHT_PORTION) {
      const flight = progress / DOT_FLIGHT_PORTION;
      setRangeCollapsed(gsap, rangeRefs);
      gsap.set(range, { autoAlpha: 0, y: rangeStartOffsetY });
      expandTimeline.pause(0);
      gsap.set(metrics, { opacity: 0 });
      placeDotInLayer(interpolateRect(sourcePlacement, targetPlacement, flight));
      return;
    }
    const expandProgress = clamp01((progress - DOT_FLIGHT_PORTION) / (1 - DOT_FLIGHT_PORTION));
    gsap.set(range, { autoAlpha: 1, y: lerp(rangeStartOffsetY, 0, expandProgress) });
    expandTimeline.progress(expandProgress).pause();
    renderMetrics(expandProgress);
    if (expandProgress <= 0.001) {
      placeDotInLayer(targetPlacement);
      return;
    }
    restoreDot();
    dotHiddenForRange = true;
    gsap.set(dot, { autoAlpha: 0 });
  };

  resetState();

  const trigger = ScrollTrigger.create({
    trigger: scene,
    start: BRIDGE_START,
    end: BRIDGE_END,
    scrub: true,
    onRefreshInit: () => {
      expandTimeline.invalidate();
    },
    onRefresh: ({ progress }) => {
      render(progress);
    },
    onLeave: () => {
      render(1);
    },
    onLeaveBack: () => {
      render(0);
    },
    onUpdate: ({ progress }) => {
      render(progress);
    },
  });

  const unwatchPageHide = watchPageHide(() => bridgeCleanup, setupStrategyToTimeReplayBridge);

  bridgeCleanup = () => {
    unwatchPageHide();
    trigger?.kill();
    expandTimeline.kill();
    titleReveal?.timeline.kill();
    restoreDot({ forceVisible: dotInLayer || dotHiddenForRange });
    dotHiddenForRange = false;
    layer.remove();
    gsap.set(range, { clearProps: 'opacity,visibility,y' });
    if (titleReveal) {
      gsap.set(titleReveal.words, { clearProps: 'all' });
      titleReveal.split.revert();
      titleReveal = undefined;
    }
    gsap.set(titleHistory, { clearProps: 'opacity,transform,yPercent' });
    gsap.set(chartMount, { clearProps: 'opacity,transform,scale,y' });
    gsap.set(metrics, { clearProps: 'opacity,visibility' });
    bridgeCleanup = undefined;
  };
};

// ---- 场景入口 ----

// ctx 未直接使用：与 scene-reveal.js 等共享模块一致，内部从 window 读取 GSAP。
export function initStrategy(ctx) { // eslint-disable-line no-unused-vars
  // 对照原站：data-global-lights=off 时整套策略焦点光跳过（卡片保持静态可见）
  if (document.documentElement.dataset.globalLights !== 'off') {
    setupFocalLightCanvas();
    // comfort/减弱动效：不做入场 reveal，但光晕 scrub 仍随滚动移动（与原站一致）
    setupStrategyFocalLight({ revealScene: !isMotionReduced() });
  }
  // 桥接转场仅在完整动效下启用（原站 comfort 模式跳过）
  if (!isMotionReduced()) {
    setupStrategyToTimeReplayBridge();
  }
}
