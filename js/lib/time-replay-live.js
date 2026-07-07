// Time Replay live 态：live candle 实时跳动动画 + 端点飞向 Active Strategy 槽位的几何测量。
// 对照 reference/pretty/timeReplay.1wp7Q-GW.js 中 je/qe，参数逐值一致。

const PNL_PER_POINT = 100;
const LOOP_INTERVAL_MS = 840;
const LOOP_DELAY_MS = 220;

const allFinite = (...values) => values.every((value) => Number.isFinite(value));
const toPercent = (value) => `${Number(value.toFixed(3))}%`;

/**
 * live candle 动画器：由 chart 的 data-live-* 与 data-price-* 驱动，
 * 用确定性正弦序列生成价格目标，逐帧写 CSS 变量并回调 Open PnL。
 */
export const createLiveCandleAnimator = ({ gsap, chart, liveCandles, onPnlChange }) => {
  const open = Number(chart.dataset.liveOpen || 0);
  const priceMin = Number(chart.dataset.priceMin || 0);
  const priceMax = Number(chart.dataset.priceMax || 1);
  const plotTop = Number(chart.dataset.plotTop || 8);
  const plotBottom = Number(chart.dataset.plotBottom || 12);
  const plotHeight = 100 - plotTop - plotBottom;
  const enabled =
    liveCandles.length > 0 &&
    chart.dataset.liveOpen !== undefined &&
    allFinite(open, priceMin, priceMax, plotTop, plotBottom, plotHeight) &&
    priceMax > priceMin &&
    plotHeight > 0;

  const proxy = { current: open };
  const priceCeil = open + 1.56;
  const priceFloor = open - 0.34;
  let sessionHigh = open;
  let sessionLow = open;
  let step = 0;
  let delayId = 0;
  let intervalId = 0;
  let tween;

  const yOf = (price) => plotTop + ((priceMax - price) / (priceMax - priceMin)) * plotHeight;

  const setVar = (name, value) => {
    const text = typeof value === 'number' ? toPercent(value) : value;
    liveCandles.forEach((candle) => {
      candle.style.setProperty(name, text);
    });
  };

  const render = (price) => {
    if (!enabled) return;
    const openY = yOf(open);
    sessionHigh = Math.max(sessionHigh, open, price);
    sessionLow = Math.min(sessionLow, open, price);
    const priceY = yOf(price);
    const isUp = price >= open;
    const bodyHeight = Math.abs(priceY - openY);
    const bodyTop = isUp ? priceY : openY;
    const bodyBottom = isUp ? openY : priceY;
    const highY = yOf(sessionHigh);
    const lowY = yOf(sessionLow);
    const bodyOpacity = Math.min(1, bodyHeight / 0.18);
    const pnl = Math.round((price - open) * PNL_PER_POINT);
    setVar('--bt', bodyTop);
    setVar('--bh', bodyHeight);
    setVar('--lo', openY);
    setVar('--lb', bodyHeight);
    setVar('--lu', isUp ? bodyOpacity.toFixed(3) : '0');
    setVar('--ld', isUp ? '0' : bodyOpacity.toFixed(3));
    setVar('--rt', highY);
    setVar('--rh', Math.max(lowY - highY, 0));
    setVar('--ut', highY);
    setVar('--uh', Math.max(bodyTop - highY, 0));
    setVar('--lt', bodyBottom);
    setVar('--lh', Math.max(lowY - bodyBottom, 0));
    liveCandles.forEach((candle) => {
      candle.classList.toggle('candle--up', isUp);
      candle.classList.toggle('candle--down', !isUp);
    });
    onPnlChange(pnl);
  };

  const clearTimers = () => {
    if (delayId !== 0) {
      window.clearTimeout(delayId);
      delayId = 0;
    }
    if (intervalId !== 0) {
      window.clearInterval(intervalId);
      intervalId = 0;
    }
  };

  const stopMotion = () => {
    clearTimers();
    tween?.kill();
    tween = undefined;
  };

  const reset = () => {
    if (!enabled) return;
    tween?.kill();
    tween = undefined;
    proxy.current = open;
    sessionHigh = open;
    sessionLow = open;
    step = 0;
    render(open);
    onPnlChange(0);
  };

  const tick = () => {
    step += 1;
    const wave = Math.sin(step * 0.82) * 0.62 + Math.sin(step * 0.37 + 1.1) * 0.28;
    const spike = step % 7 === 3 ? 0.42 : step % 11 === 6 ? -0.34 : 0;
    const target = open + 0.24 + wave + spike;
    const clamped = Math.max(priceFloor, Math.min(priceCeil, target));
    tween = gsap.to(proxy, {
      current: clamped,
      duration: 0.76,
      ease: 'power2.out',
      overwrite: true,
      onUpdate: () => render(proxy.current),
      onComplete: () => {
        tween = undefined;
        render(proxy.current);
      },
    });
  };

  return {
    enabled,
    reset,
    startLoop: () => {
      if (!enabled || intervalId !== 0 || delayId !== 0) return;
      delayId = window.setTimeout(() => {
        delayId = 0;
        tick();
        intervalId = window.setInterval(tick, LOOP_INTERVAL_MS);
      }, LOOP_DELAY_MS);
    },
    stopMotion,
  };
};

/**
 * 端点落位几何：以 range 静止边缘为端点原位，测量飞向
 * [data-time-replay-active-state-target] 所需的 x/y（scale 恒为 1）。
 */
export const createActiveStateGeometry = ({
  activeStateTarget,
  isEnabled,
  range,
  rangeEndpointFrom,
  rangeEndpointTo,
  withMeasurementLayout,
}) => {
  const sizeOf = (element, rect) => {
    const width = Math.max(1, rect.width || element.offsetWidth);
    return {
      height: Math.max(1, rect.height || element.offsetHeight),
      width,
    };
  };

  // 端点静止中心：from 贴 range 左缘、to 贴右缘（与 CSS left:0 / right:0 对应）
  const restingCenterOf = (endpoint, rangeRect, size) => ({
    centerX:
      endpoint === rangeEndpointFrom
        ? rangeRect.left + size.width / 2
        : rangeRect.right - size.width / 2,
    centerY: rangeRect.top + rangeRect.height / 2,
    height: size.height,
    width: size.width,
  });

  const transformOf = (endpoint, rangeRect, size, targetRect) => {
    const resting = restingCenterOf(endpoint, rangeRect, size);
    return {
      scaleX: 1,
      scaleY: 1,
      x: targetRect.left + targetRect.width / 2 - resting.centerX,
      y: targetRect.top + targetRect.height / 2 - resting.centerY,
    };
  };

  const measureTransforms = () => {
    const rangeRect = range.getBoundingClientRect();
    const targetRect = activeStateTarget.getBoundingClientRect();
    const fromRect = rangeEndpointFrom.getBoundingClientRect();
    const toRect = rangeEndpointTo.getBoundingClientRect();
    const fromSize = sizeOf(rangeEndpointFrom, fromRect);
    const toSize = sizeOf(rangeEndpointTo, toRect);
    return {
      fromTransform: transformOf(rangeEndpointFrom, rangeRect, fromSize, targetRect),
      toTransform: transformOf(rangeEndpointTo, rangeRect, toSize, targetRect),
    };
  };

  const measureWithLayout = () => {
    let result;
    withMeasurementLayout(() => {
      result = measureTransforms();
    });
    return result;
  };

  const fallbackFor = (prop) => (prop === 'scaleX' || prop === 'scaleY' ? 1 : 0);

  const refresh = () => {
    if (isEnabled()) measureWithLayout();
  };

  return {
    getNumber: (endpoint, prop) => {
      if (!isEnabled()) return fallbackFor(prop);
      const transforms = measureWithLayout();
      const transform =
        endpoint === rangeEndpointFrom ? transforms?.fromTransform : transforms?.toTransform;
      return transform?.[prop] ?? fallbackFor(prop);
    },
    measure: refresh,
    refresh,
  };
};
