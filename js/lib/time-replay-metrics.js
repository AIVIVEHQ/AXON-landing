// Time Replay 指标与日期窗口：确定性交易日序列 → Net PnL/ROI/Win rate/Trades。
// 对照 reference/pretty/timeReplay.1wp7Q-GW.js 中 Re/rt/at/it/ut/mt 等，数值逐条一致。

export const METRIC_KEYS = ['pnl', 'roi', 'winRate', 'trades'];
const TONED_KEYS = new Set(['pnl', 'roi']);
const CAPITAL = 1e4;
const PNL_UNIT = CAPITAL * 0.01;

export const HISTORY_LABELS = {
  pnl: 'Net PnL',
  roi: 'ROI',
  trades: 'Trades',
  winRate: 'Win rate',
};

export const LIVE_LABELS = {
  pnl: 'Open PnL',
  roi: 'ROI',
  trades: 'Trades',
  winRate: 'Active Strategy',
};

// 36 天确定性序列（offsetDays 0-35），指标由此推导
const TRADE_DAYS = [
  { offsetDays: 0, trades: 38, wins: 22, averageWinR: 1.12, averageLossR: 0.82 },
  { offsetDays: 1, trades: 37, wins: 21, averageWinR: 1.06, averageLossR: 0.85 },
  { offsetDays: 2, trades: 35, wins: 19, averageWinR: 1, averageLossR: 0.9 },
  { offsetDays: 3, trades: 33, wins: 17, averageWinR: 0.95, averageLossR: 1.02 },
  { offsetDays: 4, trades: 31, wins: 14, averageWinR: 0.88, averageLossR: 1.12 },
  { offsetDays: 5, trades: 29, wins: 12, averageWinR: 0.86, averageLossR: 1.2 },
  { offsetDays: 6, trades: 28, wins: 11, averageWinR: 0.9, averageLossR: 1.18 },
  { offsetDays: 7, trades: 31, wins: 15, averageWinR: 0.98, averageLossR: 1.05 },
  { offsetDays: 8, trades: 35, wins: 18, averageWinR: 1.05, averageLossR: 0.9 },
  { offsetDays: 9, trades: 39, wins: 22, averageWinR: 1.1, averageLossR: 0.8 },
  { offsetDays: 10, trades: 43, wins: 26, averageWinR: 1.15, averageLossR: 0.72 },
  { offsetDays: 11, trades: 46, wins: 28, averageWinR: 1.13, averageLossR: 0.76 },
  { offsetDays: 12, trades: 45, wins: 26, averageWinR: 1.08, averageLossR: 0.84 },
  { offsetDays: 13, trades: 42, wins: 22, averageWinR: 1, averageLossR: 0.95 },
  { offsetDays: 14, trades: 39, wins: 19, averageWinR: 0.94, averageLossR: 1.05 },
  { offsetDays: 15, trades: 36, wins: 16, averageWinR: 0.88, averageLossR: 1.18 },
  { offsetDays: 16, trades: 33, wins: 14, averageWinR: 0.86, averageLossR: 1.24 },
  { offsetDays: 17, trades: 31, wins: 14, averageWinR: 0.91, averageLossR: 1.12 },
  { offsetDays: 18, trades: 32, wins: 15, averageWinR: 0.98, averageLossR: 1.02 },
  { offsetDays: 19, trades: 35, wins: 18, averageWinR: 1.04, averageLossR: 0.92 },
  { offsetDays: 20, trades: 39, wins: 22, averageWinR: 1.1, averageLossR: 0.82 },
  { offsetDays: 21, trades: 43, wins: 26, averageWinR: 1.16, averageLossR: 0.72 },
  { offsetDays: 22, trades: 47, wins: 29, averageWinR: 1.18, averageLossR: 0.68 },
  { offsetDays: 23, trades: 50, wins: 31, averageWinR: 1.16, averageLossR: 0.72 },
  { offsetDays: 24, trades: 53, wins: 32, averageWinR: 1.1, averageLossR: 0.84 },
  { offsetDays: 25, trades: 55, wins: 32, averageWinR: 1.02, averageLossR: 0.98 },
  { offsetDays: 26, trades: 54, wins: 30, averageWinR: 0.95, averageLossR: 1.12 },
  { offsetDays: 27, trades: 52, wins: 27, averageWinR: 0.94, averageLossR: 1.15 },
  { offsetDays: 28, trades: 49, wins: 25, averageWinR: 0.99, averageLossR: 1.05 },
  { offsetDays: 29, trades: 45, wins: 23, averageWinR: 1.05, averageLossR: 0.9 },
  { offsetDays: 30, trades: 42, wins: 24, averageWinR: 1.1, averageLossR: 0.78 },
  { offsetDays: 31, trades: 43, wins: 25, averageWinR: 1.14, averageLossR: 0.72 },
  { offsetDays: 32, trades: 45, wins: 27, averageWinR: 1.16, averageLossR: 0.7 },
  { offsetDays: 33, trades: 48, wins: 28, averageWinR: 1.12, averageLossR: 0.76 },
  { offsetDays: 34, trades: 51, wins: 29, averageWinR: 1.1, averageLossR: 0.78 },
  { offsetDays: 35, trades: 53, wins: 31, averageWinR: 1.1, averageLossR: 0.78 },
];

const dayAt = (offsetDays) =>
  TRADE_DAYS[Math.min(Math.max(offsetDays, 0), TRADE_DAYS.length - 1)];

const netPnlOf = (day) => {
  const losses = day.trades - day.wins;
  const r = day.wins * day.averageWinR - losses * day.averageLossR;
  return Math.round(r * PNL_UNIT);
};

const formatCurrency = (value) => {
  const amount = Math.abs(value).toLocaleString('en-US');
  return value > 0 ? `+$${amount}` : value < 0 ? `-$${amount}` : '$0';
};

const formatPercent = (value) =>
  value > 0 ? `+${value.toFixed(2)}%` : value < 0 ? `${value.toFixed(2)}%` : '0.00%';

const toneFor = (key, text) => {
  if (!TONED_KEYS.has(key)) return 'neutral';
  const trimmed = text.trim();
  return trimmed.startsWith('+') ? 'positive' : trimmed.startsWith('-') ? 'negative' : 'neutral';
};

const historyMetricsAt = (offsetDays) => {
  const day = dayAt(offsetDays);
  const pnl = netPnlOf(day);
  return {
    pnl: formatCurrency(pnl),
    roi: formatPercent((pnl / CAPITAL) * 100),
    trades: String(day.trades),
    winRate: `${((day.wins / day.trades) * 100).toFixed(1)}%`,
  };
};

const liveMetricsFor = (pnl) => ({
  pnl: formatCurrency(pnl),
  roi: formatPercent((pnl / CAPITAL) * 100),
  trades: '',
  winRate: '1',
});

const applyTone = (element, tone) => {
  if (tone === 'neutral') {
    if (element.dataset.metricTone !== undefined) delete element.dataset.metricTone;
    return;
  }
  if (element.dataset.metricTone !== tone) element.dataset.metricTone = tone;
};

/** 指标控制器：缓存文本避免重复写 DOM，支持测量时快照/恢复。 */
export const createMetricsController = (root, selectors) => {
  const labelElements = {};
  const valueElements = {};
  const labelCache = {};
  const valueCache = {};
  root.querySelectorAll(selectors.label).forEach((element) => {
    const key = element.dataset.timeReplayMetricLabel;
    if (METRIC_KEYS.includes(key)) {
      labelElements[key] = element;
      labelCache[key] = element.textContent ?? '';
    }
  });
  root.querySelectorAll(selectors.value).forEach((element) => {
    const key = element.dataset.timeReplayMetric;
    if (METRIC_KEYS.includes(key)) {
      valueElements[key] = element;
      valueCache[key] = element.textContent ?? '';
    }
  });

  const setMetric = (key, label, value) => {
    const labelElement = labelElements[key];
    const valueElement = valueElements[key];
    if (labelElement && labelCache[key] !== label) {
      labelCache[key] = label;
      labelElement.textContent = label;
    }
    if (valueElement && valueCache[key] !== value) {
      valueCache[key] = value;
      valueElement.textContent = value;
    }
    if (valueElement) applyTone(valueElement, toneFor(key, value));
  };

  return {
    capture: () => ({
      labelCache: { ...labelCache },
      valueCache: { ...valueCache },
      labelText: Object.fromEntries(
        METRIC_KEYS.map((key) => [key, labelElements[key]?.textContent ?? ''])
      ),
      valueText: Object.fromEntries(
        METRIC_KEYS.map((key) => [key, valueElements[key]?.textContent ?? ''])
      ),
      valueTone: Object.fromEntries(
        METRIC_KEYS.map((key) => [key, valueElements[key]?.dataset.metricTone ?? ''])
      ),
    }),
    clearTones: () => {
      Object.values(valueElements).forEach((element) => {
        if (element?.dataset.metricTone !== undefined) delete element.dataset.metricTone;
      });
    },
    getElements: () =>
      [...Object.values(labelElements), ...Object.values(valueElements)].filter(Boolean),
    restore: (snapshot) => {
      METRIC_KEYS.forEach((key) => {
        const cachedLabel = snapshot.labelCache[key];
        const cachedValue = snapshot.valueCache[key];
        const labelElement = labelElements[key];
        const valueElement = valueElements[key];
        if (cachedLabel === undefined) delete labelCache[key];
        else labelCache[key] = cachedLabel;
        if (cachedValue === undefined) delete valueCache[key];
        else valueCache[key] = cachedValue;
        if (labelElement && labelElement.textContent !== snapshot.labelText[key]) {
          labelElement.textContent = snapshot.labelText[key];
        }
        if (valueElement) {
          if (valueElement.textContent !== snapshot.valueText[key]) {
            valueElement.textContent = snapshot.valueText[key];
          }
          if (snapshot.valueTone[key]) {
            if (valueElement.dataset.metricTone !== snapshot.valueTone[key]) {
              valueElement.dataset.metricTone = snapshot.valueTone[key];
            }
          } else if (valueElement.dataset.metricTone !== undefined) {
            delete valueElement.dataset.metricTone;
          }
        }
      });
    },
    setHistoryFromOffsetDays: (offsetDays) => {
      const values = historyMetricsAt(offsetDays);
      METRIC_KEYS.forEach((key) => setMetric(key, HISTORY_LABELS[key], values[key]));
    },
    setLiveFromPnl: (pnl) => {
      const values = liveMetricsFor(pnl);
      METRIC_KEYS.forEach((key) => setMetric(key, LIVE_LABELS[key], values[key]));
    },
  };
};

// ---- 日期窗口：基准 Jan 12 - Jan 26 (2026 UTC)，随进度整体回退最多 35 天 ----
export const RANGE_DATE_KEYS = ['from', 'to'];
const DAY_MS = 1440 * 60 * 1e3;
const MAX_OFFSET_DAYS = 35;
const BASE_WINDOW = {
  from: Date.UTC(2026, 0, 12),
  to: Date.UTC(2026, 0, 26),
};
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const clamp01 = (value) => Math.min(Math.max(value, 0), 1);
const formatDate = (ms) => DATE_FORMAT.format(new Date(ms));

export const offsetDaysFromProgress = (progress) =>
  Math.round(clamp01(progress) * MAX_OFFSET_DAYS);

export const dateWindowForProgress = (progress) => {
  const offsetMs = offsetDaysFromProgress(progress) * DAY_MS;
  return {
    from: formatDate(BASE_WINDOW.from - offsetMs),
    to: formatDate(BASE_WINDOW.to - offsetMs),
  };
};

export const collectRangeDateLabels = (root, selector) => {
  const labels = {};
  root.querySelectorAll(selector).forEach((element) => {
    const key = element.dataset.timeReplayDate;
    if (RANGE_DATE_KEYS.includes(key)) labels[key] = element;
  });
  return labels;
};
