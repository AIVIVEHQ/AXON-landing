// 通用场景入场：eyebrow + 标题逐词 + 正文逐词（SplitText），挂 ScrollTrigger。
// 对照原站 sceneReveal 模块，动画参数逐值保留。
export const createSceneReveal = ({
  body,
  bodyDuration = 0.54,
  bodyPosition = 0.24,
  bodyStagger = 0.016,
  bodyWordsClass,
  eyebrow,
  eyebrowDuration = 0.42,
  eyebrowPosition = 0,
  start,
  title,
  titleDuration = 0.78,
  titlePosition,
  titleStagger = 0.048,
  titleWordsClass,
  toggleActions = 'play none none reverse',
  trigger,
}) => {
  const { gsap, ScrollTrigger, SplitText } = window;
  const titleSplit = SplitText.create(title, {
    aria: 'none',
    reduceWhiteSpace: false,
    tag: 'span',
    type: 'words',
    wordsClass: titleWordsClass,
  });
  const bodySplit = SplitText.create(body, {
    aria: 'none',
    reduceWhiteSpace: false,
    tag: 'span',
    type: 'words',
    wordsClass: bodyWordsClass,
  });
  const titleWords = gsap.utils.toArray(titleSplit.words);
  const bodyWords = gsap.utils.toArray(bodySplit.words);
  if (titleWords.length === 0 || bodyWords.length === 0) {
    titleSplit.revert();
    bodySplit.revert();
    return undefined;
  }
  const allTargets = [...titleWords, ...bodyWords];
  if (eyebrow) allTargets.push(eyebrow);

  gsap.set(titleWords, {
    autoAlpha: 0,
    display: 'inline-block',
    scale: 0.988,
    transformOrigin: '50% 70%',
    y: '0.34em',
  });
  gsap.set(bodyWords, { autoAlpha: 0, display: 'inline-block', y: 8 });
  if (eyebrow) gsap.set(eyebrow, { autoAlpha: 0, y: 8 });

  const timeline = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
  if (eyebrow) {
    timeline.to(eyebrow, { autoAlpha: 1, duration: eyebrowDuration, y: 0 }, eyebrowPosition);
  }
  timeline
    .to(titleWords, {
      autoAlpha: 1,
      duration: titleDuration,
      scale: 1,
      stagger: { each: titleStagger, from: 'start' },
      y: 0,
    }, titlePosition ?? (eyebrow ? 0.08 : 0))
    .to(bodyWords, {
      autoAlpha: 1,
      duration: bodyDuration,
      stagger: bodyStagger,
      y: 0,
    }, bodyPosition);

  const scrollTrigger = ScrollTrigger.create({
    animation: timeline,
    start,
    toggleActions,
    trigger,
  });

  return {
    bodyWords,
    titleWords,
    timeline,
    trigger: scrollTrigger,
    cleanup: (extraTargets = []) => {
      scrollTrigger.kill();
      timeline.kill();
      gsap.set([...allTargets, ...extraTargets], { clearProps: 'all' });
      titleSplit.revert();
      bodySplit.revert();
    },
  };
};
