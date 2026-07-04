// 平滑滚动运行时：ScrollSmoother 包裹 .scroll-shell / .scroll-shell__content。
// 对照原站 scroll-runtime 模块：desktop 0.75、触屏/平板 0.5、comfort 0.25，
// smoothTouch 关闭，触屏走 normalizeScroll。
import { BREAKPOINTS, SMOOTH, matches } from './config.js';
import { isMotionReduced, onMotionPreferenceChange } from './lib/motion.js';

const MENU_SCROLL_LOCK_EVENT = 'sitemenuscrolllock';

let smoother = null;
let pausedByMenu = false;

const isTouchLike = () => matches(BREAKPOINTS.coarsePointer) || matches(BREAKPOINTS.tabletAndBelow);

const smoothAmount = () => {
  if (isMotionReduced()) return SMOOTH.comfort;
  return isTouchLike() ? SMOOTH.touch : SMOOTH.desktop;
};

export const getSmoother = () => smoother;

export const setupScrollRuntime = () => {
  const { ScrollSmoother, ScrollTrigger } = window;
  ScrollTrigger.config({
    autoRefreshEvents: 'visibilitychange,DOMContentLoaded',
    ignoreMobileResize: true,
  });

  const wrapper = document.querySelector('.scroll-shell');
  const content = document.querySelector('.scroll-shell__content');
  if (!wrapper || !content) return null;

  const root = document.documentElement;
  const amount = smoothAmount();
  smoother = ScrollSmoother.create({
    wrapper,
    content,
    smooth: amount,
    smoothTouch: false,
    effects: false,
    normalizeScroll: isTouchLike(),
    ignoreMobileResize: true,
  });
  root.dataset.scrollRuntime = 'smoother';
  root.dataset.scrollSmoothAmount = String(amount);

  // 菜单打开时锁定滚动
  window.addEventListener(MENU_SCROLL_LOCK_EVENT, (event) => {
    const locked = Boolean(event.detail?.locked);
    if (!smoother) return;
    if (locked) {
      pausedByMenu = smoother.paused();
      smoother.paused(true);
    } else if (!pausedByMenu) {
      smoother.paused(false);
    }
  });

  // motion 偏好变化 → 调整平滑系数
  onMotionPreferenceChange(() => {
    if (smoother) smoother.smooth(smoothAmount());
    root.dataset.scrollSmoothAmount = String(smoothAmount());
  });

  // hash 导航（含初始 hash）：直接落位后刷新
  const navigateToHash = () => {
    const hash = window.location.hash;
    if (hash.length <= 1) return;
    let target;
    try {
      target = document.getElementById(decodeURIComponent(hash.slice(1)));
    } catch {
      return;
    }
    if (!target) return;
    if (target.id === 'hero') {
      smoother.scrollTo(0, false);
    } else {
      smoother.scrollTo(target, false, 'top top');
    }
    requestAnimationFrame(() => ScrollTrigger.refresh());
  };
  window.addEventListener('hashchange', navigateToHash);
  if (window.location.hash.length > 1) {
    requestAnimationFrame(navigateToHash);
  }

  // 字体加载完成后刷新一次几何
  if (document.fonts?.status !== 'loaded') {
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  }

  return smoother;
};
