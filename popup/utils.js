// ---- Messaging ----

export function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (response && response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

export function isValidIp(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && part === num.toString();
  });
}

/**
 * Set the footer status text, its tooltip, and the page lock.
 * The page stays locked (blurred) until the status is 'connected'.
 * An 'error' status keeps its previous tooltip, which the caller sets.
 */
export function setStatus(text, className) {
  const el = document.getElementById("connectionStatus");
  if (el) {
    el.textContent = text;
    el.className = "connection-status" + (className ? " " + className : "");
    if (className !== "error") {
      el.title = "";
    }
    const mainEl = document.querySelector(".main");
    if (mainEl) {
      mainEl.classList.toggle("locked", className !== "connected");
    }
  }
}
