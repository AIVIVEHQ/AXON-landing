// time-replay→control 桥接：live 端点圆点飞出 → 分裂为五个策略点落进 control 面板，
// 同步驱动 control 场景入场（intro/board/states）与 pending/complete 状态。
// 对照 reference/pretty/timeReplayToControlBridge.C9WVfFlV.js（含 sceneBridge 辅助函数内联）。

const SELECTORS = {
  controlBoard: '.control-field__board',
  controlField: '.control-field',
  controlIntroItem: '.control-scene__intro > *',
  controlScene: '.control-scene',
  controlState: '[data-control-status]',
  controlTarget: '[data-control-bridge-point]',
  source: '[data-time-replay-control-source]',
  timeReplayScene: '.time-replay-scene',
};

const TARGET_ORDER = ['one', 'two', 'three', 'four', 'five'];
const TRIGGER_START = 'top 76%';
const TRIGGER_END = 'top top';
const HANDOFF_AT = 0.58; // 单点飞行 → 五点散开的分界
const COMPLETE_AT = 0.94;
const FADE_START = 0.94;
const COMPLETE_THRESHOLD = COMPLETE_AT - 0.001;
const DOT_CLASS = 'time-replay-control-bridge__dot';
const INTRO = { start: 0.34, duration: 0.34, stagger: 0.035, y: 18 };
const BOARD = { start: 0.4, duration: 0.32, scale: 0.985, y: 16 };
const STATES = { start: 0.48, duration: 0.38, stagger: 0.035, x: 18, y: 10 };

// ---- sceneBridge 辅助（内联自 reference/pretty/sceneBridge.BB-JNkCc.js）----
const clamp01 = (value) => Math.min(Math.max(value, 0), 1);
const easeOutCubic = (value) => 1 - (1 - value) ** 3;
const normalize = (value, from, to) => clamp01((value - from) / (to - from));
const lerp = (from, to, t) => from + (to - from) * t;

const squarePlacement = (rect, size) => {
  const side = size ?? Math.max(1, rect.width, rect.height);
  return {
    height: side,
    left: rect.left + rect.width / 2 - side / 2,
    top: rect.top + rect.height / 2 - side / 2,
    width: side,
  };
};

const interpolatePlacement = (from, to, t) => ({
  height: lerp(from.height, to.height, t),
  left: lerp(from.left, to.left, t),
  top: lerp(from.top, to.top, t),
  width: lerp(from.width, to.width, t),
});

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

const createDot = (layer, className, dataset = {}) => {
  const dot = document.createElement('span');
  dot.className = className;
  dot.setAttribute('aria-hidden', 'true');
  Object.entries(dataset).forEach(([key, value]) => {
    if (value !== undefined) dot.dataset[key] = value;
  });
  layer.appendChild(dot);
  return dot;
};

const orderIndexOf = (element) => {
  const key = element.dataset.controlBridgePoint;
  const index = key ? TARGET_ORDER.indexOf(key) : -1;
  return index >= 0 ? index : -1;
};

const bindPageLifecycle = (getCleanup, setup) => {
  const onPageHide = (event) => {
    getCleanup()?.();
    if (event.persisted) window.addEventListener('pageshow', setup, { once: true });
  };
  window.addEventListener('pagehide', onPageHide);
  return () => {
    window.removeEventListener('pagehide', onPageHide);
  };
};

// 进入窗口 [start+index*stagger, +duration] 的缓动进度
const windowProgress = (progress, start, duration, index = 0, stagger = 0) =>
  easeOutCubic(normalize(progress, start + index * stagger, start + index * stagger + duration));

let disposeBridge;

export const setupTimeReplayToControlBridge = () => {
  disposeBridge?.();
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) return;

  const timeReplayScene = document.querySelector(SELECTORS.timeReplayScene);
  const controlScene = document.querySelector(SELECTORS.controlScene);
  const source = timeReplayScene?.querySelector(SELECTORS.source);
  const board = controlScene?.querySelector(SELECTORS.controlBoard);
  const field = controlScene?.querySelector(SELECTORS.controlField);
  const introItems = Array.from(controlScene?.querySelectorAll(SELECTORS.controlIntroItem) ?? []);
  const stateItems = Array.from(controlScene?.querySelectorAll(SELECTORS.controlState) ?? []);
  const targets = Array.from(controlScene?.querySelectorAll(SELECTORS.controlTarget) ?? []).sort(
    (a, b) => orderIndexOf(a) - orderIndexOf(b)
  );
  if (!timeReplayScene || !controlScene || !source || !board || !field || targets.length === 0) {
    return;
  }

  const layer = createFixedLayer('timeReplayControlBridge', '9');
  const dots = targets.map((target) =>
    createDot(layer, DOT_CLASS, { side: target.dataset.side ?? 'long' })
  );

  let completed = false;
  let dotsDirty = false;
  let entranceDirty = false;

  const setDocked = (docked) => {
    if (docked) {
      if (timeReplayScene.dataset.activeState === 'docked') return;
      timeReplayScene.dataset.activeState = 'docked';
      return;
    }
    if (timeReplayScene.dataset.activeState !== undefined) {
      delete timeReplayScene.dataset.activeState;
    }
  };

  const setMoving = (moving) => {
    if (moving) {
      if (source.dataset.controlBridgeState !== 'moving') {
        source.dataset.controlBridgeState = 'moving';
      }
      setDocked(false);
      return;
    }
    if (source.dataset.controlBridgeState !== undefined) delete source.dataset.controlBridgeState;
    setDocked(timeReplayScene.dataset.replayState === 'live');
  };

  const setBridgeState = (isComplete) => {
    const state = isComplete ? 'complete' : 'pending';
    if (controlScene.dataset.controlBridgeState !== state) {
      controlScene.dataset.controlBridgeState = state;
    }
    if (field.dataset.controlBridgeState !== state) {
      field.dataset.controlBridgeState = state;
    }
  };

  const resetStates = () => {
    completed = false;
    setMoving(false);
    setBridgeState(false);
  };

  const applyEntrance = (progress) => {
    entranceDirty = true;
    introItems.forEach((item, index) => {
      const t = windowProgress(progress, INTRO.start, INTRO.duration, index, INTRO.stagger);
      gsap.set(item, { autoAlpha: t, y: lerp(INTRO.y, 0, t) });
    });
    const boardT = windowProgress(progress, BOARD.start, BOARD.duration);
    gsap.set(board, {
      autoAlpha: boardT,
      scale: lerp(BOARD.scale, 1, boardT),
      transformOrigin: '50% 50%',
      y: lerp(BOARD.y, 0, boardT),
    });
    stateItems.forEach((item, index) => {
      const t = windowProgress(progress, STATES.start, STATES.duration, index, STATES.stagger);
      gsap.set(item, {
        '--control-state-entrance-x': `${lerp(STATES.x, 0, t).toFixed(3)}px`,
        '--control-state-entrance-y': `${lerp(STATES.y, 0, t).toFixed(3)}px`,
      });
    });
  };

  const clearEntrance = () => {
    if (!entranceDirty) return;
    entranceDirty = false;
    gsap.set([...introItems, board, ...stateItems], {
      clearProps:
        'opacity,visibility,transform,scale,transformOrigin,x,y,--control-state-entrance-x,--control-state-entrance-y',
    });
    stateItems.forEach((item) => {
      item.style.removeProperty('--control-state-entrance-x');
      item.style.removeProperty('--control-state-entrance-y');
    });
  };

  const clearDots = () => {
    if (!dotsDirty) return;
    dotsDirty = false;
    gsap.set(dots, { clearProps: 'height,opacity,transform,visibility,width,x,y' });
  };

  const measurePlacements = () => ({
    sourcePlacement: squarePlacement(source.getBoundingClientRect()),
    targetPlacements: targets.map((target) => {
      const rect = target.getBoundingClientRect();
      return squarePlacement(
        rect,
        Math.max(1, rect.width, rect.height, target.offsetWidth, target.offsetHeight)
      );
    }),
  });

  const placeDot = (dot, placement, opacity) => {
    gsap.set(dot, {
      autoAlpha: opacity,
      height: placement.height,
      width: placement.width,
      x: placement.left,
      y: placement.top,
    });
  };

  const markComplete = () => {
    if (completed) return;
    completed = true;
    setBridgeState(true);
  };

  const markPending = () => {
    if (!completed && field.dataset.controlBridgeState === 'pending') return;
    completed = false;
    setBridgeState(false);
  };

  const applyProgress = (rawProgress) => {
    const progress = clamp01(rawProgress);
    if (progress <= 0) {
      resetStates();
      clearEntrance();
      clearDots();
      return;
    }
    applyEntrance(progress);
    setMoving(true);
    if (progress >= COMPLETE_THRESHOLD) markComplete();
    else markPending();
    const { sourcePlacement, targetPlacements } = measurePlacements();
    const firstTarget = targetPlacements[0];
    const flyT = easeOutCubic(normalize(progress, 0, HANDOFF_AT));
    const spreadT = easeOutCubic(normalize(progress, HANDOFF_AT, COMPLETE_AT));
    const fadeOut = 1 - normalize(progress, FADE_START, 1);
    const spreading = progress >= HANDOFF_AT;
    dotsDirty = true;
    dots.forEach((dot, index) => {
      const targetPlacement = targetPlacements[index];
      const placement = spreading
        ? interpolatePlacement(firstTarget, targetPlacement, spreadT)
        : interpolatePlacement(sourcePlacement, firstTarget, flyT);
      const spawnOpacity = easeOutCubic(normalize(spreadT, 0.08, 0.42));
      const opacity = index === 0 ? fadeOut : fadeOut * spawnOpacity;
      placeDot(dot, placement, opacity);
    });
  };

  resetStates();
  const trigger = ScrollTrigger.create({
    trigger: controlScene,
    start: TRIGGER_START,
    end: TRIGGER_END,
    scrub: true,
    onLeave: () => applyProgress(1),
    onLeaveBack: () => applyProgress(0),
    onRefresh: ({ progress }) => applyProgress(progress),
    onUpdate: ({ progress }) => applyProgress(progress),
  });

  const unbindLifecycle = bindPageLifecycle(() => disposeBridge, setupTimeReplayToControlBridge);
  disposeBridge = () => {
    unbindLifecycle();
    trigger.kill();
    setMoving(false);
    delete field.dataset.controlBridgeState;
    delete controlScene.dataset.controlBridgeState;
    clearEntrance();
    clearDots();
    layer.remove();
    disposeBridge = undefined;
  };
};
