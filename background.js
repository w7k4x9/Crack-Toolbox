// 크랙 툴박스 — 백그라운드
// ① TXT 자동 입력: 신뢰 클릭·키 입력(디버거)  ② QA 러너: 탭 깨어 있게·창 떼어내기
// ③ 팝업에서 도구 열기  ④ 새 버전 확인
importScripts("lib/update-check.js");

// ------------------------------------------------------------ ① TXT 자동 입력
const attachedTabs = new Set();

async function ensureAttached(tabId) {
  if (attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attachedTabs.add(tabId);
  } catch (error) {
    const message = String(error?.message || error);
    if (/already attached|Another debugger/i.test(message)) {
      throw new Error("다른 디버거가 이 탭을 사용 중입니다. Chrome 개발자도구를 닫고 다시 실행하세요.");
    }
    throw error;
  }
}

async function detach(tabId) {
  if (!attachedTabs.has(tabId)) return;
  try { await chrome.debugger.detach({ tabId }); } catch (_) {}
  attachedTabs.delete(tabId);
}

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) attachedTabs.delete(source.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
});

const DEBUGGER_TYPES = ["CRACK_TXT_DEBUGGER_START_V26", "CRACK_TXT_DEBUGGER_CLICK_V26", "CRACK_TXT_DEBUGGER_STOP_V26", "CRACK_TXT_DEBUGGER_KEY_V30", "CRACK_TXT_DEBUGGER_REPLACE_TEXT_V40"];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId) return;
  if (!DEBUGGER_TYPES.includes(message?.type)) return;

  (async () => {
    if (message.type === "CRACK_TXT_DEBUGGER_START_V26") {
      await ensureAttached(tabId);
      return { ok: true };
    }
    if (message.type === "CRACK_TXT_DEBUGGER_STOP_V26") {
      await detach(tabId);
      return { ok: true };
    }

    if (message.type === "CRACK_TXT_DEBUGGER_KEY_V30") {
      await ensureAttached(tabId);
      const key = String(message.key || "Enter");
      if (key !== "Enter") throw new Error("현재는 Enter 키만 지원합니다.");
      const base = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type: "char", text: "\r", unmodifiedText: "\r", ...base });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
      return { ok: true };
    }

    if (message.type === "CRACK_TXT_DEBUGGER_REPLACE_TEXT_V40") {
      await ensureAttached(tabId);
      const text = String(message.text ?? "");
      const ctrl = { key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 };
      const selectAll = { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 };
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...ctrl, modifiers: 2 });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...selectAll });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type: "keyUp", ...selectAll });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type: "keyUp", ...ctrl, modifiers: 0 });
      await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text });
      return { ok: true };
    }

    await ensureAttached(tabId);
    const x = Number(message.x);
    const y = Number(message.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("클릭 좌표가 올바르지 않습니다.");
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseMoved", x, y, button: "none", buttons: 0, pointerType: "mouse",
    });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse",
    });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse",
    });
    return { ok: true };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, reason: String(error?.message || error) }));
  return true;
});

// ------------------------------------------------------------ ② QA 러너
// 진행 중에는 크롬이 이 탭을 재우거나(메모리 절약) 버리지 못하게 한다. 끝나면 원래대로.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "CRACK_QA_KEEPALIVE" || !sender.tab?.id) return;
  chrome.tabs.update(sender.tab.id, { autoDiscardable: !msg.on }).catch(() => {});
});

// 크랙 탭을 작은 창으로 떼어낸다 (가려지지 않게 화면 구석에 두라고)
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "CRACK_QA_DETACH" || !sender.tab?.id) return;
  chrome.windows.create({ tabId: sender.tab.id, type: "normal", width: 560, height: 860, focused: true }).catch(() => {});
});

// ------------------------------------------------------------ ③ 팝업에서 도구 열기
const CRACK = "https://crack.wrtn.ai/";
const MY = "https://crack.wrtn.ai/my";

async function openQa(tab) {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "CRACK_QA_TOGGLE" });
  } catch (_) {
    // 설치 직후라 콘텐츠 스크립트가 아직 없는 탭 → 한 번 주입하고 다시 시도
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["qa/pool.js", "qa/content.js"] });
      await chrome.tabs.sendMessage(tab.id, { type: "CRACK_QA_TOGGLE" });
    } catch (_) {}
  }
}

async function openBump(tab) {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "cvb-open" });
  } catch (_) {
    // 설치하기 전부터 열려 있던 탭이라 스크립트가 없으면 새로 불러온다.
    chrome.tabs.reload(tab.id);
  }
}

async function refreshBadge(force) {
  try {
    const info = await self.ToolboxUpdate.check({ force });
    await chrome.action.setBadgeText({ text: info.available ? "N" : "" });
    if (info.available) await chrome.action.setBadgeBackgroundColor({ color: "#007aff" });
    return info;
  } catch (_) { return null; }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!["TOOLBOX_OPEN", "TOOLBOX_UPDATE_STATUS", "TOOLBOX_OPEN_UPDATE"].includes(msg?.type)) return;
  (async () => {
    if (msg.type === "TOOLBOX_UPDATE_STATUS") return refreshBadge(!!msg.force);
    if (msg.type === "TOOLBOX_OPEN_UPDATE") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("update.html") });
      return { ok: true };
    }
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    // 크랙 탭이 아니면(주소를 볼 수 없는 탭 포함) 내 작품을 새 탭으로 연다.
    if (!tab?.id || !(tab.url || "").startsWith(CRACK)) {
      await chrome.tabs.create({ url: MY });
      return { ok: true, opened: "my" };
    }
    if (msg.tool === "qa") await openQa(tab);
    else await openBump(tab);
    return { ok: true };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, reason: String(error?.message || error) }));
  return true;
});

// ------------------------------------------------------------ ④ 새 버전 확인
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "update" && (await chrome.storage.local.get("toolbox.updateApplied"))["toolbox.updateApplied"]) {
    chrome.tabs.create({ url: chrome.runtime.getURL("update.html#done") });
  }
  refreshBadge(true);
});
chrome.runtime.onStartup.addListener(() => { refreshBadge(false); });
