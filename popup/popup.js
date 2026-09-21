import { state, FEATURES_CACHE_KEY, LAST_SOUND_PROGRAM_KEY } from './state.js';
import * as api from './api.js';
import * as controls from './controls.js';
import { isValidIp, setStatus } from './utils.js';

let autoTestTimer = null;

function clearAutoTestTimer() {
  if (autoTestTimer) {
    clearTimeout(autoTestTimer);
    autoTestTimer = null;
  }
}

/**
 * Fetch getStatus from a specific IP; doubles as the connection test.
 * @returns {Promise<Object>} Raw getStatus response.
 */
async function fetchStatusFromIp(ip) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  const response = await fetch(`http://${ip}:80/YamahaExtendedControl/v1/main/getStatus`, {
    method: 'GET',
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

/**
 * Wipe all persisted receiver data and reset the UI.
 * Run whenever the IP changes: cached features and the stored model name
 * may belong to a different receiver.
 */
function resetConnection() {
  controls.beginConnection(); // invalidate any in-flight connect
  controls.resetUI();
  api.invalidateFeatures();
  chrome.storage.sync.remove(['yamahaIp', 'yamahaModel']);
  chrome.storage.local.remove([FEATURES_CACHE_KEY, LAST_SOUND_PROGRAM_KEY]);
}

async function connect(ip) {
  const gen = controls.beginConnection();
  setStatus('Connecting...', 'connecting');

  try {
    const response = await fetchStatusFromIp(ip);
    if (!controls.isCurrentConnection(gen)) return;

    await chrome.runtime.sendMessage({ action: 'setYamahaIp', ip });
    if (!controls.isCurrentConnection(gen)) return;

    state.connected = true;
    await controls.initFromStatus(response, gen);
    if (!controls.isCurrentConnection(gen)) return;

    setStatus('Connected', 'connected');
  } catch (err) {
    if (!controls.isCurrentConnection(gen)) return;
    state.connected = false;
    setStatus('Connection error', 'error');
    // Store error in a data attribute for tooltip
    const el = document.getElementById('connectionStatus');
    if (el) el.title = err.message;
  }
}

// Initialize controls page
(async function init() {
  controls.showControls();

  const ipInput = document.getElementById('ipInput');

  // Load saved IP from storage
  const stored = await new Promise((resolve) => {
    chrome.storage.sync.get('yamahaIp', (data) => resolve(data.yamahaIp));
  });

  if (stored) {
    ipInput.value = stored;
    connect(stored);
  } else {
    setStatus('Not connected', '');
  }

  // Debounced IP input handler
  ipInput.addEventListener('input', () => {
    const ip = ipInput.value.trim();

    if (!ip) {
      resetConnection();
      setStatus('Not connected', '');
      clearAutoTestTimer();
      return;
    }

    if (!isValidIp(ip)) {
      setStatus('Invalid IP', 'error');
      clearAutoTestTimer();
      return;
    }

    clearAutoTestTimer();
    setStatus('Connecting...', 'connecting');
    autoTestTimer = setTimeout(() => {
      resetConnection();
      connect(ip);
    }, 800);
  });
})();
