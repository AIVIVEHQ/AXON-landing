// gate-question 场景：文案 reveal 工厂 + 光晕 canvas 兜底。
// 对照原站 rewind-transition 模块内嵌的 question reveal（动画参数逐值保留）；
// reveal 的触发时机由 rewind 场景的滚动进度驱动（见 js/scenes/rewind.js）。
import { setupFocalLightCanvas } from '../lib/focal-light.js';

const SELECTORS = {
  content: '.gate-question__content',
  lead: '.gate-question__lead',
  headlineLine: '.gate-question__headline-line',
};

const REVEAL = {
  content: { initialY: '0.42svh', revealDuration: 0.34, revealEase: 'power2.out' },
  lead: { initialY: 8, revealDelay: 0.04, revealDuration: 0.62, stagger: 0.028 },
  headline: {
    initialY: '0.42em',
    initialScale: 0.985,
    revealDelay: 0.16,
    revealDuration: 0.92,
    stagger: 0.058,
    transformOrigin: '50% 60%',
  },
};

/**
 * 创建 question 文案 reveal 控制器（lead 先、三行 headline 逐词后）。
 * 返回 { reset, reveal, revert }；DOM 不满足条件时返回 undefined。
 */
export const createQuestionReveal = (section, options = {}) => {
  const { gsap, SplitText } = window;
  const content = section.querySelector(SELECTORS.content);
  const lead = section.querySelector(SELECTORS.lead);
  const headlineLines = gsap.utils.toArray(SELECTORS.headlineLine, section);
  if (!content || !lead || headlineLines.length === 0) return undefined;

  const leadSplit = SplitText.create(lead, {
    aria: 'none',
    type: 'words',
    wordsClass: 'gate-question__lead-word',
    tag: 'span',
    reduceWhiteSpace: false,
  });
  const headlineSplits = headlineLines.map((line) =>
    SplitText.create(line, {
      aria: 'none',
      type: 'words',
      wordsClass: 'gate-question__headline-word',
      tag: 'span',
      reduceWhiteSpace: false,
    }));
  const leadWords = gsap.utils.toArray(leadSplit.words);
  const headlineWords = headlineSplits.flatMap((split) => gsap.utils.toArray(split.words));
  const allWords = [...leadWords, ...headlineWords];
  if (leadWords.length === 0 || headlineWords.length === 0) {
    leadSplit.revert();
    headlineSplits.forEach((split) => split.revert());
    return undefined;
  }

  let state = 'idle';
  let reverted = false;
  const clearInline = () => {
    gsap.set([content, ...allWords], { clearProps: 'all' });
  };
  const revertSplits = () => {
    if (reverted) return;
    reverted = true;
    leadSplit.revert();
    headlineSplits.forEach((split) => split.revert());
  };
  const restore = () => {
    clearInline();
    revertSplits();
  };

  gsap.set(content, { autoAlpha: 0, y: REVEAL.content.initialY });
  gsap.set(leadWords, { autoAlpha: 0, display: 'inline-block', y: REVEAL.lead.initialY });
  gsap.set(headlineWords, {
    autoAlpha: 0,
    display: 'inline-block',
    y: REVEAL.headline.initialY,
    scale: REVEAL.headline.initialScale,
    transformOrigin: REVEAL.headline.transformOrigin,
  });

  const timeline = gsap.timeline({
    paused: true,
    defaults: { ease: 'power3.out' },
    onStart: () => {
      state = 'revealing';
      section.dataset.questionMotion = 'running';
    },
    onComplete: () => {
      state = 'done';
      section.dataset.questionMotion = 'done';
      if (options.autoRevertOnComplete) restore();
    },
  });
  timeline
    .to(content, {
      autoAlpha: 1,
      y: '0svh',
      duration: REVEAL.content.revealDuration,
      ease: REVEAL.content.revealEase,
    })
    .to(leadWords, {
      autoAlpha: 1,
      y: 0,
      duration: REVEAL.lead.revealDuration,
      stagger: REVEAL.lead.stagger,
    }, REVEAL.lead.revealDelay)
    .to(headlineWords, {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      duration: REVEAL.headline.revealDuration,
      stagger: { each: REVEAL.headline.stagger, from: 'start' },
    }, REVEAL.headline.revealDelay);

  return {
    reset: () => {
      if (state === 'idle' || reverted) return;
      state = 'idle';
      section.dataset.questionMotion = 'idle';
      timeline.pause(0);
      gsap.set(content, { autoAlpha: 0, y: REVEAL.content.initialY });
      gsap.set(leadWords, { autoAlpha: 0, y: REVEAL.lead.initialY });
      gsap.set(headlineWords, {
        autoAlpha: 0,
        y: REVEAL.headline.initialY,
        scale: REVEAL.headline.initialScale,
      });
    },
    reveal: () => {
      if (state === 'revealing' || state === 'done' || reverted) return;
      timeline.play(0);
    },
    revert: () => {
      delete section.dataset.questionMotion;
      timeline.kill();
      restore();
    },
  };
};

/**
 * question 场景独立初始化：只负责全站焦点光晕 canvas 的绘制兜底。
 * 文案 reveal 与光晕锚定/接力全部由 rewind 场景的 ScrollTrigger 驱动；
 * comfort（减弱动效）模式下无任何 JS 初始状态，文案由 CSS 静态展示。
 */
export function initQuestion() {
  if (document.documentElement.dataset.globalLights === 'off') return;
  setupFocalLightCanvas();
}
