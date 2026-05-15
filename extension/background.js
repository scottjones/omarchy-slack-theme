const HOST = "com.omarchy.slack_theme";
const SLACK_URL_PATTERNS = ["*://app.slack.com/*", "*://*.slack.com/*"];

let port = null;
let reconnectTimer = null;

function connect() {
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    console.warn("[omarchy] connectNative threw:", e);
    scheduleReconnect();
    return;
  }

  port.onMessage.addListener((theme) => {
    if (!theme || theme.error) {
      console.warn("[omarchy] native host error:", theme && theme.error);
      return;
    }
    chrome.storage.local.set({ theme });
    broadcast(theme);
  });

  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    if (err) console.warn("[omarchy] native host disconnected:", err.message);
    port = null;
    scheduleReconnect();
  });

  // Request initial state
  try {
    port.postMessage({ action: "get" });
  } catch (e) {
    console.warn("[omarchy] postMessage failed:", e);
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

function broadcast(theme) {
  chrome.tabs.query({ url: SLACK_URL_PATTERNS }, (tabs) => {
    for (const t of tabs) {
      chrome.tabs.sendMessage(t.id, { type: "omarchy-theme", theme }).catch(() => {});
    }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "request-theme") {
    chrome.storage.local.get("theme").then(({ theme }) => sendResponse(theme || null));
    return true;
  }
  if (msg && msg.type === "request-fresh-theme") {
    fetchFreshTheme(sendResponse);
    return true;
  }
});

function fetchFreshTheme(callback) {
  if (!port) {
    chrome.storage.local.get("theme").then(({ theme }) => callback(theme || null));
    return;
  }
  let done = false;
  let timeoutId;
  const oneShot = (theme) => {
    if (done) return;
    if (theme && theme.error) return;
    done = true;
    clearTimeout(timeoutId);
    port.onMessage.removeListener(oneShot);
    callback(theme || null);
  };
  port.onMessage.addListener(oneShot);
  try {
    port.postMessage({ action: "get" });
  } catch (e) {
    if (!done) {
      done = true;
      port.onMessage.removeListener(oneShot);
      chrome.storage.local.get("theme").then(({ theme }) => callback(theme || null));
    }
    return;
  }
  timeoutId = setTimeout(() => {
    if (done) return;
    done = true;
    port.onMessage.removeListener(oneShot);
    chrome.storage.local.get("theme").then(({ theme }) => callback(theme || null));
  }, 1500);
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete") return;
  if (!tab.url || !tab.url.includes("slack.com")) return;
  chrome.storage.local.get("theme").then(({ theme }) => {
    if (theme) chrome.tabs.sendMessage(tabId, { type: "omarchy-theme", theme }).catch(() => {});
  });
});

chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);

connect();
