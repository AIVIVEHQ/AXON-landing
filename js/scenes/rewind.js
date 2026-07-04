// hero 穿门/倒带滚动转场：pin 住 [data-rewind-track]，用其滚动进度驱动
// hero 文案淡出 → "Time" 字缩入拱门 → 世界透视放大越过相机 → 焦点光晕点亮
// → hero 图层退役（retired）→ question 文案 reveal，并把光晕从 fixed 接力到
// question 的锚点。对照原站 rewind-transition 模块，数值逐值保留。
import { BREAKPOINTS, BREAKPOINT_VALUES, matches } from '../config.js';
import { isComfortMotion, onMotionPreferenceChange } from '../lib/motion.js';
import { createQuestionReveal } from './question.js';

const HERO_INTRO_COMPLETE_EVENT = 'hero:intro:complete';
const PHASE_CHANGE_EVENT = 'rewindtransitionphasechange';
const INTRO_SETTLE_FRAMES = 2; // intro 完成后等 2 帧再建 pin（对照原站 post-complete window）

const SELECTORS = {
  transition: '[data-rewind-track]',
  hero: '.hero',
  heroWorld: '.hero__world',
  heroChart: '.hero__chart-stage',
  heroCopy: '.hero__content',
  heroHeadline: '.hero__headline',
  heroStrategy: '.hero__headline-line',
  heroTime: '.hero__headline-word',
  heroSubhead: '.hero__subhead',
  heroCta: '.hero__content-cta-frame',
  heroTimeline: '.hero__timeline',
  focalLight: '[data-site-focal-light]',
  question: '.gate-question',
  questionContent: '.gate-question__content',
  questionLightAnchor: '[data-site-light-anchor="question"]',
};

// 进度里程碑（0-1，相对 pin 距离）
const MILESTONES = {
  timeToLightStart: 0.46,
  heroRetireStart: 0.925,
  questionTextReset: 0.955,
  questionRevealStart: 0.96,
  heroRetireEnd: 0.965,
  questionTextReveal: 0.985,
};

// hero 各组文案的淡出（start 为进度位置，duration 为进度跨度）
const COPY_FADE = {
  chart: { start: 0.035, y: '-1.2svh', duration: 0.12, ease: 'power1.out' },
  timeline: { start: 0.06, y: '4svh', duration: 0.18, ease: 'power1.out' },
  cta: { start: 0.08, y: '3.6svh', duration: 0.18, ease: 'power1.out' },
  subhead: { start: 0.12, y: '2.6svh', duration: 0.2, ease: 'power1.out' },
  strategy: { start: 0.36, y: '-1.45svh', duration: 0.2, ease: 'power1.in' },
};

// hero__world 三段透视放大（exit 段的 scale/y 按 tier 决定），ease 均为 none
const WORLD_ZOOM = {
  bridge: { start: 0.08, scale: 1.22, y: '-1.8svh', duration: 0.22 },
  tunnel: { start: 0.3, scale: 2.35, y: '0svh', duration: 0.36 },
  exit: { start: 0.69, duration: 0.3 },
};

const QUESTION_CONTENT_INITIAL_Y = '1.2svh';
const HERO_PHASE_MAX_PROGRESS = 0.002;
const ROAD_FLOOR_VAR = '--hero-road-floor-opacity';
const TUNNEL_GLOW_VAR = '--hero-tunnel-depth-glow-opacity';

// "Time" 字缩入拱门 → 淡出，交棒给焦点光晕
const TIME_SHRINK_START = MILESTONES.timeToLightStart;
const TIME_SHRINK_DURATION = 0.22;
const TIME_FADE_START = TIME_SHRINK_START + TIME_SHRINK_DURATION * 0.8;
const TIME_FADE_DURATION = TIME_SHRINK_DURATION * 0.2;
const TIME_TARGET_SCALE = 0.045;
const TIME_ANCHOR_RATIO = 0.58; // "Time" 的 transform-origin / 收敛锚点（高度百分比）

// 焦点光晕：点亮（bridge）→ 增强至静息值 → z-index 回落
const LIGHT_Z_REST = 0;
const LIGHT_Z_RAISED = 2;
const LIGHT_IGNITE_START = TIME_SHRINK_START + TIME_SHRINK_DURATION * 0.95;
const LIGHT_IGNITE_DURATION = 0.055;
const LIGHT_BRIDGE_OPACITY = 0.5;
const LIGHT_REST_OPACITY = 0.74;
const LIGHT_REST_SCALE = 1;
const LIGHT_SETTLE_START = LIGHT_IGNITE_START + LIGHT_IGNITE_DURATION;
const LIGHT_SETTLE_DURATION = MILESTONES.questionRevealStart - LIGHT_SETTLE_START;
const LIGHT_ANCHOR_PROGRESS = MILESTONES.questionTextReveal;

// 视口变化：移动端仅高度小幅变化（地址栏收起等）不触发刷新
const RESIZE_HEIGHT_NOISE_PX = 150;
const RESIZE_REFRESH_DELAY_MS = 150;

// 断点档位（gsap.matchMedia 条件），命中即整套重建
const MEDIA_CONDITIONS = {
  phone: BREAKPOINTS.phone,
  tablet: BREAKPOINTS.tablet,
  desktop: BREAKPOINTS.desktop,
  short: BREAKPOINTS.short,
  landscape: BREAKPOINTS.landscape,
  portrait: BREAKPOINTS.portrait,
  coarsePointer: BREAKPOINTS.coarsePointer,
};

const TIERS = [
  {
    tier: 'desktop-fine',
    pinDistance: '+=100%',
    exitScale: 4.2,
    exitY: '7.5svh',
    roadFadeStart: 0.45,
    roadFadeDuration: 0.15,
    focalLightStartScale: 0.045,
    focalLightBridgeScale: 0.18,
  },
  {
    tier: 'desktop-touch',
    pinDistance: '+=100%',
    exitScale: 4,
    exitY: '5.2svh',
    roadFadeStart: 0.45,
    roadFadeDuration: 0.15,
    focalLightStartScale: 1,
    focalLightBridgeScale: 1,
  },
  {
    tier: 'tablet-portrait',
    pinDistance: '+=100%',
    exitScale: 3.55,
    exitY: '2.5svh',
    roadFadeStart: 0.4,
    roadFadeDuration: 0.15,
    focalLightStartScale: 1,
    focalLightBridgeScale: 1,
  },
  {
    tier: 'phone',
    pinDistance: '+=100%',
    exitScale: 2.75,
    exitY: '0.8svh',
    roadFadeStart: 0.3,
    roadFadeDuration: 0.15,
    focalLightStartScale: 1,
    focalLightBridgeScale: 1,
  },
];

const tierIndexFor = (c) => {
  if (c.phone || (c.short && c.landscape)) return 3;
  if (c.tablet && !c.landscape) return 2;
  if ((c.desktop && c.coarsePointer) || (c.tablet && c.landscape)) return 1;
  return 0;
};

const resolveTier = (conditions, { lowEnd = false } = {}) =>
  TIERS[Math.min(tierIndexFor(conditions) + (lowEnd ? 1 : 0), TIERS.length - 1)];

// 低端设备降一档（对照原站 device-quality 模块）
const isLowEndDevice = () => {
  if (typeof navigator === 'undefined') return false;
  const memory = navigator.deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 8;
  return navigator.connection?.saveData === true
    || (typeof memory === 'number' && memory <= 4)
    || cores <= 4;
};

const phaseForProgress = (progress) => {
  if (progress <= HERO_PHASE_MAX_PROGRESS) return 'hero';
  return progress < MILESTONES.questionRevealStart ? 'tunnel' : 'question';
};

const phaseOf = (trigger) => (trigger ? phaseForProgress(trigger.progress) : 'tunnel');

const clearHeroPointerState = (hero) => {
  if (hero.classList.contains('is-pointer-active')) hero.classList.remove('is-pointer-active');
  if (hero.dataset.timelineState) delete hero.dataset.timelineState;
};

const setPhase = (track, hero, phase, force = false) => {
  const unchanged = track.dataset.rewindPhase === phase && hero.dataset.rewindPhase === phase;
  if (unchanged && !force) return;
  if (phase !== 'hero') clearHeroPointerState(hero);
  track.dataset.rewindPhase = phase;
  hero.dataset.rewindPhase = phase;
  if (!unchanged) {
    window.dispatchEvent(new CustomEvent(PHASE_CHANGE_EVENT, { detail: { phase } }));
  }
};

const findQuestion = (track) =>
  track.nextElementSibling instanceof HTMLElement && track.nextElementSibling.matches(SELECTORS.question)
    ? track.nextElementSibling
    : document.querySelector(SELECTORS.question);

// 计算 "Time" 收敛到 world 中心所需的位移（消除 world 当前 scale 的影响）
const computeTimeWordOffset = (timeEl, worldEl) => {
  const timeRect = timeEl.getBoundingClientRect();
  const worldRect = worldEl.getBoundingClientRect();
  const scaleX = worldEl.offsetWidth > 0 ? worldRect.width / worldEl.offsetWidth : 1;
  const scaleY = worldEl.offsetHeight > 0 ? worldRect.height / worldEl.offsetHeight : scaleX;
  const timeCenterX = timeRect.left + timeRect.width / 2;
  const timeAnchorY = timeRect.top + timeRect.height * TIME_ANCHOR_RATIO;
  const localX = (timeCenterX - worldRect.left) / (scaleX || 1);
  const localY = (timeAnchorY - worldRect.top) / (scaleY || 1);
  return {
    x: worldEl.offsetWidth / 2 - localX,
    y: worldEl.offsetHeight / 2 - localY,
  };
};

// 光晕在点亮至 question reveal 之间抬高 z-index；回滚方向保持抬高
const lightZIndexFor = (progress, direction = 1) =>
  (direction < 0 && progress >= LIGHT_IGNITE_START)
    || (progress >= LIGHT_IGNITE_START && progress < MILESTONES.questionRevealStart)
    ? LIGHT_Z_RAISED
    : LIGHT_Z_REST;

/** 构建整套转场：滚动时间线 + 相态控制。返回销毁函数。 */
const createRewindTransition = (gsap, track, hero, question, tier) => {
  hero.dataset.rewindHeroLayer = 'true';
  track.dataset.rewindTier = tier.tier;

  const worlds = gsap.utils.toArray(SELECTORS.heroWorld, hero);
  const charts = gsap.utils.toArray(SELECTORS.heroChart, hero);
  const copies = gsap.utils.toArray(SELECTORS.heroCopy, hero);
  const headlines = gsap.utils.toArray(SELECTORS.heroHeadline, hero);
  const strategyLines = gsap.utils.toArray(SELECTORS.heroStrategy, hero);
  const timeWords = gsap.utils.toArray(SELECTORS.heroTime, hero);
  const subheads = gsap.utils.toArray(SELECTORS.heroSubhead, hero);
  const ctas = gsap.utils.toArray(SELECTORS.heroCta, hero);
  const heroTimelines = gsap.utils.toArray(SELECTORS.heroTimeline, hero);
  const lights = gsap.utils.toArray(SELECTORS.focalLight, document);
  const light = lights[0];
  const questionContent = question.querySelector(SELECTORS.questionContent) ?? question;
  const lightAnchor = question.querySelector(SELECTORS.questionLightAnchor);
  const heroCopyTargets = [
    ...headlines, ...strategyLines, ...timeWords, ...subheads, ...ctas, ...heroTimelines,
  ];
  const questionReveal = createQuestionReveal(question);

  gsap.set([track, hero], { clearProps: 'visibility' });
  gsap.set(question, { pointerEvents: 'none', zIndex: 3 });
  gsap.set(questionContent, { autoAlpha: 0, y: QUESTION_CONTENT_INITIAL_Y });
  gsap.set(timeWords, { transformOrigin: `50% ${TIME_ANCHOR_RATIO * 100}%` });
  gsap.set(lights, { transformOrigin: '50% 50%' });

  let heroRestored = false;
  let worldNeedsTransformClear = false;
  let timeTarget;
  let appliedLightZIndex;
  let lightState;

  // ---- 光晕状态机：rewind-hidden / rewind-bridge / question-rest ----
  const setLightMode = (mode) => {
    if (!light || light.dataset.lightMode === mode) return;
    light.dataset.lightMode = mode;
  };
  const clearLightState = () => {
    lightState = undefined;
  };
  const attachLightToBody = () => {
    if (!light) return;
    if (light.parentElement !== document.body) {
      document.body.appendChild(light);
      clearLightState();
    }
    setLightMode('rewind-fixed');
  };
  const hideLightFixed = () => {
    if (!light || lightState === 'rewind-hidden') return;
    gsap.set(light, {
      opacity: 0, scale: 1, transformOrigin: '50% 50%', x: 0, y: 0, zIndex: LIGHT_Z_REST,
    });
    attachLightToBody();
    lightState = 'rewind-hidden';
  };
  const bridgeLightFixed = () => {
    if (!light || lightState === 'rewind-bridge') return;
    gsap.set(light, {
      opacity: LIGHT_REST_OPACITY,
      scale: LIGHT_REST_SCALE,
      transformOrigin: '50% 50%',
      x: 0,
      y: 0,
      zIndex: LIGHT_Z_RAISED,
    });
    attachLightToBody();
    lightState = 'rewind-bridge';
  };
  const anchorLightToQuestion = () => {
    if (!light || !lightAnchor) return;
    if (lightState === 'question-rest' && light.parentElement === lightAnchor) return;
    if (light.parentElement !== lightAnchor) lightAnchor.appendChild(light);
    gsap.set(light, {
      opacity: LIGHT_REST_OPACITY, scale: 1, transformOrigin: '50% 50%', x: 0, y: 0, zIndex: LIGHT_Z_REST,
    });
    setLightMode('anchor');
    lightState = 'question-rest';
  };

  const setQuestionInteractive = (interactive) => {
    gsap.set(question, { pointerEvents: interactive ? 'auto' : 'none' });
  };

  // ---- hero/track 渲染退役（question 相态时背景转透明、指针穿透）----
  const setRetired = (retired) => {
    if (retired) {
      if (track.dataset.rewindRender === 'retired' && hero.dataset.rewindRender === 'retired') return;
      track.dataset.rewindRender = 'retired';
      hero.dataset.rewindRender = 'retired';
      return;
    }
    if (!track.dataset.rewindRender && !hero.dataset.rewindRender) return;
    delete track.dataset.rewindRender;
    delete hero.dataset.rewindRender;
  };
  const markTunnel = () => {
    heroRestored = false;
    worldNeedsTransformClear = true;
    setRetired(false);
  };
  const clearRoadVars = () => {
    hero.style.removeProperty(ROAD_FLOOR_VAR);
    hero.style.removeProperty(TUNNEL_GLOW_VAR);
  };
  const retireForQuestion = () => {
    markTunnel();
    gsap.set(hero, { [ROAD_FLOOR_VAR]: 0, [TUNNEL_GLOW_VAR]: 0 });
    setRetired(true);
  };
  const showWorld = () => {
    setRetired(false);
    gsap.set(worlds, { autoAlpha: 1, display: 'block' });
  };
  const restoreHero = (force = false) => {
    if (heroRestored && !force) return;
    const wasRetired = track.dataset.rewindRender === 'retired' || hero.dataset.rewindRender === 'retired';
    heroRestored = true;
    hideLightFixed();
    clearRoadVars();
    setRetired(false);
    if (worldNeedsTransformClear || wasRetired) {
      gsap.set(worlds, worldNeedsTransformClear
        ? { autoAlpha: 1, display: 'block', clearProps: 'transform' }
        : { autoAlpha: 1, display: 'block' });
    }
    worldNeedsTransformClear = false;
    setQuestionInteractive(false);
  };

  // 按进度同步光晕归属：>= anchor 进度挂到 question 锚点，<= 点亮进度隐藏
  const syncLight = (progress, direction = 1) => {
    if (!light) return;
    if (direction >= 0 && progress >= LIGHT_ANCHOR_PROGRESS) {
      anchorLightToQuestion();
      return;
    }
    attachLightToBody();
    if (progress <= LIGHT_IGNITE_START) {
      hideLightFixed();
      return;
    }
    clearLightState();
  };

  const syncQuestionText = (progress) => {
    if (!questionReveal) return;
    if (progress >= MILESTONES.questionTextReveal) {
      questionReveal.reveal();
      return;
    }
    if (progress <= MILESTONES.questionTextReset) questionReveal.reset();
  };

  const clearTimeTarget = () => {
    timeTarget = undefined;
  };
  const resolveTimeTarget = () => {
    if (!timeTarget && timeWords[0] && worlds[0]) {
      timeTarget = computeTimeWordOffset(timeWords[0], worlds[0]);
    }
    return timeTarget ?? { x: 0, y: 0 };
  };

  const applyLightZIndex = (progress, force = false, direction = 1) => {
    if (lights.length === 0) return;
    const zIndex = lightZIndexFor(progress, direction);
    if (!force && appliedLightZIndex === zIndex) return;
    appliedLightZIndex = zIndex;
    gsap.set(lights, { zIndex });
  };

  const triggerConfig = {
    trigger: track,
    start: 'top top',
    end: tier.pinDistance,
    pin: true,
    pinSpacing: false,
    scrub: true,
    refreshPriority: 2,
    invalidateOnRefresh: true,
    onUpdate: (self) => {
      const phase = phaseOf(self);
      applyLightZIndex(self.progress, false, self.direction);
      syncLight(self.progress, self.direction);
      if (phase === 'hero') restoreHero();
      else if (self.progress >= MILESTONES.heroRetireEnd) retireForQuestion();
      else markTunnel();
      syncQuestionText(self.progress);
      setPhase(track, hero, phase);
    },
    onRefresh: (self) => {
      clearTimeTarget();
      applyLightZIndex(self.progress, true);
      const phase = phaseOf(self);
      if (phase === 'hero') {
        restoreHero(true);
      } else if (phase === 'question') {
        retireForQuestion();
        setQuestionInteractive(true);
        syncLight(self.progress);
      } else {
        attachLightToBody();
        clearLightState();
        markTunnel();
        showWorld();
        setQuestionInteractive(false);
      }
      syncQuestionText(self.progress);
      setPhase(track, hero, phase, true);
    },
    onLeave: () => {
      applyLightZIndex(1, true);
      retireForQuestion();
      setQuestionInteractive(true);
      anchorLightToQuestion();
      questionReveal?.reveal();
      setPhase(track, hero, 'question');
    },
    onEnterBack: () => {
      clearTimeTarget();
      bridgeLightFixed();
      applyLightZIndex(timeline.scrollTrigger?.progress ?? 0, true, -1);
      retireForQuestion();
      gsap.set(worlds, { display: 'block' });
      setQuestionInteractive(false);
    },
    onLeaveBack: () => {
      clearTimeTarget();
      applyLightZIndex(0, true);
      restoreHero(true);
      questionReveal?.reset();
      setPhase(track, hero, 'hero');
    },
  };

  const timeline = gsap.timeline({
    defaults: { ease: 'none', lazy: false },
    scrollTrigger: triggerConfig,
  });

  // ---- hero 文案淡出 ----
  timeline
    .fromTo(charts, { autoAlpha: 1, y: '0svh' }, {
      autoAlpha: 0,
      y: COPY_FADE.chart.y,
      duration: COPY_FADE.chart.duration,
      ease: COPY_FADE.chart.ease,
      immediateRender: false,
    }, COPY_FADE.chart.start)
    .fromTo(heroTimelines, { autoAlpha: 1, y: '0svh' }, {
      autoAlpha: 0,
      y: COPY_FADE.timeline.y,
      duration: COPY_FADE.timeline.duration,
      ease: COPY_FADE.timeline.ease,
      immediateRender: false,
    }, COPY_FADE.timeline.start)
    .fromTo(ctas, { autoAlpha: 1, y: '0svh' }, {
      autoAlpha: 0,
      y: COPY_FADE.cta.y,
      duration: COPY_FADE.cta.duration,
      ease: COPY_FADE.cta.ease,
      immediateRender: false,
    }, COPY_FADE.cta.start)
    .fromTo(subheads, { autoAlpha: 1, y: '0svh' }, {
      autoAlpha: 0,
      y: COPY_FADE.subhead.y,
      duration: COPY_FADE.subhead.duration,
      ease: COPY_FADE.subhead.ease,
      immediateRender: false,
    }, COPY_FADE.subhead.start)
    .fromTo(strategyLines, { autoAlpha: 1, '--hero-strategy-scroll-y': '0svh' }, {
      autoAlpha: 0,
      '--hero-strategy-scroll-y': COPY_FADE.strategy.y,
      duration: COPY_FADE.strategy.duration,
      ease: COPY_FADE.strategy.ease,
      immediateRender: false,
    }, COPY_FADE.strategy.start);

  // ---- "Time" 缩入拱门并淡出 ----
  timeline
    .fromTo(timeWords, { autoAlpha: 1, scale: 1, x: 0, y: 0 }, {
      duration: TIME_SHRINK_DURATION,
      ease: 'power2.in',
      immediateRender: false,
      scale: TIME_TARGET_SCALE,
      x: () => resolveTimeTarget().x,
      y: () => resolveTimeTarget().y,
    }, TIME_SHRINK_START)
    .fromTo(timeWords, { autoAlpha: 1 }, {
      autoAlpha: 0,
      duration: TIME_FADE_DURATION,
      ease: 'power1.in',
      immediateRender: false,
    }, TIME_FADE_START);

  // ---- 世界三段透视放大（穿门）----
  timeline
    .fromTo(worlds, { scale: 1, y: '0svh' }, {
      scale: WORLD_ZOOM.bridge.scale,
      y: WORLD_ZOOM.bridge.y,
      duration: WORLD_ZOOM.bridge.duration,
      ease: 'none',
      immediateRender: false,
    }, WORLD_ZOOM.bridge.start)
    .fromTo(worlds, { scale: WORLD_ZOOM.bridge.scale, y: WORLD_ZOOM.bridge.y }, {
      scale: WORLD_ZOOM.tunnel.scale,
      y: WORLD_ZOOM.tunnel.y,
      duration: WORLD_ZOOM.tunnel.duration,
      ease: 'none',
      immediateRender: false,
    }, WORLD_ZOOM.tunnel.start)
    .fromTo(worlds, { scale: WORLD_ZOOM.tunnel.scale, y: WORLD_ZOOM.tunnel.y }, {
      scale: tier.exitScale,
      y: tier.exitY,
      duration: WORLD_ZOOM.exit.duration,
      ease: 'none',
      immediateRender: false,
    }, WORLD_ZOOM.exit.start);

  // ---- question 内容入场（滚动驱动的容器位移；逐词 reveal 由 questionReveal 播放）----
  timeline.fromTo(questionContent, { autoAlpha: 0, y: QUESTION_CONTENT_INITIAL_Y }, {
    autoAlpha: 1,
    y: '0svh',
    duration: 1 - MILESTONES.questionRevealStart,
    ease: 'power1.out',
    immediateRender: false,
  }, MILESTONES.questionRevealStart);

  // ---- 世界整体淡出（hero 退役窗口）----
  timeline.fromTo(worlds, { autoAlpha: 1 }, {
    autoAlpha: 0,
    duration: MILESTONES.heroRetireEnd - MILESTONES.heroRetireStart,
    ease: 'none',
    immediateRender: false,
  }, MILESTONES.heroRetireStart);

  // ---- 路面/隧道深处辉光淡出（CSS 变量）----
  timeline.fromTo(hero, {
    [ROAD_FLOOR_VAR]: 1,
    [TUNNEL_GLOW_VAR]: () => window.getComputedStyle(hero).getPropertyValue(TUNNEL_GLOW_VAR).trim() || 1,
  }, {
    [ROAD_FLOOR_VAR]: 0,
    [TUNNEL_GLOW_VAR]: 0,
    duration: tier.roadFadeDuration,
    ease: 'power1.in',
    immediateRender: false,
  }, tier.roadFadeStart);

  // ---- 焦点光晕：点亮 → 增强 → z-index 回落 ----
  if (lights.length > 0) {
    timeline
      .fromTo(lights, {
        opacity: 0, scale: tier.focalLightStartScale, x: 0, y: 0, zIndex: LIGHT_Z_RAISED,
      }, {
        opacity: LIGHT_BRIDGE_OPACITY,
        scale: tier.focalLightBridgeScale,
        x: 0,
        y: 0,
        zIndex: LIGHT_Z_RAISED,
        duration: LIGHT_IGNITE_DURATION,
        ease: 'power2.out',
        immediateRender: false,
      }, LIGHT_IGNITE_START)
      .fromTo(lights, {
        opacity: LIGHT_BRIDGE_OPACITY, scale: tier.focalLightBridgeScale, x: 0, y: 0, zIndex: LIGHT_Z_RAISED,
      }, {
        opacity: LIGHT_REST_OPACITY,
        scale: LIGHT_REST_SCALE,
        x: 0,
        y: 0,
        zIndex: LIGHT_Z_RAISED,
        duration: LIGHT_SETTLE_DURATION,
        ease: 'power2.out',
        immediateRender: false,
      }, LIGHT_SETTLE_START)
      .fromTo(lights, { zIndex: LIGHT_Z_RAISED }, {
        zIndex: LIGHT_Z_REST,
        duration: 0,
        immediateRender: false,
      }, MILESTONES.questionRevealStart);
  }

  setPhase(track, hero, timeline.scrollTrigger ? phaseOf(timeline.scrollTrigger) : 'hero', true);
  syncQuestionText(timeline.scrollTrigger?.progress ?? 0);

  return () => {
    setPhase(track, hero, 'tunnel');
    anchorLightToQuestion();
    timeline.scrollTrigger?.kill();
    timeline.kill();
    questionReveal?.revert();
    delete track.dataset.rewindPhase;
    delete track.dataset.rewindRender;
    delete track.dataset.rewindTier;
    delete hero.dataset.rewindPhase;
    delete hero.dataset.rewindRender;
    delete hero.dataset.rewindHeroLayer;
    question.style.pointerEvents = '';
    gsap.set([
      track, hero, question, questionContent,
      ...worlds, ...lights, ...charts, ...copies, ...heroCopyTargets,
    ].filter(Boolean), { clearProps: 'all' });
  };
};

// 视口变化 → 防抖刷新 ScrollTrigger（invalidateOnRefresh 会重算数值与 rect 缓存）。
// 移动端仅高度小幅变化（≤150px，地址栏收起等）视为噪声跳过。
const createResizeWatcher = (ScrollTrigger) => {
  let width = window.innerWidth;
  let height = window.innerHeight;
  let timer;
  const isNoise = () => {
    const nextWidth = window.innerWidth;
    const nextHeight = window.innerHeight;
    const widthChanged = nextWidth !== width;
    const heightDelta = Math.abs(nextHeight - height);
    const mobileLike = nextWidth <= BREAKPOINT_VALUES.desktopMin || matches(BREAKPOINTS.coarsePointer);
    width = nextWidth;
    height = nextHeight;
    return !widthChanged && mobileLike && heightDelta <= RESIZE_HEIGHT_NOISE_PX;
  };
  const onViewportChange = () => {
    if (isNoise()) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => ScrollTrigger.refresh(), RESIZE_REFRESH_DELAY_MS);
  };
  window.addEventListener('resize', onViewportChange, { passive: true });
  window.addEventListener('orientationchange', onViewportChange, { passive: true });
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('orientationchange', onViewportChange);
  };
};

const isHeroIntroComplete = () => {
  const hero = document.querySelector(SELECTORS.hero);
  if (!hero) return true;
  return hero.dataset.introState === 'done' || hero.classList.contains('is-intro-complete');
};

/**
 * hero 倒带/穿门转场入口。comfort 模式跳过（CSS 隐藏 rewind-track、
 * hero 回归文档流、question 静态展示）；full 模式等 hero intro 完成后再建 pin。
 */
export function initRewind(ctx) {
  const { gsap, ScrollTrigger } = ctx;
  let teardown;

  const setup = () => {
    if (teardown || isComfortMotion()) return;
    const track = document.querySelector(SELECTORS.transition);
    const hero = document.querySelector(SELECTORS.hero);
    if (!track || !hero) return;
    const question = findQuestion(track);
    if (!question) return;

    const media = gsap.matchMedia();
    media.add(MEDIA_CONDITIONS, (context) => {
      const conditions = { ...(context.conditions ?? {}) };
      const tier = resolveTier(conditions, { lowEnd: isLowEndDevice() });
      let destroy;
      const scope = gsap.context(() => {
        destroy = createRewindTransition(gsap, track, hero, question, tier);
      }, track);
      return () => {
        destroy?.();
        destroy = undefined;
        scope.revert();
      };
    });
    const stopResizeWatcher = createResizeWatcher(ScrollTrigger);
    teardown = () => {
      stopResizeWatcher();
      media.revert();
      teardown = undefined;
    };
    requestAnimationFrame(() => ScrollTrigger.refresh());
  };

  // intro 完成后等 2 帧再建，让收尾布局稳定
  const setupAfterIntro = () => {
    let frames = INTRO_SETTLE_FRAMES;
    const tick = () => {
      if (frames > 0) {
        frames -= 1;
        requestAnimationFrame(tick);
        return;
      }
      setup();
    };
    requestAnimationFrame(tick);
  };
  const waitForIntro = () => {
    window.removeEventListener(HERO_INTRO_COMPLETE_EVENT, setupAfterIntro);
    window.addEventListener(HERO_INTRO_COMPLETE_EVENT, setupAfterIntro, { once: true });
  };

  if (!isComfortMotion()) {
    if (isHeroIntroComplete()) setup();
    else waitForIntro();
  }

  // 模板没有原站的“切换动效偏好即刷新页面”，这里就地建/拆
  onMotionPreferenceChange(({ mode }) => {
    if (mode === 'comfort') {
      window.removeEventListener(HERO_INTRO_COMPLETE_EVENT, setupAfterIntro);
      if (teardown) {
        teardown();
        requestAnimationFrame(() => ScrollTrigger.refresh());
      }
      return;
    }
    if (teardown) return;
    if (isHeroIntroComplete()) setup();
    else waitForIntro();
  });
}
