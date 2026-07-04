// 产品入口场景，对照原站 productEntryScene 移植：
// 文案 reveal，同一时间线上追加产品截图浮入（.42）、
// 5 个 marker 依次点亮（.66, stagger .045）、动作按钮浮入（.78）。
import { isMotionReduced } from '../lib/motion.js';
import { createSceneReveal } from '../lib/scene-reveal.js';
import { onPageHideRebind } from '../lib/bridge-utils.js';

const SELECTORS = {
  actions: '.product-entry-scene__actions',
  body: '.product-entry-scene__intro .scene-body',
  eyebrow: '.product-entry-scene__intro .scene-eyebrow',
  marker: '.product-entry-proof__marker',
  proof: '.product-entry-proof',
  scene: '.product-entry-scene',
  title: '.product-entry-scene__intro .scene-title',
};

let teardown;

const setIfAny = (targets, vars) => {
  if (targets.length !== 0) window.gsap.set(targets, vars);
};

const setup = () => {
  teardown?.();
  const { gsap } = window;
  const scene = document.querySelector(SELECTORS.scene);
  const title = scene?.querySelector(SELECTORS.title);
  const body = scene?.querySelector(SELECTORS.body);
  const eyebrow = scene?.querySelector(SELECTORS.eyebrow);
  const proof = scene?.querySelector(SELECTORS.proof);
  if (!scene || !title || !body || !proof) return;
  const markers = gsap.utils.toArray(scene.querySelectorAll(SELECTORS.marker));
  const actions = gsap.utils.toArray(scene.querySelectorAll(SELECTORS.actions));

  const reveal = createSceneReveal({
    body,
    bodyPosition: 0.24,
    bodyWordsClass: 'product-entry-scene__body-word',
    eyebrow,
    start: 'top 62%',
    title,
    titleStagger: 0.048,
    titleWordsClass: 'product-entry-scene__title-word',
    trigger: scene,
  });
  if (!reveal) return;

  gsap.set(proof, { autoAlpha: 0, scale: 0.992, transformOrigin: '50% 20%', y: 28 });
  setIfAny(markers, { autoAlpha: 0, y: 10 });
  setIfAny(actions, { autoAlpha: 0, y: 14 });
  reveal.timeline.to(proof, { autoAlpha: 1, duration: 0.78, scale: 1, y: 0 }, 0.42);
  if (markers.length > 0) {
    reveal.timeline.to(markers, { autoAlpha: 1, duration: 0.42, stagger: 0.045, y: 0 }, 0.66);
  }
  if (actions.length > 0) {
    reveal.timeline.to(actions, { autoAlpha: 1, duration: 0.52, y: 0 }, 0.78);
  }

  const unbindPageHide = onPageHideRebind(() => teardown, setup);
  teardown = () => {
    unbindPageHide();
    reveal.cleanup([proof, ...markers, ...actions]);
    teardown = undefined;
  };
};

export function initProductEntry() {
  // comfort：原站不初始化本场景，静态展示
  if (isMotionReduced()) return;
  setup();
}
