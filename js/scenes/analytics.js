// 分析场景，对照原站 analyticsScene 移植：文案 reveal + 画布随滚动淡入。
// control → analytics 桥接（策略点飞入 / 曲线绘制 / 节点点亮）在
// js/lib/analytics-bridge.js，此处按原站顺序（先场景后桥接）一并初始化。
import { isMotionReduced } from '../lib/motion.js';
import { createSceneReveal } from '../lib/scene-reveal.js';
import { onPageHideRebind } from '../lib/bridge-utils.js';
import { setupControlToAnalyticsBridge } from '../lib/analytics-bridge.js';

const SELECTORS = {
  body: '.analytics-scene__intro .scene-body',
  canvas: '.analytics-flow__canvas',
  eyebrow: '.analytics-scene__intro .scene-eyebrow',
  intro: '.analytics-scene__intro',
  scene: '.analytics-scene',
  title: '.analytics-scene__intro .scene-title',
};

let teardown;

const setup = () => {
  teardown?.();
  const { gsap, ScrollTrigger } = window;
  const scene = document.querySelector(SELECTORS.scene);
  const intro = scene?.querySelector(SELECTORS.intro);
  const title = scene?.querySelector(SELECTORS.title);
  const body = scene?.querySelector(SELECTORS.body);
  const eyebrow = scene?.querySelector(SELECTORS.eyebrow);
  const canvas = scene?.querySelector(SELECTORS.canvas);
  if (!scene || !intro || !title || !body || !canvas) return;

  const reveal = createSceneReveal({
    body,
    bodyDuration: 0.58,
    bodyPosition: 0.22,
    bodyStagger: 0.018,
    bodyWordsClass: 'analytics-scene__body-word',
    eyebrow,
    start: 'top 78%',
    title,
    titleDuration: 0.84,
    titleStagger: 0.052,
    titleWordsClass: 'analytics-scene__title-word',
    trigger: intro,
  });

  // 画布整体随滚动淡入（scrub）
  gsap.set(canvas, { autoAlpha: 0 });
  const fade = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
  fade.fromTo(canvas, { autoAlpha: 0 }, { autoAlpha: 1, duration: 1, immediateRender: false });
  const fadeTrigger = ScrollTrigger.create({
    animation: fade,
    end: 'top 62%',
    scrub: true,
    start: 'top 92%',
    trigger: canvas,
  });

  const unbindPageHide = onPageHideRebind(() => teardown, setup);
  teardown = () => {
    unbindPageHide();
    fadeTrigger.kill();
    fade.kill();
    gsap.set(canvas, { clearProps: 'all' });
    reveal?.cleanup();
    teardown = undefined;
  };
};

export function initAnalytics() {
  // comfort：原站不初始化本场景与桥接，静态展示
  if (isMotionReduced()) return;
  setup();
  setupControlToAnalyticsBridge();
}
