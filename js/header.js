// Header 菜单开合 + 焦点管理，对照原站 Header.astro 内联脚本；
// 并接入全站交互运行时与鼠标跟随光（BaseDocument 内联脚本 + globalHoverLight）。
// 差异：原站 hash 链接走 sitesectionnavigate 编排（等场景懒加载后 scrollIntoView），
// 本模板全量预载，hash 链接不阻断默认行为，交给 scroll-runtime 的 hashchange 落位。
import { BREAKPOINTS, matches } from './config.js';
import { isComfortMotion, onMotionPreferenceChange } from './lib/motion.js';
import { initInteractionRuntime, setupGlobalHoverLight } from './lib/interaction.js';

// 与 css/header.css 的 .header-menu 关闭过渡时长对齐
const MENU_CLOSE_MS = 260;
const SCROLL_LOCK_EVENT = 'sitemenuscrolllock';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// 原站在 BaseDocument 按「非 comfort 且 fine pointer」懒加载 hover 光；
// 原站 comfort⇄full 切换靠整页刷新重新走该判定，这里改为监听偏好变化补挂。
const maybeSetupHoverLight = () => {
  if (isComfortMotion() || !matches(BREAKPOINTS.finePointer)) return;
  setupGlobalHoverLight();
};

const playSubtleEntry = (header, trigger, gsap) => {
  if (!header || !header.classList.contains('header--subtle-entry')) return;
  if (header.dataset.subtleHeaderMotion === 'ready') return;
  const brand = header.querySelector('.header__brand');
  if (!brand || !trigger || !gsap || isComfortMotion()) {
    header.dataset.subtleHeaderMotion = 'ready';
    return;
  }
  header.dataset.subtleHeaderMotion = 'ready';
  const targets = [brand, trigger];
  const timeline = gsap.timeline({
    defaults: { duration: 0.25, ease: 'power2.out' },
    onComplete: () => {
      gsap.set(targets, { clearProps: 'opacity,transform' });
    },
  });
  timeline
    .fromTo(brand, { opacity: 0, y: -6 }, { opacity: 1, y: 0 }, 0.1)
    .fromTo(trigger, { opacity: 0, y: -6 }, { opacity: 1, y: 0 }, 0.18);
  window.addEventListener('pagehide', () => timeline.kill(), { once: true });
};

const bindMenu = ({ header, trigger, menu, closers, links }) => {
  let closeTimer = 0;
  let lastFocused;

  const focusables = () =>
    Array.from(menu.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
    );

  const normalizePath = (pathname) => {
    const trimmed = pathname.replace(/\/+$/, '');
    return trimmed.length ? trimmed : '/';
  };
  const isSamePage = (url) =>
    url.origin === window.location.origin &&
    normalizePath(url.pathname) === normalizePath(window.location.pathname);
  const hashTarget = (link) => {
    const url = new URL(link.href, window.location.href);
    if (!isSamePage(url) || !url.hash) return undefined;
    return document.getElementById(decodeURIComponent(url.hash.slice(1))) ?? undefined;
  };
  const isSamePageWithoutHash = (link) => {
    const url = new URL(link.href, window.location.href);
    return isSamePage(url) && !url.hash;
  };
  const isPlainClick = (event) =>
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

  const clearNavigationState = () => {
    header.classList.remove('is-menu-navigating');
    links.forEach((link) => {
      delete link.dataset.menuNavigationState;
    });
  };
  const markNavigating = (link) => {
    clearNavigationState();
    header.classList.add('is-menu-navigating');
    link.dataset.menuNavigationState = 'loading';
  };

  const applyMenuState = (open) => {
    if (open) header.classList.remove('is-menu-closing');
    header.classList.toggle('is-menu-open', open);
    trigger.setAttribute('aria-expanded', String(open));
    trigger.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    menu.setAttribute('aria-hidden', String(!open));
    document.documentElement.toggleAttribute('data-menu-open', open);
    window.dispatchEvent(new CustomEvent(SCROLL_LOCK_EVENT, { detail: { locked: open } }));
  };

  const settleFocus = (restore) => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    if (!restore) {
      if (active && menu.contains(active)) active.blur();
      return;
    }
    (lastFocused?.isConnected ? lastFocused : trigger).focus({ preventScroll: true });
  };

  const openMenu = () => {
    window.clearTimeout(closeTimer);
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    menu.hidden = false;
    // 先解除 hidden 再下一帧加状态类，保证开启过渡能播放
    window.requestAnimationFrame(() => {
      applyMenuState(true);
      focusables()[0]?.focus({ preventScroll: true });
    });
  };

  const closeMenu = ({ restoreFocus = true } = {}) => {
    window.clearTimeout(closeTimer);
    clearNavigationState();
    header.classList.add('is-menu-closing');
    settleFocus(restoreFocus);
    applyMenuState(false);
    closeTimer = window.setTimeout(() => {
      menu.hidden = true;
      header.classList.remove('is-menu-closing');
    }, MENU_CLOSE_MS);
  };

  const toggleMenu = () => {
    if (header.classList.contains('is-menu-open')) {
      closeMenu();
      return;
    }
    openMenu();
  };

  const onDocumentKeydown = (event) => {
    if (!header.classList.contains('is-menu-open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  trigger.addEventListener('click', toggleMenu);
  closers.forEach((closer) => {
    closer.addEventListener('click', () => closeMenu());
  });
  links.forEach((link) => {
    link.addEventListener('click', (event) => {
      if (!isPlainClick(event)) return;
      if (hashTarget(link)) {
        // 不 preventDefault：hash 变化后由 scroll-runtime 的 hashchange 落位
        closeMenu({ restoreFocus: false });
        return;
      }
      if (isSamePageWithoutHash(link)) {
        event.preventDefault();
        closeMenu({ restoreFocus: false });
        return;
      }
      // 跨页链接：标记 loading 态并放行导航
      markNavigating(link);
      settleFocus(false);
    });
  });
  document.addEventListener('keydown', onDocumentKeydown);
  window.addEventListener('pagehide', () => {
    window.clearTimeout(closeTimer);
    clearNavigationState();
    applyMenuState(false);
  });
};

export function initHeader(ctx) {
  const gsap = ctx?.gsap ?? window.gsap;
  const header = document.querySelector('[data-site-header]');
  const trigger = header?.querySelector('[data-header-menu-trigger]') ?? null;
  const menu = header?.querySelector('[data-header-menu]') ?? null;
  const closers = Array.from(header?.querySelectorAll('[data-header-menu-close]') ?? []);
  const links = Array.from(header?.querySelectorAll('[data-header-menu-link]') ?? []);

  initInteractionRuntime();
  maybeSetupHoverLight();
  onMotionPreferenceChange(maybeSetupHoverLight);

  if (header && trigger && menu && header.dataset.menuRuntime !== 'ready') {
    header.dataset.menuRuntime = 'ready';
    bindMenu({ header, trigger, menu, closers, links });
  }

  playSubtleEntry(header, trigger, gsap);
}
