// ---- 换皮点②：品牌与链接 ----
// 文案主要写在 index.html 里（搜索替换即可）；这里集中品牌级常量。
export const BRAND = {
  name: 'CryptOwl',
  productUrl: '/product/',
  contactUrl: '/contact/',
};

// ScrollSmoother 平滑系数（对照原站 scroll-runtime）
export const SMOOTH = {
  desktop: 0.75,
  touch: 0.5,
  comfort: 0.25, // 用户选择 comfort（减弱动效）时
};

// 断点（对照原站 breakpoints 模块）
export const BREAKPOINT_VALUES = {
  phoneMax: 767,
  timeReplayPhoneMax: 639,
  tabletMin: 768,
  tabletMax: 1023,
  desktopMin: 1024,
  sceneColumnsMaxRem: 74.999,
  sceneColumnsMinRem: 75,
  wideSceneMinRem: 120,
  focalLightMobileRenderMaxWidth: 900,
  compactLandscapeMaxWidth: 959,
  compactLandscapeMaxHeight: 520,
  timelineCollisionMaxHeight: 599.98,
  shortViewportMaxHeight: 599,
};

export const BREAKPOINTS = {
  phone: `(max-width: ${BREAKPOINT_VALUES.phoneMax}px)`,
  timeReplayPhone: `(max-width: ${BREAKPOINT_VALUES.timeReplayPhoneMax}px)`,
  tablet: `(min-width: ${BREAKPOINT_VALUES.tabletMin}px) and (max-width: ${BREAKPOINT_VALUES.tabletMax}px)`,
  tabletAndBelow: `(max-width: ${BREAKPOINT_VALUES.tabletMax}px)`,
  desktop: `(min-width: ${BREAKPOINT_VALUES.desktopMin}px)`,
  sceneStacked: `(max-width: ${BREAKPOINT_VALUES.sceneColumnsMaxRem}rem)`,
  sceneColumns: `(min-width: ${BREAKPOINT_VALUES.sceneColumnsMinRem}rem)`,
  wideScene: `(min-width: ${BREAKPOINT_VALUES.wideSceneMinRem}rem)`,
  short: `(max-height: ${BREAKPOINT_VALUES.shortViewportMaxHeight}px)`,
  compactLandscape: `(max-width: ${BREAKPOINT_VALUES.compactLandscapeMaxWidth}px) and (max-height: ${BREAKPOINT_VALUES.compactLandscapeMaxHeight}px) and (orientation: landscape)`,
  timelineCollision: `(max-height: ${BREAKPOINT_VALUES.timelineCollisionMaxHeight}px)`,
  compactAspect: '(max-aspect-ratio: 0.62)',
  portrait: '(max-aspect-ratio: 0.85)',
  landscape: '(orientation: landscape)',
  coarsePointer: '(pointer: coarse)',
  finePointer: '(hover: hover) and (pointer: fine)',
};

export const matches = (query) => window.matchMedia(query).matches;
