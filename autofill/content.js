(() => {
  if (window.__CRACK_TXT_AUTOFILL_V47__) return;
  window.__CRACK_TXT_AUTOFILL_V47__ = true;

  const P = globalThis.CrackTxtParser;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  let abortRequested = false;
  let currentStage = "대기";
  let debuggerAttached = false;

  async function debuggerCommand(type, payload = {}) {
    if (!globalThis.chrome?.runtime?.sendMessage) return { ok: false, reason: "runtime-unavailable" };
    try {
      return await chrome.runtime.sendMessage({ type, ...payload });
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }
  }

  async function startTrustedInput() {
    const result = await debuggerCommand("CRACK_TXT_DEBUGGER_START_V26");
    if (!result?.ok) {
      throw new Error(`브라우저 신뢰 클릭 연결 실패: ${result?.reason || "알 수 없는 오류"}. Chrome 개발자도구가 열려 있다면 닫고 다시 실행하세요.`);
    }
    debuggerAttached = true;
  }

  async function stopTrustedInput() {
    if (!debuggerAttached) return;
    debuggerAttached = false;
    await debuggerCommand("CRACK_TXT_DEBUGGER_STOP_V26");
  }

  async function trustedPointClick(x, y) {
    const result = await debuggerCommand("CRACK_TXT_DEBUGGER_CLICK_V26", { x, y });
    if (!result?.ok) throw new Error(`브라우저 신뢰 클릭 실패: ${result?.reason || "알 수 없는 오류"}`);
    return true;
  }

  async function trustedEnter() {
    const result = await debuggerCommand("CRACK_TXT_DEBUGGER_KEY_V30", { key: "Enter" });
    if (!result?.ok) throw new Error(`브라우저 Enter 입력 실패: ${result?.reason || "알 수 없는 오류"}`);
    return true;
  }

  function directMainButtonClick(button) {
    return new Promise((resolve) => {
      if (!(button instanceof HTMLButtonElement)) return resolve(false);
      const requestId = `direct-click-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const token = `crack-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      button.dataset.crackTxtDirectClickToken = token;
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        delete button.dataset.crackTxtDirectClickToken;
        resolve(false);
      }, 1800);
      function onMessage(event) {
        if (event.source !== window || event.data?.type !== "CRACK_TXT_DIRECT_BUTTON_CLICK_RESULT_V30" || event.data?.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        delete button.dataset.crackTxtDirectClickToken;
        resolve(Boolean(event.data.ok));
      }
      window.addEventListener("message", onMessage);
      window.postMessage({ type: "CRACK_TXT_DIRECT_BUTTON_CLICK_V30", requestId, token }, "*");
    });
  }

  function assertRunning() {
    if (abortRequested) throw new Error("사용자가 작업을 중단했습니다.");
  }

  function visible(el) {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  }

  function clickable(el) {
    return el?.closest?.("button,[role='button'],[role='tab'],[role='option'],[role='menuitem'],a,label,[data-radix-collection-item]") || el;
  }

  function leafTexts(root = document) {
    return all("button,label,p,span,div,h1,h2,h3,h4,h5,input,textarea", root).filter((el) => {
      if (!visible(el)) return false;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return false;
      const text = norm(el.textContent).replace(/\s*\*$/, "");
      if (!text) return false;
      return ![...el.children].some((child) => {
        const childText = norm(child.textContent).replace(/\s*\*$/, "");
        return childText === text;
      });
    });
  }

  function exactText(text, root = document) {
    const wanted = norm(text);
    return leafTexts(root).filter((el) => norm(el.textContent).replace(/\s*\*$/, "") === wanted);
  }

  function textContaining(text, root = document) {
    const wanted = norm(text);
    return leafTexts(root).filter((el) => norm(el.textContent).includes(wanted));
  }

  function findButtonText(text, root = document) {
    const wanted = norm(text);
    const buttons = all("button,[role='button'],[role='tab'],[role='option'],[role='menuitem'],a,label", root).filter(visible);
    const exactButton = buttons.find((el) => norm(el.textContent).replace(/^\+\s*/, "") === wanted);
    if (exactButton) return exactButton;
    const containsButton = buttons.find((el) => norm(el.textContent).includes(wanted));
    if (containsButton) return containsButton;
    const exact = exactText(text, root).map(clickable).find((el) => visible(el));
    if (exact) return exact;
    return textContaining(text, root).map(clickable).find((el) => visible(el)) || null;
  }

  async function waitFor(test, timeout = 5000, interval = 100) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      assertRunning();
      try {
        const result = test();
        if (result) return result;
      } catch (_) {}
      await sleep(interval);
    }
    return null;
  }

  async function click(el, delay = 180) {
    assertRunning();
    if (!el) return false;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await sleep(60);
    const box = document.getElementById("crack-txt-autofill-overlay-v20");
    const previousVisibility = box?.style.visibility || "";
    if (box) box.style.visibility = "hidden";
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const x = Math.max(1, Math.min(innerWidth - 2, r.left + r.width / 2));
      const y = Math.max(1, Math.min(innerHeight - 2, r.top + r.height / 2));
      await trustedPointClick(x, y);
    } finally {
      if (box) box.style.visibility = previousVisibility;
    }
    await sleep(delay);
    return true;
  }

  function readValue(el) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
    if (el?.isContentEditable) return el.innerText;
    return "";
  }

  function nativeSetValue(el, value) {
    const next = String(value ?? "");
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const old = el.value;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, next);
      else el.value = next;
      if (el._valueTracker) el._valueTracker.setValue(old);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: next }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    if (el?.isContentEditable) {
      el.focus();
      el.textContent = next;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: next }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }

  async function setExact(el, value, label) {
    if (!el) throw new Error(`${label}: 입력칸을 찾지 못했습니다.`);
    el.scrollIntoView({ block: "center", inline: "nearest" });
    el.focus();
    nativeSetValue(el, value);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", keyCode: 9, which: 9, bubbles: true }));
    el.blur();
    const ok = await waitFor(() => readValue(el) === String(value) ? true : null, 1800, 80);
    if (!ok) {
      el.focus();
      nativeSetValue(el, value);
      el.blur();
      await sleep(180);
    }
    if (readValue(el) !== String(value)) {
      throw new Error(`${label}: 화면 값이 TXT와 다릅니다. 현재 ${readValue(el).length}자, TXT ${String(value).length}자.`);
    }
  }

  function nearestFieldForLabel(labelText, selector, root = document, maxGap = 560) {
    const labels = exactText(labelText, root);
    for (const label of labels) {
      const lr = label.getBoundingClientRect();
      let node = label.parentElement;
      for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
        const candidates = all(selector, node)
          .filter(visible)
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.top >= lr.bottom - 8 && r.top <= lr.bottom + maxGap;
          })
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        if (candidates[0]) return candidates[0];
      }
    }
    return null;
  }

  function controlAfterLabel(labelText, root = document, nextLabelText = null) {
    const label = exactText(labelText, root)[0];
    if (!label) return null;
    const lr = label.getBoundingClientRect();
    let lowerLimit = lr.bottom + 230;
    if (nextLabelText) {
      const next = exactText(nextLabelText, root).find((el) => el.getBoundingClientRect().top > lr.bottom);
      if (next) lowerLimit = Math.min(lowerLimit, next.getBoundingClientRect().top);
    }
    const candidates = all("[role='combobox'],[aria-haspopup='listbox'],button,div", root)
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect(), s: getComputedStyle(el) }))
      .filter(({ r }) => r.top > lr.bottom - 2 && r.top < lowerLimit && r.width > 360 && r.height >= 34 && r.height <= 140)
      .map((entry) => {
        let score = 0;
        if (entry.el.matches("[role='combobox'],[aria-haspopup='listbox'],button")) score += 12;
        if (entry.el.querySelector("input")) score += 8;
        if (entry.el.querySelector("svg")) score += 4;
        if (parseFloat(entry.s.borderTopWidth) > 0) score += 3;
        score -= Math.abs(entry.r.top - lr.bottom) / 80;
        return { ...entry, score };
      })
      .sort((a, b) => b.score - a.score || a.r.top - b.r.top || a.r.height - b.r.height);
    return candidates[0]?.el || null;
  }

  // 상단 스텝 메뉴는 2026-09 개편에서 <button>이 아니라
  // Next.js <Link>가 만든 a[href*="step="]로 바뀌었습니다.
  // 텍스트/마크업이 또 바뀌어도 버티도록 href의 step 값을 1순위 기준으로 씁니다.
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

  function stripTabText(value) {
    return norm(value).replace(/\*+$/, "").trim();
  }

  function currentBuilderStep() {
    try { return new URL(location.href).searchParams.get("step") || ""; } catch (_) { return ""; }
  }

  function hrefStep(el) {
    const href = el?.getAttribute?.("href");
    if (!href) return "";
    try { return new URL(href, location.origin).searchParams.get("step") || ""; } catch (_) { return ""; }
  }

  function topTabButton(name) {
    const wanted = stripTabText(name);
    const step = TOP_TAB_STEPS[wanted] || "";
    const nodes = all(TOP_TAB_SELECTOR);

    if (step) {
      const byStep = nodes
        .filter((el) => hrefStep(el) === step)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      if (byStep.length) return byStep[0];
    }

    const byText = nodes.filter((el) => stripTabText(el.textContent) === wanted);
    const nearTop = byText.filter((el) => el.getBoundingClientRect().top < 220);
    return nearTop[0] || byText[0] || null;
  }

  function topTabSnapshot() {
    const seen = new Set();
    for (const el of all(TOP_TAB_SELECTOR)) {
      if (el.getBoundingClientRect().top >= 220) continue;
      const text = stripTabText(el.textContent);
      if (text && text.length <= 12) seen.add(text);
    }
    return [...seen].slice(0, 20).join(" / ");
  }

  // 앵커/버튼/커스텀 탭을 가리지 않고 "사람이 누른 것과 같은" 순서로 이벤트를 보냅니다.
  // 앵커의 기본 이동은 Next.js Link 핸들러가 막아 주므로 페이지가 새로고침되지 않고,
  // 지금까지 입력한 내용도 유지됩니다.
  function nativeTabClick(el) {
    if (!el) return false;
    try {
      el.focus?.({ preventScroll: true });
      const r = el.getBoundingClientRect();
      const opts = {
        bubbles: true, cancelable: true, composed: true, button: 0,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      };
      el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerType: "mouse", isPrimary: true, buttons: 1 }));
      el.dispatchEvent(new MouseEvent("mousedown", { ...opts, buttons: 1 }));
      el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerType: "mouse", isPrimary: true, buttons: 0 }));
      el.dispatchEvent(new MouseEvent("mouseup", { ...opts, buttons: 0 }));
      HTMLElement.prototype.click.call(el);
      return true;
    } catch (_) {
      try { el.click(); return true; } catch (_) { return false; }
    }
  }

  function bridgeClickTopTab(name) {
    return new Promise((resolve) => {
      const requestId = `top-tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve({ ok: false, reason: "bridge-timeout" });
      }, 2500);
      function onMessage(event) {
        if (event.source !== window || event.data?.type !== "CRACK_TXT_TOP_TAB_CLICK_RESULT_V1" || event.data?.requestId !== requestId) return;
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(event.data);
      }
      window.addEventListener("message", onMessage);
      window.postMessage({ type: "CRACK_TXT_TOP_TAB_CLICK_V1", requestId, name }, "*");
    });
  }

  function markerVisible(markerText) {
    if (!markerText) return true;
    return textContaining(markerText).some((el) => {
      const r = el.getBoundingClientRect();
      return visible(el) && r.bottom > 70 && r.top < innerHeight;
    });
  }

  async function openTopTab(name, markerText) {
    currentStage = `${name} 탭 열기`;
    const wanted = stripTabText(name);
    const step = TOP_TAB_STEPS[wanted] || "";
    const stepOk = () => Boolean(step) && currentBuilderStep() === step;
    const opened = () => (markerText ? markerVisible(markerText) : stepOk() || !step);

    if (opened()) return;

    let target = topTabButton(name);
    if (!target) {
      const snapshot = topTabSnapshot();
      throw new Error(`상단 ‘${name}’ 탭을 찾지 못했습니다. 현재 상단 메뉴: ${snapshot || "감지된 항목 없음"}`);
    }

    // 상단 메뉴는 overflow-hidden 캐러셀입니다. 뒤쪽 탭에서 앞쪽 탭으로 돌아갈 때
    // 버튼 좌표가 화면 밖으로 나가므로 좌표 클릭을 쓰면 화면 가장자리의 엉뚱한 곳을 누르게 됩니다.
    // 실제 노드의 click 핸들러를 MAIN world에서 직접 호출합니다.
    const bridged = await bridgeClickTopTab(name);
    if (!bridged?.ok) nativeTabClick(target);

    let ok = await waitFor(() => (opened() ? true : null), 5000, 100);
    if (!ok) {
      // React가 첫 호출을 놓친 경우 새 DOM에서 한 번 더 직접 호출합니다.
      target = topTabButton(name);
      if (target) nativeTabClick(target);
      ok = await waitFor(() => (opened() ? true : null), 3000, 100);
    }
    // 마커 문구가 사이트 개편으로 바뀌었을 수 있으므로,
    // 주소의 step이 목표 탭으로 넘어갔다면 전환에 성공한 것으로 봅니다.
    if (!ok && stepOk()) ok = true;
    if (!ok) {
      const r = target?.getBoundingClientRect?.();
      const position = r ? `left=${Math.round(r.left)}, top=${Math.round(r.top)}, width=${Math.round(r.width)}` : "좌표 없음";
      throw new Error(`‘${name}’ 탭은 찾았지만 화면 전환이 되지 않았습니다. ${position} · step=${currentBuilderStep() || "없음"}`);
    }
  }

  function overlay() {
    document.getElementById("crack-txt-autofill-overlay-v20")?.remove();
    const box = document.createElement("section");
    box.id = "crack-txt-autofill-overlay-v20";
    box.innerHTML = `
      <style>
        #crack-txt-autofill-overlay-v20{--tb-text:#1d1d1f;--tb-text2:#6e6e73;--tb-glass:rgba(242,242,247,.92);--tb-edge:rgba(255,255,255,.65);--tb-ring:rgba(0,0,0,.1);--tb-fill:rgba(120,120,128,.14);--tb-accent:#007aff;--tb-ok:#1a7f37;--tb-warn:#b25f00;--tb-err:#d70015;--tb-shadow:0 22px 60px rgba(0,0,0,.22);
          position:fixed;right:18px;bottom:18px;z-index:2147483647;width:420px;max-height:72vh;overflow:auto;background:var(--tb-glass);color:var(--tb-text);border:.5px solid var(--tb-edge);border-radius:16px;box-shadow:0 0 0 .5px var(--tb-ring),var(--tb-shadow);-webkit-backdrop-filter:blur(30px) saturate(180%);backdrop-filter:blur(30px) saturate(180%);padding:14px 16px;font:12.5px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Apple SD Gothic Neo","Pretendard","Malgun Gothic",system-ui,sans-serif;letter-spacing:-.01em;word-break:keep-all}
        @media (prefers-color-scheme: dark){#crack-txt-autofill-overlay-v20{--tb-text:#f5f5f7;--tb-text2:#a1a1a6;--tb-glass:rgba(30,30,32,.82);--tb-edge:rgba(255,255,255,.1);--tb-ring:rgba(0,0,0,.5);--tb-fill:rgba(120,120,128,.28);--tb-accent:#0a84ff;--tb-ok:#30d158;--tb-warn:#ff9f0a;--tb-err:#ff453a;--tb-shadow:0 22px 60px rgba(0,0,0,.55)}}
        #crack-txt-autofill-overlay-v20 h3{margin:0 0 8px;font-size:14px;font-weight:700}
        #crack-txt-autofill-overlay-v20 ol{margin:0;padding-left:20px}
        #crack-txt-autofill-overlay-v20 li{margin:4px 0;color:var(--tb-text2);white-space:pre-wrap}
        #crack-txt-autofill-overlay-v20 li.ok{color:var(--tb-ok)} #crack-txt-autofill-overlay-v20 li.warn{color:var(--tb-warn)} #crack-txt-autofill-overlay-v20 li.err{color:var(--tb-err)}
        #crack-txt-autofill-overlay-v20 .actions{display:flex;gap:8px;align-items:center;padding:10px 0 0}
        #crack-txt-autofill-overlay-v20 .actions span{color:var(--tb-warn)!important}
        #crack-txt-autofill-overlay-v20 button{border:0;border-radius:8px;padding:6px 12px;font:inherit;font-weight:600;cursor:pointer;background:var(--tb-fill);color:var(--tb-text)}
        #crack-txt-autofill-overlay-v20 button:hover{filter:brightness(.96)}
      </style>
      <h3>크랙 툴박스 · TXT 자동 입력</h3><ol></ol><div class="actions"><button data-stop>중단</button></div>`;
    document.body.appendChild(box);
    box.querySelector("[data-stop]").onclick = () => { abortRequested = true; };
    return {
      log(text, type = "") {
        const li = document.createElement("li");
        li.className = type;
        li.textContent = text;
        box.querySelector("ol").appendChild(li);
        box.scrollTop = box.scrollHeight;
      },
      waitForManualStart(index, label, verify) {
        return new Promise((resolve) => {
          const actions = box.querySelector(".actions");
          actions.innerHTML = "";
          const info = document.createElement("span");
          info.textContent = `${index + 1}번 ‘${label}’ 칩을 직접 누른 뒤`;
          info.style.alignSelf = "center";
          info.style.color = "#ffd278";
          const check = document.createElement("button");
          check.textContent = "계속 확인";
          const stop = document.createElement("button");
          stop.textContent = "중단";
          check.onclick = () => {
            if (!verify()) {
              check.textContent = "아직 해당 칩이 안 열림";
              setTimeout(() => { check.textContent = "계속 확인"; }, 900);
              return;
            }
            actions.innerHTML = '<button data-stop>중단</button>';
            actions.querySelector("[data-stop]").onclick = () => { abortRequested = true; };
            resolve(true);
          };
          stop.onclick = () => { abortRequested = true; resolve(false); };
          actions.append(info, check, stop);
        });
      },
      done(text, type = "ok", withDiagnostic = false) {
        this.log(text, type);
        const actions = box.querySelector(".actions");
        actions.innerHTML = "";
        if (withDiagnostic) {
          const copy = document.createElement("button");
          copy.textContent = "진단 복사";
          copy.onclick = async () => {
            const buttons = all("button,[role='button'],[role='tab'],[role='link'],a[href]").filter(visible).map((el) => norm(el.textContent)).filter(Boolean).slice(0, 160);
            const topTabs = all(TOP_TAB_SELECTOR).filter((el) => el.getBoundingClientRect().top < 220).map((el) => ({ tag: el.tagName, text: stripTabText(el.textContent), step: hrefStep(el) })).filter((entry) => entry.text).slice(0, 30);
            const labels = leafTexts().map((el) => norm(el.textContent).replace(/\s*\*$/, "")).filter(Boolean).slice(0, 220);
            const fields = all("input,textarea,[contenteditable='true']").filter(visible).map((el) => ({ tag: el.tagName, type: el.getAttribute("type") || "", valueLength: readValue(el).length, placeholder: el.getAttribute("placeholder") || "" }));
            const report = JSON.stringify({ stage: currentStage, url: location.href, step: currentBuilderStep(), topTabs, buttons, labels, fields }, null, 2);
            try { await navigator.clipboard.writeText(report); copy.textContent = "복사 완료"; }
            catch (_) { copy.textContent = "복사 실패"; }
          };
          actions.appendChild(copy);
        }
        const close = document.createElement("button");
        close.textContent = "닫기";
        close.onclick = () => box.remove();
        actions.appendChild(close);
      }
    };
  }

  function readTotalCount() {
    // 활성 탭의 `전체 N` 텍스트 자체를 읽는다. 화면 위에서 몇 px인지로 제한하면
    // 창 높이·배율·모니터가 달라졌을 때 같은 탭도 개수를 못 읽을 수 있다.
    const hits = [...document.querySelectorAll("button,span,div")]
      .filter(visible)
      .map((el) => norm(el.textContent).match(/^전체\s*(\d+)$/))
      .filter(Boolean)
      .map((match) => Number(match[1]));
    return hits.length ? Math.min(...hits) : null;
  }

  function startPageVerticalBounds() {
    const topTab = exactText("시작 설정")
      .map(clickable)
      .filter(visible)
      .filter((el) => el.getBoundingClientRect().top < 140)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    const heading = exactText("스토리의 다양한 시작상황을 설정해 보세요")
      .filter(visible)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] ||
      textContaining("스토리의 다양한 시작상황을 설정해 보세요")
        .filter(visible)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.height <= 80 && norm(el.textContent).length <= 120;
        })
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    const prologue = exactText("프롤로그")
      .filter(visible)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    const lower = topTab ? topTab.getBoundingClientRect().bottom + 8 : 72;
    const upperCandidates = [heading, prologue]
      .filter(Boolean)
      .map((el) => el.getBoundingClientRect().top - 6)
      .filter((value) => value > lower);
    const upper = upperCandidates.length ? Math.min(...upperCandidates) : Math.min(innerHeight * 0.42, lower + 230);
    return { lower, upper };
  }

  function exactNativeStartPillButtons() {
    // 실제 크랙 DOM의 기준점은 첫 칩 안의 <span>기본</span>이다.
    // 좌표/문구 추측 대신 이 버튼의 동일 행 형제 버튼 3개를 그대로 사용한다.
    const basicSpan = all("button > span")
      .filter(visible)
      .find((span) => norm(span.textContent) === "기본");
    const basicButton = basicSpan?.closest("button");
    const basicSlide = basicButton?.closest("[aria-roledescription='slide'][role='group']");
    const row = basicSlide?.parentElement;
    if (row) {
      const direct = all(":scope > [aria-roledescription='slide'][role='group'] > button", row)
        .filter(visible)
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      if (direct.length >= 1 && direct.length <= 3) return direct;
    }

    // 래퍼 속성이 바뀐 경우에도 '추가 설정 1/2'가 함께 들어 있는 가장 가까운 행을 찾는다.
    const add1 = all("button").filter(visible).find((button) => norm(button.textContent) === "추가 설정 1");
    const add2 = all("button").filter(visible).find((button) => norm(button.textContent) === "추가 설정 2");
    if (add1 && add2) {
      let node = add1.parentElement;
      while (node && node !== document.body) {
        if (node.contains(add2)) {
          const buttons = all("button", node)
            .filter(visible)
            .filter((button) => {
              const r = button.getBoundingClientRect();
              const a = add1.getBoundingClientRect();
              return Math.abs((r.top + r.bottom) / 2 - (a.top + a.bottom) / 2) <= 18;
            })
            .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
          if (buttons.length >= 2 && buttons.length <= 3) return buttons;
        }
        node = node.parentElement;
      }
    }
    return [];
  }

  async function nativeStartButtonClick(button) {
    if (!(button instanceof HTMLButtonElement)) throw new Error("시작 설정 칩이 button 요소가 아닙니다.");
    button.scrollIntoView({ block: "nearest", inline: "center" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    button.focus({ preventScroll: true });

    // 이 버튼은 평범한 type=button이다. Chrome Debugger 좌표 클릭을 거치지 않고
    // 브라우저의 native click 메서드를 정확한 버튼 노드에 직접 호출한다.
    HTMLButtonElement.prototype.click.call(button);
    await sleep(80);

    // click 핸들러가 pointerdown을 전제로 한 경우를 위한 보조 경로.
    if (document.activeElement !== button) button.focus({ preventScroll: true });
    const init = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1 };
    try { button.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse", isPrimary: true })); } catch (_) {}
    button.dispatchEvent(new MouseEvent("mousedown", init));
    try { button.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0, pointerType: "mouse", isPrimary: true })); } catch (_) {}
    button.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 }));
    return true;
  }

  function exactStartPillRows() {
    const { lower, upper } = startPageVerticalBounds();
    const buttons = all("[aria-roledescription='slide'][role='group'] > button")
      .filter(visible)
      .filter((button) => {
        const r = button.getBoundingClientRect();
        const cy = (r.top + r.bottom) / 2;
        return cy > lower && cy < upper && r.width >= 36 && r.width <= 340 && r.height >= 26 && r.height <= 68;
      });
    const groups = new Map();
    for (const button of buttons) {
      const row = button.parentElement?.parentElement;
      if (!row) continue;
      if (!groups.has(row)) groups.set(row, []);
      groups.get(row).push(button);
    }
    return [...groups.entries()]
      .map(([row, rowButtons]) => ({
        row,
        buttons: rowButtons.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left),
        top: row.getBoundingClientRect().top,
      }))
      .filter((entry) => entry.buttons.length >= 1 && entry.buttons.length <= 3)
      .sort((a, b) => {
        const aScore = (a.buttons.some((button) => /설정/.test(norm(button.textContent))) ? 10 : 0) + (a.buttons[0]?.querySelector("span") ? 2 : 0);
        const bScore = (b.buttons.some((button) => /설정/.test(norm(button.textContent))) ? 10 : 0) + (b.buttons[0]?.querySelector("span") ? 2 : 0);
        return bScore - aScore || a.top - b.top;
      });
  }

  function startRowButtons() {
    const nativeExact = exactNativeStartPillButtons();
    if (nativeExact.length) return nativeExact;
    const exact = exactStartPillRows()[0]?.buttons;
    if (exact?.length) return exact;

    const { lower, upper } = startPageVerticalBounds();
    const excluded = new Set([
      "자동 생성", "고급 설정", "추천 답변 추가", "설정 삭제", "이전", "다음",
      "프로필", "스토리 설정", "시작 설정", "스탯 설정", "미디어", "키워드북", "단축어", "엔딩 설정", "등록",
    ]);
    const candidates = all("button,[role='tab']")
      .filter(visible)
      .filter((button) => {
        const text = norm(button.textContent).replace(/^\+\s*/, "");
        if (!text || excluded.has(text)) return false;
        const r = button.getBoundingClientRect();
        const cy = (r.top + r.bottom) / 2;
        return cy > lower && cy < upper && r.width >= 38 && r.width <= 310 && r.height >= 26 && r.height <= 64;
      });

    const rows = [];
    for (const button of candidates) {
      const cy = (button.getBoundingClientRect().top + button.getBoundingClientRect().bottom) / 2;
      let row = rows.find((entry) => Math.abs(entry.cy - cy) <= 14);
      if (!row) {
        row = { cy, buttons: [] };
        rows.push(row);
      }
      row.buttons.push(button);
      row.cy = row.buttons.reduce((sum, el) => {
        const r = el.getBoundingClientRect();
        return sum + (r.top + r.bottom) / 2;
      }, 0) / row.buttons.length;
    }

    const selected = rows
      .filter((row) => row.buttons.some((button) => /설정/.test(norm(button.textContent))) || row.buttons.length >= 2)
      .sort((a, b) => b.cy - a.cy || b.buttons.length - a.buttons.length)[0] ||
      rows.sort((a, b) => b.cy - a.cy || b.buttons.length - a.buttons.length)[0];
    return (selected?.buttons || []).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  }

  function startAddButton() {
    return startRowButtons().find((button) => norm(button.textContent).replace(/^\+\s*/, "") === "설정 추가") ||
      findButtonText("설정 추가");
  }

  function startPills() {
    return startRowButtons()
      .filter((button) => norm(button.textContent).replace(/^\+\s*/, "") !== "설정 추가")
      .slice(0, 3);
  }


  function startPillLabel(button) {
    if (!button) return "";
    let text = norm(button.textContent);
    const firstSpan = button.querySelector("span");
    if (firstSpan && norm(firstSpan.textContent) === "기본") {
      text = norm(text.replace(/^기본\s*/, ""));
    }
    return text;
  }

  function startPanelName() {
    return norm(readValue(currentStartFields().name));
  }

  function startPillPanelMatches(index, pills = startPills()) {
    const expected = startPillLabel(pills[index]);
    return !!expected && startPanelName() === expected;
  }

  function colorLuminance(value) {
    const parts = String(value || "").match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (!parts || parts.length < 3) return 255;
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  }

  function activeStartPillIndex(pills = startPills()) {
    const semantic = pills.findIndex((pill) =>
      pill.getAttribute("aria-selected") === "true" ||
      pill.getAttribute("aria-current") === "true" ||
      pill.getAttribute("data-state") === "active" ||
      pill.dataset.active === "true"
    );
    if (semantic >= 0) return semantic;

    // 실제 크랙 시작 설정 칩은 선택된 버튼에 아래 Tailwind 클래스가 붙습니다.
    // bg-primary 하나만 보지 않고 2개 이상 일치할 때만 활성으로 판정해 오탐을 막습니다.
    const classMatched = pills.findIndex((pill) => {
      const tokens = new Set(String(pill.className || "").split(/\s+/).filter(Boolean));
      let score = 0;
      if (tokens.has("bg-primary")) score += 1;
      if (tokens.has("text-primary-foreground")) score += 1;
      if (tokens.has("border-chat-foreground")) score += 1;
      return score >= 2;
    });
    if (classMatched >= 0) return classMatched;

    const ranked = pills.map((pill, index) => ({ index, lum: colorLuminance(getComputedStyle(pill).backgroundColor) }));
    if (ranked.length < 2) return ranked[0]?.index ?? -1;
    ranked.sort((a, b) => a.lum - b.lum);
    return ranked[1].lum - ranked[0].lum >= 45 ? ranked[0].index : -1;
  }

  function startFieldSignature() {
    const fields = currentStartFields();
    return {
      prologue: fields.prologue,
      name: fields.name,
      situation: fields.situation,
      values: [readValue(fields.name), readValue(fields.prologue), readValue(fields.situation)],
    };
  }

  async function openStartPill(index, ui = null, expectedName = "") {
    let pills = startPills();
    if (pills.length < 3) throw new Error(`시작 설정 칩이 ${pills.length}개만 감지됐습니다.`);
    if (activeStartPillIndex(pills) === index) return;

    const beforeName = startPanelName();
    const targetLabel = startPillLabel(pills[index]) || `${index + 1}번`;
    currentStage = `시작 설정 ${index + 1}/3 · ${targetLabel} 버튼 클릭`;

    // React 재렌더링으로 노드가 교체될 수 있으므로 클릭 직전에 다시 찾는다.
    pills = startPills();
    const target = pills[index];
    if (!target) throw new Error(`시작 설정 ${index + 1} 버튼을 찾지 못했습니다.`);
    await nativeStartButtonClick(target);

    const activated = await waitFor(() => {
      const fresh = startPills();
      return activeStartPillIndex(fresh) === index ? true : null;
    }, 3500, 60);
    if (!activated) {
      const fresh = startPills();
      const active = activeStartPillIndex(fresh);
      const labels = fresh.map((button, i) => `${i + 1}:${startPillLabel(button)}${i === active ? "[활성]" : ""}`).join(" | ");
      throw new Error(`‘${targetLabel}’ button.click() 후 활성 칩이 바뀌지 않았습니다. ${labels}`);
    }

    // 활성 클래스가 먼저 바뀌고 입력 패널이 한 프레임 뒤 갱신되는 경우가 있어 안정화 대기.
    await waitFor(() => {
      const name = startPanelName();
      if (expectedName && name === norm(expectedName)) return true;
      if (name !== beforeName) return true;
      return activeStartPillIndex(startPills()) === index ? true : null;
    }, 1200, 50);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await sleep(220);

    if (activeStartPillIndex(startPills()) !== index) {
      throw new Error(`시작 설정 ${index + 1} 활성 상태가 입력 직전에 풀렸습니다.`);
    }
    ui?.log(`시작 설정 ${index + 1}: ‘${targetLabel}’ native button.click() 확인`, "ok");
  }

  async function ensureThreeStartTabs() {
    let pills = startPills();
    if (!pills.length) throw new Error("시작 설정 탭 행을 찾지 못했습니다.");
    if (pills.length > 3) throw new Error(`시작 설정 탭이 ${pills.length}개로 감지됐습니다. 최대 3개만 지원합니다.`);
    while (pills.length < 3) {
      const before = pills.length;
      const add = startAddButton();
      if (!add) throw new Error(`시작 설정이 ${before}개인데 ‘설정 추가’ 버튼을 찾지 못했습니다.`);
      await click(add, 300);
      pills = await waitFor(() => {
        const fresh = startPills();
        return fresh.length === before + 1 ? fresh : null;
      }, 5000, 120);
      if (!pills) throw new Error(`시작 설정 ${before + 1}번째 추가가 화면에 반영되지 않았습니다.`);
    }
    return pills;
  }

  function currentStartFields() {
    // 이름은 단일행 input을 우선합니다. 이름 탐색에 contenteditable을 함께 넣으면
    // 사이트 구조에 따라 바로 아래의 시작 상황 편집기를 이름칸으로 오인할 수 있습니다.
    const nameInput = nearestFieldForLabel("시작설정 이름", "input:not([type='file']):not([type='hidden'])") ||
      nearestFieldForLabel("시작 설정 이름", "input:not([type='file']):not([type='hidden'])");
    const nameFallback = nearestFieldForLabel("시작설정 이름", "[contenteditable='true']:not([aria-multiline='true'])") ||
      nearestFieldForLabel("시작 설정 이름", "[contenteditable='true']:not([aria-multiline='true'])");
    return {
      prologue: nearestFieldForLabel("프롤로그", "textarea") || nearestFieldForLabel("프롤로그", "[contenteditable='true']"),
      name: nameInput || nameFallback,
      situation: nearestFieldForLabel("시작 상황", "textarea") || nearestFieldForLabel("시작 상황", "[contenteditable='true']"),
      playGuide: nearestFieldForLabel("플레이 가이드", "textarea") || nearestFieldForLabel("플레이 가이드", "[contenteditable='true']"),
    };
  }

  const PROMPT_TEMPLATE_NAMES = [
    "기본 프롬프트",
    "1:1 롤플레잉 프롬프트",
    "시뮬레이션 프롬프트",
    "생산성 프롬프트",
    "제작자 커스텀 프롬프트",
    "2차 창작 기반",
  ];

  function promptTemplateControl() {
    const label = exactText("프롬프트 템플릿")[0];
    const lr = label?.getBoundingClientRect() || null;
    // 1순위: Radix Select 트리거(role=combobox) 중 템플릿 값을 표시하는 것.
    const isTemplateTrigger = (el) =>
      PROMPT_TEMPLATE_NAMES.some((name) => norm(el.textContent).includes(name)) ||
      Boolean(el.querySelector("img[src*='prompt-template/']"));
    const combos = all("[role='combobox']").filter(visible).filter(isTemplateTrigger);
    if (combos.length) {
      if (!lr) return combos[0];
      const below = combos
        .map((el) => ({ el, d: el.getBoundingClientRect().top - lr.bottom }))
        .filter(({ d }) => d > -12)
        .sort((a, b) => a.d - b.d);
      return below[0]?.el || combos[0];
    }
    if (!lr) return null;
    // 2순위: 예전 방식(위치 기반). 좁은 화면을 위해 폭 조건을 완화.
    const candidates = all("button,[aria-haspopup='listbox'],[aria-haspopup='menu'],div")
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect(), text: norm(el.textContent) }))
      .filter(({ r, text }) => r.top >= lr.bottom - 12 && r.top <= lr.bottom + 180 && r.width >= 200 && r.height >= 36 && r.height <= 90 && PROMPT_TEMPLATE_NAMES.some((name) => text.includes(name)))
      .sort((a, b) => {
        const aInteractive = a.el.matches("button,[aria-haspopup]") ? 0 : 1;
        const bInteractive = b.el.matches("button,[aria-haspopup]") ? 0 : 1;
        return aInteractive - bInteractive || a.r.top - b.r.top || a.r.height - b.r.height;
      });
    return candidates[0]?.el || controlAfterLabel("프롬프트 템플릿", document, "스토리 설정 및 정보") || null;
  }

  function interactiveOptionForText(text, anchor = null) {
    const wanted = norm(text);
    const anchorRect = anchor?.getBoundingClientRect?.() || null;
    const leaves = all("body *")
      .filter(visible)
      .filter((el) => norm(el.textContent) === wanted);
    const candidates = [];
    for (const leaf of leaves) {
      let node = leaf;
      for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
        if (!visible(node)) continue;
        const r = node.getBoundingClientRect();
        const textValue = norm(node.textContent);
        if (!textValue.includes(wanted) || r.width < 220 || r.height < 26 || r.height > 140) continue;
        const role = node.getAttribute("role") || "";
        const interactive = node.matches("button,li,label,[role='option'],[role='menuitem'],[role='button'],[data-radix-collection-item],[cmdk-item]");
        const pointer = getComputedStyle(node).cursor === "pointer";
        if (!interactive && !pointer && depth < 2) continue;
        let score = depth;
        if (interactive) score -= 20;
        if (role === "option" || role === "menuitem") score -= 10;
        if (node.hasAttribute("data-radix-collection-item")) score -= 8;
        if (anchorRect) {
          if (r.top < anchorRect.bottom - 10) score += 100;
          score += Math.abs(r.top - anchorRect.bottom) / 100;
          score += Math.abs(r.left - anchorRect.left) / 500;
        }
        candidates.push({ node, score, area: r.width * r.height });
      }
    }
    return candidates.sort((a, b) => a.score - b.score || a.area - b.area)[0]?.node || null;
  }

  function bridgeClickStartPill(index) {
    return new Promise((resolve) => {
      const requestId = `start-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve({ ok: false, reason: "bridge-timeout" });
      }, 2500);
      function onMessage(event) {
        if (event.source !== window || event.data?.type !== "CRACK_TXT_START_PILL_CLICK_RESULT_V2" || event.data?.requestId !== requestId) return;
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(event.data);
      }
      window.addEventListener("message", onMessage);
      window.postMessage({ type: "CRACK_TXT_START_PILL_CLICK_V2", requestId, index }, "*");
    });
  }

  async function nativeButtonClick(button, delay = 220) {
    if (!button) return false;
    button.scrollIntoView({ block: "center", inline: "center" });
    await sleep(80);
    try { button.focus({ preventScroll: true }); } catch (_) { button.focus?.(); }
    try { HTMLElement.prototype.click.call(button); }
    catch (_) { try { button.click(); } catch (_) {} }
    await sleep(delay);
    return true;
  }

  async function clickCenter(el, delay = 220) {
    return click(el, delay);
  }

  // ── 프롬프트 템플릿(Radix Select) 선택 ─────────────────────────────
  // 트리거: <button role="combobox" aria-controls="radix-…" aria-expanded>
  // 목록:   #aria-controls  →  [role="listbox"] > [role="option"]
  // 좌표/폭 추측 대신 이 연결 관계를 그대로 사용한다.
  const CUSTOM_TEMPLATE_NAME = "제작자 커스텀 프롬프트";

  function isSelectOpen(trigger) {
    return trigger?.getAttribute("aria-expanded") === "true" || trigger?.getAttribute("data-state") === "open";
  }

  function selectListboxFor(trigger) {
    const id = trigger?.getAttribute("aria-controls");
    const byId = id ? document.getElementById(id) : null;
    if (byId && visible(byId)) return byId;
    const boxes = all("[role='listbox']").filter(visible);
    return boxes[boxes.length - 1] || null;
  }

  function templateOptionIn(listbox, name = CUSTOM_TEMPLATE_NAME) {
    if (!listbox) return null;
    const wanted = norm(name);
    const options = all("[role='option']", listbox);
    return options.find((o) => norm(o.textContent) === wanted) ||
      options.find((o) => norm(o.textContent).includes(wanted)) ||
      options.find((o) => o.querySelector("img[src*='prompt-template/custom']")) ||
      null;
  }

  function customTemplateSelected() {
    const trigger = promptTemplateControl();
    return trigger && norm(trigger.textContent).includes(CUSTOM_TEMPLATE_NAME) ? trigger : null;
  }

  function dispatchKeyDown(el, key, code = key) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, composed: true }));
  }

  // 요소 중심을 실제 마우스로 누르되, 그 좌표에 정말 그 요소가 있는지 먼저 확인한다.
  async function trustedClickIfHittable(el) {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = document.getElementById("crack-txt-autofill-overlay-v20");
    const prev = box?.style.visibility || "";
    if (box) box.style.visibility = "hidden";
    try {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (r.width <= 0 || r.height <= 0 || x < 0 || y < 0 || x > innerWidth || y > innerHeight) return "화면 밖";
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(el === hit || el.contains(hit))) {
        return `다른 요소가 가림(${hit ? hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") : "없음"})`;
      }
      await trustedPointClick(x, y);
      return "";
    } finally {
      if (box) box.style.visibility = prev;
    }
  }

  async function openTemplateSelect(log) {
    const attempts = [
      ["신뢰 클릭", async (t) => trustedClickIfHittable(t)],
      ["키보드 ArrowDown", async (t) => { t.focus({ preventScroll: true }); dispatchKeyDown(t, "ArrowDown"); return ""; }],
      ["pointerdown", async (t) => {
        const r = t.getBoundingClientRect();
        t.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1,
          pointerType: "mouse", pointerId: 1, isPrimary: true,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        }));
        return "";
      }],
    ];
    for (const [name, run] of attempts) {
      const trigger = promptTemplateControl();
      if (!trigger) throw new Error("프롬프트 템플릿 드롭다운을 찾지 못했습니다.");
      if (isSelectOpen(trigger) && selectListboxFor(trigger)) return selectListboxFor(trigger);
      const note = await run(trigger);
      const listbox = await waitFor(() => {
        const t = promptTemplateControl();
        return t && isSelectOpen(t) ? selectListboxFor(t) : null;
      }, 1500, 60);
      log.push(`열기/${name}: ${listbox ? "열림" : "안 열림"}${note ? ` (${note})` : ""}`);
      if (listbox) return listbox;
    }
    return null;
  }

  async function closeTemplateSelect() {
    const trigger = promptTemplateControl();
    if (!trigger || !isSelectOpen(trigger)) return;
    const target = selectListboxFor(trigger) || document.activeElement || document.body;
    dispatchKeyDown(target, "Escape");
    await waitFor(() => !isSelectOpen(promptTemplateControl()) || null, 800, 50);
  }

  function templateDiagnostics(log) {
    const trigger = promptTemplateControl();
    const listbox = trigger ? selectListboxFor(trigger) : null;
    const options = listbox ? all("[role='option']", listbox).map((o) => `「${norm(o.textContent).slice(0, 30)}」${o.hasAttribute("data-disabled") ? "(비활성)" : ""}`) : [];
    const dialog = all("[role='dialog'],[role='alertdialog']").filter(visible).map((d) => norm(d.textContent).slice(0, 40));
    return [
      `트리거: ${trigger ? `현재값「${norm(trigger.textContent)}」 aria-expanded=${trigger.getAttribute("aria-expanded")} aria-controls=${trigger.getAttribute("aria-controls")}` : "없음"}`,
      `목록: ${listbox ? `${listbox.id || "(id 없음)"} · 항목 ${options.length}개 ${options.join(" ")}` : "없음"}`,
      dialog.length ? `열린 대화상자: ${dialog.join(" / ")}` : "",
      ...log,
    ].filter(Boolean).join("\n");
  }

  async function selectCustomPromptTemplate() {
    if (customTemplateSelected()) return customTemplateSelected();
    if (!promptTemplateControl()) throw new Error("프롬프트 템플릿 드롭다운을 찾지 못했습니다.");
    const log = [];

    const selectAttempts = [
      ["신뢰 클릭", async (opt) => trustedClickIfHittable(opt)],
      ["키보드 Enter", async (opt) => { opt.focus({ preventScroll: true }); dispatchKeyDown(opt, "Enter"); return ""; }],
      ["브라우저 Enter", async (opt) => { opt.focus({ preventScroll: true }); await trustedEnter(); return ""; }],
      ["element.click()", async (opt) => { HTMLElement.prototype.click.call(opt); return ""; }],
    ];

    for (const [name, run] of selectAttempts) {
      const listbox = await openTemplateSelect(log);
      if (!listbox) break;
      const option = templateOptionIn(listbox);
      if (!option) { log.push("목록은 열렸지만 ‘제작자 커스텀’ 항목이 없음"); break; }
      if (option.hasAttribute("data-disabled") || option.getAttribute("aria-disabled") === "true") {
        log.push("‘제작자 커스텀’ 항목이 비활성 상태(권한/인증 필요 가능성)");
        break;
      }
      const note = await run(option);
      const selected = await waitFor(customTemplateSelected, 1500, 60);
      log.push(`선택/${name}: ${selected ? "성공" : "반영 안 됨"}${note ? ` (${note})` : ""}`);
      if (selected) return selected;
    }

    // 최후 수단: Radix Select는 닫힌 상태에서도 트리거 타이핑으로 항목을 고른다(typeahead).
    await closeTemplateSelect();
    const trigger = promptTemplateControl();
    if (trigger) {
      trigger.focus({ preventScroll: true });
      for (const ch of "제작자") { dispatchKeyDown(trigger, ch, ""); await sleep(40); }
      const selected = await waitFor(customTemplateSelected, 1500, 60);
      log.push(`선택/타이핑: ${selected ? "성공" : "반영 안 됨"}`);
      if (selected) return selected;
    }

    const diag = templateDiagnostics(log);
    await closeTemplateSelect();
    throw new Error(`‘제작자 커스텀 프롬프트’를 선택하지 못했습니다.\n${diag}`);
  }

  function storyMainField() {
    const fields = all("textarea,[contenteditable='true']").filter(visible);
    const byPlaceholder = fields.find((el) => /자동 생성 기능|프롬프트를 참고|초안을 작성/.test(el.getAttribute("placeholder") || ""));
    if (byPlaceholder) return byPlaceholder;
    const byLabel = nearestFieldForLabel("스토리 설정 및 정보", "textarea,[contenteditable='true']", document, 420);
    if (byLabel) return byLabel;
    const label = exactText("프롬프트 템플릿")[0];
    if (!label) return fields[0] || null;
    const lr = label.getBoundingClientRect();
    return fields
      .filter((el) => el.getBoundingClientRect().top > lr.bottom)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
  }

  async function fillStoryMain(main, ui) {
    await openTopTab("스토리 설정", "프롬프트 템플릿");
    currentStage = "제작자 커스텀 프롬프트 선택";
    if (!exactText("프롬프트 템플릿")[0]) throw new Error("‘프롬프트 템플릿’ 항목을 찾지 못했습니다.");
    await selectCustomPromptTemplate();

    currentStage = "main 입력";
    const field = await waitFor(storyMainField, 5000, 100);
    await setExact(field, main, "스토리 설정 main");
    ui.log("스토리 설정: 제작자 커스텀 프롬프트 선택 · main 검증 완료", "ok");
  }


  // ---------------------------------------- 고급 설정: 플레이 가이드 · 추천 답변
  // 추천 답변 칸: textarea[maxlength=200][placeholder="추천 답변 N"], 옆에 내용 없는 삭제(−) 버튼, 아래에 ‘추천 답변 추가’.
  function recommendationFields() {
    const byPlaceholder = all("textarea").filter(visible).filter((el) => /^추천 답변/.test(el.getAttribute("placeholder") || ""));
    if (byPlaceholder.length) return byPlaceholder;
    const label = exactText("추천 답변")[0];
    if (!label) return [];
    const top = label.getBoundingClientRect().bottom;
    return all("textarea[maxlength='200']").filter(visible).filter((el) => el.getBoundingClientRect().top > top);
  }

  function recommendationAddButton() {
    return all("button").filter(visible).find((el) => norm(el.textContent) === "추천 답변 추가") || null;
  }

  function recommendationRemoveButton(field) {
    let node = field.parentElement;
    for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
      if (all("textarea", node).length > 1) return null;
      const button = all("button", node).filter(visible).find((el) => !norm(el.textContent));
      if (button) return button;
    }
    return null;
  }

  async function ensureAdvancedOpen(label) {
    const open = () => !!(currentStartFields().playGuide || recommendationAddButton() || recommendationFields().length);
    if (open()) return;
    const advanced = findButtonText("고급 설정");
    if (!advanced) throw new Error(`${label}: ‘고급 설정’을 찾지 못했습니다.`);
    await click(advanced, 220);
    const ok = await waitFor(() => (open() ? true : null), 3000, 100);
    if (!ok) throw new Error(`${label}: ‘고급 설정’을 열었지만 플레이 가이드·추천 답변 칸이 보이지 않습니다.`);
  }

  async function fillRecommendations(list, label) {
    const wanted = (list || []).map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 3);
    if (!wanted.length) return 0;
    await ensureAdvancedOpen(label);
    let fields = recommendationFields();
    while (fields.length > wanted.length) {
      const before = fields.length;
      const remove = recommendationRemoveButton(fields[before - 1]);
      if (!remove) throw new Error(`${label}: 남는 추천 답변 칸의 삭제 버튼을 찾지 못했습니다.`);
      await click(remove, 200);
      fields = await waitFor(() => { const now = recommendationFields(); return now.length === before - 1 ? now : null; }, 3000, 100);
      if (!fields) throw new Error(`${label}: 추천 답변 칸 삭제가 화면에 반영되지 않았습니다.`);
    }
    while (fields.length < wanted.length) {
      const before = fields.length;
      const add = recommendationAddButton();
      if (!add) throw new Error(`${label}: ‘추천 답변 추가’ 버튼을 찾지 못했습니다. (현재 ${before}칸)`);
      await click(add, 220);
      fields = await waitFor(() => { const now = recommendationFields(); return now.length === before + 1 ? now : null; }, 3000, 100);
      if (!fields) throw new Error(`${label}: 추천 답변 ${before + 1}번째 칸 추가가 화면에 반영되지 않았습니다.`);
    }
    for (let k = 0; k < wanted.length; k++) {
      await setExact(recommendationFields()[k], wanted[k], `${label} 추천 답변 ${k + 1}`);
    }
    const final = recommendationFields().map(readValue);
    if (final.length !== wanted.length || final.some((value, k) => value !== wanted[k])) {
      throw new Error(`${label}: 추천 답변 최종 검증 실패`);
    }
    return wanted.length;
  }

  // start 없이 플레이가이드·추천답변 파일만 고른 경우: 이미 있는 시작 설정 탭에 그 두 가지만 넣습니다.
  async function fillStartExtras(guides, recs, ui) {
    await openTopTab("시작 설정", "프롤로그");
    const pills = startPills();
    if (!pills.length) throw new Error("시작 설정 탭 행을 찾지 못했습니다.");
    const names = pills.map((pill) => startPillLabel(pill));
    const guide = P.alignExtras(names, guides || []);
    const rec = P.alignExtras(names, recs || []);
    if (guide.byOrder || rec.byOrder) ui.log("시작 설정 이름과 파일의 제목이 달라, 파일에 적힌 순서대로 탭에 넣습니다.", "warn");
    const lost = [...guide.unmatched, ...rec.unmatched];
    if (lost.length) ui.log(`화면에 없는 시작 설정 이름이라 건너뜁니다: ${[...new Set(lost)].join(", ")}`, "warn");

    for (let i = 0; i < pills.length; i++) {
      const g = guide.aligned[i], r = rec.aligned[i];
      if (!g && !r) continue;
      const label = `시작 설정 ${i + 1}(${names[i]})`;
      currentStage = `${label} 플레이 가이드·추천 답변`;
      if (pills.length > 1 && activeStartPillIndex(startPills()) !== i) await openStartPill(i, ui, names[i]);
      if (pills.length > 1 && activeStartPillIndex(startPills()) !== i) throw new Error(`${label}: 대상 탭 활성 확인 실패`);
      const ready = await waitFor(() => (currentStartFields().prologue ? true : null), 5000, 100);
      if (!ready) throw new Error(`${label}: 입력칸을 찾지 못했습니다.`);
      if (g?.body) {
        await ensureAdvancedOpen(label);
        const field = await waitFor(() => currentStartFields().playGuide, 3000, 100);
        await setExact(field, g.body, `${label} 플레이 가이드`);
        ui.log(`${label}: 플레이 가이드 ${g.body.length}자 반영 확인`, "ok");
      }
      if (r?.items?.length) {
        const count = await fillRecommendations(r.items, label);
        ui.log(`${label}: 추천 답변 ${count}개 반영 확인`, "ok");
      }
    }
    currentStage = "플레이 가이드·추천 답변 입력 완료";
  }

  async function fillStart(items, ui) {
    await openTopTab("시작 설정", "프롤로그");
    await ensureThreeStartTabs();

    for (let i = 0; i < items.length; i++) {
      ui.log(`시작 설정 ${i + 1} TXT 인식: 프롤로그 ${items[i].prologue.length}자 · 시작 상황 ${items[i].situation.length}자`, "ok");
      currentStage = `시작 설정 ${i + 1}/3`;
      await openStartPill(i, ui, items[i].name);
      if (activeStartPillIndex(startPills()) !== i) throw new Error(`시작 설정 ${i + 1}: 대상 탭 활성 확인 실패`);
      const ready = await waitFor(() => {
        const f = currentStartFields();
        return f.prologue && f.name && f.situation ? f : null;
      }, 5000, 100);
      if (!ready) throw new Error(`시작 설정 ${i + 1}의 프롤로그·이름·시작 상황 입력칸을 찾지 못했습니다.`);

      // 사이트가 첫 본문 입력 시 시작 설정 이름을 시작 상황 첫 줄로 자동 생성하는 경우가 있어
      // 프롤로그/상황을 먼저 넣고, TXT 헤더에서 읽은 이름을 마지막에 다시 확정합니다.
      let fields = currentStartFields();
      await setExact(fields.prologue, items[i].prologue, `시작 설정 ${i + 1} 프롤로그`);
      ui.log(`시작 설정 ${i + 1}: 프롤로그 ${items[i].prologue.length}자 반영 확인`, "ok");
      fields = currentStartFields();
      await setExact(fields.situation, items[i].situation, `시작 설정 ${i + 1} 시작 상황`);
      ui.log(`시작 설정 ${i + 1}: 시작 상황 ${items[i].situation.length}자 반영 확인`, "ok");

      if (items[i].playGuide) {
        fields = currentStartFields();
        if (!fields.playGuide) {
          const advanced = findButtonText("고급 설정");
          if (!advanced) throw new Error(`시작 설정 ${i + 1}: 플레이 가이드가 있지만 ‘고급 설정’을 찾지 못했습니다.`);
          await click(advanced, 220);
          fields = await waitFor(() => {
            const f = currentStartFields();
            return f.playGuide ? f : null;
          }, 3000, 100);
        }
        await setExact(fields.playGuide, items[i].playGuide, `시작 설정 ${i + 1} 플레이 가이드`);
        ui.log(`시작 설정 ${i + 1}: 플레이 가이드 ${items[i].playGuide.length}자 반영 확인`, "ok");
      }

      if (items[i].recommendations?.length) {
        const count = await fillRecommendations(items[i].recommendations, `시작 설정 ${i + 1}`);
        ui.log(`시작 설정 ${i + 1}: 추천 답변 ${count}개 반영 확인`, "ok");
      }

      await sleep(420);
      fields = currentStartFields();
      await setExact(fields.name, items[i].name, `시작 설정 ${i + 1} 이름`);
      ui.log(`시작 설정 ${i + 1}: 이름 ‘${items[i].name}’ 최종 확정`, "ok");
      // React의 지연 자동제목 업데이트가 뒤늦게 덮어쓰는지 확인합니다.
      await sleep(650);
      fields = currentStartFields();
      if (readValue(fields.name) !== items[i].name || readValue(fields.prologue) !== items[i].prologue || readValue(fields.situation) !== items[i].situation) {
        throw new Error(`시작 설정 ${i + 1}: 세 필드 최종 검증 실패`);
      }
      if (items[i].playGuide && readValue(fields.playGuide) !== items[i].playGuide) {
        throw new Error(`시작 설정 ${i + 1}: 플레이 가이드 최종 검증 실패`);
      }
      ui.log(`시작 설정 ${i + 1}/3: ${items[i].name} 입력 완료${items[i].playGuide ? " · 플레이 가이드 포함" : ""}`, "ok");
    }

    currentStage = "시작 설정 입력 완료";
    ui.log("시작 설정: 각 탭 입력 직후 TXT 값 검증 완료 (추가 재전환 생략)", "ok");
    return items.map((item) => item.name);
  }

  function cardRootsByLabels(labelNames) {
    const firstLabels = exactText(labelNames[0]);
    const roots = [];
    for (const label of firstLabels) {
      let node = label.parentElement;
      for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
        if (!visible(node)) continue;
        const r = node.getBoundingClientRect();
        if (r.width < 650 || r.height < 220) continue;
        const ok = labelNames.every((name) => exactText(name, node).length === 1);
        if (!ok) continue;
        roots.push(node);
        break;
      }
    }
    return [...new Set(roots)]
      .filter((root) => !roots.some((other) => other !== root && root.contains(other)))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  }

  function bottomExpandedCard(labelNames) {
    const roots = cardRootsByLabels(labelNames);
    return roots.length ? roots[roots.length - 1] : null;
  }

  function svgPathData(button) {
    return all("path", button).map((path) => String(path.getAttribute("d") || "")).join(" ");
  }

  function isPencilButton(button) {
    const label = `${button?.getAttribute?.("aria-label") || ""} ${button?.title || ""}`;
    if (/수정|편집|edit|rename/i.test(label)) return true;
    const data = svgPathData(button);
    return data.includes("M16.05 2.01") && data.includes("3.92 14.14");
  }

  function isTrashButton(button) {
    const label = `${button?.getAttribute?.("aria-label") || ""} ${button?.title || ""}`;
    if (/삭제|휴지통|delete|trash/i.test(label)) return true;
    const data = svgPathData(button);
    return data.includes("15.44 4.34") || data.includes("M2.6 5.43");
  }

  function titleHeaderRow(card, firstLabelName) {
    const label = exactText(firstLabelName, card)[0];
    if (!label) return null;
    const labelTop = label.getBoundingClientRect().top;

    // 실제 카드 DOM: 제목 span + 오른쪽 연필/휴지통/접기 버튼 3개가 같은 flex 행에 있습니다.
    const rows = all("div", card)
      .filter(visible)
      .filter((row) => {
        const r = row.getBoundingClientRect();
        if (r.bottom >= labelTop + 12 || r.height > 90 || r.width < 240) return false;
        const directButtons = [...row.children].filter((child) => child instanceof HTMLButtonElement && visible(child));
        const nestedButtons = all(":scope > div > button, :scope > button", row).filter(visible);
        const buttons = [...new Set([...directButtons, ...nestedButtons])];
        return buttons.some(isPencilButton) && buttons.some(isTrashButton);
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return Math.abs(labelTop - ar.bottom) - Math.abs(labelTop - br.bottom) || ar.height - br.height;
      });
    return rows[0] || null;
  }

  function headerButtons(card, firstLabelName) {
    const row = titleHeaderRow(card, firstLabelName);
    if (row) {
      return all("button", row)
        .filter(visible)
        .filter((button) => button.querySelector("svg"))
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    }

    const label = exactText(firstLabelName, card)[0];
    if (!label) return [];
    const topLimit = label.getBoundingClientRect().top;
    const cr = card.getBoundingClientRect();
    return all("button", card)
      .filter(visible)
      .filter((button) => button.querySelector("svg"))
      .filter((button) => {
        const r = button.getBoundingClientRect();
        return r.bottom < topLimit + 10 && r.right > cr.right - 320 && r.width <= 58 && r.height <= 58;
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  }

  function titleInputForCard(card, firstLabelName) {
    const label = exactText(firstLabelName, card)[0];
    const labelTop = label?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
    return all("input:not([type='file']):not([type='hidden'])", card)
      .filter(visible)
      .filter((input) => {
        const r = input.getBoundingClientRect();
        return r.top < labelTop && r.height >= 28;
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return Math.abs(labelTop - ar.bottom) - Math.abs(labelTop - br.bottom) || br.width - ar.width;
      })[0] || null;
  }

  function titleActionGroup(card, firstLabelName) {
    const label = exactText(firstLabelName, card)[0];
    if (!label) return null;
    const labelTop = label.getBoundingClientRect().top;
    return all("div", card)
      .filter(visible)
      .map((group) => ({
        group,
        buttons: [...group.children].filter((child) => child instanceof HTMLButtonElement && visible(child)),
      }))
      .filter(({ group, buttons }) => {
        if (buttons.length !== 3) return false;
        const r = group.getBoundingClientRect();
        if (r.bottom >= labelTop + 12 || r.height > 72) return false;
        return isPencilButton(buttons[0]) && isTrashButton(buttons[1]) && !isTrashButton(buttons[0]);
      })
      .sort((a, b) => {
        const ar = a.group.getBoundingClientRect();
        const br = b.group.getBoundingClientRect();
        return Math.abs(labelTop - ar.bottom) - Math.abs(labelTop - br.bottom);
      })[0] || null;
  }

  function titleCardLabelNames(firstLabelName) {
    return firstLabelName === "상황"
      ? ["상황", "이미지 적용 대상", "이미지 힌트"]
      : ["정보", "키워드", "키워드북 적용 대상"];
  }

  function expandedCardForTitle(firstLabelName) {
    if (firstLabelName === "상황") {
      // 상황/적용대상 입력칸만 감싸는 내부 폼은 제목 헤더를 포함하지 않습니다.
      // 이미지 변경·코드 복사·제목 아이콘까지 들어 있는 실제 미디어 카드 전체를 사용합니다.
      const cards = mediaCardRootsAny().filter((card) =>
        exactText("상황", card).length && exactText("이미지 적용 대상", card).length
      );
      return cards.length ? cards[cards.length - 1] : null;
    }
    return bottomExpandedCard(titleCardLabelNames(firstLabelName));
  }

  async function waitForStableTitleEditor(firstLabelName, timeout = 30000) {
    let lastEdit = null;
    let stableSince = 0;

    return await waitFor(() => {
      const freshCard = expandedCardForTitle(firstLabelName);
      if (!freshCard || !freshCard.isConnected) {
        lastEdit = null;
        stableSince = 0;
        return null;
      }

      let action;
      let edit;
      if (firstLabelName === "상황") {
        const buttons = mediaHeaderIconButtons(freshCard);
        edit = buttons.find(isPencilButton) || null;
        action = { group: edit?.parentElement || null, buttons };
      } else {
        action = titleActionGroup(freshCard, firstLabelName);
        edit = action?.buttons?.[0] || null;
      }

      if (!(edit instanceof HTMLButtonElement) || !edit.isConnected || edit.disabled || !visible(edit)) {
        lastEdit = null;
        stableSince = 0;
        return null;
      }

      // 같은 실제 버튼이 짧게라도 유지되는지만 확인합니다. 이전 700ms 조건은
      // 카드 헤더가 주기적으로 재렌더링되는 화면에서 영원히 충족되지 않을 수 있었습니다.
      if (edit !== lastEdit) {
        lastEdit = edit;
        stableSince = Date.now();
        return null;
      }
      if (Date.now() - stableSince < 250) return null;

      return { card: freshCard, action, edit };
    }, timeout, 80);
  }

  async function editCardTitle(card, title, firstLabelName) {
    let edit;
    if (firstLabelName === "상황") {
      edit = card?.__crackTxtExactMediaTitleEditButton || null;
      if (!(edit instanceof HTMLButtonElement) || !edit.isConnected) {
        const index = card?.__crackTxtExpectedMediaIndex;
        const header = fixedDelayMediaTitleHeader(index);
        edit = titleEditButtonFromExactHeader(header);
        const freshCard = mediaCardFromTitleHeader(header);
        if (freshCard) card = freshCard;
      }
      if (!(edit instanceof HTMLButtonElement) || !edit.isConnected) {
        throw new Error(`${title}: 4초 대기 후 확정한 제목 연필 버튼이 사라졌습니다.`);
      }
    } else {
      const ready = await waitForStableTitleEditor(firstLabelName, 15000);
      if (!ready) {
        throw new Error(`${title}: 카드 내용은 열렸지만 제목 연필 버튼이 나타나지 않았습니다.`);
      }
      card = ready.card;
      edit = ready.edit;
    }

    // 미디어는 업로드 후 4초 대기 뒤 정확한 제목 행의 첫 번째 버튼만 직접 클릭합니다.
    let clicked = await directMainButtonClick(edit);
    if (!clicked) {
      try {
        edit.focus({ preventScroll: true });
        HTMLButtonElement.prototype.click.call(edit);
        clicked = true;
      } catch (_) {}
    }
    if (!clicked) throw new Error(`${title}: 제목 연필 버튼을 직접 클릭하지 못했습니다.`);

    let titleInput = await waitFor(() => titleInputForCard(card, firstLabelName), 2500, 70);
    if (!titleInput) throw new Error(`${title}: 제목 연필을 눌렀지만 제목 입력칸이 열리지 않았습니다.`);

    await setExact(titleInput, title, `${title} 제목`);
    titleInput.focus({ preventScroll: true });

    // 이 사이트의 제목 편집은 체크 버튼이 아니라 Enter로 확정됩니다.
    try {
      await trustedEnter();
    } catch (_) {
      for (const type of ["keydown", "keypress", "keyup"]) {
        titleInput.dispatchEvent(new KeyboardEvent(type, {
          key: "Enter", code: "Enter", keyCode: 13, which: 13,
          bubbles: true, cancelable: true,
        }));
      }
    }

    const findSavedCard = () => {
      if (firstLabelName === "상황") {
        // 미디어 제목은 내부 입력 폼이 아니라 실제 미디어 카드 헤더에 표시됩니다.
        // 이전 버전은 내부 폼만 검사해서 화면에 제목이 저장됐어도 실패로 판정했습니다.
        const wanted = norm(title);
        const connectedCard = card?.isConnected && norm(card.textContent).includes(wanted) ? card : null;
        if (connectedCard) return connectedCard;
        return mediaCardRootsAny().find((candidate) => norm(candidate.textContent).includes(wanted)) || null;
      }
      const labelNames = titleCardLabelNames(firstLabelName);
      return cardRootsByLabels(labelNames).find((candidate) => norm(candidate.textContent).includes(norm(title))) || null;
    };

    let saved = await waitFor(findSavedCard, 5000, 100);

    // CDP Enter가 페이지 핸들러에 전달되지 않는 경우 MAIN DOM 키 이벤트로 한 번 더 확정합니다.
    if (!saved) {
      titleInput = titleInputForCard(card, firstLabelName) || titleInput;
      try { titleInput.focus({ preventScroll: true }); } catch (_) {}
      for (const type of ["keydown", "keypress", "keyup"]) {
        titleInput.dispatchEvent(new KeyboardEvent(type, {
          key: "Enter", code: "Enter", keyCode: 13, which: 13,
          bubbles: true, cancelable: true,
        }));
      }
      saved = await waitFor(findSavedCard, 3000, 100);
    }

    if (!saved) throw new Error(`${title}: 제목을 입력하고 Enter를 눌렀지만 카드 제목이 저장되지 않았습니다.`);
    return saved;
  }

  function keywordControlAfterLabel(labelName, card, nextLabelName) {
    if (!card) return null;
    const label = exactText(labelName, card)[0];
    if (!label) return null;

    let section = label.parentElement;
    for (let depth = 0; section && section !== card && depth < 8; depth++, section = section.parentElement) {
      if (nextLabelName && exactText(nextLabelName, section).length) continue;
      const controls = all("input:not([type='file']):not([type='hidden']),button,[role='combobox'],[aria-haspopup='listbox'],[aria-haspopup='menu']", section)
        .filter((el) => !el.closest("#crack-txt-autofill-overlay-v20"));
      if (controls.length) return section;
    }

    const nextLabel = nextLabelName ? exactText(nextLabelName, card)[0] : null;
    const following = all("input:not([type='file']):not([type='hidden']),button,[role='combobox'],[aria-haspopup='listbox'],[aria-haspopup='menu']", card)
      .filter((el) => label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      .filter((el) => !nextLabel || (el.compareDocumentPosition(nextLabel) & Node.DOCUMENT_POSITION_FOLLOWING));
    const first = following[0] || null;
    if (!first) return null;
    let wrapper = first.parentElement;
    while (wrapper && wrapper.parentElement !== card && !exactText(labelName, wrapper).length) wrapper = wrapper.parentElement;
    return wrapper || first;
  }

  function smallChipRemoveButtons(control) {
    const buttons = all("button,[role='button']", control)
      .filter((button) => button.isConnected)
      .filter((button) => !button.matches("[role='combobox'],[aria-haspopup='listbox'],[aria-haspopup='menu']"))
      .filter((button) => !button.closest("[role='option'],[role='menuitem']"));
    const named = buttons.filter((button) => /삭제|지우기|제거|remove|clear|close/i.test(`${button.getAttribute("aria-label") || ""} ${button.title || ""}`));
    if (named.length) return named;
    return buttons.filter((button) => {
      if (!button.querySelector("svg")) return false;
      if (norm(button.textContent)) return false;
      if (isPencilButton(button) || isTrashButton(button)) return false;
      if (button.hasAttribute("aria-expanded")) return false;
      // 태그 삭제 X는 보통 자기 칩 텍스트와 같은 부모에 있고, 입력 input과 같은 부모에는 없다.
      return !button.parentElement?.querySelector?.("input");
    });
  }

  async function clearChips(getControl, max = 8) {
    for (let i = 0; i < max; i++) {
      const control = getControl();
      if (!control) throw new Error("선택 상자가 사라졌습니다.");
      const button = smallChipRemoveButtons(control)[0];
      if (!button) break;
      if (button instanceof HTMLButtonElement) await directClickButton(button, "기존 키워드 삭제");
      else {
        try { HTMLElement.prototype.click.call(button); } catch (_) { await click(button, 80); }
      }
      await sleep(100);
    }
  }

  function visibleOptionByText(name, control) {
    const candidates = [...new Set(exactText(name).map(clickable))]
      .filter(visible)
      .filter((el) => !control?.contains?.(el))
      .filter((el) => {
        if (el.matches("[role='option'],[role='menuitem'],[data-radix-collection-item]")) return true;
        return Boolean(el.closest("[role='listbox'],[role='menu'],[data-radix-popper-content-wrapper]"));
      });
    return candidates[0] || null;
  }

  function selectionOpenTarget(control) {
    if (!control) return null;
    if (control instanceof HTMLButtonElement || control.matches?.("[role='combobox'],[aria-haspopup='listbox'],[aria-haspopup='menu']")) {
      return control;
    }
    const semantic = all("[role='combobox'],[aria-haspopup='listbox'],[aria-haspopup='menu']", control)
      .filter((el) => el.isConnected && !el.disabled);
    if (semantic[0]) return semantic[0];

    const removeSet = new Set(smallChipRemoveButtons(control));
    const buttons = all("button", control)
      .filter((el) => el.isConnected && !el.disabled && !removeSet.has(el));
    if (buttons.length) return buttons[buttons.length - 1];
    return control.closest?.("button,[role='combobox'],[aria-haspopup='listbox'],[aria-haspopup='menu']") || control;
  }

  async function openSelectionDropdown(control, itemLabel) {
    const target = selectionOpenTarget(control);
    if (!target) throw new Error(`${itemLabel}: 적용 대상 드롭다운 버튼을 찾지 못했습니다.`);
    let opened = false;
    if (target instanceof HTMLButtonElement) opened = await directMainButtonClick(target);
    if (!opened && target instanceof HTMLElement) {
      try {
        target.focus?.({ preventScroll: true });
        HTMLElement.prototype.click.call(target);
        opened = true;
      } catch (_) {}
    }
    if (!opened) await click(target, 120);
  }

  async function selectAllTargets(cardGetter, labelName, nextLabelName, names, itemLabel, controlResolver = controlAfterLabel) {
    const getControl = () => {
      const card = cardGetter();
      return card ? controlResolver(labelName, card, nextLabelName) : null;
    };
    let control = getControl();
    if (!control) throw new Error(`${itemLabel}: ${labelName} 선택 상자를 찾지 못했습니다.`);

    let missing = names.filter((name) => !norm(control.textContent).includes(name));
    if (!missing.length) return;

    for (const name of missing) {
      control = getControl();
      if (!control) throw new Error(`${itemLabel}: ${labelName} 선택 상자가 사라졌습니다.`);
      if (norm(control.textContent).includes(name)) continue;

      await openSelectionDropdown(control, itemLabel);
      const option = await waitFor(() => visibleOptionByText(name, getControl()), 2500, 80);
      if (!option) throw new Error(`${itemLabel}: 적용 대상 ‘${name}’ 옵션을 찾지 못했습니다.`);

      let selected = false;
      if (option instanceof HTMLButtonElement) selected = await directMainButtonClick(option);
      if (!selected && option instanceof HTMLElement) {
        try { HTMLElement.prototype.click.call(option); selected = true; } catch (_) {}
      }
      if (!selected) await click(option, 130);

      const added = await waitFor(() => {
        const c = getControl();
        return c && norm(c.textContent).includes(name) ? true : null;
      }, 2500, 80);
      if (!added) throw new Error(`${itemLabel}: 적용 대상 ‘${name}’ 선택이 반영되지 않았습니다.`);
    }

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    control = getControl();
    if (!control || !names.every((name) => norm(control.textContent).includes(name))) {
      throw new Error(`${itemLabel}: 적용 대상 3개 최종 검증 실패`);
    }
  }

  async function replaceKeywordChips(cardGetter, tags, itemLabel) {
    const getControl = () => {
      const card = cardGetter();
      return card ? keywordControlAfterLabel("키워드", card, "키워드북 적용 대상") : null;
    };
    await clearChips(getControl, 10);
    for (const tag of tags) {
      let control = getControl();
      if (!control) throw new Error(`${itemLabel}: 키워드 입력 상자를 찾지 못했습니다.`);
      let input = all("input:not([type='file']):not([type='hidden'])", control).find((field) => field.isConnected && !field.disabled);
      if (!input) {
        try {
          control.focus?.({ preventScroll: true });
          HTMLElement.prototype.click.call(control);
        } catch (_) {}
        input = all("input:not([type='file']):not([type='hidden'])", getControl()).find((field) => field.isConnected && !field.disabled) ||
          (document.activeElement instanceof HTMLInputElement ? document.activeElement : null);
      }
      if (!input) throw new Error(`${itemLabel}: 키워드 입력용 input을 찾지 못했습니다.`);
      input.focus({ preventScroll: true });
      nativeSetValue(input, tag);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      await sleep(140);
      const added = await waitFor(() => {
        const c = getControl();
        return c && norm(c.textContent).includes(tag) ? true : null;
      }, 2000, 80);
      if (!added) throw new Error(`${itemLabel}: 키워드 ‘${tag}’ 입력이 반영되지 않았습니다.`);
    }
    const control = getControl();
    if (!control || !tags.every((tag) => norm(control.textContent).includes(tag))) {
      throw new Error(`${itemLabel}: 키워드 최종 검증 실패`);
    }
  }

  function injectBridge() {
    if (document.documentElement.dataset.crackTxtBridgeReady === "1" || document.documentElement.dataset.crackTxtBridgeInjected === "1") return;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("autofill/page-bridge.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
    document.documentElement.dataset.crackTxtBridgeInjected = "1";
  }

  function dataUrlToFile(spec) {
    const [meta, data] = spec.dataUrl.split(",");
    const mime = spec.type || meta.match(/data:([^;]+)/)?.[1] || "image/png";
    const bytes = atob(data);
    const array = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
    return new File([array], spec.name, { type: mime, lastModified: Date.now() });
  }

  function assignFile(input, imageSpec) {
    const file = dataUrlToFile(imageSpec);
    const transfer = new DataTransfer();
    transfer.items.add(file);
    try {
      input.files = transfer.files;
    } catch (_) {
      Object.defineProperty(input, "files", { value: transfer.files, configurable: true });
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }


  function armFileCapture() {
    return new Promise((resolve) => {
      const requestId = `file-arm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(false);
      }, 1800);
      function onMessage(event) {
        if (event.source !== window || event.data?.type !== "CRACK_TXT_FILE_CAPTURE_ARMED_V2" || event.data?.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(true);
      }
      window.addEventListener("message", onMessage);
      window.postMessage({ type: "CRACK_TXT_ARM_FILE_CAPTURE_V2", requestId }, "*");
    });
  }

  function modalRoot() {
    const title = exactText("이미지 업로드")[0];
    if (!title) return null;
    return title.closest("[role='dialog']") || (() => {
      let node = title.parentElement;
      for (let i = 0; node && i < 8; i++, node = node.parentElement) {
        const style = getComputedStyle(node);
        const r = node.getBoundingClientRect();
        if ((style.position === "fixed" || style.position === "absolute") && r.width > 400 && r.height > 220) return node;
      }
      return title.parentElement;
    })();
  }

  function dialogButtonByText(dialog, label) {
    if (!dialog) return null;
    const wanted = norm(label);
    const buttons = all("button[type='button'],button", dialog).filter(visible);
    return buttons.find((button) => norm(button.innerText || button.textContent).includes(wanted)) || null;
  }

  async function pickDeviceFileInput(modal) {
    const before = new Set(all("input[type='file']").map((el) => el));
    for (const stale of before) delete stale.dataset.crackTxtCapturedFileInput;

    const armed = await armFileCapture();
    if (!armed) throw new Error("이미지 파일 입력 포착 준비에 실패했습니다.");

    const device = dialogButtonByText(modal, "기기에서 가져오기") || findButtonText("기기에서 가져오기", modal) || findButtonText("기기에서 가져오기");
    if (!device) throw new Error("이미지 업로드 창에서 ‘기기에서 가져오기’를 찾지 못했습니다.");

    device.scrollIntoView({ block: "center", inline: "center" });
    await sleep(40);
    try { device.focus({ preventScroll: true }); } catch (_) {}
    try { HTMLButtonElement.prototype.click.call(device); } catch (_) {}
    await sleep(120);

    let input = await waitFor(() => all("input[type='file']").find((el) => el.dataset.crackTxtCapturedFileInput === "1") || null, 1200, 60);
    if (input) return input;

    await click(device, 120);
    input = await waitFor(() => all("input[type='file']").find((el) => el.dataset.crackTxtCapturedFileInput === "1") || null, 1600, 60);
    if (input) return input;

    return await waitFor(() => {
      const captured = all("input[type='file']").find((el) => el.dataset.crackTxtCapturedFileInput === "1");
      if (captured) return captured;
      const fresh = all("input[type='file']").find((el) => !before.has(el));
      if (fresh) return fresh;
      const any = all("input[type='file']").find((el) => {
        const accept = String(el.getAttribute("accept") || "").toLowerCase();
        return !el.disabled && (accept.includes("image") || !accept);
      });
      return any || null;
    }, 2000, 60);
  }

  function fixedDelayMediaTitleHeader(expectedCount) {
    const wanted = String(expectedCount);
    const rows = all("div.flex.flex-row.items-center.w-full").filter(visible);
    return rows.find((row) => {
      const directTitle = [...row.children].find((child) =>
        child instanceof HTMLSpanElement && norm(child.textContent) === wanted
      );
      if (!directTitle) return false;
      const actionGroup = [...row.children].find((child) => {
        if (!(child instanceof HTMLDivElement)) return false;
        const buttons = [...child.children].filter((item) => item instanceof HTMLButtonElement && visible(item));
        return buttons.length === 3 && isPencilButton(buttons[0]) && isTrashButton(buttons[1]);
      });
      return Boolean(actionGroup);
    }) || null;
  }

  function mediaCardFromTitleHeader(row) {
    let node = row;
    for (let depth = 0; node && depth < 14; depth++, node = node.parentElement) {
      if (!(node instanceof HTMLElement) || !visible(node)) continue;
      if (!exactText("이미지 변경", node).length) continue;
      if (!exactText("코드 복사", node).length) continue;
      if (!exactText("상황", node).length) continue;
      return node;
    }
    return null;
  }

  function titleEditButtonFromExactHeader(row) {
    if (!row) return null;
    for (const child of [...row.children]) {
      if (!(child instanceof HTMLDivElement)) continue;
      const buttons = [...child.children].filter((item) => item instanceof HTMLButtonElement && visible(item));
      if (buttons.length === 3 && isPencilButton(buttons[0]) && isTrashButton(buttons[1])) return buttons[0];
    }
    return null;
  }

  async function uploadOneImage(imageSpec, expectedCount) {
    const add = findButtonText("상황 이미지 추가");
    if (!add) throw new Error("‘상황 이미지 추가’ 버튼을 찾지 못했습니다.");
    await click(add, 180);
    let modal = await waitFor(modalRoot, 3500, 80);
    if (!modal) throw new Error("‘이미지 업로드’ 창이 열리지 않았습니다.");

    const input = await pickDeviceFileInput(modal);
    if (!input) throw new Error("‘기기에서 가져오기’를 눌렀지만 실제 이미지 파일 입력칸을 포착하지 못했습니다.");

    assignFile(input, imageSpec);

    const countUpdated = await waitFor(() => readTotalCount() === expectedCount ? true : null, 20000, 150);
    if (!countUpdated) throw new Error(`이미지를 넣었지만 미디어 전체 개수가 ${expectedCount}으로 바뀌지 않았습니다.`);

    let closed = await waitFor(() => !modalRoot() ? true : null, 4500, 100);
    if (!closed) {
      modal = modalRoot();
      const cancel = modal && findButtonText("취소", modal);
      if (!cancel) throw new Error("이미지는 추가됐지만 업로드 창이 닫히지 않았고 ‘취소’ 버튼도 찾지 못했습니다.");
      await click(cancel, 180);
      closed = await waitFor(() => !modalRoot() ? true : null, 3000, 100);
      if (!closed) throw new Error("이미지 업로드 창을 닫지 못했습니다.");
      if (readTotalCount() !== expectedCount) throw new Error("업로드 창을 닫는 과정에서 방금 추가한 미디어가 사라졌습니다.");
    }

    // 사이트가 업로드 개수와 입력칸을 먼저 표시한 뒤 카드 헤더를 완성합니다.
    // 사용자 환경에서 확인된 시간에 맞춰 각 이미지마다 4초만 기다린 뒤 정확한 제목 행을 찾습니다.
    currentStage = `미디어 ${expectedCount} 업로드 완료 · 4초 고정 대기`;
    await sleep(4000);
    assertRunning();

    const header = fixedDelayMediaTitleHeader(expectedCount);
    if (!header) {
      throw new Error(`미디어 ${expectedCount}: 업로드 후 4초를 기다렸지만 제목 ${expectedCount} 행을 찾지 못했습니다.`);
    }
    const edit = titleEditButtonFromExactHeader(header);
    if (!edit) {
      throw new Error(`미디어 ${expectedCount}: 제목 행은 찾았지만 첫 번째 연필 버튼을 찾지 못했습니다.`);
    }
    const card = mediaCardFromTitleHeader(header);
    if (!card) {
      throw new Error(`미디어 ${expectedCount}: 제목 행이 들어 있는 실제 미디어 카드 전체를 찾지 못했습니다.`);
    }
    card.__crackTxtExactMediaTitleEditButton = edit;
    card.__crackTxtExpectedMediaIndex = expectedCount;
    return card;
  }

  async function collapseCurrentCard(card, firstLabelName) {
    const buttons = headerButtons(card, firstLabelName);
    const toggle = buttons[buttons.length - 1];
    if (!toggle) return;
    await click(toggle, 130);
  }

  function mediaCardRootsAny() {
    const roots = [];
    const imageButtons = exactText("이미지 변경").map(clickable).filter(visible);
    for (const imageButton of imageButtons) {
      let node = imageButton.parentElement;
      for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
        if (!visible(node)) continue;
        const r = node.getBoundingClientRect();
        if (r.width < 650 || r.height < 80) continue;
        if (!exactText("코드 복사", node).length) continue;
        const icons = all("button", node).filter(visible).filter((button) => button.querySelector("svg"));
        if (icons.length < 3) continue;
        roots.push(node);
        break;
      }
    }
    return [...new Set(roots)]
      .filter((root) => !roots.some((other) => other !== root && root.contains(other)))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  }

  function mediaHeaderIconButtons(card) {
    const cr = card.getBoundingClientRect();
    return all("button", card)
      .filter(visible)
      .filter((button) => button.querySelector("svg"))
      .filter((button) => {
        const r = button.getBoundingClientRect();
        return r.top < cr.top + 105 && r.right > cr.right - 280 && r.width <= 62 && r.height <= 62;
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  }

  function mediaDeleteButton(card) {
    const buttons = mediaHeaderIconButtons(card);
    const named = buttons.find((button) => /삭제|delete|trash/i.test(`${button.getAttribute("aria-label") || ""} ${button.title || ""}`));
    if (named) return named;
    const trashPath = buttons.find((button) => {
      const d = all("path", button).map((path) => path.getAttribute("d") || "").join(" ");
      return /15\.44|2\.6 5\.43|20\.93|trash/i.test(d);
    });
    if (trashPath) return trashPath;
    return buttons.length >= 3 ? buttons[buttons.length - 2] : null;
  }

  async function confirmDeleteIfNeeded() {
    const confirm = await waitFor(() => {
      const dialogs = all("[role='dialog'],[role='alertdialog']").filter(visible);
      const scopes = dialogs.length ? dialogs : [document];
      for (const scope of scopes) {
        const candidates = all("button", scope).filter(visible).filter((button) => {
          const text = norm(button.textContent);
          return text === "삭제" || text === "확인" || text === "삭제하기";
        });
        if (candidates.length) return candidates[candidates.length - 1];
      }
      return null;
    }, 1400, 80);
    if (!confirm) return false;
    const direct = await directMainButtonClick(confirm);
    if (!direct) await click(confirm, 180);
    else await sleep(180);
    return true;
  }

  async function deleteButtonDirectly(button, label) {
    if (!(button instanceof HTMLButtonElement)) throw new Error(`${label}: 삭제 버튼 노드가 올바르지 않습니다.`);
    try { button.scrollIntoView({ block: "center", inline: "nearest" }); } catch (_) {}
    await sleep(80);
    const direct = await directMainButtonClick(button);
    if (!direct) {
      // MAIN-world 직접 클릭이 실패할 때만 마지막 수단으로 좌표 클릭을 사용합니다.
      await click(button, 160);
    } else {
      await sleep(160);
    }
  }

  async function clearExistingMedia(ui) {
    let count = readTotalCount();
    if (count == null) throw new Error("미디어 전체 개수를 읽지 못했습니다.");
    if (count === 0) return;
    ui.log(`기존 미디어 ${count}개 발견: 전부 삭제한 뒤 TXT 항목 수만큼 새로 생성합니다.`, "warn");

    while (count > 0) {
      currentStage = `기존 미디어 삭제 · ${count}개 남음`;
      const card = await waitFor(() => {
        const cards = mediaCardRootsAny();
        return cards.length ? cards[cards.length - 1] : null;
      }, 5000, 100);
      if (!card) throw new Error(`기존 미디어가 ${count}개 남았지만 카드 영역을 찾지 못했습니다.`);

      const remove = mediaDeleteButton(card);
      if (!remove) throw new Error(`기존 미디어가 ${count}개 남았지만 휴지통 버튼을 찾지 못했습니다.`);
      await deleteButtonDirectly(remove, `기존 미디어 ${count}`);
      await confirmDeleteIfNeeded();

      const changed = await waitFor(() => {
        const next = readTotalCount();
        return next === count - 1 ? { count: next } : null;
      }, 7000, 120);
      if (!changed) throw new Error(`미디어 삭제를 눌렀지만 전체 개수가 ${count - 1}개로 줄지 않았습니다.`);
      count = changed.count;
      await sleep(280);
      if (count % 5 === 0 || count < 3) ui.log(`기존 미디어 삭제 진행: ${count}개 남음`, "ok");
    }
    ui.log("기존 미디어 삭제 완료 · 새 미디어 생성을 시작합니다.", "ok");
  }

  async function fillMedia(items, startNames, imageSpec, ui) {
    await openTopTab("미디어", "상황 이미지");
    await clearExistingMedia(ui);
    const count = readTotalCount();
    if (count !== 0) throw new Error(`기존 미디어 삭제 후 전체 개수가 0이 아닙니다: ${count}`);

    for (let i = 0; i < items.length; i++) {
      currentStage = `미디어 ${i + 1}/${items.length} 이미지 추가`;
      let card = await uploadOneImage(imageSpec, i + 1);
      currentStage = `미디어 ${i + 1}/${items.length} 내용 입력`;
      card = await editCardTitle(card, items[i].title, "상황");
      let field = nearestFieldForLabel("상황", "textarea,[contenteditable='true']", card, 260);
      if (!field) {
        const formCard = bottomExpandedCard(["상황", "이미지 적용 대상", "이미지 힌트"]);
        field = formCard && nearestFieldForLabel("상황", "textarea,[contenteditable='true']", formCard, 260);
      }
      await setExact(field, items[i].body, `미디어 ${i + 1} 상황`);
      const getCard = () => bottomExpandedCard(["상황", "이미지 적용 대상", "이미지 힌트"]);
      await selectAllTargets(getCard, "이미지 적용 대상", "이미지 힌트", startNames, `미디어 ${i + 1}`);
      const formCard = getCard();
      field = nearestFieldForLabel("상황", "textarea,[contenteditable='true']", formCard || card, 260);
      const titleCard = mediaCardRootsAny().find((candidate) => norm(candidate.textContent).includes(norm(items[i].title))) || (card?.isConnected ? card : null);
      if (!field || readValue(field) !== items[i].body || !titleCard || !norm(titleCard.textContent).includes(norm(items[i].title))) {
        throw new Error(`미디어 ${i + 1}: 제목·상황 최종 검증 실패`);
      }
      await collapseCurrentCard(titleCard, "상황");
      if ((i + 1) % 5 === 0 || i === items.length - 1) ui.log(`미디어 ${i + 1}/${items.length}: 이미지·제목·상황 검증 완료${startNames.length ? " · 적용 대상 검증" : " · 기존 기본 적용 대상 유지"}`, "ok");
    }
  }

  function keywordHandleNodes(root = document) {
    return all([
      ".dnd-item-handle",
      "[aria-roledescription='sortable']",
      "[data-rbd-drag-handle-draggable-id]",
      "[data-rfd-drag-handle-draggable-id]",
    ].join(","), root);
  }

  function renderedWithoutViewport(el) {
    if (!(el instanceof HTMLElement) || !el.isConnected) return false;
    const style = getComputedStyle(el);
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity || 1) > 0;
  }

  function keywordTitleFromRow(row, handle = null) {
    if (!(row instanceof HTMLElement)) return "";

    // 편집 중에는 p가 input/contenteditable로 교체됩니다. 화면 좌표가 아니라
    // 실제 헤더 행 안의 단일행 편집기 값을 먼저 읽습니다.
    const editor = all("input:not([type='file']):not([type='hidden']),[contenteditable='true']", row)
      .find((field) => {
        if (!(field instanceof HTMLElement) || !field.isConnected) return false;
        if (field.closest("button,[role='button']")) return false;
        if (field === handle || field.matches(".dnd-item-handle,[aria-roledescription='sortable'],.tiptap,.ProseMirror")) return false;
        if (field.getAttribute("aria-hidden") === "true") return false;
        return true;
      });
    if (editor) return norm(readValue(editor));

    const titleLeaf = all("p,span", row).find((node) => {
      if (!node.isConnected || node.closest("button,[role='button']")) return false;
      if (handle && (node === handle || handle.contains(node))) return false;
      const text = norm(node.textContent);
      return Boolean(text) && !/^(삭제|수정|편집|접기|펼치기)$/.test(text);
    });
    return norm(titleLeaf?.textContent || row.textContent)
      .replace(/To pick up a draggable item[\s\S]*?cancel\.?/gi, "")
      .trim();
  }

  function keywordRowEntryFromHandle(handle) {
    if (!(handle instanceof Element) || !handle.isConnected) return null;
    let row = handle.parentElement;
    for (let depth = 0; row && depth < 5; depth++, row = row.parentElement) {
      if (!(row instanceof HTMLElement) || row.closest("#crack-txt-autofill-overlay-v20")) continue;
      if (!renderedWithoutViewport(row)) continue;

      const handles = keywordHandleNodes(row).filter((node) => node === handle || row.contains(node));
      if (handles.length !== 1) continue;

      const iconButtons = all("button", row)
        .filter((button) => button.isConnected && button.querySelector("svg"));
      const pencil = iconButtons.find(isPencilButton);
      const trash = iconButtons.find(isTrashButton);
      const toggle = iconButtons.find((button) => button !== pencil && button !== trash);
      if (!pencil || !trash || !toggle) continue;

      return {
        row,
        handle,
        title: keywordTitleFromRow(row, handle),
        iconButtons,
        pencil,
        trash,
        toggle,
      };
    }
    return null;
  }

  function keywordDeleteRowsExact() {
    const seen = new Set();
    const entries = [];

    // 모니터 크기·브라우저 높이·스크롤 위치를 보지 않는다. 크랙의 실제 구조인
    // DnD 손잡이 + 연필 + 휴지통 + 펼침 버튼이 한 헤더 행에 있는지만 확인한다.
    for (const handle of keywordHandleNodes()) {
      const entry = keywordRowEntryFromHandle(handle);
      if (!entry || seen.has(entry.row)) continue;
      seen.add(entry.row);
      entries.push(entry);
    }

    return entries.sort((a, b) => {
      if (a.row === b.row) return 0;
      const relation = a.row.compareDocumentPosition(b.row);
      if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function keywordDeleteButtonExact(entry) {
    if (!entry) return null;
    if (entry.trash?.isConnected) return entry.trash;
    const buttons = entry.iconButtons.filter((button) => button.isConnected);
    const named = buttons.find((button) => {
      const label = `${button.getAttribute("aria-label") || ""} ${button.title || ""}`;
      return /삭제|delete|trash/i.test(label);
    });
    if (named) return named;
    const byTrashSvg = buttons.find(isTrashButton);
    if (byTrashSvg) return byTrashSvg;
    return buttons.length >= 3 ? buttons[buttons.length - 2] : null;
  }

  async function clearExistingKeywords(ui) {
    let count = readTotalCount();
    if (count == null) throw new Error("키워드북 전체 개수를 읽지 못했습니다.");
    if (count === 0) return;
    ui.log(`기존 키워드북 ${count}개 발견: 전부 삭제한 뒤 TXT 20개를 새로 생성합니다.`, "warn");

    while (count > 0) {
      currentStage = `기존 키워드북 삭제 · ${count}개 남음`;
      const entry = await waitFor(() => {
        const rows = keywordDeleteRowsExact();
        return rows.length ? rows[rows.length - 1] : null;
      }, 5000, 100);
      if (!entry) throw new Error(`키워드북이 ${count}개 남았지만 실제 키워드 헤더 DOM을 찾지 못했습니다.`);
      const remove = keywordDeleteButtonExact(entry);
      if (!remove) throw new Error(`기존 키워드북 ${count}개 남음: ‘${entry.title || "마지막 노트"}’ 헤더의 휴지통 버튼을 찾지 못했습니다.`);

      ui.log(`키워드북 삭제 대상: ${entry.title || `마지막 노트 ${count}`}`, "warn");
      await deleteButtonDirectly(remove, `기존 키워드북 ${count}`);
      await confirmDeleteIfNeeded();
      const changed = await waitFor(() => {
        const next = readTotalCount();
        return next === count - 1 ? { count: next } : null;
      }, 7000, 120);
      if (!changed) throw new Error(`키워드북 삭제를 눌렀지만 전체 개수가 ${count - 1}개로 줄지 않았습니다.`);
      count = changed.count;
      await sleep(280);
      if (count % 5 === 0 || count < 3) ui.log(`기존 키워드북 삭제 진행: ${count}개 남음`, "ok");
    }
    ui.log("기존 키워드북 삭제 완료 · 새 키워드 노트 생성을 시작합니다.", "ok");
  }

  function keywordHeaderEntries() {
    return keywordDeleteRowsExact().map((entry, index) => ({
      row: entry.row,
      handle: entry.handle,
      title: keywordTitleFromRow(entry.row, entry.handle),
      buttons: entry.iconButtons.filter((button) => button.isConnected),
      pencil: entry.pencil,
      trash: entry.trash,
      toggle: entry.toggle,
      index,
    })).filter((entry) => entry.row && entry.buttons.length >= 3);
  }

  function keywordHeaderEntryByTitle(title) {
    const wanted = norm(title);
    return keywordHeaderEntries().find((entry) => {
      const rowText = norm(entry.row.textContent);
      return norm(entry.title) === wanted || rowText.includes(wanted);
    }) || null;
  }

  function newestKeywordHeaderEntry() {
    const entries = keywordHeaderEntries();
    return entries.length ? entries[entries.length - 1] : null;
  }

  function keywordHeaderEditButton(entry) {
    if (entry?.pencil?.isConnected) return entry.pencil;
    return entry?.buttons?.find(isPencilButton) || entry?.buttons?.[0] || null;
  }

  function keywordHeaderToggleButton(entry) {
    if (!entry) return null;
    if (entry.toggle?.isConnected) return entry.toggle;
    return entry.buttons.find((button) => !isPencilButton(button) && !isTrashButton(button)) || entry.buttons[entry.buttons.length - 1] || null;
  }

  async function directClickButton(button, errorLabel) {
    if (!(button instanceof HTMLButtonElement)) throw new Error(`${errorLabel}: 버튼을 찾지 못했습니다.`);
    let clicked = await directMainButtonClick(button);
    if (!clicked) {
      try {
        button.focus({ preventScroll: true });
        HTMLButtonElement.prototype.click.call(button);
        clicked = true;
      } catch (_) {}
    }
    if (!clicked) throw new Error(`${errorLabel}: 버튼을 직접 클릭하지 못했습니다.`);
  }

  function isKeywordTitleEditor(field, row = null) {
    if (!(field instanceof HTMLElement) || !field.isConnected) return false;
    if (!field.matches("input:not([type='file']):not([type='hidden']),[contenteditable='true']")) return false;
    if (field.getAttribute("aria-hidden") === "true") return false;
    if (field.closest("#crack-txt-autofill-overlay-v20,button,[role='button']")) return false;
    if (field.matches(".dnd-item-handle,[aria-roledescription='sortable'],[data-rbd-drag-handle-draggable-id],[data-rfd-drag-handle-draggable-id],.tiptap,.ProseMirror")) return false;
    if (field.isContentEditable && (!row || !row.contains(field))) return false;
    return renderedWithoutViewport(field);
  }

  function keywordTitleEditorCandidate(entry, targetIndex, beforeEditors, originalTitle) {
    const entries = keywordHeaderEntries();
    const wanted = norm(originalTitle);
    const currentEntry = entries.find((item) => norm(item.title) === wanted)
      || entries[targetIndex]
      || (entry?.row?.isConnected ? entry : null);
    const row = currentEntry?.row?.isConnected ? currentEntry.row : null;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const pool = new Set();

    if (row) {
      for (const field of all("input:not([type='file']):not([type='hidden']),[contenteditable='true']", row)) pool.add(field);
    }

    // React가 헤더 행을 통째로 다시 마운트하는 경우를 위해 새로 생긴 단일행 input도 본다.
    for (const field of all("input:not([type='file']):not([type='hidden']),[contenteditable='true']")) {
      const label = norm(`${field.getAttribute("aria-label") || ""} ${field.getAttribute("placeholder") || ""} ${field.getAttribute("name") || ""}`);
      const current = norm(readValue(field));
      if (!beforeEditors.has(field) && (field instanceof HTMLInputElement || /제목|title|name/i.test(label) || current === wanted)) {
        pool.add(field);
      }
    }
    if (active && (row?.contains(active) || !beforeEditors.has(active))) pool.add(active);

    return [...pool]
      .filter((field) => isKeywordTitleEditor(field, row))
      .map((field) => {
        const current = norm(readValue(field));
        const label = norm(`${field.getAttribute("aria-label") || ""} ${field.getAttribute("placeholder") || ""} ${field.getAttribute("name") || ""}`);
        const inRow = Boolean(row?.contains(field));
        const newlyAppeared = !beforeEditors.has(field);
        let score = 0;
        if (inRow) score += 220;
        if (field instanceof HTMLInputElement) score += 80;
        if (wanted && current === wanted) score += 130;
        if (/제목|title|name/i.test(label)) score += 90;
        if (newlyAppeared) score += field instanceof HTMLInputElement ? 120 : 70;
        if (field === active) score += 30;
        if (!current) score += 5;
        return { field, score };
      })
      .filter(({ score }) => score >= 200)
      .sort((a, b) => b.score - a.score)[0]?.field || null;
  }

  async function editKeywordTitle(entry, title) {
    if (!entry?.row) throw new Error(`${title}: 제목 행을 찾지 못했습니다.`);

    const originalTitle = norm(entry.title || keywordTitleFromRow(entry.row, entry.handle));
    const beforeEntries = keywordHeaderEntries();
    const targetIndex = Math.max(0, beforeEntries.findIndex((item) => item.row === entry.row || norm(item.title) === originalTitle));
    const selector = "input:not([type='file']):not([type='hidden']),[contenteditable='true']";
    const beforeEditors = new Set(all(selector));

    // 추가 직후 React가 행을 교체할 수 있으므로 연필 클릭 직전에 다시 찾는다.
    entry = keywordHeaderEntryByTitle(originalTitle) || keywordHeaderEntries()[targetIndex] || entry;
    const edit = keywordHeaderEditButton(entry);
    await directClickButton(edit, `${title} 제목 연필`);

    const input = await waitFor(() => keywordTitleEditorCandidate(entry, targetIndex, beforeEditors, originalTitle), 5000, 60);
    if (!input) throw new Error(`${title}: 연필을 눌렀지만 해당 헤더 안의 제목 편집 DOM을 찾지 못했습니다.`);

    await setExact(input, title, `${title} 제목`);
    if (input.isConnected) {
      input.focus({ preventScroll: true });
      try {
        await trustedEnter();
      } catch (_) {
        for (const type of ["keydown", "keypress", "keyup"]) {
          input.dispatchEvent(new KeyboardEvent(type, {
            key: "Enter", code: "Enter", keyCode: 13, which: 13,
            bubbles: true, cancelable: true,
          }));
        }
      }
    }

    let saved = await waitFor(() => keywordHeaderEntryByTitle(title), 3500, 100);
    if (!saved && input.isConnected) {
      input.focus({ preventScroll: true });
      try { await trustedEnter(); } catch (_) {}
      input.blur();
      saved = await waitFor(() => keywordHeaderEntryByTitle(title), 2500, 100);
    }
    if (!saved) throw new Error(`${title}: 제목을 입력했지만 헤더에 저장되지 않았습니다.`);
    return saved;
  }

  function keywordExpandedCards() {
    const labelNames = ["정보", "키워드", "키워드북 적용 대상"];
    const roots = [];
    for (const label of exactText("정보")) {
      let node = label.parentElement;
      for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
        if (!(node instanceof HTMLElement) || node.closest("#crack-txt-autofill-overlay-v20")) continue;
        if (!labelNames.every((name) => exactText(name, node).length >= 1)) continue;
        const hasEditable = all("textarea,input:not([type='file']):not([type='hidden']),[contenteditable='true']", node)
          .some((field) => !field.closest("button,[role='button']"));
        if (!hasEditable) continue;
        roots.push(node);
        break;
      }
    }
    return [...new Set(roots)]
      .filter((root) => !roots.some((other) => other !== root && root.contains(other)))
      .sort((a, b) => {
        if (a === b) return 0;
        const relation = a.compareDocumentPosition(b);
        if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
  }

  function currentKeywordExpandedCard() {
    const cards = keywordExpandedCards();
    return cards.length ? cards[cards.length - 1] : null;
  }

  function keywordFieldForLabel(card, labelName) {
    if (!card) return null;
    const label = exactText(labelName, card)[0];
    if (!label) return null;
    const selector = "textarea,input:not([type='file']):not([type='hidden']),[contenteditable='true']";
    let section = label.parentElement;
    for (let depth = 0; section && section !== card && depth < 7; depth++, section = section.parentElement) {
      const candidates = all(selector, section)
        .filter((field) => !field.closest("button,[role='button']"))
        .filter((field) => field.getClientRects().length > 0);
      const following = candidates.filter((field) => label.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (following.length === 1) return following[0];
      const textarea = following.find((field) => field instanceof HTMLTextAreaElement);
      if (textarea) return textarea;
    }
    const candidates = all(selector, card)
      .filter((field) => !field.closest("button,[role='button']"))
      .filter((field) => label.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING)
      .sort((a, b) => {
        if (a === b) return 0;
        const relation = a.compareDocumentPosition(b);
        return relation & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
    return candidates.find((field) => field instanceof HTMLTextAreaElement) || candidates[0] || null;
  }

  async function ensureKeywordCardExpanded(entry, title) {
    let card = currentKeywordExpandedCard();
    if (card) return card;

    entry = keywordHeaderEntryByTitle(title) || entry || newestKeywordHeaderEntry();
    const toggle = keywordHeaderToggleButton(entry);
    await directClickButton(toggle, `${title} 펼치기`);
    card = await waitFor(currentKeywordExpandedCard, 5000, 100);
    if (!card) throw new Error(`${title}: 펼치기 버튼을 눌렀지만 키워드 입력 DOM이 열리지 않았습니다.`);
    return card;
  }

  async function collapseKeywordCard(title) {
    const card = currentKeywordExpandedCard();
    if (!card) return;
    const entry = keywordHeaderEntryByTitle(title) || newestKeywordHeaderEntry();
    const toggle = keywordHeaderToggleButton(entry);
    if (!toggle) throw new Error(`${title}: 접기 버튼을 찾지 못했습니다.`);
    await directClickButton(toggle, `${title} 접기`);
    const collapsed = await waitFor(() => currentKeywordExpandedCard() ? null : true, 4000, 80);
    if (!collapsed) throw new Error(`${title}: 접기 버튼을 눌렀지만 카드가 계속 펼쳐져 있습니다.`);
    await sleep(160);
  }

  async function addKeywordCard(expectedCount) {
    const add = findButtonText("키워드 노트 추가");
    if (!add) throw new Error("‘키워드 노트 추가’ 버튼을 찾지 못했습니다.");
    const beforeEntries = keywordHeaderEntries();
    const beforeRows = new Set(beforeEntries.map((entry) => entry.row));
    const beforeHandles = new Set(beforeEntries.map((entry) => entry.handle));

    if (add instanceof HTMLButtonElement) await directClickButton(add, "키워드 노트 추가");
    else {
      try { HTMLElement.prototype.click.call(add); } catch (_) { await click(add, 120); }
    }

    const countUpdated = await waitFor(() => readTotalCount() === expectedCount ? true : null, 6000, 100);
    if (!countUpdated) throw new Error(`키워드 노트를 추가했지만 전체 개수가 ${expectedCount}으로 바뀌지 않았습니다.`);

    const defaultTitle = norm(`키워드 노트 ${expectedCount}`);
    const header = await waitFor(() => {
      const entries = keywordHeaderEntries();
      if (!entries.length) return null;

      // 크랙은 추가 직후 행을 여러 번 재마운트할 수 있다. 같은 Element 객체가
      // 일정 시간 유지되는지 기다리지 않고, 고유한 기본 제목을 가장 먼저 사용한다.
      const byDefaultTitle = entries.find((entry) => norm(entry.title) === defaultTitle || norm(entry.row.textContent).includes(defaultTitle));
      if (byDefaultTitle?.row?.isConnected) return byDefaultTitle;

      const newlyAdded = entries.filter((entry) => !beforeRows.has(entry.row) && !beforeHandles.has(entry.handle));
      if (newlyAdded.length === 1 && newlyAdded[0].row.isConnected) return newlyAdded[0];

      // React가 기존 행까지 전부 교체했다면 표시 개수와 DOM 순서로 마지막 행을 고른다.
      if (entries.length === expectedCount) {
        const last = entries[entries.length - 1];
        return last?.row?.isConnected ? last : null;
      }
      return null;
    }, 7000, 80);
    if (!header) {
      const found = keywordHeaderEntries().map((entry) => entry.title || "(편집 중)").join(" | ");
      throw new Error(`추가된 키워드 노트 ${expectedCount}번째 헤더를 찾지 못했습니다. 현재 감지: ${found || "0개"}`);
    }
    return header;
  }

  async function fillKeyword(items, startNames, ui) {
    await openTopTab("키워드북", "키워드 노트 추가");
    await clearExistingKeywords(ui);
    const count = readTotalCount();
    if (count !== 0) throw new Error(`기존 키워드북 삭제 후 전체 개수가 0이 아닙니다: ${count}`);

    for (let i = 0; i < items.length; i++) {
      currentStage = `키워드북 ${i + 1}/${items.length} 추가·제목 입력`;
      let header = await addKeywordCard(i + 1);

      // 키워드북도 미디어와 동일하게 헤더의 첫 번째 연필 버튼을 직접 누르고 Enter로 저장합니다.
      header = await editKeywordTitle(header, items[i].title);

      currentStage = `키워드북 ${i + 1}/${items.length} 펼치기·내용 입력`;
      let card = await ensureKeywordCardExpanded(header, items[i].title);
      let field = keywordFieldForLabel(card, "정보");
      if (!field) throw new Error(`키워드북 ${i + 1}: 정보 입력칸을 찾지 못했습니다.`);
      await setExact(field, items[i].body, `키워드북 ${i + 1} 정보`);

      const getCard = () => currentKeywordExpandedCard();
      await replaceKeywordChips(getCard, items[i].keywords, `키워드북 ${i + 1}`);

      // 새 노트는 시작 설정 3개가 기본 선택되어 있으므로 이미 전부 있으면 그대로 둡니다.
      // 누락된 이름이 있을 때만 드롭다운을 직접 엽니다.
      await selectAllTargets(getCard, "키워드북 적용 대상", null, startNames, `키워드북 ${i + 1}`, keywordControlAfterLabel);

      card = getCard();
      field = keywordFieldForLabel(card, "정보");
      const titleHeader = keywordHeaderEntryByTitle(items[i].title);
      if (!field || readValue(field) !== items[i].body || !titleHeader) {
        throw new Error(`키워드북 ${i + 1}: 제목·정보 최종 검증 실패`);
      }

      await collapseKeywordCard(items[i].title);
      if ((i + 1) % 5 === 0 || i === items.length - 1) ui.log(`키워드북 ${i + 1}/${items.length}: 제목·정보·키워드 검증 완료${startNames.length ? " · 적용 대상 검증" : " · 기존 기본 적용 대상 유지"}`, "ok");
    }
  }

  function shortcutSectionDeleteButtons() {
    // 단축어의 삭제 버튼에는 사이트가 정확히 aria-label="삭제"를 붙입니다.
    // 이름/설명/본문의 내부 폼 범위를 추측하지 않고 이 실제 버튼만 사용합니다.
    const add = findButtonText("단축어 추가");
    const heading = exactText("단축어 설정")[0] || null;
    let buttons = all('button[aria-label="삭제"]')
      .filter(visible)
      .filter((button) => {
        if (add) {
          const beforeAdd = Boolean(button.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING);
          if (!beforeAdd) return false;
        }
        if (heading) {
          const afterHeading = Boolean(heading.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING);
          if (!afterHeading) return false;
        }
        return true;
      });

    // 화면 구조가 바뀌어 문서 순서 필터가 비면 aria-label이 정확한 버튼을 그대로 사용합니다.
    if (!buttons.length) buttons = all('button[aria-label="삭제"]').filter(visible);
    return buttons.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left;
    });
  }

  function shortcutCardFromDeleteButton(button) {
    if (!button) return null;
    let fallback = null;
    let node = button.parentElement;
    for (let depth = 0; node && depth < 14; depth++, node = node.parentElement) {
      const hasName = exactText("단축어 이름", node).length > 0;
      const hasDescription = exactText("설명", node).length > 0;
      const hasBody = exactText("프롬프트 본문", node).length > 0;
      if (hasName && hasDescription && hasBody) return node;

      const inputCount = all("input:not([type='hidden']):not([type='file']),textarea,[contenteditable='true']", node).filter(visible).length;
      if (!fallback && inputCount >= 3 && node.querySelector('button[aria-label="삭제"]')) fallback = node;
    }
    return fallback;
  }

  function shortcutCardRoots() {
    const roots = shortcutSectionDeleteButtons()
      .map(shortcutCardFromDeleteButton)
      .filter(Boolean);
    return [...new Set(roots)].sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left;
    });
  }

  function shortcutCount() {
    // 단축어 1개마다 aria-label="삭제" 버튼이 정확히 하나 있습니다.
    return shortcutSectionDeleteButtons().length;
  }

  function shortcutDeleteButtonFromCard(card) {
    if (!card) return null;
    return all('button[aria-label="삭제"]', card).filter(visible)[0] || null;
  }

  async function clearExistingShortcuts(ui) {
    let count = shortcutCount();
    if (count === 0) return;
    ui.log(`기존 단축어 ${count}개 발견: aria-label=삭제 휴지통을 눌러 0개까지 삭제합니다.`, "warn");

    while (count > 0) {
      currentStage = `기존 단축어 삭제 · ${count}개 남음`;
      const removeButtons = shortcutSectionDeleteButtons();
      const remove = removeButtons[removeButtons.length - 1] || null;
      if (!remove) throw new Error(`단축어가 ${count}개 남았지만 aria-label=삭제 휴지통 버튼을 찾지 못했습니다.`);

      // 사용자가 제공한 실제 DOM의 button[aria-label="삭제"] 노드를 직접 클릭합니다.
      await deleteButtonDirectly(remove, `기존 단축어 ${count}`);
      await confirmDeleteIfNeeded();
      const changed = await waitFor(() => {
        const next = shortcutCount();
        return next === count - 1 ? { count: next } : null;
      }, 7000, 120);
      if (!changed) throw new Error(`단축어 휴지통을 눌렀지만 개수가 ${count} → ${count - 1}로 줄지 않았습니다.`);

      count = changed.count;
      await sleep(220);
      if (count % 5 === 0 || count < 3) ui.log(`기존 단축어 삭제 진행: ${count}개 남음`, "ok");
    }
    ui.log("기존 단축어 삭제 완료 · 새 단축어 생성을 시작합니다.", "ok");
  }

  async function clickShortcutNewItem() {
    // '+ 단축어 추가'는 곧바로 카드를 만들지 않고 3개 메뉴를 엽니다.
    // 반드시 첫 메뉴인 '신규 추가'를 한 번 더 눌러야 실제 입력 카드가 생깁니다.
    const option = await waitFor(() => {
      const candidates = exactText("신규 추가")
        .filter(visible)
        .map((el) => clickable(el))
        .filter(Boolean);
      if (!candidates.length) return null;
      return candidates.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      })[0];
    }, 3500, 70);
    if (!option) throw new Error("‘+ 단축어 추가’를 눌렀지만 펼쳐진 메뉴에서 ‘신규 추가’를 찾지 못했습니다.");

    option.scrollIntoView({ block: "center", inline: "nearest" });
    if (option instanceof HTMLButtonElement) {
      await directClickButton(option, "단축어 신규 추가");
      await sleep(220);
      return;
    }

    // 메뉴 행이 div/li로 구현된 경우에는 해당 행의 실제 화면 중앙을 신뢰 클릭합니다.
    const clicked = await click(option, 220);
    if (!clicked) throw new Error("단축어 메뉴의 ‘신규 추가’를 클릭하지 못했습니다.");
  }

  async function addShortcutCard(expectedCount) {
    const add = findButtonText("단축어 추가");
    if (!add) throw new Error("‘단축어 추가’ 버튼을 찾지 못했습니다.");
    await click(add, 180);
    await clickShortcutNewItem();

    const countUpdated = await waitFor(() => shortcutCount() === expectedCount ? true : null, 7000, 100);
    if (!countUpdated) throw new Error(`‘신규 추가’를 눌렀지만 휴지통 버튼 개수가 ${expectedCount}개로 바뀌지 않았습니다.`);

    const card = await waitFor(() => {
      const deletes = shortcutSectionDeleteButtons();
      return shortcutCardFromDeleteButton(deletes[deletes.length - 1]) || null;
    }, 7000, 100);
    if (!card) throw new Error(`단축어 ${expectedCount}번째 카드의 이름·설명·본문 입력칸을 찾지 못했습니다.`);
    return card;
  }

  function cleanShortcutName(value) {
    // ASCII slash뿐 아니라 비슷하게 생긴 전각/분수 슬래시도 모두 제거합니다.
    return String(value ?? "").trim().replace(/^[\/／∕⁄]+/u, "").trim();
  }

  async function trustedReplaceFocusedText(value) {
    const result = await debuggerCommand("CRACK_TXT_DEBUGGER_REPLACE_TEXT_V40", { text: String(value ?? "") });
    return Boolean(result?.ok);
  }

  async function setShortcutNameWithoutSlash(input, value, label) {
    if (!(input instanceof HTMLInputElement) && !input?.isContentEditable) {
      throw new Error(`${label}: 단축어 이름 입력칸을 찾지 못했습니다.`);
    }
    const desired = cleanShortcutName(value);
    if (!desired) throw new Error(`${label}: 슬래시를 제거한 뒤 이름이 비었습니다.`);

    input.scrollIntoView({ block: "center", inline: "nearest" });

    // 새 단축어 이름칸에 기존 '/'가 남아 있더라도 Ctrl+A 후 이름만 타이핑해 통째로 교체합니다.
    // DOM value 대입보다 실제 사용자 입력에 가까워 사이트의 고정 슬래시와 중복되지 않습니다.
    for (let attempt = 0; attempt < 3; attempt++) {
      input.focus({ preventScroll: true });
      const typed = await trustedReplaceFocusedText(desired);
      if (!typed) {
        try {
          if (input instanceof HTMLInputElement) input.setSelectionRange(0, input.value.length);
          document.execCommand?.("insertText", false, desired);
        } catch (_) {
          nativeSetValue(input, desired);
        }
      }
      await sleep(180);
      if (readValue(input) === desired) break;

      // 혹시 사이트/이전 값에서 '/'가 남으면 현재 전체 값을 다시 선택해 한 번 더 이름만 입력합니다.
      const stripped = cleanShortcutName(readValue(input));
      if (stripped === desired) {
        input.focus({ preventScroll: true });
        await trustedReplaceFocusedText(desired);
        await sleep(180);
      }
    }

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", keyCode: 9, which: 9, bubbles: true }));
    input.blur();
    const ok = await waitFor(() => readValue(input) === desired ? true : null, 1800, 80);
    if (!ok || /^\s*[\/／∕⁄]/u.test(readValue(input))) {
      throw new Error(`${label}: 입력값이 ‘${readValue(input)}’입니다. 이름은 ‘${desired}’만 들어가야 합니다.`);
    }
  }

  async function fillShortcuts(items, ui) {
    await openTopTab("단축어", "단축어 설정");
    await clearExistingShortcuts(ui);
    const count = shortcutCount();
    if (count !== 0) throw new Error(`기존 단축어 삭제 후 개수가 0이 아닙니다: ${count}`);

    for (let i = 0; i < items.length; i++) {
      currentStage = `단축어 ${i + 1}/${items.length} 추가·입력`;
      let card = await addShortcutCard(i + 1);
      const cleanName = cleanShortcutName(items[i].name);
      if (!cleanName) throw new Error(`단축어 ${i + 1}: 슬래시를 제거한 뒤 이름이 비었습니다.`);

      const name = nearestFieldForLabel("단축어 이름", "input:not([type='file']):not([type='hidden']),[contenteditable='true']", card, 180);
      const description = nearestFieldForLabel("설명", "input:not([type='file']):not([type='hidden']),textarea,[contenteditable='true']", card, 180);
      const body = nearestFieldForLabel("프롬프트 본문", "textarea,[contenteditable='true']", card, 320);

      // 단축어 이름은 사이트의 호출용 '/'와 중복되지 않도록 이름 글자만 입력합니다.
      await setShortcutNameWithoutSlash(name, cleanName, `단축어 ${i + 1} 이름`);
      await setExact(description, items[i].description, `단축어 ${i + 1} 설명`);
      await setExact(body, items[i].body, `단축어 ${i + 1} 본문`);

      const deletes = shortcutSectionDeleteButtons();
      card = shortcutCardFromDeleteButton(deletes[i]) || card;
      const verifyName = nearestFieldForLabel("단축어 이름", "input:not([type='file']):not([type='hidden']),[contenteditable='true']", card, 180);
      const verifyDescription = nearestFieldForLabel("설명", "input:not([type='file']):not([type='hidden']),textarea,[contenteditable='true']", card, 180);
      const verifyBody = nearestFieldForLabel("프롬프트 본문", "textarea,[contenteditable='true']", card, 320);
      if (!verifyName || readValue(verifyName) !== cleanName || /^\s*[\/／∕⁄]/u.test(readValue(verifyName))) {
        throw new Error(`단축어 ${i + 1}: 이름에는 ‘${cleanName}’만 있어야 하는데 현재 ‘${readValue(verifyName)}’입니다.`);
      }
      if (!verifyDescription || readValue(verifyDescription) !== items[i].description) throw new Error(`단축어 ${i + 1}: 설명 검증 실패`);
      if (!verifyBody || readValue(verifyBody) !== items[i].body) throw new Error(`단축어 ${i + 1}: 본문 검증 실패`);
      if ((i + 1) % 5 === 0 || i === items.length - 1) ui.log(`단축어 ${i + 1}/${items.length}: 슬래시 없는 이름·설명·본문 검증 완료`, "ok");
    }
  }

  async function preflight(ui) {
    currentStage = "프로젝트 사전 점검";
    // 이전 버전은 시작→미디어→키워드북→단축어를 미리 순회한 뒤 다시 스토리 설정으로
    // 돌아왔습니다. 상단 메뉴가 overflow-hidden 캐러셀이라 이 왕복 자체가 실패 원인이 됐습니다.
    // v2.6은 실제 입력 순서로 처리하며 미디어 업로드 때 반드시 ‘기기에서 가져오기’를 거칩니다.
    ui.log("사전 점검 완료: 선택한 항목만 정해진 순서로 처리하며, 선택하지 않은 영역은 열거나 삭제하지 않습니다.", "ok");
  }

  async function run(payload) {
    abortRequested = false;
    injectBridge();
    const ui = overlay();
    try {
      currentStage = "브라우저 신뢰 클릭 연결";
      await startTrustedInput();
      ui.log("브라우저 신뢰 클릭 연결 완료", "ok");
      const { parsed, selected, errors, warnings, reports } = P.validate(payload.files);
      if (errors.length) throw new Error(errors.join("\n"));
      (warnings || []).forEach((line) => ui.log(line, "warn"));
      if (parsed.media && (!payload.image?.dataUrl || !payload.image?.name)) {
        throw new Error("media TXT를 처리하려면 미디어용 플레이스홀더 이미지를 선택해야 합니다.");
      }

      const countText = selected.map((kind) => {
        if (kind === "main") return "main 1";
        return `${kind} ${parsed[kind].length}/${reports?.[kind]?.expected ?? "?"}`;
      }).join(" · ");
      ui.log(`선택한 TXT 확인: ${countText}`, "ok");
      if (parsed.media) ui.log(`미디어 이미지: ${payload.image.name} · ${parsed.media.length}개에 재사용`, "ok");
      await preflight(ui);

      if (parsed.main !== null) await fillStoryMain(parsed.main, ui);
      let startNames = [];
      if (parsed.start !== null) startNames = await fillStart(parsed.start, ui);
      else if (parsed.guide !== null || parsed.recs !== null) await fillStartExtras(parsed.guide, parsed.recs, ui);
      if (parsed.media !== null) await fillMedia(parsed.media, startNames, payload.image, ui);
      if (parsed.keyword !== null) await fillKeyword(parsed.keyword, startNames, ui);
      if (parsed.shortcut !== null) await fillShortcuts(parsed.shortcut, ui);

      currentStage = "완료";
      ui.done(`선택한 항목(${selected.join(", ")})의 입력과 화면 값 검증이 끝났습니다. 선택하지 않은 영역은 건드리지 않았습니다. 상단 ‘수정’은 자동으로 누르지 않았습니다.`, "ok");
    } catch (error) {
      console.error("[크랙 툴박스 · TXT 자동 입력]", currentStage, error);
      ui.log(`중단 위치: ${currentStage}`, "err");
      ui.log(`오류: ${error.message}`, "err");
      ui.done("여기까지 입력된 내용은 저장되지 않았습니다. 원상복구하려면 상단 ‘수정’을 누르지 말고 페이지를 새로고침하세요.", "warn", true);
    } finally {
      await stopTrustedInput();
    }
  }

  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "CRACK_TXT_AUTOFILL_RUN_V47") return;
      sendResponse({ ok: true });
      run(message.payload);
      return true;
    });
  }

  globalThis.__CRACK_TXT_AUTOFILL_V47_TEST__ = {
    run,
    helpers: { recommendationFields, recommendationAddButton, ensureAdvancedOpen, fillRecommendations, fillStartExtras, readTotalCount, startPageVerticalBounds, exactNativeStartPillButtons, exactStartPillRows, startRowButtons, startPills, startPillLabel, startPillPanelMatches, activeStartPillIndex, openStartPill, ensureThreeStartTabs, currentStartFields, shortcutCardRoots, shortcutCount, shortcutDeleteButtonFromCard, clearExistingShortcuts, cardRootsByLabels, promptTemplateControl, interactiveOptionForText, selectCustomPromptTemplate, storyMainField, fillStoryMain, fillStart },
  };
})();
