(() => {
  if (window.__CRACK_TXT_FILE_BRIDGE_V30__) return;
  window.__CRACK_TXT_FILE_BRIDGE_V30__ = true;
  document.documentElement.dataset.crackTxtBridgeReady = "1";

  const originalClick = HTMLInputElement.prototype.click;
  let armedUntil = 0;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "CRACK_TXT_ARM_FILE_CAPTURE_V2") {
      const requestId = event.data.requestId;
      armedUntil = Date.now() + 5000;
      window.postMessage({ type: "CRACK_TXT_FILE_CAPTURE_ARMED_V2", requestId }, "*");
    }
  });

  HTMLInputElement.prototype.click = function (...args) {
    if (this.type === "file" && Date.now() < armedUntil) {
      armedUntil = 0;
      this.dataset.crackTxtCapturedFileInput = "1";
      window.postMessage({ type: "CRACK_TXT_FILE_INPUT_CAPTURED_V2" }, "*");
      return;
    }
    return originalClick.apply(this, args);
  };


  function visible(el) {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function findStartPills() {
    const buttons = [...document.querySelectorAll("[aria-roledescription='slide'][role='group'] > button")].filter(visible);
    const groups = new Map();
    for (const button of buttons) {
      const row = button.parentElement?.parentElement;
      if (!row) continue;
      if (!groups.has(row)) groups.set(row, []);
      groups.get(row).push(button);
    }
    return [...groups.values()]
      .map((items) => items.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left))
      .filter((items) => items.length >= 1 && items.length <= 3)
      .sort((a, b) => {
        const as = a.some((button) => /설정/.test((button.textContent || "").trim())) ? 1 : 0;
        const bs = b.some((button) => /설정/.test((button.textContent || "").trim())) ? 1 : 0;
        return bs - as || a[0].getBoundingClientRect().top - b[0].getBoundingClientRect().top;
      })[0] || [];
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.type !== "CRACK_TXT_START_PILL_CLICK_V2") return;
    const { requestId, index } = event.data;
    const pills = findStartPills();
    const button = pills[index];
    if (!button) {
      window.postMessage({ type: "CRACK_TXT_START_PILL_CLICK_RESULT_V2", requestId, ok: false, count: pills.length }, "*");
      return;
    }
    try {
      button.scrollIntoView({ block: "center", inline: "center" });
      button.focus({ preventScroll: true });
      const r = button.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
      button.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerType: "mouse", isPrimary: true, buttons: 1 }));
      button.dispatchEvent(new MouseEvent("mousedown", { ...opts, buttons: 1 }));
      button.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerType: "mouse", isPrimary: true, buttons: 0 }));
      button.dispatchEvent(new MouseEvent("mouseup", { ...opts, buttons: 0 }));
      HTMLElement.prototype.click.call(button);
      setTimeout(() => {
        window.postMessage({
          type: "CRACK_TXT_START_PILL_CLICK_RESULT_V2",
          requestId,
          ok: true,
          text: (button.textContent || "").trim(),
          className: String(button.className || ""),
        }, "*");
      }, 120);
    } catch (error) {
      window.postMessage({ type: "CRACK_TXT_START_PILL_CLICK_RESULT_V2", requestId, ok: false, reason: String(error?.message || error) }, "*");
    }
  });


  function normalizeTopTabText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().replace(/\*+$/, "").trim();
  }

  const TOP_TAB_STEPS = {
    "프로필": "profile",
    "스토리 설정": "detail",
    "시작 설정": "starting_set",
    "스탯 설정": "stats",
    "미디어": "media",
    "키워드북": "keyword_book",
    "단축어": "slash_command",
    "엔딩 설정": "ending",
    "등록": "register",
  };

  const TOP_TAB_SELECTOR = "a[href],button,[role='tab'],[role='link']";

  function hrefStep(el) {
    const href = el?.getAttribute?.("href");
    if (!href) return "";
    try { return new URL(href, location.origin).searchParams.get("step") || ""; } catch (_) { return ""; }
  }

  // 상단 스텝 메뉴가 button → a[href*="step="]로 바뀌어도 동작하도록,
  // href의 step 값을 먼저 보고 없으면 텍스트로 찾습니다.
  function findTopTabButton(name) {
    const wanted = normalizeTopTabText(name);
    const step = TOP_TAB_STEPS[wanted] || "";
    const nodes = [...document.querySelectorAll(TOP_TAB_SELECTOR)];

    if (step) {
      const byStep = nodes
        .filter((el) => hrefStep(el) === step)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      if (byStep.length) return byStep[0];
    }

    const byText = nodes.filter((el) => normalizeTopTabText(el.textContent) === wanted);
    const nearTop = byText.filter((el) => el.getBoundingClientRect().top < 220);
    return nearTop[0] || byText[0] || null;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.type !== "CRACK_TXT_TOP_TAB_CLICK_V1") return;
    const { requestId, name } = event.data;
    const button = findTopTabButton(name);
    if (!button) {
      window.postMessage({ type: "CRACK_TXT_TOP_TAB_CLICK_RESULT_V1", requestId, ok: false, reason: "button-not-found" }, "*");
      return;
    }
    try {
      button.focus?.({ preventScroll: true });
      const r = button.getBoundingClientRect();
      const opts = {
        bubbles: true, cancelable: true, composed: true, button: 0,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      };
      button.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerType: "mouse", isPrimary: true, buttons: 1 }));
      button.dispatchEvent(new MouseEvent("mousedown", { ...opts, buttons: 1 }));
      button.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerType: "mouse", isPrimary: true, buttons: 0 }));
      button.dispatchEvent(new MouseEvent("mouseup", { ...opts, buttons: 0 }));
      HTMLElement.prototype.click.call(button);
      setTimeout(() => {
        window.postMessage({
          type: "CRACK_TXT_TOP_TAB_CLICK_RESULT_V1",
          requestId,
          ok: true,
          tag: button.tagName,
          text: normalizeTopTabText(button.textContent),
          className: String(button.className || ""),
        }, "*");
      }, 80);
    } catch (error) {
      window.postMessage({ type: "CRACK_TXT_TOP_TAB_CLICK_RESULT_V1", requestId, ok: false, reason: String(error?.message || error) }, "*");
    }
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.type !== "CRACK_TXT_DIRECT_BUTTON_CLICK_V30") return;
    const { requestId, token } = event.data;
    const selectorToken = CSS.escape(String(token || ""));
    const button = document.querySelector(`button[data-crack-txt-direct-click-token="${selectorToken}"]`);
    if (!(button instanceof HTMLButtonElement)) {
      window.postMessage({ type: "CRACK_TXT_DIRECT_BUTTON_CLICK_RESULT_V30", requestId, ok: false, reason: "button-not-found" }, "*");
      return;
    }
    try {
      button.focus({ preventScroll: true });
      HTMLButtonElement.prototype.click.call(button);
      window.postMessage({ type: "CRACK_TXT_DIRECT_BUTTON_CLICK_RESULT_V30", requestId, ok: true }, "*");
    } catch (error) {
      window.postMessage({ type: "CRACK_TXT_DIRECT_BUTTON_CLICK_RESULT_V30", requestId, ok: false, reason: String(error?.message || error) }, "*");
    }
  });


})();
