// 动效偏好（full / comfort），对照原站 motionPreference 模块。
// comfort = 减弱动效：pin/scrub 场景直接静态展示，平滑滚动降为 0.25。
const STORAGE_KEY = 'axon.motionPreference';
const EVENT_NAME = 'sitemotionpreferencechange';
const CHOICE_SELECTOR = '[data-motion-choice]';
const VALID = new Set(['comfort', 'full']);
const DEFAULT_MODE = 'full';

let initialized = false;

const normalize = (value) => (value && VALID.has(value) ? value : DEFAULT_MODE);

const readStored = () => {
  try {
    return normalize(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_MODE;
  }
};

const store = (value) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
    return true;
  } catch {
    return false;
  }
};

const syncChoiceButtons = (root = document) => {
  const mode = getMotionPreference();
  root.querySelectorAll(CHOICE_SELECTOR).forEach((button) => {
    const active = normalize(button.dataset.motionChoice) === mode;
    button.setAttribute('aria-pressed', String(active));
    button.dataset.motionState = active ? 'active' : 'idle';
  });
};

export const getMotionPreference = () =>
  normalize(document.documentElement.dataset.motionPreference ?? readStored());

export const isComfortMotion = () =>
  typeof document !== 'undefined' && document.documentElement.dataset.motion === 'comfort';

/** 系统级 prefers-reduced-motion 或用户选择 comfort，都视为“减弱动效”。 */
export const isMotionReduced = () =>
  isComfortMotion() || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const apply = (value = readStored()) => {
  const mode = normalize(value);
  const root = document.documentElement;
  root.dataset.motionPreference = mode;
  root.dataset.motion = mode;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { mode, preference: mode } }));
  syncChoiceButtons();
  return mode;
};

export const setMotionPreference = (value) => {
  const mode = normalize(value);
  store(mode);
  return apply(mode);
};

export const initMotionPreference = (root = document, { reloadOnChange = false } = {}) => {
  if (!initialized) {
    initialized = true;
    apply();
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY) apply(normalize(event.newValue));
    });
  }
  root.querySelectorAll(CHOICE_SELECTOR).forEach((button) => {
    if (button.dataset.motionControlRuntime === 'ready') return;
    button.dataset.motionControlRuntime = 'ready';
    button.addEventListener('click', () => {
      const next = normalize(button.dataset.motionChoice);
      const current = getMotionPreference();
      if (reloadOnChange && next !== current && store(next)) {
        window.location.reload();
        return;
      }
      setMotionPreference(next);
    });
  });
  syncChoiceButtons(root);
};

export const onMotionPreferenceChange = (handler) => {
  window.addEventListener(EVENT_NAME, (event) => handler(event.detail));
};
