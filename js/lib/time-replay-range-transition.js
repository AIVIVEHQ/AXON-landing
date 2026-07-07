// 日期窗口 collapse/expand 过渡（history↔live）：窗口收成端点圆点、标签淡出。
// 对照 reference/pretty/timeReplayRangeTransition.D76-B6Qe.js，参数逐值一致。

const measureCollapse = ({ range, rangeEndpointFrom, rangeEndpointTo }) => {
  const rangeWidth = range.getBoundingClientRect().width;
  const fromWidth = rangeEndpointFrom.getBoundingClientRect().width;
  const toWidth = rangeEndpointTo.getBoundingClientRect().width;
  const safeRange = Math.max(1, rangeWidth);
  const safeFrom = Math.max(1, fromWidth);
  return {
    collapsedScale: safeFrom / safeRange,
    fromCollapseX: Math.max(0, safeRange / 2 - safeFrom / 2),
    toCollapseX: -Math.max(0, safeRange / 2 - Math.max(1, toWidth) / 2),
  };
};

// 同一帧内多次取值只测一次（rAF 后失效）
const createCollapseCache = (elements) => {
  let cache;
  let rafId = 0;
  const reset = () => {
    rafId = 0;
    cache = undefined;
  };
  return () => {
    if (cache) return cache;
    cache = measureCollapse(elements);
    if (rafId === 0) rafId = window.requestAnimationFrame(reset);
    return cache;
  };
};

/** 直接摆到收起态（供入场桥接使用）。 */
export const setRangeCollapsed = (gsap, elements) => {
  const {
    rangeEndpointFrom,
    rangeEndpointTo,
    rangeLabels,
    rangeLine,
    rangeLineFill,
    rangeWindow,
  } = elements;
  const measure = createCollapseCache(elements);
  const collapsedScale = () => measure().collapsedScale;
  gsap.set(rangeWindow, { opacity: 0, scaleX: collapsedScale, transformOrigin: '50% 50%' });
  gsap.set(rangeLine, { scaleX: collapsedScale, transformOrigin: '50% 50%' });
  gsap.set(rangeLineFill, { opacity: 0 });
  gsap.set(rangeLabels, { opacity: 0, y: -4 });
  gsap.set(rangeEndpointFrom, { x: () => measure().fromCollapseX });
  gsap.set(rangeEndpointTo, { x: () => measure().toCollapseX });
};

/**
 * 在 timeline 上插入 collapse（窗口→圆点）或 expand（圆点→窗口）过渡。
 * duration 的前 22% 给标签淡出/入，其余给窗口与端点。
 */
export const applyRangeTransition = (timeline, elements, mode, position, duration) => {
  const {
    rangeEndpointFrom,
    rangeEndpointTo,
    rangeLabels,
    rangeLine,
    rangeLineFill,
    rangeWindow,
  } = elements;
  const measure = createCollapseCache(elements);
  const expand = mode === 'expand';
  const labelDuration = duration * 0.22;
  const mainDuration = duration - labelDuration;
  const mainPosition = expand ? position : position + labelDuration;
  const labelPosition = expand ? position + mainDuration : position;
  const collapsedScale = () => measure().collapsedScale;
  const fromCollapseX = () => measure().fromCollapseX;
  const toCollapseX = () => measure().toCollapseX;

  const windowFrom = { opacity: expand ? 0 : 1, scaleX: expand ? collapsedScale : 1 };
  const windowTo = { opacity: expand ? 1 : 0, scaleX: expand ? 1 : collapsedScale };
  const lineFrom = { scaleX: expand ? collapsedScale : 1 };
  const lineTo = { scaleX: expand ? 1 : collapsedScale };
  const fillFrom = { opacity: expand ? 0 : 1 };
  const fillTo = { opacity: expand ? 1 : 0 };
  const labelsFrom = { opacity: expand ? 0 : 1, y: expand ? -4 : 0 };
  const labelsTo = { opacity: expand ? 1 : 0, y: expand ? 0 : -4 };

  timeline.fromTo(
    rangeWindow,
    { ...windowFrom, transformOrigin: '50% 50%' },
    { ...windowTo, transformOrigin: '50% 50%', duration: mainDuration, immediateRender: false },
    mainPosition
  );
  timeline.fromTo(
    rangeLine,
    { ...lineFrom, transformOrigin: '50% 50%' },
    { ...lineTo, transformOrigin: '50% 50%', duration: mainDuration, immediateRender: false },
    mainPosition
  );
  timeline.fromTo(
    rangeLineFill,
    fillFrom,
    { ...fillTo, duration: mainDuration, immediateRender: false },
    mainPosition
  );
  timeline.fromTo(
    rangeLabels,
    labelsFrom,
    { ...labelsTo, duration: labelDuration, immediateRender: false },
    labelPosition
  );
  timeline.fromTo(
    rangeEndpointFrom,
    { x: expand ? fromCollapseX : 0 },
    { x: expand ? 0 : fromCollapseX, duration: mainDuration, immediateRender: false },
    mainPosition
  );
  timeline.fromTo(
    rangeEndpointTo,
    { x: expand ? toCollapseX : 0 },
    { x: expand ? 0 : toCollapseX, duration: mainDuration, immediateRender: false },
    mainPosition
  );
};
