import { sendMessage, setStatus } from './utils.js';
import { state, resetState, getLastSoundProgram, saveLastSoundProgram } from './state.js';
import * as api from './api.js';

// ---- Controls Logic ----

let connectionGen = 0;
let autoRefreshInterval = null;
let failedPolls = 0;

// The receiver applies set commands asynchronously (~5-10ms, measured on a
// live unit). Post-action refresh must wait this long, otherwise getStatus
// still reports the value from before the change.
const SETTLE_DELAY = 50;

export function beginConnection() {
  connectionGen += 1;
  return connectionGen;
}

export function isCurrentConnection(gen) {
  return gen === connectionGen;
}

/**
 * Build the controls UI and attach all listeners.
 * Called once when the popup opens — listeners are never attached twice.
 */
export function showControls() {
  document.getElementById('page-controls').style.display = 'flex';

  const headerBtn = document.getElementById('powerToggleHeader');
  headerBtn.className = 'btn-power-header disconnected';
  headerBtn.title = 'Connecting...';
  headerBtn.disabled = true;

  initPowerButton();
  initMuteToggle();
  initVolumeButtons();
  initInputSelect();
  initStraightToggle();
  initSoundProgramSelect();
  initExtraBassToggle();
  initEnhancerToggle();
  initBassControl();
  initTrebleControl();
  initSubwooferControl();
}

/**
 * Apply the first getStatus response and load cached features.
 * Called once after a successful connection.
 * @param {Object} data - Raw getStatus response from the receiver.
 * @param {number} gen - Connection generation this call belongs to.
 */
export async function initFromStatus(data, gen) {
  api.setLastStatusData(data);
  api.applyStatusData(data);

  const features = await api.ensureFeatures();
  if (!isCurrentConnection(gen)) return;

  setInputOptions(features.inputList);
  setProgramOptions(features.soundProgramList);
  applyStatusToUI(data);
  await updateStraightToggleState();
  await ensureModelName(gen);

  startAutoRefresh();
}

/** Reset state, polling, and header to the disconnected look. */
export function resetUI() {
  resetState();
  stopAutoRefresh();
  const headerBtn = document.getElementById('powerToggleHeader');
  headerBtn.className = 'btn-power-header disconnected';
  headerBtn.title = 'Disconnected — no receiver connection';
  headerBtn.disabled = true;
}

// ── Refresh ────────────────────────────────────

/**
 * Single refresh entry point: fetch getStatus and resync all state and UI.
 * Triggered every 5 seconds and after every local action.
 * @param {number} [delay] - Wait before fetching (ms). Post-action calls use
 * SETTLE_DELAY so the receiver has applied the change before we read it.
 * @returns {Promise<boolean>} true if the receiver responded.
 */
export async function refresh(delay = 0) {
  if (!state.connected) return false;
  if (delay) await new Promise((r) => setTimeout(r, delay));

  const ok = await api.fetchStatus();
  if (!ok) {
    failedPolls += 1;
    if (failedPolls >= 3) {
      state.connected = false;
      resetUI();
      setStatus('Connection lost', 'error');
    }
    return false;
  }
  failedPolls = 0;
  applyStatusToUI(api.getLastStatusData());
  return true;
}

function startAutoRefresh() {
  stopAutoRefresh();
  failedPolls = 0;
  autoRefreshInterval = setInterval(refresh, 5000);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

/** Push current state into every control. */
function applyStatusToUI(statusData) {
  updatePowerUI(state.power);
  updateMuteUI();
  updateVolumeUI(state.volume, state.rawVolume);
  syncToggles(statusData);
  syncSoundProgram(statusData);
  syncInputSelect();
  updateToneSliders();
}

// ── Header / Model ─────────────────────────────

/**
 * Show the receiver model name in the header.
 * Fetches getDeviceInfo only when no model name is stored yet.
 */
async function ensureModelName(gen) {
  const receiverNameEl = document.getElementById('receiverName');

  const stored = await new Promise((resolve) => {
    chrome.storage.sync.get('yamahaModel', (data) => resolve(data.yamahaModel));
  });
  if (stored) {
    receiverNameEl.textContent = `Yamaha ${stored}`;
    return;
  }

  try {
    const response = await sendMessage({ action: 'getDeviceInfo' });
    const model = response?.data?.model_name;
    // The receiver may have changed in the meantime (IP edit) — do not save a stale model
    if (model && isCurrentConnection(gen)) {
      await chrome.storage.sync.set({ yamahaModel: model });
      receiverNameEl.textContent = `Yamaha ${model}`;
    }
  } catch (err) {
    console.warn('[ensureModelName]', err.message);
  }
}

// ── Power ──────────────────────────────────────

function updatePowerUI(status) {
  const headerBtn = document.getElementById('powerToggleHeader');

  if (status === 'ON') {
    headerBtn.className = 'btn-power-header on';
    headerBtn.title = 'Power: ON';
    headerBtn.disabled = false;
    updateBasicControlBlur(false);
  } else if (status === 'STANDBY') {
    headerBtn.className = 'btn-power-header off';
    headerBtn.title = 'Power: STANDBY';
    headerBtn.disabled = false;
    updateBasicControlBlur(true);
  } else {
    headerBtn.className = 'btn-power-header disconnected';
    headerBtn.title = 'Disconnected — no receiver connection';
    headerBtn.disabled = true;
  }
}

function initPowerButton() {
  const headerBtn = document.getElementById('powerToggleHeader');
  headerBtn.addEventListener('click', async () => {
    if (headerBtn.disabled) return;
    const newPower = state.power === 'ON' ? 'standby' : 'on';
    try {
      await sendMessage({ action: 'sendPowerCommand', power: newPower });
      await refresh(SETTLE_DELAY);
    } catch (err) {
      console.warn('[power]', err.message);
    }
  });
}

function updateBasicControlBlur(standby) {
  const section = document.querySelector('.group-basic');
  if (!section) return;
  if (standby) {
    section.style.filter = 'blur(3px)';
    section.style.pointerEvents = 'none';
  } else {
    section.style.filter = '';
    section.style.pointerEvents = '';
  }
}

// ── Volume ─────────────────────────────────────

function getVolumeRange() {
  const min = state.volRangeMin !== null && state.volRangeMin !== undefined
    ? parseInt(state.volRangeMin, 10)
    : 0;
  const max = state.maxVolume !== null && state.maxVolume !== undefined
    ? parseInt(state.maxVolume, 10)
    : 0;
  return { min, max };
}

function rawToSlider(raw) {
  const { min, max } = getVolumeRange();
  return Math.round(((raw - min) / (max - min)) * 100);
}

function sliderToRaw(sliderVal) {
  const { min, max } = getVolumeRange();
  return Math.round((sliderVal / 100) * (max - min) + min);
}

function rawToDB(raw) {
  if (state.volStep === null || state.volStep === undefined || state.volDbMin === null || state.volDbMin === undefined) {
    return null;
  }
  const step = parseFloat(state.volStep);
  const min = parseFloat(state.volDbMin);
  return raw * step + min;
}

// The thumb is constrained inside the track, so the fill must end at the
// thumb center (thumbRadius from the edge), not at the track edge.
function setSliderFill(sliderFillEl, pct) {
  const containerWidth = sliderFillEl.parentElement.offsetWidth || 1;
  const thumbRadiusPx = 16; // half of the 32px thumb width
  const thumbCenterPx = thumbRadiusPx + (pct / 100) * (containerWidth - 2 * thumbRadiusPx);
  sliderFillEl.style.width = `${(thumbCenterPx / containerWidth) * 100}%`;
}

function initVolumeButtons() {
  const volumeSliderEl = document.getElementById('volumeSlider');
  const volumeDisplayEl = document.getElementById('volumeDisplay');
  const sliderFillEl = document.getElementById('sliderFill');

  function updateVolumeDisplay(raw) {
    const db = rawToDB(raw);
    state.rawVolume = String(raw);
    if (db !== null) {
      state.volume = db.toFixed(1);
    }
    const formatted = db === null ? '—' : db >= 0 ? `+${db.toFixed(1)}` : db.toFixed(1);
    volumeDisplayEl.textContent = `${formatted} dB`;

    // Fill tracks the slider's 0-100 position, not the raw volume value:
    // the thumb is placed by slider percentage.
    setSliderFill(sliderFillEl, Math.round(parseFloat(volumeSliderEl.value)));
  }

  // Slider: instant feedback, sends while dragging with a 100ms trailing debounce
  let dragging = false;
  let lastSendRaw = -1;
  let sendTimer = null;
  volumeSliderEl.addEventListener('mousedown', () => { dragging = true; });
  volumeSliderEl.addEventListener('touchstart', () => { dragging = true; });
  volumeSliderEl.addEventListener('mousemove', () => {
    if (!dragging) return;
    const raw = sliderToRaw(parseFloat(volumeSliderEl.value));
    updateVolumeDisplay(raw);
    if (raw !== lastSendRaw) {
      lastSendRaw = raw;
      clearTimeout(sendTimer);
      sendTimer = setTimeout(() => {
        sendMessage({ action: 'sendVolume', volume: raw }).catch(() => {});
      }, 100);
    }
  });
  volumeSliderEl.addEventListener('mouseup', async () => {
    if (!dragging) return;
    dragging = false;
    lastSendRaw = -1;
    clearTimeout(sendTimer);
    const raw = sliderToRaw(parseFloat(volumeSliderEl.value));
    updateVolumeDisplay(raw);

    try {
      await sendMessage({ action: 'sendVolume', volume: raw });
      await refresh(SETTLE_DELAY);
    } catch (err) {
      console.warn('[volumeSlider]', err.message);
    }
  });
  volumeSliderEl.addEventListener('touchend', async () => {
    if (!dragging) return;
    dragging = false;
    const raw = sliderToRaw(parseFloat(volumeSliderEl.value));
    updateVolumeDisplay(raw);

    try {
      await sendMessage({ action: 'sendVolume', volume: raw });
      await refresh(SETTLE_DELAY);
    } catch (err) {
      console.warn('[volumeSlider]', err.message);
    }
  });

  // Slider input: instant UI feedback + gradient fill
  volumeSliderEl.addEventListener('input', () => {
    const raw = sliderToRaw(parseFloat(volumeSliderEl.value));
    updateVolumeDisplay(raw);
  });
}

function updateVolumeUI(volume, rawVolume) {
  const volumeSliderEl = document.getElementById('volumeSlider');
  const volumeDisplayEl = document.getElementById('volumeDisplay');
  const sliderFillEl = document.getElementById('sliderFill');

  if (rawVolume !== undefined && rawVolume !== null) {
    state.rawVolume = String(rawVolume);
  }

  // Display dB (actual_volume.value)
  const num = parseFloat(volume);
  if (isNaN(num) || volume === '0' || volume === '—') {
    volumeSliderEl.value = 0;
    setSliderFill(sliderFillEl, 0);
    volumeDisplayEl.textContent = '— dB';
    return;
  }

  // Map raw to slider position using dynamic max_volume from API
  const raw = parseInt(state.rawVolume, 10);
  const sliderVal = rawToSlider(isNaN(raw) ? 0 : raw);
  volumeSliderEl.value = sliderVal;
  setSliderFill(sliderFillEl, sliderVal);

  const formatted = num >= 0 ? `+${num.toFixed(1)}` : num.toFixed(1);
  volumeDisplayEl.textContent = `${formatted} dB`;
}

// ── Mute ───────────────────────────────────────

function updateMuteUI() {
  const muteBtn = document.getElementById('muteToggle');
  const muteIcon = muteBtn?.querySelector('.mute-icon');
  if (!muteIcon) return;
  muteIcon.textContent = state.mute ? '🔇' : '🔊';
  muteBtn.classList.toggle('muted', state.mute);
}

function initMuteToggle() {
  const muteBtn = document.getElementById('muteToggle');
  muteBtn.addEventListener('click', async () => {
    const newMuted = !state.mute;
    try {
      await sendMessage({ action: 'setMute', enable: newMuted });
      await refresh(SETTLE_DELAY);
    } catch (err) {
      console.warn('[mute]', err.message);
    }
  });
}

// ── Input ──────────────────────────────────────

function initInputSelect() {
  const inputSelectEl = document.getElementById('inputSelect');
  inputSelectEl.addEventListener('change', async () => {
    try {
      await sendMessage({ action: 'setInputSource', input: inputSelectEl.value });
      await refresh(SETTLE_DELAY);
    } catch (err) {
      console.warn('[inputSelect]', err.message);
    }
  });
}

function setInputOptions(inputs) {
  const inputSelect = document.getElementById('inputSelect');
  inputSelect.innerHTML = '';

  if (!inputs || inputs.length === 0) {
    const option = document.createElement('option');
    option.textContent = 'No inputs found';
    inputSelect.appendChild(option);
    return;
  }

  const inputLabels = {
    usb: 'USB',
    tv: 'TV',
    airplay: 'AirPlay',
  };

  function formatInput(input) {
    if (inputLabels[input]) return inputLabels[input];
    if (input.startsWith('hdmi')) return 'HDMI' + input.replace('hdmi', '');
    return input.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  inputs
    .map((input) => ({ value: input, label: formatInput(input) }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      inputSelect.appendChild(option);
    });
  inputSelect.value = state.input || '';
}

function syncInputSelect() {
  const inputSelect = document.getElementById('inputSelect');
  if (state.input && inputSelect.value !== state.input) {
    inputSelect.value = state.input;
  }
}

// ── Sound Program / Straight ───────────────────

function setProgramOptions(programs) {
  const select = document.getElementById('soundProgramSelect');
  select.innerHTML = '';

  // "straight" is excluded — it has its own toggle
  (programs || []).filter((p) => p !== 'straight')
    .map((program) => ({ value: program, label: program.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
}

/** Keep the program select and straight toggle in sync with the receiver. */
async function syncSoundProgram(statusData) {
  const current = statusData?.sound_program;
  const select = document.getElementById('soundProgramSelect');
  const straightBtn = document.getElementById('straightToggle');

  straightBtn.classList.toggle('active', current === 'straight');

  if (current && current !== 'straight') {
    if (select.value !== current) select.value = current;
    // Track the last non-straight program so straight can restore it
    const stored = await getLastSoundProgram();
    if (stored !== current) {
      await saveLastSoundProgram(current);
    }
  } else if (current === 'straight') {
    // Show the program straight will restore to
    const stored = await getLastSoundProgram();
    const hasStored = [...select.options].some((o) => o.value === stored);
    select.value = hasStored ? stored : '';
  }
}

/** The straight toggle can be turned OFF only if a program is stored to restore. */
async function updateStraightToggleState() {
  const btn = document.getElementById('straightToggle');
  const stored = await getLastSoundProgram();
  if (!stored) {
    btn.disabled = true;
    btn.title = 'Select a sound program to turn off straight';
  } else {
    btn.disabled = false;
    btn.title = 'Toggle Straight mode';
  }
}

function unlockStraightToggle() {
  const straightBtn = document.getElementById('straightToggle');
  if (straightBtn && straightBtn.disabled) {
    straightBtn.disabled = false;
    straightBtn.title = 'Toggle Straight mode';
  }
}

function initStraightToggle() {
  const btn = document.getElementById('straightToggle');
  btn.addEventListener('click', async () => {
    const isActive = btn.classList.contains('active');
    try {
      if (!isActive) {
        await sendMessage({ action: 'setSoundProgram', program: 'straight' });
      } else {
        const stored = await getLastSoundProgram();
        if (!stored) return;
        await sendMessage({ action: 'setSoundProgram', program: stored });
      }
      await refresh(SETTLE_DELAY);
    } catch (err) {
      console.warn('[straightToggle]', err.message);
    }
  });
}

function initSoundProgramSelect() {
  const select = document.getElementById('soundProgramSelect');
  select.addEventListener('change', async () => {
    try {
      await sendMessage({ action: 'setSoundProgram', program: select.value });
      await saveLastSoundProgram(select.value);
      unlockStraightToggle();
      await refresh(SETTLE_DELAY);
    } catch (err) {
      console.warn('[soundProgramSelect]', err.message);
    }
  });
}

// ── Toggle Buttons (Extra Bass / Enhancer) ──

function toggleFeature(feature, action, btnId) {
  const btn = document.getElementById(btnId);
  const newState = !btn.classList.contains('active');
  sendMessage({ action, [feature]: newState })
    .then(() => refresh(SETTLE_DELAY))
    .catch((err) => {
      console.warn(`[toggleFeature] ${feature}:`, err.message);
    });
}

function initExtraBassToggle() {
  const btn = document.getElementById('extraBassToggle');
  btn.addEventListener('click', () => toggleFeature('extra_bass', 'setExtraBass', 'extraBassToggle'));
}

function initEnhancerToggle() {
  const btn = document.getElementById('enhancerToggle');
  btn.addEventListener('click', () => toggleFeature('enhancer', 'setEnhancer', 'enhancerToggle'));
}

function syncToggles(statusData) {
  const data = statusData || {};
  if (data.extra_bass !== undefined) {
    document.getElementById('extraBassToggle').classList.toggle('active', data.extra_bass);
  }
  if (data.enhancer !== undefined) {
    document.getElementById('enhancerToggle').classList.toggle('active', data.enhancer);
  }
}

// ── Tone Sliders ───────────────────────────────

// The receiver reports tone values on a -12..12 scale; each step is 0.5 dB.
function toneDbText(value) {
  return (value * 0.5).toFixed(1).replace(/\.0$/, '') + ' dB';
}

function updateToneSliders() {
  const sliders = [
    { id: 'bassSlider', valueId: 'bassValue', min: state.toneRangeMin, max: state.toneRangeMax, value: state.bass },
    { id: 'trebleSlider', valueId: 'trebleValue', min: state.toneRangeMin, max: state.toneRangeMax, value: state.treble },
    { id: 'subwooferSlider', valueId: 'subValue', min: state.subRangeMin, max: state.subRangeMax, value: state.subwoofer },
  ];

  for (const s of sliders) {
    if (s.min === null || s.min === undefined || s.max === null || s.max === undefined) continue;
    const slider = document.getElementById(s.id);
    const valueEl = document.getElementById(s.valueId);
    slider.min = s.min;
    slider.max = s.max;
    if (s.value !== null && s.value !== undefined) {
      const clamped = Math.max(s.min, Math.min(s.max, s.value));
      slider.value = clamped;
      valueEl.textContent = toneDbText(clamped);
    }
  }
}

function initToneSlider(action, sliderId, valueId, labelId) {
  const slider = document.getElementById(sliderId);
  const valueEl = document.getElementById(valueId);
  const labelEl = document.getElementById(labelId);

  let sendTimer = null;

  const restoreLabel = () => {
    labelEl.textContent = labelEl.dataset.param.charAt(0).toUpperCase() + labelEl.dataset.param.slice(1);
  };

  // Live send while dragging, 100ms trailing debounce
  slider.addEventListener('input', () => {
    const val = parseFloat(slider.value);
    valueEl.textContent = toneDbText(val);
    if (labelEl.textContent === 'RESET') restoreLabel();

    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      sendMessage({ action, value: val }).catch((err) => console.warn(`[tone ${action}]`, err.message));
    }, 100);
  });

  // Final value on release
  slider.addEventListener('change', async () => {
    clearTimeout(sendTimer);
    const val = parseFloat(slider.value);
    try {
      await sendMessage({ action, value: val });
      await refresh(SETTLE_DELAY);
    } catch (err) {
      console.warn(`[tone ${action}]`, err.message);
    }
  });

  // Hover -> show RESET, click -> reset to 0
  labelEl.addEventListener('mouseenter', () => {
    labelEl.textContent = 'RESET';
  });
  labelEl.addEventListener('mouseleave', restoreLabel);
  labelEl.addEventListener('click', async () => {
    slider.value = 0;
    valueEl.textContent = '0 dB';
    try {
      await sendMessage({ action, value: 0 });
      await refresh(SETTLE_DELAY);
    } catch (err) {
      console.warn(`[tone ${action} reset]`, err.message);
    }
  });
}

function initBassControl() {
  initToneSlider('setBass', 'bassSlider', 'bassValue', 'bassLabel');
}

function initTrebleControl() {
  initToneSlider('setTreble', 'trebleSlider', 'trebleValue', 'trebleLabel');
}

function initSubwooferControl() {
  initToneSlider('setSubwoofer', 'subwooferSlider', 'subValue', 'subwooferLabel');
}
