// ---- State ----

export const LAST_SOUND_PROGRAM_KEY = "lastSoundProgram";
export const FEATURES_CACHE_KEY = "featuresCache";
export const FEATURES_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const DEFAULTS = {
  connected: false,
  power: null,
  mute: false,
  volume: null,
  rawVolume: null,
  maxVolume: null,
  input: null,
  volStep: null,
  volDbMin: null,
  volRangeMin: null,
  toneRangeMin: null,
  toneRangeMax: null,
  subRangeMin: null,
  subRangeMax: null,
  bass: null,
  treble: null,
  subwoofer: null,
};

// Live receiver state; reset on disconnect / IP change.
export const state = { ...DEFAULTS };

export function resetState() {
  Object.assign(state, DEFAULTS);
}

// ---- Storage ----

export function getLastSoundProgram() {
  return new Promise((resolve) => {
    chrome.storage.local.get(LAST_SOUND_PROGRAM_KEY, (data) => {
      resolve(data[LAST_SOUND_PROGRAM_KEY] || null);
    });
  });
}

export function saveLastSoundProgram(program) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [LAST_SOUND_PROGRAM_KEY]: program }, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

export function getFeaturesCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get(FEATURES_CACHE_KEY, (data) =>
      resolve(data[FEATURES_CACHE_KEY] || null),
    );
  });
}

export function saveFeaturesCache(cacheData) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [FEATURES_CACHE_KEY]: cacheData }, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}
