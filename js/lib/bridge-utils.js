// 场景桥接共享工具，对照原站 sceneBridge 模块逐函数移植。
// 提供：0-1 数值工具、视口矩形运算、fixed 图层与桥接 dot 生成、
// data-* 顺序排序、pagehide/bfcache 重建。

export const clamp01 = (value) => Math.min(Math.max(value, 0), 1);

export const easeOutCubic = (value) => 1 - (1 - value) ** 3;

/** value 在 [from, to] 区间内的归一化进度（clamp 到 0-1）。 */
export const progressBetween = (value, from, to) => clamp01((value - from) / (to - from));

export const lerp = (from, to, t) => from + (to - from) * t;

/** 以元素中心为基准、指定边长的正方形视口矩形（可减去偏移）。 */
export const rectAround = (element, size, offset = {}) => {
  const rect = element.getBoundingClientRect();
  return {
    height: size,
    left: rect.left - (offset.x ?? 0) + rect.width / 2 - size / 2,
    top: rect.top - (offset.y ?? 0) + rect.height / 2 - size / 2,
    width: size,
  };
};

/** 把任意矩形归一为同心正方形；size 缺省取宽高最大值（至少 1）。 */
export const squareRect = (rect, size) => {
  const side = size ?? Math.max(1, rect.width, rect.height);
  return {
    height: side,
    left: rect.left + rect.width / 2 - side / 2,
    top: rect.top + rect.height / 2 - side / 2,
    width: side,
  };
};

/** 两个矩形按 t 线性插值（left/top/width/height）。 */
export const interpolateRect = (from, to, t) => ({
  height: lerp(from.height, to.height, t),
  left: lerp(from.left, to.left, t),
  top: lerp(from.top, to.top, t),
  width: lerp(from.width, to.width, t),
});

export const offsetRectTop = (rect, dy) => ({ ...rect, top: rect.top + dy });

/** 创建全屏 fixed 容器（datasetKey → data-* 标记），桥接飞行元素挂在里面。 */
export const createFixedLayer = (datasetKey, zIndex = '8') => {
  const layer = document.createElement('div');
  layer.dataset[datasetKey] = 'true';
  Object.assign(layer.style, {
    contain: 'layout style paint',
    inset: '0',
    pointerEvents: 'none',
    position: 'fixed',
    zIndex,
  });
  document.body.appendChild(layer);
  return layer;
};

export const createSpan = (parent, className, dataset = {}) => {
  const span = document.createElement('span');
  span.className = className;
  span.setAttribute('aria-hidden', 'true');
  Object.entries(dataset).forEach(([key, value]) => {
    if (value !== undefined) span.dataset[key] = value;
  });
  parent.appendChild(span);
  return span;
};

/** 为一组条目各生成一个 span，dataset 由回调按条目给出。 */
export const createSpans = (items, parent, className, datasetFor = () => ({})) =>
  items.map((item, index) => createSpan(parent, className, datasetFor(item, index)));

const datasetIndexOf = (element, datasetKey, order, fallback = -1) => {
  const value = element.dataset[datasetKey];
  const index = value ? order.indexOf(value) : -1;
  return index >= 0 ? index : fallback;
};

/** 按元素 data-* 值在给定顺序表中的位置排序的比较器。 */
export const byDatasetOrder = (datasetKey, order, fallback = -1) => (a, b) =>
  datasetIndexOf(a, datasetKey, order, fallback) - datasetIndexOf(b, datasetKey, order, fallback);

/** pagehide 时执行清理；bfcache 恢复（persisted）时在 pageshow 重建。返回解绑函数。 */
export const onPageHideRebind = (getCleanup, reinit) => {
  const onPageHide = (event) => {
    getCleanup()?.();
    if (event.persisted) window.addEventListener('pageshow', reinit, { once: true });
  };
  window.addEventListener('pagehide', onPageHide);
  return () => {
    window.removeEventListener('pagehide', onPageHide);
  };
};
