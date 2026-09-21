import { sendMessage } from "./utils.js";
import {
  state,
  getFeaturesCache,
  saveFeaturesCache,
  FEATURES_CACHE_TTL,
} from "./state.js";

let _lastStatusData = null;
let _featuresPromise = null;
let _featuresVersion = 0;

export function getLastStatusData() {
  return _lastStatusData;
}

export function setLastStatusData(data) {
  _lastStatusData = data;
}

/**
 * Apply a getStatus response to state.
 * Fields are only updated when present, so a partial response
 * (e.g. during standby) does not clobber current values.
 */
export function applyStatusData(data) {
  if (data.power) {
    state.power = data.power === "on" ? "ON" : "STANDBY";
  }
  if (data.mute !== undefined) {
    state.mute = data.mute === "on" || data.mute === true;
  }
  if (data.actual_volume?.value !== undefined) {
    state.volume = String(data.actual_volume.value).trim();
  } else if (data.volume !== undefined) {
    state.volume = String(data.volume).trim();
  }
  if (data.volume !== undefined) {
    state.rawVolume = String(data.volume).trim();
  }
  if (data.max_volume !== undefined) {
    state.maxVolume = String(data.max_volume).trim();
  }
  if (data.input) {
    state.input = data.input;
  }
  if (data.tone_control) {
    if (data.tone_control.bass !== undefined)
      state.bass = data.tone_control.bass;
    if (data.tone_control.treble !== undefined)
      state.treble = data.tone_control.treble;
  }
  if (data.subwoofer_volume !== undefined) {
    state.subwoofer = data.subwoofer_volume;
  }
}

export async function fetchStatus() {
  if (!state.connected) return false;

  try {
    const response = await sendMessage({ action: "getMainStatus" });
    const data = response?.data || {};
    if (
      data.power === undefined &&
      data.volume === undefined &&
      data.input === undefined
    ) {
      return false;
    }
    _lastStatusData = data;
    applyStatusData(data);
    return true;
  } catch (err) {
    console.warn("[fetchStatus]", err.message);
    return false;
  }
}

function applyRanges(rangeStep) {
  for (const item of rangeStep) {
    if (item.id === "volume") {
      // max comes from getStatus (user limit); features' max is the hardware ceiling.
      state.volRangeMin = item.min;
    }
    if (item.id === "actual_volume_db") {
      state.volStep = item.step;
      state.volDbMin = item.min;
    }
    if (item.id === "tone_control") {
      state.toneRangeMin = item.min;
      state.toneRangeMax = item.max;
    }
    if (item.id === "subwoofer_volume") {
      state.subRangeMin = item.min;
      state.subRangeMax = item.max;
    }
  }
}

/**
 * Main-zone features (input list, sound program list, volume/tone ranges).
 * Cache first (24h TTL), fetch from the receiver on a miss.
 * Concurrent callers share a single in-flight request.
 * @returns {Promise<{timestamp: number, rangeStep: Array, inputList: Array, soundProgramList: Array}>}
 */
export function ensureFeatures() {
  if (!_featuresPromise) {
    const version = _featuresVersion;
    _featuresPromise = (async () => {
      const cached = await getFeaturesCache();
      if (
        version === _featuresVersion &&
        cached &&
        cached.timestamp &&
        Date.now() - cached.timestamp < FEATURES_CACHE_TTL
      ) {
        applyRanges(cached.rangeStep);
        return cached;
      }

      const response = await sendMessage({ action: "getFeatures" });
      const data = response?.data || {};
      const zone = data.zone?.find((z) => z.id === "main") || {};
      const features = {
        timestamp: Date.now(),
        rangeStep: zone.range_step || [],
        inputList: zone.input_list || [],
        soundProgramList: zone.sound_program_list || [],
      };
      if (version === _featuresVersion) {
        await saveFeaturesCache(features);
      }
      applyRanges(features.rangeStep);
      return features;
    })().finally(() => {
      _featuresPromise = null;
    });
  }
  return _featuresPromise;
}

/** Invalidate the features cache and any in-flight fetch (used when the IP changes). */
export function invalidateFeatures() {
  _featuresVersion += 1;
  _featuresPromise = null;
}
