// 控制场景，对照原站 controlScene 移植。
// 桌面（sceneColumns）：pin 住整段，按滚动进度在 5 个状态间轮换
//   active → down-protect → up-protect → paused → resumed；
// 窄屏（sceneStacked）：不 pin，只在离开/回退时切到首尾状态。
// 状态卡视觉与策略点 data-side 联动全部由 CSS 按 data-control-state 驱动。
import { BREAKPOINTS, matches } from '../config.js';
import { isMotionReduced } from '../lib/motion.js';
import { onPageHideRebind } from '../lib/bridge-utils.js';

const SELECTORS = {
  scene: '.control-scene',
  field: '.control-field',
  state: '[data-control-status]',
};
const NAV_EVENT = 'sitesectionnavigationtarget';
const PIN_LENGTH = { max: 1500, min: 920, viewportRatio: 1.35 };
const NAV_PIN_OFFSET = 4;
const MOBILE_HEIGHT_TOLERANCE = 150;
const PIN_CLEAR_PROPS = 'left,right,width,maxWidth';
const STATE_BANDS = [
  { progress: 0, state: 'active' },
  { progress: 0.22, state: 'down-protect' },
  { progress: 0.44, state: 'up-protect' },
  { progress: 0.66, state: 'paused' },
  { progress: 0.84, state: 'resumed' },
];

let teardown;

const pinnedLength = () =>
  Math.round(Math.min(PIN_LENGTH.max, Math.max(PIN_LENGTH.min, window.innerHeight * PIN_LENGTH.viewportRatio)));

const stateForProgress = (progress) => {
  let state = STATE_BANDS[0].state;
  STATE_BANDS.forEach((band) => {
    if (progress >= band.progress) state = band.state;
  });
  return state;
};

/** 状态区间中点，点击状态卡时滚到这里。 */
const bandMidpoint = (state) => {
  const index = STATE_BANDS.findIndex((band) => band.state === state);
  const band = STATE_BANDS[index] ?? STATE_BANDS[0];
  const nextProgress = STATE_BANDS[index + 1]?.progress ?? 1;
  return band.progress + (nextProgress - band.progress) / 2;
};

const scrollToPinnedProgress = (trigger, fraction) => {
  const raw = trigger.start + (trigger.end - trigger.start) * fraction;
  const top = Math.min(trigger.end, Math.max(trigger.start, raw));
  const smoother = window.ScrollSmoother?.get?.();
  if (smoother) {
    smoother.scrollTo(top, true);
    return;
  }
  window.scrollTo({ behavior: 'smooth', top });
};

// 原站在 resize 时动态加载 controlSceneResize 协调 pin 重排（模块未随 reference 下载）。
// 此处简化：忽略触屏地址栏引起的纯高度抖动（≤150px）后，清掉 pin 内联尺寸并
// 按帧去抖调度一次 ScrollTrigger.refresh()。
const createPinnedResizeRefresh = (clearPinProps) => {
  let width = window.innerWidth;
  let height = window.innerHeight;
  let frame = 0;
  const isIgnorableResize = () => {
    const nextWidth = window.innerWidth;
    const nextHeight = window.innerHeight;
    const widthChanged = nextWidth !== width;
    const heightDelta = Math.abs(nextHeight - height);
    const touchLike = matches(BREAKPOINTS.coarsePointer) || matches(BREAKPOINTS.tabletAndBelow);
    width = nextWidth;
    height = nextHeight;
    return !widthChanged && touchLike && heightDelta <= MOBILE_HEIGHT_TOLERANCE;
  };
  const onResize = () => {
    if (isIgnorableResize() || frame !== 0) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      clearPinProps();
      window.ScrollTrigger.refresh();
    });
  };
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onResize, { passive: true });
  return () => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    if (frame !== 0) window.cancelAnimationFrame(frame);
  };
};

const setup = () => {
  teardown?.();
  const { gsap, ScrollTrigger } = window;
  const scene = document.querySelector(SELECTORS.scene);
  const field = scene?.querySelector(SELECTORS.field);
  const stateButtons = Array.from(scene?.querySelectorAll(SELECTORS.state) ?? []);
  if (!scene || !field) return;

  let currentState = field.dataset.controlState;
  let pinTrigger;
  let pinRefreshed = false;

  const applyState = (state) => {
    if (currentState === state) return;
    currentState = state;
    field.dataset.controlState = state;
    stateButtons.forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.controlStatus === state ? 'true' : 'false');
    });
  };

  const clearPinProps = () => {
    gsap.set(scene, { clearProps: PIN_CLEAR_PROPS });
  };
  const clearPinPropsIfPinned = () => {
    if (pinRefreshed) clearPinProps();
  };
  const removeResizeRefresh = createPinnedResizeRefresh(clearPinProps);

  const onStateClick = (event) => {
    const status = event.currentTarget.dataset.controlStatus;
    if (!status) return;
    if (pinTrigger) {
      // pin 生效时点击 = 滚到对应状态区间中点，让滚动驱动切换
      event.preventDefault();
      scrollToPinnedProgress(pinTrigger, bandMidpoint(status));
      return;
    }
    applyState(status);
  };

  // 站内导航跳到本节：落在 pin 起点稍后，保证初始状态可见
  const onNavigationTarget = (event) => {
    const detail = event.detail;
    if (detail?.targetId !== scene.id || !pinTrigger || typeof detail.setScrollTop !== 'function') return;
    detail.setScrollTop(Math.min(pinTrigger.end, pinTrigger.start + NAV_PIN_OFFSET));
  };

  stateButtons.forEach((button) => {
    button.addEventListener('click', onStateClick);
  });
  window.addEventListener(NAV_EVENT, onNavigationTarget);

  const media = gsap.matchMedia();
  media?.add(BREAKPOINTS.sceneStacked, () => {
    const trigger = ScrollTrigger.create({
      trigger: scene,
      start: 'top bottom',
      end: 'bottom 78%',
      onLeave: () => applyState('resumed'),
      onLeaveBack: () => applyState('active'),
    });
    return () => {
      trigger.kill();
    };
  });
  media?.add(BREAKPOINTS.sceneColumns, () => {
    const syncState = (self) => {
      applyState(stateForProgress(self.progress));
    };
    pinTrigger = ScrollTrigger.create({
      trigger: scene,
      start: 'top top',
      end: () => `+=${pinnedLength()}`,
      pin: true,
      pinSpacing: true,
      anticipatePin: 1,
      onRefreshInit: clearPinPropsIfPinned,
      onEnter: syncState,
      onEnterBack: syncState,
      onLeave: () => applyState('resumed'),
      onLeaveBack: () => applyState('active'),
      onRefresh: (self) => {
        pinRefreshed = true;
        syncState(self);
      },
      onUpdate: syncState,
    });
    return () => {
      pinTrigger?.kill();
      pinTrigger = undefined;
    };
  });

  const unbindPageHide = onPageHideRebind(() => teardown, setup);
  teardown = () => {
    removeResizeRefresh();
    unbindPageHide();
    window.removeEventListener(NAV_EVENT, onNavigationTarget);
    stateButtons.forEach((button) => {
      button.removeEventListener('click', onStateClick);
    });
    media?.revert();
    applyState('active');
    teardown = undefined;
  };
};

// comfort：无滚动驱动，点击状态卡直接切换（对照原站 controlInteraction 模块的行为）。
const setupComfortInteraction = () => {
  const scene = document.querySelector(SELECTORS.scene);
  const field = scene?.querySelector(SELECTORS.field);
  const stateButtons = Array.from(scene?.querySelectorAll(SELECTORS.state) ?? []);
  if (!scene || !field) return;
  stateButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const status = button.dataset.controlStatus;
      if (!status || field.dataset.controlState === status) return;
      field.dataset.controlState = status;
      stateButtons.forEach((other) => {
        other.setAttribute('aria-pressed', other.dataset.controlStatus === status ? 'true' : 'false');
      });
    });
  });
};

export function initControl() {
  if (isMotionReduced()) {
    setupComfortInteraction();
    return;
  }
  setup();
}
