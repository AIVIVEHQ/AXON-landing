// 出口场景 + 页脚显隐。
// 场景部分对照原站 exitScene：文案 reveal + 动作按钮浮入（.58, stagger .06），
// 并带「初始已在视口内」的一次性 rAF 兜底播放。
// 页脚部分对照原站 SiteFooter 脚本：data-footer-reveal pending ↔ visible，
// rule 横线展开 + 内容浮入，comfort 下直接置为 visible。
import { isMotionReduced } from '../lib/motion.js';
import { createSceneReveal } from '../lib/scene-reveal.js';
import { onPageHideRebind } from '../lib/bridge-utils.js';

const SELECTORS = {
  action: '.exit-scene__action',
  body: '.exit-scene__body',
  eyebrow: '.exit-scene__intro .scene-eyebrow',
  inner: '.exit-scene__inner',
  scene: '.exit-scene',
  title: '.exit-scene__intro .scene-title',
};
const VIEWPORT_VISIBLE_RATIO = 0.88;

const FOOTER = {
  content: '.site-footer__content',
  footer: '[data-site-footer][data-footer-reveal]',
  rule: '.site-footer__rule',
};

let sceneTeardown;
let footerTeardown;

const setIfAny = (targets, vars) => {
  if (targets.length !== 0) window.gsap.set(targets, vars);
};

const isInViewport = (element) => {
  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  return rect.top < viewportHeight * VIEWPORT_VISIBLE_RATIO && rect.bottom > 0;
};

const setupExitScene = () => {
  sceneTeardown?.();
  const { gsap } = window;
  const scene = document.querySelector(SELECTORS.scene);
  const inner = scene?.querySelector(SELECTORS.inner);
  const title = scene?.querySelector(SELECTORS.title);
  const body = scene?.querySelector(SELECTORS.body);
  const eyebrow = scene?.querySelector(SELECTORS.eyebrow);
  if (!scene || !inner || !title || !body) return;
  const actions = gsap.utils.toArray(scene.querySelectorAll(SELECTORS.action));

  const reveal = createSceneReveal({
    body,
    bodyPosition: 0.26,
    bodyWordsClass: 'exit-scene__body-word',
    eyebrow,
    start: 'top 84%',
    title,
    titleStagger: 0.05,
    titleWordsClass: 'exit-scene__title-word',
    trigger: inner,
  });
  if (!reveal) return;

  setIfAny(actions, { autoAlpha: 0, y: 14 });
  if (actions.length > 0) {
    reveal.timeline.to(actions, { autoAlpha: 1, duration: 0.52, stagger: 0.06, y: 0 }, 0.58);
  }

  // 兜底：初始就在视口内但 ScrollTrigger 起点未触发时直接播放
  let frame = window.requestAnimationFrame(() => {
    frame = 0;
    if (reveal.timeline.progress() === 0 && !reveal.timeline.isActive() && isInViewport(inner)) {
      reveal.timeline.play(0);
    }
  });

  const unbindPageHide = onPageHideRebind(() => sceneTeardown, setupExitScene);
  sceneTeardown = () => {
    if (frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
    unbindPageHide();
    reveal.cleanup(actions);
    sceneTeardown = undefined;
  };
};

const clearInlineStyles = (elements) => {
  elements.forEach((element) => {
    element.style.removeProperty('opacity');
    element.style.removeProperty('visibility');
    element.style.removeProperty('transform');
  });
};

const footerParts = (footer) =>
  [footer.querySelector(FOOTER.rule), footer.querySelector(FOOTER.content)].filter((part) => !!part);

const setFooterRevealState = (footer, state) => {
  footer.dataset.footerReveal = state;
};

const setupSingleFooter = (footer) => {
  const { gsap, ScrollTrigger } = window;
  const parts = footerParts(footer);
  const [rule, content] = parts;
  if (!rule || !content) {
    setFooterRevealState(footer, 'visible');
    return () => {};
  }
  gsap.set(rule, { autoAlpha: 0, scaleX: 0.7, transformOrigin: '0 50%' });
  gsap.set(content, { autoAlpha: 0, y: 8 });
  const timeline = gsap.timeline({ defaults: { ease: 'power3.out' }, paused: true });
  timeline
    .to(rule, { autoAlpha: 1, duration: 0.5, scaleX: 1 }, 0)
    .to(content, { autoAlpha: 1, duration: 0.4, y: 0 }, 0.06);
  const show = () => {
    setFooterRevealState(footer, 'visible');
    timeline.play();
  };
  const hide = () => {
    setFooterRevealState(footer, 'pending');
    timeline.reverse();
  };
  const trigger = ScrollTrigger.create({
    trigger: footer,
    start: 'top bottom',
    end: 'bottom top',
    onEnter: show,
    onEnterBack: show,
    onLeave: hide,
    onLeaveBack: hide,
    onRefresh: (self) => {
      if (self.isActive) show();
      else hide();
    },
  });
  return () => {
    trigger.kill();
    timeline.kill();
    clearInlineStyles(parts);
  };
};

const setupFooterReveal = () => {
  footerTeardown?.();
  const footers = Array.from(document.querySelectorAll(FOOTER.footer));
  if (footers.length === 0) return;
  if (isMotionReduced()) {
    footers.forEach((footer) => {
      setFooterRevealState(footer, 'visible');
      clearInlineStyles(footerParts(footer));
    });
    return;
  }
  const cleanups = footers.map((footer) => setupSingleFooter(footer));
  const unbindPageHide = onPageHideRebind(() => footerTeardown, setupFooterReveal);
  footerTeardown = () => {
    unbindPageHide();
    cleanups.forEach((cleanup) => cleanup());
    footerTeardown = undefined;
  };
};

export function initExit() {
  // comfort：场景 reveal 不初始化（静态展示），页脚仍要置为 visible
  if (!isMotionReduced()) setupExitScene();
  setupFooterReveal();
}
