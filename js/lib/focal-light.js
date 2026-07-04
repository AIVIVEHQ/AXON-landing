// 站点焦点光晕：在 [data-site-focal-light-canvas] 上绘制多层径向渐变。
// 对照原站 focalLightCanvas 模块（参数逐值保留）。
import { BREAKPOINT_VALUES } from '../config.js';

const CANVAS_SELECTOR = '[data-site-focal-light-canvas]';
const FALLBACK_RATIO = 5 / 3;
const FALLBACK_WIDTH = 1200;
const MAX_DPR = 1.2;
const MOBILE_MAX_DPR = 1;
const MAX_RENDER_DIMENSION = 2200;
const RESIZE_DEBOUNCE_MS = 180;

const FALLBACK_RGB = {
  '--rgb-accent': '124 230 255',
  '--rgb-accent-muted': '150 205 222',
  '--rgb-accent-soft': '190 239 250',
  '--rgb-market-short': '65 121 222',
  '--rgb-base-deep': '3 6 11',
  '--rgb-base': '7 9 13',
  '--rgb-white': '255 255 255',
};

// 渐变层定义：[offset, css 变量, alpha]
const LAYER_OUTER = [
  [0, '--rgb-accent-muted', 0.1],
  [0.3, '--rgb-accent-muted', 0.069],
  [0.58, '--rgb-market-short', 0.032],
  [0.82, '--rgb-base', 0.009],
  [1, '--rgb-base-deep', 0],
];
const LAYER_MID = [
  [0, '--rgb-accent-soft', 0.132],
  [0.3, '--rgb-accent-muted', 0.082],
  [0.6, '--rgb-market-short', 0.036],
  [0.84, '--rgb-base', 0.009],
  [1, '--rgb-base-deep', 0],
];
const LAYER_CORE = [
  [0, '--rgb-white', 0.34],
  [0.2, '--rgb-accent-soft', 0.22],
  [0.52, '--rgb-accent-muted', 0.078],
  [0.8, '--rgb-market-short', 0.014],
  [1, '--rgb-market-short', 0],
];
const LAYER_MASK = [
  [0, '--rgb-white', 1],
  [0.48, '--rgb-white', 1],
  [0.68, '--rgb-white', 0.12],
  [0.86, '--rgb-white', 0.025],
  [1, '--rgb-white', 0],
];

let cleanup;

const readRgb = (styles, variable) =>
  styles.getPropertyValue(variable).trim().replace(/\s+/g, ' ') || FALLBACK_RGB[variable];

const resolveStops = (styles, layer) =>
  layer.map(([offset, variable, alpha]) => [offset, `rgb(${readRgb(styles, variable)} / ${alpha})`]);

const measure = (canvas) => {
  const rect = canvas.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  return width > 0 && height > 0
    ? { width, height }
    : { width: FALLBACK_WIDTH, height: Math.round(FALLBACK_WIDTH / FALLBACK_RATIO) };
};

const renderScaleFor = (width, height) => {
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DPR);
  const capped = width < BREAKPOINT_VALUES.focalLightMobileRenderMaxWidth
    ? Math.min(dpr, MOBILE_MAX_DPR)
    : dpr;
  const dimensionCap = MAX_RENDER_DIMENSION / Math.max(width, height);
  return Math.min(capped, dimensionCap);
};

const paintLayer = (ctx, width, height, cx, cy, rx, ry, stops) => {
  const px = width * cx;
  const py = height * cy;
  const sx = width * rx;
  const sy = height * ry;
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(sx, sy);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  ctx.fillStyle = gradient;
  ctx.fillRect(-px / sx, -py / sy, width / sx, height / sy);
  ctx.restore();
};

export const paintFocalLight = (canvas) => {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  const { width, height } = measure(canvas);
  const scale = renderScaleFor(width, height);
  const renderWidth = Math.max(1, Math.round(width * scale));
  const renderHeight = Math.max(1, Math.round(height * scale));
  if (canvas.width !== renderWidth) canvas.width = renderWidth;
  if (canvas.height !== renderHeight) canvas.height = renderHeight;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  const styles = getComputedStyle(document.documentElement);
  paintLayer(ctx, width, height, 0.5, 0.52, 0.47, 0.47, resolveStops(styles, LAYER_OUTER));
  paintLayer(ctx, width, height, 0.5, 0.52, 0.32, 0.32, resolveStops(styles, LAYER_MID));
  paintLayer(ctx, width, height, 0.5, 0.5, 0.15, 0.15, resolveStops(styles, LAYER_CORE));
  ctx.globalCompositeOperation = 'destination-in';
  paintLayer(ctx, width, height, 0.5, 0.5, 0.5, 0.5, resolveStops(styles, LAYER_MASK));
  ctx.globalCompositeOperation = 'source-over';
};

export const setupFocalLightCanvas = () => {
  if (cleanup) return;
  const canvas = document.querySelector(CANVAS_SELECTOR);
  if (!canvas) return;
  let timer;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => paintFocalLight(canvas), RESIZE_DEBOUNCE_MS);
  };
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
  const onPageHide = (event) => {
    cleanup?.();
    if (event.persisted) {
      window.addEventListener('pageshow', setupFocalLightCanvas, { once: true });
    }
  };
  paintFocalLight(canvas);
  observer?.observe(canvas);
  observer?.observe(canvas.parentElement ?? canvas);
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('pagehide', onPageHide);
  cleanup = () => {
    window.clearTimeout(timer);
    observer?.disconnect();
    window.removeEventListener('resize', schedule);
    window.removeEventListener('pagehide', onPageHide);
    cleanup = undefined;
  };
};
