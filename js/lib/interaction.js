// 站点交互运行时 + 全局鼠标跟随光。
// 对照原站 interaction-runtime / viewportRefreshScheduler / globalHoverLight 模块，数值逐值保留。
// 运行时聚合「当前段落 / 是否滚动中 / 指针类型 / 页面可见性」，
// 写入 html[data-interaction-section] / [data-interaction-scroll] 并向订阅者广播。
import { BREAKPOINTS } from '../config.js';

const STATE_CHANGE_EVENT = 'siteinteractionstatechange';
const SMOOTH_SCROLL_STATE_EVENT = 'sitesmoothscrollstatechange';
const REWIND_REFRESH_START_EVENT = 'rewindtransitionrefreshstart';
const REWIND_REFRESH_END_EVENT = 'rewindtransitionrefreshend';
const REWIND_PHASE_EVENT = 'rewindtransitionphasechange';

const HERO_TOP_MAX_SCROLL = 1;
const MIN_SCROLL_DELTA = 1;
const SCROLL_IDLE_MS = 180;
// 触屏地址栏伸缩：宽度/方向不变且高度差 ≤150px 时视为软 resize，不触发刷新
const SOFT_RESIZE_HEIGHT_DELTA = 150;
const REFRESH_SETTLE_MS = 180;
const RESIZE_DEBOUNCE_MS = 150;
const SECTION_THRESHOLDS = [0, 0.12, 0.25, 0.45, 0.65, 0.85, 1];

let initialized = false;
let state = {
  activeSection: null,
  isFinePointer: false,
  isScrolling: false,
  isVisible: typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
};

const listeners = new Set();
const sectionRatios = new Map();

let scrollIdleTimer = 0;
let refreshSettleTimer = 0;
let resizeTimer = 0;
let scrollEpoch = 0;
let refreshEpoch = 0;
let lastScrollTop = 0;
let rewindRefreshing = false;
let rewindPhase;
let smootherScrollTop;
let viewportSnapshot;
let finePointerQuery;
let sectionObserver;

const usesSmootherRuntime = () => document.documentElement.dataset.scrollRuntime === 'smoother';

const readNativeScrollTop = () =>
  document.scrollingElement?.scrollTop ?? document.documentElement.scrollTop ?? 0;

// 原站优先用 ScrollSmoother 广播的 scrollTop（sitesmoothscrollstatechange），否则读原生
const readScrollTop = () =>
  usesSmootherRuntime() && smootherScrollTop !== undefined ? smootherScrollTop : readNativeScrollTop();

const hasHeroSection = () => document.querySelector('[data-section="hero"]') !== null;

const heroPinnedToTop = () => hasHeroSection() && readScrollTop() <= HERO_TOP_MAX_SCROLL;

const sectionNameOf = (element) => element.dataset.section || element.dataset.scene || element.id || null;

const highestRatioSection = () => {
  let best = null;
  let bestRatio = 0;
  sectionRatios.forEach((ratio, name) => {
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = name;
    }
  });
  return bestRatio > 0 ? best : null;
};

const viewportCoverageSection = () => {
  const elements = Array.from(document.querySelectorAll('[data-section], [data-scene]'));
  const viewportHeight = Math.max(window.innerHeight, 1);
  let best = null;
  let bestCoverage = 0;
  elements.forEach((element) => {
    const name = sectionNameOf(element);
    if (!name) return;
    const rect = element.getBoundingClientRect();
    const top = Math.max(0, rect.top);
    const bottom = Math.min(viewportHeight, rect.bottom);
    const coverage = Math.max(0, bottom - top);
    if (coverage > bestCoverage) {
      bestCoverage = coverage;
      best = name;
    }
  });
  return bestCoverage > 0 ? best : null;
};

// rewind 过场分相位覆盖：tunnel 期间无激活段落，question 相位兜底为 question
const resolveActiveSection = () => {
  if (heroPinnedToTop()) return 'hero';
  const section = highestRatioSection() ?? viewportCoverageSection();
  if (rewindPhase === 'tunnel') return null;
  if (rewindPhase === 'hero') return 'hero';
  if (rewindPhase === 'question') return section && section !== 'hero' ? section : 'question';
  return section;
};

const emit = () => {
  const root = document.documentElement;
  root.dataset.interactionSection = state.activeSection ?? '';
  if (state.isScrolling) {
    root.dataset.interactionScroll = 'active';
  } else {
    delete root.dataset.interactionScroll;
  }
  listeners.forEach((listener) => listener({ ...state }));
  window.dispatchEvent(new CustomEvent(STATE_CHANGE_EVENT, { detail: { ...state } }));
};

const setState = (patch) => {
  const next = { ...state, ...patch };
  const changed =
    next.activeSection !== state.activeSection ||
    next.isFinePointer !== state.isFinePointer ||
    next.isScrolling !== state.isScrolling ||
    next.isVisible !== state.isVisible;
  state = next;
  if (changed) emit();
};

const refreshActiveSection = () => {
  setState({ activeSection: resolveActiveSection() });
};

const clearScrollIdle = () => {
  if (scrollIdleTimer !== 0) {
    window.clearTimeout(scrollIdleTimer);
    scrollIdleTimer = 0;
  }
};

const markScrollIdle = () => {
  clearScrollIdle();
  lastScrollTop = readScrollTop();
  setState({ isScrolling: false });
};

const scheduleScrollIdle = (epoch) => {
  clearScrollIdle();
  scrollIdleTimer = window.setTimeout(() => {
    scrollIdleTimer = 0;
    if (epoch === scrollEpoch) markScrollIdle();
  }, SCROLL_IDLE_MS);
};

const handleScrollTop = (top, epoch) => {
  if (epoch !== scrollEpoch) return;
  if (top <= HERO_TOP_MAX_SCROLL) {
    markScrollIdle();
    return;
  }
  if (rewindRefreshing) return;
  const delta = Math.abs(top - lastScrollTop);
  lastScrollTop = top;
  if (delta < MIN_SCROLL_DELTA) {
    if (state.isScrolling) scheduleScrollIdle(epoch);
    return;
  }
  setState({ isScrolling: true });
  scheduleScrollIdle(epoch);
};

const bumpScrollEpoch = () => {
  scrollEpoch += 1;
  markScrollIdle();
};

const clearRefreshSettle = () => {
  if (refreshSettleTimer !== 0) {
    window.clearTimeout(refreshSettleTimer);
    refreshSettleTimer = 0;
  }
};

const settle = (epoch) => {
  if (epoch !== refreshEpoch) return;
  markScrollIdle();
  refreshActiveSection();
  emit();
};

// 双 rAF + 180ms 定时双保险，等布局稳定后再校正段落
const settleAfterRefresh = (epoch) => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => settle(epoch));
  });
  refreshSettleTimer = window.setTimeout(() => {
    refreshSettleTimer = 0;
    settle(epoch);
  }, REFRESH_SETTLE_MS);
};

const handleViewportRefresh = () => {
  refreshEpoch += 1;
  const epoch = refreshEpoch;
  bumpScrollEpoch();
  clearRefreshSettle();
  refreshActiveSection();
  emit();
  settleAfterRefresh(epoch);
};

const handleRewindRefreshStart = () => {
  rewindRefreshing = true;
  bumpScrollEpoch();
  clearRefreshSettle();
  refreshActiveSection();
  emit();
};

const handleRewindRefreshEnd = () => {
  rewindRefreshing = false;
  refreshEpoch += 1;
  const epoch = refreshEpoch;
  bumpScrollEpoch();
  clearRefreshSettle();
  refreshActiveSection();
  emit();
  settleAfterRefresh(epoch);
};

const onNativeScroll = () => {
  if (usesSmootherRuntime() && smootherScrollTop !== undefined) return;
  handleScrollTop(readScrollTop(), scrollEpoch);
};

const onSmoothScrollState = (event) => {
  const detail = event.detail;
  if (!detail?.active) return;
  if (typeof detail.scrollTop === 'number') smootherScrollTop = detail.scrollTop;
  handleScrollTop(smootherScrollTop !== undefined ? smootherScrollTop : readScrollTop(), scrollEpoch);
};

const setupSectionObserver = () => {
  const elements = Array.from(document.querySelectorAll('[data-section], [data-scene]'));
  if (typeof IntersectionObserver === 'undefined') {
    refreshActiveSection();
    return;
  }
  sectionObserver?.disconnect();
  sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const name = entry.target instanceof HTMLElement ? sectionNameOf(entry.target) : null;
        if (name) sectionRatios.set(name, entry.isIntersecting ? entry.intersectionRatio : 0);
      });
      refreshActiveSection();
    },
    { threshold: SECTION_THRESHOLDS },
  );
  elements.forEach((element) => sectionObserver?.observe(element));
  refreshActiveSection();
};

const readViewportSnapshot = () => ({
  coarsePointer: window.matchMedia(BREAKPOINTS.coarsePointer).matches,
  height: window.innerHeight,
  orientation: window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait',
  tabletAndBelow: window.matchMedia(BREAKPOINTS.tabletAndBelow).matches,
  width: window.innerWidth,
});

const isSoftResize = (prev, next) => {
  const heightDelta = Math.abs(next.height - prev.height);
  const touchLike = prev.coarsePointer || next.coarsePointer || prev.tabletAndBelow || next.tabletAndBelow;
  return (
    prev.width === next.width &&
    prev.orientation === next.orientation &&
    touchLike &&
    heightDelta <= SOFT_RESIZE_HEIGHT_DELTA
  );
};

const shouldScheduleRefresh = () => {
  const next = readViewportSnapshot();
  const prev = viewportSnapshot;
  if (!prev) {
    viewportSnapshot = next;
    return true;
  }
  if (
    prev.width !== next.width ||
    prev.height !== next.height ||
    prev.orientation !== next.orientation ||
    prev.tabletAndBelow !== next.tabletAndBelow ||
    prev.coarsePointer !== next.coarsePointer
  ) {
    viewportSnapshot = next;
    return !isSoftResize(prev, next);
  }
  return false;
};

const scheduleViewportRefresh = () => {
  if (!shouldScheduleRefresh()) return;
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(handleViewportRefresh, RESIZE_DEBOUNCE_MS);
};

const sectionEnabled = (section, snapshot = state) => {
  if (rewindRefreshing || snapshot.isScrolling) return false;
  if (section === 'hero' && heroPinnedToTop()) return snapshot.isFinePointer && snapshot.isVisible;
  return snapshot.isFinePointer && snapshot.isVisible && snapshot.activeSection === section;
};

const decorEnabled = (snapshot = state) => {
  if (rewindRefreshing) return false;
  return snapshot.isFinePointer && !snapshot.isScrolling && snapshot.isVisible && snapshot.activeSection !== 'hero';
};

const init = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined' || initialized) return;
  initialized = true;
  lastScrollTop = readScrollTop();
  viewportSnapshot = readViewportSnapshot();
  finePointerQuery = window.matchMedia(BREAKPOINTS.finePointer);
  setState({
    activeSection: viewportCoverageSection(),
    isFinePointer: finePointerQuery.matches,
    isScrolling: false,
    isVisible: document.visibilityState !== 'hidden',
  });
  setupSectionObserver();
  finePointerQuery.addEventListener('change', () => {
    setState({ isFinePointer: finePointerQuery?.matches ?? false });
  });
  document.addEventListener('visibilitychange', () => {
    setState({ isVisible: document.visibilityState !== 'hidden' });
  });
  window.addEventListener(REWIND_REFRESH_START_EVENT, handleRewindRefreshStart);
  window.addEventListener(REWIND_REFRESH_END_EVENT, handleRewindRefreshEnd);
  window.addEventListener(SMOOTH_SCROLL_STATE_EVENT, onSmoothScrollState);
  window.addEventListener('scroll', onNativeScroll, { passive: true });
  window.addEventListener('resize', scheduleViewportRefresh, { passive: true });
  window.addEventListener('orientationchange', scheduleViewportRefresh, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleViewportRefresh, { passive: true });
  window.addEventListener(
    REWIND_PHASE_EVENT,
    (event) => {
      const phase = event.detail?.phase;
      rewindPhase = phase === 'hero' || phase === 'tunnel' || phase === 'question' ? phase : undefined;
      refreshActiveSection();
    },
    { passive: true },
  );
};

export const initInteractionRuntime = () => init();

export const getInteractionRuntimeState = () => {
  init();
  return { ...state };
};

export const isSectionInteractionEnabled = (section) => {
  init();
  return sectionEnabled(section);
};

export const isGlobalDecorEnabled = () => {
  init();
  return decorEnabled();
};

export const onSectionInteractionChange = (section, handler) => {
  init();
  let last;
  const listener = (snapshot) => {
    const enabled = sectionEnabled(section, snapshot);
    if (last !== enabled) {
      last = enabled;
      handler(enabled, snapshot);
    }
  };
  listeners.add(listener);
  listener({ ...state });
  return () => {
    listeners.delete(listener);
  };
};

export const onGlobalDecorChange = (handler) => {
  init();
  let last;
  const listener = (snapshot) => {
    const enabled = decorEnabled(snapshot);
    if (last !== enabled) {
      last = enabled;
      handler(enabled, snapshot);
    }
  };
  listeners.add(listener);
  listener({ ...state });
  return () => {
    listeners.delete(listener);
  };
};

// ---- 全局鼠标跟随光（对照原站 globalHoverLight 模块）----

const HOVER_LIGHT_SELECTOR = '[data-site-hover-light]';
const HOVER_QUIET_ZONE_SELECTOR = '[data-contact-form]';
const HOVER_LIGHT_OPACITY = 0.86;
const HOVER_LIGHT_QUIET_OPACITY = 0.18;

let teardownHoverLight;

export const setupGlobalHoverLight = () => {
  if (teardownHoverLight) return;
  const light = document.querySelector(HOVER_LIGHT_SELECTOR);
  const { gsap } = window;
  if (!light || !gsap) return;

  let enabled = isGlobalDecorEnabled();
  let positioned = false;
  let width = light.offsetWidth;
  let height = light.offsetHeight;
  // 焦点落在静默区（表单）时熄灭，避免打字时光斑晃动
  let quietFocus =
    document.activeElement instanceof HTMLElement &&
    !!document.activeElement.closest(HOVER_QUIET_ZONE_SELECTOR);

  const followConfig = { duration: 0.08, ease: 'power3.out' };
  const moveX = gsap.quickTo(light, 'x', followConfig);
  const moveY = gsap.quickTo(light, 'y', followConfig);
  const fade = gsap.quickTo(light, 'opacity', { duration: 0.18, ease: 'power2.out' });

  const measure = () => {
    width = light.offsetWidth;
    height = light.offsetHeight;
  };
  const hide = () => {
    fade(0);
  };
  const quietZoneOf = (target) => (target instanceof Element ? target.closest(HOVER_QUIET_ZONE_SELECTOR) : null);

  // 首次移动直接 set 定位，避免光斑从 (0,0) 飞过来
  const moveTo = (x, y) => {
    if (!positioned) {
      gsap.set(light, { x, y });
      positioned = true;
      return;
    }
    moveX(x);
    moveY(y);
  };

  const onPointerMove = (event) => {
    if (!enabled) return;
    if (quietFocus) {
      hide();
      return;
    }
    const x = event.clientX - width / 2;
    const y = event.clientY - height / 2;
    const opacity = quietZoneOf(event.target) ? HOVER_LIGHT_QUIET_OPACITY : HOVER_LIGHT_OPACITY;
    moveTo(x, y);
    fade(opacity);
  };

  const onPointerOut = (event) => {
    if (event.relatedTarget === null) hide();
  };

  const onPageHide = (event) => {
    teardownHoverLight?.();
    // bfcache 恢复时重挂
    if (event.persisted) window.addEventListener('pageshow', setupGlobalHoverLight, { once: true });
  };

  const onFocusIn = (event) => {
    quietFocus = !!quietZoneOf(event.target);
    if (quietFocus) hide();
  };

  const onFocusOut = (event) => {
    quietFocus = !!quietZoneOf(event.relatedTarget);
  };

  const offDecorChange = onGlobalDecorChange((next) => {
    enabled = next;
    if (!next) {
      positioned = false;
      hide();
      return;
    }
    measure();
  });

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          measure();
        });
  resizeObserver?.observe(light);

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerout', onPointerOut, { passive: true });
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  window.addEventListener('blur', hide);
  window.addEventListener('pagehide', onPageHide);

  teardownHoverLight = () => {
    offDecorChange();
    resizeObserver?.disconnect();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerout', onPointerOut);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    window.removeEventListener('blur', hide);
    window.removeEventListener('pagehide', onPageHide);
    gsap.set(light, { opacity: 0 });
    moveX.tween.kill();
    moveY.tween.kill();
    fade.tween.kill();
    teardownHoverLight = undefined;
  };
};
