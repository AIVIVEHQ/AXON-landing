// 策略场景焦点光：随滚动把 question 场景的站点光晕“飞”到 strategy 靶心，
// 同一条 scrub 时间线同时驱动 intro 文案与 8 张卡片入场、靶环与时间光点浮现。
// 对照原站 strategyFocalLight 模块（选择器、时间轴参数逐值一致）。
// 原站用 GSAP Flip 插件做光晕换父级的位移/缩放插值；模板未引入 Flip，
// 这里用 rect 差值手写等价的 FLIP（translate + scale，效果一致）。

const SELECTORS = {
  light: '[data-site-focal-light]',
  sourceAnchor: '[data-site-light-anchor="question"]',
  targetAnchor: '[data-site-light-anchor="strategy"]',
  question: '.gate-question',
  scene: '.strategy-scene',
  intro: '.strategy-scene__intro > *',
  target: '.strategy-object__target',
  targetChrome: '.strategy-object__target-shell, .strategy-object__core-ring',
  targetDot: '[data-strategy-time-dot]',
  sourceCards: '.strategy-map__column--source > *',
  resolvedCards: '.strategy-map__column--resolved > *',
};

const TARGET_FOCAL_OPACITY_FALLBACK = 0.74;
const SOURCE_FOCAL_OPACITY = 0.74;
// 场景进度到 0.62 时光晕抵达靶心（与时间光点浮现同步）
const LIGHT_ARRIVE_PROGRESS = 0.62;
const SCENE_START = 'top 72%';
// 手写 flip 额外写入 transformOrigin，这里一并清除
const RESTORE_CLEAR_PROPS =
  'bottom,height,inset,left,position,right,top,transform,transformOrigin,width,x,y,scale,scaleX,scaleY,zIndex';
const DOT_RESTORED_EVENT = 'cryptowl:strategy-dot-restored';

let cleanup;

const clamp01 = (value) => Math.min(Math.max(value, 0), 1);

const readCssNumber = (styles, property, fallback) => {
  const value = Number.parseFloat(styles.getPropertyValue(property));
  return Number.isFinite(value) ? value : fallback;
};

export const setupStrategyFocalLight = (options = {}) => {
  const { revealScene = true } = options;
  if (cleanup) return;
  const { gsap } = window;

  const light = document.querySelector(SELECTORS.light);
  const sourceAnchor = document.querySelector(SELECTORS.sourceAnchor);
  const targetAnchor = document.querySelector(SELECTORS.targetAnchor);
  const scene = targetAnchor?.closest(SELECTORS.scene);
  const question = document.querySelector(SELECTORS.question);
  const restoreParent = sourceAnchor ?? light?.parentElement;
  const restoreNext = sourceAnchor ? null : light?.nextSibling ?? null;
  if (!light || !targetAnchor || !scene || !restoreParent) return;

  let flipTween;
  let timeline;
  let trigger;
  let placement; // 'source' | 'target' | undefined（flip 进行中）
  let rafId = 0;
  let pendingProgress = 0;

  const setIfAny = (targets, vars) => {
    if (targets.length !== 0) gsap.set(targets, vars);
  };

  const readTargetOpacity = () =>
    readCssNumber(getComputedStyle(scene ?? targetAnchor), '--strategy-focal-opacity', TARGET_FOCAL_OPACITY_FALLBACK);

  const restoreDom = () => {
    if (restoreNext && restoreNext.parentElement === restoreParent) {
      restoreParent.insertBefore(light, restoreNext);
      light.dataset.lightMode = 'anchor';
      return;
    }
    restoreParent.appendChild(light);
    light.dataset.lightMode = 'anchor';
  };

  const clearLight = () => {
    gsap.set(light, { clearProps: RESTORE_CLEAR_PROPS });
  };

  const placeAt = (parent, opacity) => {
    parent.appendChild(light);
    light.dataset.lightMode = 'anchor';
    clearLight();
    gsap.set(light, { opacity, zIndex: 0 });
  };

  const placeAtSource = () => {
    if (sourceAnchor) {
      placeAt(sourceAnchor, SOURCE_FOCAL_OPACITY);
      placement = 'source';
    }
  };

  const placeAtTarget = () => {
    placeAt(targetAnchor, readTargetOpacity());
    placement = 'target';
  };

  const killFlip = () => {
    flipTween?.kill();
    flipTween = undefined;
  };

  const cancelRaf = () => {
    if (rafId !== 0) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  // 手写 FLIP：source/target 各摆放测量一次，落位 target 后用 x/y/scale 差值回放
  const createFlip = () => {
    killFlip();
    placeAtSource();
    const from = light.getBoundingClientRect();
    placeAtTarget();
    const to = light.getBoundingClientRect();
    flipTween = gsap.fromTo(
      light,
      {
        scaleX: from.width / Math.max(to.width, 1),
        scaleY: from.height / Math.max(to.height, 1),
        transformOrigin: '0 0',
        x: from.left - to.left,
        y: from.top - to.top,
      },
      { duration: 1, ease: 'none', paused: true, scaleX: 1, scaleY: 1, x: 0, y: 0 },
    );
    placement = undefined;
  };

  const isFlipManaged = () =>
    !!flipTween || light.parentElement === sourceAnchor || light.parentElement === targetAnchor;

  const restoreToSource = () => {
    if (!isFlipManaged()) return;
    if (!flipTween && placement === 'source') return;
    killFlip();
    placeAtSource();
  };

  const setFlipProgress = (value) => {
    const progress = clamp01(value);
    if (!flipTween || light.parentElement !== targetAnchor) createFlip();
    flipTween?.progress(progress);
  };

  const applyScrollProgress = (value) => {
    const progress = clamp01(value);
    if (progress <= 0) {
      restoreToSource();
      return;
    }
    setFlipProgress(progress / LIGHT_ARRIVE_PROGRESS);
  };

  // refresh 后布局已变，杀掉旧 flip 用新几何重建
  const applyAfterRefresh = (progress) => {
    killFlip();
    if (progress > 0) {
      applyScrollProgress(progress);
      return;
    }
    restoreToSource();
  };

  const scheduleRefreshApply = (progress) => {
    pendingProgress = progress;
    if (rafId === 0) {
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        applyAfterRefresh(pendingProgress);
      });
    }
  };

  // 桥接把时间光点送回后，重新按当前滚动进度同步时间线与光晕
  const syncFromTrigger = () => {
    if (!timeline || !trigger) return;
    const progress = clamp01(trigger.progress);
    timeline.progress(progress);
    applyScrollProgress(progress);
  };

  const jumpToTarget = () => {
    killFlip();
    placeAtTarget();
  };

  const collectElements = () => ({
    intro: gsap.utils.toArray(SELECTORS.intro, scene),
    resolvedCards: gsap.utils.toArray(SELECTORS.resolvedCards, scene),
    sourceCards: gsap.utils.toArray(SELECTORS.sourceCards, scene),
    target: scene.querySelector(SELECTORS.target),
    targetChrome: gsap.utils.toArray(SELECTORS.targetChrome, scene),
    targetDot: scene.querySelector(SELECTORS.targetDot),
  });

  const showAll = () => {
    const { intro, resolvedCards, sourceCards, target, targetChrome, targetDot } = collectElements();
    const groups = [intro, sourceCards, resolvedCards, targetChrome].flat();
    const singles = [target, targetDot].filter((el) => !!el);
    setIfAny([...groups, ...singles], { autoAlpha: 1, clearProps: 'x,y,scale' });
  };

  const showStaticScene = () => {
    showAll();
    jumpToTarget();
  };

  const onPageHide = (event) => {
    cleanup?.();
    if (event.persisted) {
      window.addEventListener('pageshow', () => setupStrategyFocalLight({ revealScene }), { once: true });
    }
  };

  if (!question || !sourceAnchor) {
    showStaticScene();
  } else {
    const { intro, resolvedCards, sourceCards, target, targetChrome, targetDot } = collectElements();
    const targetList = target ? [target] : [];
    const dotList = targetDot ? [targetDot] : [];

    timeline = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: scene,
        start: SCENE_START,
        endTrigger: target ?? scene,
        end: 'center center',
        scrub: true,
        invalidateOnRefresh: true,
        onEnter: ({ progress }) => {
          applyScrollProgress(progress);
        },
        onEnterBack: ({ progress }) => {
          applyScrollProgress(progress);
        },
        onLeave: () => {
          setFlipProgress(1);
        },
        onLeaveBack: () => {
          restoreToSource();
        },
        onRefresh: (self) => scheduleRefreshApply(self.progress),
        onUpdate: ({ progress }) => {
          applyScrollProgress(progress);
        },
      },
    });
    trigger = timeline.scrollTrigger;

    if (revealScene) {
      // 初始隐藏态
      setIfAny(intro, { autoAlpha: 0, y: 18 });
      if (targetList.length > 0) gsap.set(targetList, { autoAlpha: 1, clearProps: 'scale,transform' });
      setIfAny(targetChrome, { autoAlpha: 0, scale: 0.96, transformOrigin: '50% 50%' });
      if (dotList.length > 0) gsap.set(dotList, { autoAlpha: 0, scale: 0.36, transformOrigin: '50% 50%' });
      setIfAny(sourceCards, { autoAlpha: 0, x: -18, y: 10 });
      setIfAny(resolvedCards, { autoAlpha: 0, x: 18, y: 10 });

      // scrub 进度表：0.34 intro → 0.40 靶环 → 0.48 左列 → 0.54 右列 → 0.62 光点
      if (intro.length > 0) {
        timeline.fromTo(
          intro,
          { autoAlpha: 0, y: 18 },
          { autoAlpha: 1, duration: 0.34, immediateRender: false, stagger: 0.035, y: 0 },
          0.34,
        );
      }
      if (targetChrome.length > 0) {
        timeline.fromTo(
          targetChrome,
          { autoAlpha: 0, scale: 0.96 },
          { autoAlpha: 1, duration: 0.32, immediateRender: false, scale: 1 },
          0.4,
        );
      }
      if (sourceCards.length > 0) {
        timeline.fromTo(
          sourceCards,
          { autoAlpha: 0, x: -18, y: 10 },
          { autoAlpha: 1, duration: 0.38, immediateRender: false, stagger: 0.035, x: 0, y: 0 },
          0.48,
        );
      }
      if (resolvedCards.length > 0) {
        timeline.fromTo(
          resolvedCards,
          { autoAlpha: 0, x: 18, y: 10 },
          { autoAlpha: 1, duration: 0.38, immediateRender: false, stagger: 0.035, x: 0, y: 0 },
          0.54,
        );
      }
      if (dotList.length > 0) {
        timeline.fromTo(
          dotList,
          { autoAlpha: 0, scale: 0.36 },
          { autoAlpha: 1, duration: 0.18, ease: 'power2.out', immediateRender: false, scale: 1 },
          LIGHT_ARRIVE_PROGRESS,
        );
      }
    } else {
      showAll();
    }
    syncFromTrigger();
  }

  window.addEventListener('pagehide', onPageHide);
  window.addEventListener(DOT_RESTORED_EVENT, syncFromTrigger);

  cleanup = () => {
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener(DOT_RESTORED_EVENT, syncFromTrigger);
    trigger?.kill();
    timeline?.kill();
    trigger = undefined;
    timeline = undefined;
    cancelRaf();
    killFlip();
    restoreDom();
    clearLight();
    cleanup = undefined;
  };
};
