// 场景：Time Replay —— 招牌 pin+scrub 场景（约 2.55 视口高）。
// 阶段：history 倒带（K线右移 + 日期/指标回溯）→ resultHold → 窗口收成圆点、
// 端点飞向 Active Strategy 槽位、K线回位并切 live 态 → liveHold（live candle 跳动）。
// 对照 reference/pretty/timeReplay.1wp7Q-GW.js。history 标题的逐词 reveal
// 属 strategy→time-replay 桥接（见 js/scenes/strategy.js），本模块只负责双标题切换。
import { BREAKPOINTS, matches } from '../config.js';
import { isMotionReduced } from '../lib/motion.js';
import { applyRangeTransition } from '../lib/time-replay-range-transition.js';
import { createActiveStateGeometry, createLiveCandleAnimator } from '../lib/time-replay-live.js';
import {
  collectRangeDateLabels,
  createMetricsController,
  dateWindowForProgress,
  offsetDaysFromProgress,
  RANGE_DATE_KEYS,
} from '../lib/time-replay-metrics.js';
import { setupTimeReplayToControlBridge } from '../lib/time-replay-control-bridge.js';

const SELECTORS = {
  scene: '.time-replay-scene',
  candles: '.time-replay-chart__candles',
  metrics: '.time-replay-metrics',
  metricLabel: '[data-time-replay-metric-label]',
  metricValue: '[data-time-replay-metric]',
  range: '[data-time-replay-range]',
  rangeDate: '[data-time-replay-date]',
  rangeEndpointFrom: '.time-replay-range__endpoint--from',
  rangeEndpointTo: '.time-replay-range__endpoint--to',
  rangeLabels: '.time-replay-range__labels',
  rangeLine: '.time-replay-range__line',
  rangeLineFill: '.time-replay-range__line-fill',
  rangeWindow: '.time-replay-range__window',
  activeStateTarget: '[data-time-replay-active-state-target]',
  titleHistory: "[data-time-replay-title='history']",
  titleLive: "[data-time-replay-title='live']",
  chart: '.time-replay-chart',
  liveCandle: '.time-replay-chart [data-live-candle]',
};

const CANDLE_SHIFT = { desktop: 96, tablet: 88, phone: 76 };
// 各阶段时长（timeline 时间单位），总计 2.34
const PHASE = { history: 1, resultHold: 0.24, returnLive: 0.68, liveHold: 0.42 };
const PHASE_TOTAL = PHASE.history + PHASE.resultHold + PHASE.returnLive + PHASE.liveHold;
const METRICS_FADE_DURATION = 0.24;
const LABELS_SET_AT = 0.001;
const PROGRESS = {
  historyEnd: PHASE.history / PHASE_TOTAL,
  collapseStart: (PHASE.history + PHASE.resultHold) / PHASE_TOTAL,
  liveStart: (PHASE.history + PHASE.resultHold + PHASE.returnLive) / PHASE_TOTAL,
};
const TITLE_SWAP = { duration: 0.42, distance: 112 };
const PIN_HEIGHTS = { live: 2.55, history: 1.24 };

let disposeScene;

const clamp01 = (value) => Math.min(Math.max(value, 0), 1);

const candleShiftPercent = () =>
  matches(BREAKPOINTS.timeReplayPhone)
    ? CANDLE_SHIFT.phone
    : matches(BREAKPOINTS.tabletAndBelow)
      ? CANDLE_SHIFT.tablet
      : CANDLE_SHIFT.desktop;

// 指标在 collapse 开始后 0.24/2.34 的进度内淡出
const metricsOpacityAt = (progress) => {
  const fadeStart = PROGRESS.collapseStart;
  const fadeEnd = Math.min(PROGRESS.liveStart, fadeStart + METRICS_FADE_DURATION / PHASE_TOTAL);
  if (progress <= fadeStart) return 1;
  if (progress >= fadeEnd) return 0;
  return 1 - clamp01((progress - fadeStart) / (fadeEnd - fadeStart));
};

const historyProgressAt = (progress) => clamp01(progress / PROGRESS.historyEnd);

const setupScene = () => {
  if (disposeScene) return;
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) return;

  const scene = document.querySelector(SELECTORS.scene);
  const candles = scene?.querySelector(SELECTORS.candles);
  const metricsRoot = scene?.querySelector(SELECTORS.metrics);
  const range = scene?.querySelector(SELECTORS.range);
  const rangeWindow = scene?.querySelector(SELECTORS.rangeWindow);
  const rangeLine = scene?.querySelector(SELECTORS.rangeLine);
  const rangeLineFill = scene?.querySelector(SELECTORS.rangeLineFill);
  const endpointFrom = scene?.querySelector(SELECTORS.rangeEndpointFrom);
  const endpointTo = scene?.querySelector(SELECTORS.rangeEndpointTo);
  const rangeLabels = scene?.querySelector(SELECTORS.rangeLabels);
  const activeStateTarget = scene?.querySelector(SELECTORS.activeStateTarget);
  const titleHistory = scene?.querySelector(SELECTORS.titleHistory);
  const titleLive = scene?.querySelector(SELECTORS.titleLive);
  const chart = scene?.querySelector(SELECTORS.chart);
  const liveCandles = Array.from(scene?.querySelectorAll(SELECTORS.liveCandle) ?? []);
  if (
    !scene ||
    !candles ||
    !metricsRoot ||
    !range ||
    !rangeWindow ||
    !rangeLine ||
    !rangeLineFill ||
    !endpointFrom ||
    !endpointTo ||
    !rangeLabels ||
    !activeStateTarget ||
    !titleHistory ||
    !titleLive ||
    !chart
  ) {
    return;
  }

  const metrics = createMetricsController(scene, {
    label: SELECTORS.metricLabel,
    value: SELECTORS.metricValue,
  });
  const dateLabels = collectRangeDateLabels(scene, SELECTORS.rangeDate);
  const dateTextCache = Object.fromEntries(
    RANGE_DATE_KEYS.map((key) => [key, dateLabels[key]?.textContent ?? ''])
  );

  let dateOffsetCache = offsetDaysFromProgress(0);
  let metricsOffsetCache;
  let metricsOpacityCache = 1;
  let liveIntroTweens = [];
  let metricsFadeTween;
  let liveLoopRaf = 0;
  let metricsFadedIn = false;
  let liveModeActive = false;
  let liveMetricsApplied = false;

  const setDocked = (docked) => {
    if (docked) {
      if (scene.dataset.activeState === 'docked') return;
      scene.dataset.activeState = 'docked';
      return;
    }
    if (scene.dataset.activeState !== undefined) delete scene.dataset.activeState;
  };

  const applyHistoryMetrics = (historyProgress) => {
    const offsetDays = offsetDaysFromProgress(historyProgress);
    if (metricsOffsetCache === offsetDays) return;
    metricsOffsetCache = offsetDays;
    metrics.setHistoryFromOffsetDays(offsetDays);
  };

  const liveAnimator = createLiveCandleAnimator({
    gsap,
    chart,
    liveCandles,
    onPnlChange: metrics.setLiveFromPnl,
  });
  const liveEnabled = liveAnimator.enabled;

  const applyLiveMetricsState = () => {
    if (!liveEnabled || liveMetricsApplied) return;
    liveMetricsApplied = true;
    metricsOffsetCache = undefined;
    scene.dataset.replayState = 'live';
    metrics.setLiveFromPnl(0);
  };

  const applyHistoryState = (historyProgress) => {
    if (liveMetricsApplied || scene.dataset.replayState !== 'history') {
      liveMetricsApplied = false;
      scene.dataset.replayState = 'history';
    }
    setDocked(false);
    applyHistoryMetrics(historyProgress);
  };

  const isSceneInView = () => {
    const rect = scene.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  };

  const syncLiveLoop = () => {
    if (!liveEnabled || !liveModeActive) return;
    if (isSceneInView()) {
      liveAnimator.startLoop();
      return;
    }
    liveAnimator.stopMotion();
  };

  const scheduleLiveLoopSync = () => {
    if (liveLoopRaf !== 0) return;
    liveLoopRaf = window.requestAnimationFrame(() => {
      liveLoopRaf = 0;
      syncLiveLoop();
    });
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      liveAnimator.stopMotion();
      return;
    }
    scheduleLiveLoopSync();
  };

  const killLiveIntroTweens = () => {
    liveIntroTweens.forEach((tween) => tween.kill());
    liveIntroTweens = [];
  };

  const killMetricsFade = () => {
    metricsFadeTween?.kill();
    metricsFadeTween = undefined;
  };

  const setMetricsOpacity = (value, { force = false } = {}) => {
    if (!force && metricsOpacityCache === value) return;
    metricsOpacityCache = value;
    gsap.set(metricsRoot, { opacity: value, y: 0 });
  };

  const syncMetricsOpacity = (progress) => {
    if (liveEnabled && progress >= PROGRESS.liveStart) return;
    setMetricsOpacity(liveEnabled ? metricsOpacityAt(progress) : 1, { force: true });
  };

  const fadeMetricsIn = () => {
    if (metricsFadedIn) return;
    metricsFadedIn = true;
    killMetricsFade();
    metricsFadeTween = gsap.fromTo(
      metricsRoot,
      { opacity: 0, y: 0 },
      {
        opacity: 1,
        y: 0,
        duration: METRICS_FADE_DURATION,
        ease: 'power2.out',
        overwrite: true,
        onComplete: () => {
          metricsFadeTween = undefined;
        },
      }
    );
  };

  const cancelMetricsFade = () => {
    if (!metricsFadedIn && !metricsFadeTween) return;
    metricsFadedIn = false;
    metricsOpacityCache = 0;
    killMetricsFade();
    gsap.set(metricsRoot, { opacity: 0, y: 0 });
  };

  const enterLiveMode = () => {
    if (!liveEnabled) return;
    if (liveModeActive) {
      syncLiveLoop();
      return;
    }
    liveModeActive = true;
    liveAnimator.reset();
    applyLiveMetricsState();
    setDocked(endpointTo.dataset.controlBridgeState !== 'moving');
    fadeMetricsIn();
    killLiveIntroTweens();
    liveIntroTweens = [
      gsap.to(titleHistory, {
        opacity: 0,
        yPercent: -TITLE_SWAP.distance,
        duration: TITLE_SWAP.duration,
        ease: 'power3.inOut',
        overwrite: true,
      }),
      gsap.fromTo(
        titleLive,
        { opacity: 0, yPercent: TITLE_SWAP.distance },
        {
          opacity: 1,
          yPercent: 0,
          duration: TITLE_SWAP.duration,
          ease: 'power3.inOut',
          overwrite: true,
        }
      ),
      gsap.to(liveCandles, { opacity: 1, duration: 0.22, ease: 'power2.out', overwrite: true }),
    ];
    syncLiveLoop();
  };

  const exitLiveMode = () => {
    if (!liveModeActive) return;
    liveModeActive = false;
    liveAnimator.stopMotion();
    liveAnimator.reset();
    scene.dataset.replayState = 'history';
    setDocked(false);
    metricsOffsetCache = undefined;
    metricsOpacityCache = 0;
    liveMetricsApplied = false;
    metricsFadedIn = false;
    killMetricsFade();
    killLiveIntroTweens();
    liveIntroTweens = [
      gsap.fromTo(
        titleHistory,
        { opacity: 0, yPercent: -TITLE_SWAP.distance },
        {
          opacity: 1,
          yPercent: 0,
          duration: TITLE_SWAP.duration,
          ease: 'power3.inOut',
          overwrite: true,
        }
      ),
      gsap.to(titleLive, {
        opacity: 0,
        yPercent: TITLE_SWAP.distance,
        duration: TITLE_SWAP.duration,
        ease: 'power3.inOut',
        overwrite: true,
      }),
    ];
    gsap.set(liveCandles, { opacity: 0 });
    gsap.set(metricsRoot, { opacity: 0, y: 0 });
  };

  const updateDateWindow = (historyProgress) => {
    const offsetDays = offsetDaysFromProgress(historyProgress);
    if (dateOffsetCache === offsetDays) return;
    dateOffsetCache = offsetDays;
    const dates = dateWindowForProgress(historyProgress);
    RANGE_DATE_KEYS.forEach((key) => {
      const element = dateLabels[key];
      const text = dates[key];
      if (!element || dateTextCache[key] === text) return;
      dateTextCache[key] = text;
      element.textContent = text;
    });
  };

  const applyProgress = (progress) => {
    if (liveEnabled && progress >= PROGRESS.liveStart) {
      enterLiveMode();
      return;
    }
    const historyProgress = historyProgressAt(progress);
    if (liveModeActive) exitLiveMode();
    updateDateWindow(historyProgress);
    cancelMetricsFade();
    applyHistoryState(historyProgress);
    setMetricsOpacity(liveEnabled ? metricsOpacityAt(progress) : 1);
  };

  const enableWillChange = () => {
    gsap.set(candles, { willChange: 'transform' });
  };

  const disableWillChange = () => {
    gsap.set(candles, { willChange: 'auto' });
  };

  // 端点落位几何：测量时临时切 live 布局（指标行按 live 标签排版）并归零 range 位移
  const geometry = createActiveStateGeometry({
    activeStateTarget,
    isEnabled: () => liveEnabled,
    range,
    rangeEndpointFrom: endpointFrom,
    rangeEndpointTo: endpointTo,
    withMeasurementLayout: (measure) => {
      const previousState = scene.dataset.replayState;
      const previousApplied = liveMetricsApplied;
      const snapshot = metrics.capture();
      const previousY = Number(gsap.getProperty(range, 'y')) || 0;
      const needsLiveLayout = previousState !== 'live';
      if (needsLiveLayout) {
        scene.dataset.replayState = 'live';
        metrics.setLiveFromPnl(0);
      }
      try {
        gsap.set(range, { y: 0 });
        measure();
      } finally {
        gsap.set(range, { y: previousY });
        if (needsLiveLayout) {
          scene.dataset.replayState = previousState || 'history';
          liveMetricsApplied = previousApplied;
          metrics.restore(snapshot);
        }
      }
    },
  });

  const rangeElements = {
    range,
    rangeEndpointFrom: endpointFrom,
    rangeEndpointTo: endpointTo,
    rangeLabels,
    rangeLine,
    rangeLineFill,
    rangeWindow,
  };

  const onRefreshInit = () => {
    if (liveEnabled) geometry.measure();
  };

  const timeline = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: scene,
      start: 'top top',
      end: () =>
        `+=${Math.round(window.innerHeight * (liveEnabled ? PIN_HEIGHTS.live : PIN_HEIGHTS.history))}`,
      pin: true,
      scrub: true,
      invalidateOnRefresh: true,
      anticipatePin: 0.8,
      onRefreshInit,
      onEnter: (self) => {
        enableWillChange();
        syncMetricsOpacity(self.progress);
      },
      onEnterBack: (self) => {
        enableWillChange();
        syncMetricsOpacity(self.progress);
        syncLiveLoop();
      },
      onLeave: disableWillChange,
      onLeaveBack: () => {
        disableWillChange();
        exitLiveMode();
      },
      onRefresh: (self) => {
        syncMetricsOpacity(self.progress);
        applyProgress(self.progress);
        scheduleLiveLoopSync();
      },
      onUpdate: (self) => applyProgress(self.progress),
    },
  });

  // timeline 时间轴锚点
  const collapseTime = PHASE.history + PHASE.resultHold;
  const collapseDuration = PHASE.returnLive * 0.46;
  const flyTime = collapseTime + collapseDuration;
  const flyDuration = PHASE.returnLive - collapseDuration;
  const liveHoldTime = collapseTime + PHASE.returnLive;

  liveAnimator.reset();
  gsap.set(titleHistory, { opacity: 1, yPercent: 0 });
  gsap.set(titleLive, { opacity: 0, yPercent: TITLE_SWAP.distance });
  gsap.set(liveCandles, { opacity: 0 });
  timeline.set(range, { autoAlpha: 1, y: 0 }, 0);
  timeline.set([endpointFrom, endpointTo], { scaleX: 1, scaleY: 1, x: 0, y: 0 }, 0);
  timeline.set([rangeWindow, rangeLine], { opacity: 1, scaleX: 1, transformOrigin: '50% 50%' }, 0);
  timeline.set(rangeLineFill, { opacity: 1 }, 0);
  timeline.set(rangeLabels, { opacity: 1, y: 0 }, LABELS_SET_AT);
  timeline.fromTo(
    candles,
    { xPercent: 0 },
    { xPercent: () => candleShiftPercent(), duration: PHASE.history },
    0
  );
  timeline.fromTo({}, {}, { duration: PHASE.resultHold }, PHASE.history);
  if (liveEnabled) {
    applyRangeTransition(timeline, rangeElements, 'collapse', collapseTime, collapseDuration);
    timeline.fromTo(
      endpointFrom,
      { scaleX: 1, scaleY: 1, y: 0 },
      {
        x: () => geometry.getNumber(endpointFrom, 'x'),
        y: () => geometry.getNumber(endpointFrom, 'y'),
        scaleX: () => geometry.getNumber(endpointFrom, 'scaleX'),
        scaleY: () => geometry.getNumber(endpointFrom, 'scaleY'),
        duration: flyDuration,
        ease: 'power2.inOut',
        immediateRender: false,
      },
      flyTime
    );
    timeline.fromTo(
      endpointTo,
      { scaleX: 1, scaleY: 1, y: 0 },
      {
        x: () => geometry.getNumber(endpointTo, 'x'),
        y: () => geometry.getNumber(endpointTo, 'y'),
        scaleX: () => geometry.getNumber(endpointTo, 'scaleX'),
        scaleY: () => geometry.getNumber(endpointTo, 'scaleY'),
        duration: flyDuration,
        ease: 'power2.inOut',
        immediateRender: false,
      },
      flyTime
    );
    timeline.fromTo(
      candles,
      { xPercent: () => candleShiftPercent() },
      { xPercent: 0, duration: PHASE.returnLive, ease: 'power2.inOut', immediateRender: false },
      collapseTime
    );
    timeline.fromTo({}, {}, { duration: PHASE.liveHold }, liveHoldTime);
  }

  applyProgress(timeline.scrollTrigger?.progress ?? 0);
  window.addEventListener('scroll', scheduleLiveLoopSync, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);

  const onPageHide = (event) => {
    disposeScene?.();
    if (event.persisted) window.addEventListener('pageshow', setupScene, { once: true });
  };
  window.addEventListener('pagehide', onPageHide);

  disposeScene = () => {
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('scroll', scheduleLiveLoopSync);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (liveLoopRaf !== 0) {
      window.cancelAnimationFrame(liveLoopRaf);
      liveLoopRaf = 0;
    }
    liveAnimator.stopMotion();
    killLiveIntroTweens();
    killMetricsFade();
    timeline.scrollTrigger?.kill();
    timeline.kill();
    gsap.set(candles, { clearProps: 'transform,x,xPercent,willChange' });
    gsap.set(
      [
        metricsRoot,
        rangeWindow,
        rangeLine,
        rangeLineFill,
        rangeLabels,
        endpointFrom,
        endpointTo,
        titleHistory,
        titleLive,
        ...liveCandles,
        ...metrics.getElements(),
      ],
      { clearProps: 'opacity,transform,x,y,scale,scaleX,scaleY,transformOrigin' }
    );
    metrics.clearTones();
    delete scene.dataset.activeState;
    disposeScene = undefined;
  };
};

// ctx 未使用：pageshow 重建时无 ctx，统一从 window 取 GSAP（与 scene-reveal 一致）
export function initTimeReplay(ctx) {
  setupScene();
  // 桥接仅在非 comfort/reduced motion 下启用（对照原站 index 的 comfort 分支）
  if (!isMotionReduced()) setupTimeReplayToControlBridge();
}
