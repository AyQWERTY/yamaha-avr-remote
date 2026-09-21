// Yamaha Receiver Service Worker
// Communicates with the receiver via the YamahaExtendedControl JSON API

const STORAGE_IP_KEY = 'yamahaIp';
const BASE_URL = 'http://';

/**
 * Get the stored IP address of the Yamaha receiver.
 * @returns {Promise<string>}
 */
function getYamahaIp() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(STORAGE_IP_KEY, (data) => {
      if (data[STORAGE_IP_KEY]) {
        resolve(data[STORAGE_IP_KEY]);
      } else {
        reject(new Error('Receiver IP not configured. Enter the IP in the extension popup.'));
      }
    });
  });
}

/**
 * Save the receiver IP address.
 * @param {string} ip
 * @returns {Promise<void>}
 */
function setYamahaIp(ip) {
  return new Promise((resolve, reject) => {
    if (!isValidIp(ip)) {
      reject(new Error('Invalid IP address format'));
      return;
    }
    chrome.storage.sync.set({ [STORAGE_IP_KEY]: ip }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Basic IPv4 validation.
 * @param {string} ip
 * @returns {boolean}
 */
function isValidIp(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && part === num.toString();
  });
}

/**
 * Build URL with port 80.
 * @param {string} ip
 * @param {string} path
 * @returns {string}
 */
function buildUrl(ip, path) {
  return `${BASE_URL}${ip}:80${path}`;
}

/**
 * Generic API request to the Yamaha receiver (JSON format).
 * @param {string} path - The API path (e.g., '/YamahaExtendedControl/v1/main/getStatus')
 * @returns {Promise<Object>} Parsed JSON response.
 */
function fetchYamahaApi(path) {
  return getYamahaIp()
    .then((ip) => fetch(buildUrl(ip, path), { method: 'GET' }))
    .then((response) => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
}

/**
 * Send power command to the receiver (new JSON API).
 * @param {string} power - 'on' or 'standby'
 * @returns {Promise<void>}
 */
function sendPowerCommand(power) {
  if (power !== 'on' && power !== 'standby') {
    return Promise.reject(new Error('Invalid power command. Use "on" or "standby".'));
  }
  return fetchYamahaApi(`/YamahaExtendedControl/v1/main/setPower?power=${power}`);
}

/**
 * Set volume level (new JSON API).
 * @param {number|string} volume - Volume level (dB)
 * @returns {Promise<void>}
 */
function sendVolume(volume) {
  return fetchYamahaApi(`/YamahaExtendedControl/v1/main/setVolume?volume=${volume}`);
}

/**
 * Set input source (new JSON API).
 * @param {string} input - Input name (e.g., 'TV', 'DVD', 'BLU-RAY', 'TUNER', 'USB', 'PHONO', 'NET_Radio')
 * @returns {Promise<void>}
 */
function setInputSource(input) {
  return fetchYamahaApi(`/YamahaExtendedControl/v1/main/setInput?input=${input}`);
}

/**
 * Get device information (model name) from the receiver.
 * @returns {Promise<Object>} Device info object.
 */
function getDeviceInfo() {
  return fetchYamahaApi('/YamahaExtendedControl/v1/system/getDeviceInfo');
}

/**
 * Set sound program.
 * @param {string} program - Program name (e.g., 'straight', 'all_ch_stereo')
 * @returns {Promise<void>}
 */
function setSoundProgram(program) {
  return fetchYamahaApi(`/YamahaExtendedControl/v1/main/setSoundProgram?program=${program}`);
}

/**
 * Toggle extra bass.
 * @param {boolean} enable - true or false
 * @returns {Promise<void>}
 */
function setExtraBass(enable) {
  return fetchYamahaApi(`/YamahaExtendedControl/v1/main/setExtraBass?enable=${enable}`);
}

/**
 * Toggle enhancer.
 * @param {boolean} enable - true or false
 * @returns {Promise<void>}
 */
function setEnhancer(enable) {
  return fetchYamahaApi(`/YamahaExtendedControl/v1/main/setEnhancer?enable=${enable}`);
}

/**
 * Set bass tone control.
 * @param {number} value - Bass value
 * @returns {Promise<void>}
 */
function setBass(value) {
  return fetchYamahaApi(`/YamahaExtendedControl/v1/main/setToneControl?bass=${value}`);
}

/**
 * Set treble tone control.
 * @param {number} value - Treble value
 * @returns {Promise<void>}
 */
function setTreble(value) {
  return fetchYamahaApi(`/YamahaExtendedControl/v1/main/setToneControl?treble=${value}`);
}

/**
 * Set subwoofer volume.
 * @param {number} value - Subwoofer value
 * @returns {Promise<void>}
 */
function setSubwoofer(value) {
  return fetchYamahaApi(`/YamahaExtendedControl/v1/main/setSubwooferVolume?volume=${value}`);
}

/**
 * Set mute status on the receiver.
 * @param {boolean} enable - true to mute, false to unmute
 * @returns {Promise<void>}
 */
function setMute(enable) {
  return fetchYamahaApi(`/YamahaExtendedControl/v1/main/setMute?enable=${enable}`);
}

/**
 * Get main status (power, volume, input) from the receiver.
 * @returns {Promise<Object>} Main status object.
 */
function getMainStatus() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  return getYamahaIp()
    .then((ip) => {
      const url = buildUrl(ip, '/YamahaExtendedControl/v1/main/getStatus');
      return fetch(url, { method: 'GET', signal: controller.signal });
    })
    .then((response) => {
      clearTimeout(timeout);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .catch((err) => {
      clearTimeout(timeout);
      if (err.name === 'AbortError') throw new Error('Request timed out');
      throw err;
    });
}

/**
 * Get system features (inputs, sound programs, volume/tone ranges).
 * @returns {Promise<Object>} Features object.
 */
function getFeatures() {
  return fetchYamahaApi('/YamahaExtendedControl/v1/system/getFeatures');
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let result;

  switch (message.action) {
    case 'setYamahaIp':
      result = setYamahaIp(message.ip);
      break;
    case 'getMainStatus':
      result = getMainStatus();
      break;
    case 'sendPowerCommand':
      result = sendPowerCommand(message.power);
      break;
    case 'sendVolume':
      result = sendVolume(message.volume);
      break;
    case 'setInputSource':
      result = setInputSource(message.input);
      break;
    case 'setSoundProgram':
      result = setSoundProgram(message.program);
      break;
    case 'setExtraBass':
      result = setExtraBass(message.extra_bass);
      break;
    case 'setEnhancer':
      result = setEnhancer(message.enhancer);
      break;
    case 'setBass':
      result = setBass(message.value);
      break;
    case 'setTreble':
      result = setTreble(message.value);
      break;
    case 'setSubwoofer':
      result = setSubwoofer(message.value);
      break;
    case 'getFeatures':
      result = getFeatures();
      break;
    case 'getDeviceInfo':
      result = getDeviceInfo();
      break;
    case 'setMute':
      result = setMute(message.enable);
      break;
    default:
      sendResponse({ error: `Unknown action: ${message.action}` });
      return false;
  }

  if (result && result.then) {
    result
      .then((data) => {
        sendResponse({ data });
      })
      .catch((err) => {
        sendResponse({ error: err.message });
      });
    return true; // Keep message channel open for async response
  }

  sendResponse({ data: result });
  return false;
});
