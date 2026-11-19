(() => {
  "use strict";
  if (window.__CRACK_QA__) return;
  window.__CRACK_QA__ = true;

  // ============================================================
  //  Crack QA 러너 — 작품 무관 범용
  //  작품별인 것(HUD 칸 이름·감시 단어·추출 패턴)은 전부 시나리오 파일이 들고 있다.
  //  이 파일에는 특정 작품에 대한 지식이 없다.
  // ============================================================

  const PANEL_ID = "crack-qa-panel";
  const SEL = {
    editor: '.__chat_input_textarea[contenteditable="true"]',
    group: "[data-message-group-id]",
    markdown: ".wrtn-markdown",
    rerollPath: "M3.8 12a8.2",
    sendPath: ["18.77", "11.13"]
  };
  const API_BASE = "https://crack-api.wrtn.ai/crack-gen/v3";
  const STORE_KEY = "crack_qa_scenarios";

  const DEFAULTS = () => ({
    gap: 3, timeout: 240, settle: 4, status: 0,
    gapMax: null,   // @gap 1-5 처럼 범위를 주면 그 사이 무작위
    read: 0,        // @read N : 응답 1000자당 N초를 간격에 더함
    pool: [],       // @pool : [랜덤] 턴이 고를 문장들 (비면 기본 풀)
    cont: null,     // @continue : [이어서] 버튼이 없을 때 대신 보낼 문구 (null = @blank, off = 실패 처리)
    blank: "*아무런 말도 하지 않았다.*",
    name: "이름없음", model: "", scenario: "",
    hud: [],        // 주석 칸 이름 (@hud)
    watch: [],      // 등장 감시 단어 (@watch)
    grab: [],       // [{name, re}] (@grab)
    header: 3       // 응답 앞 N줄을 헤더로 기록 (@header off = 0)
  });

  let cfg = DEFAULTS();
  let turns = [], idx = 0, state = "idle", log = [], fails = 0, abort = false;
  let apiOn = false, chatroomId = null, saved = {};

  // 크롬은 안 보는 탭의 setTimeout 을 늦춘다(몇 분 지나면 1분에 한 번까지).
  // 워커 안의 타이머는 그 제한을 받지 않으므로 대기는 워커로 잰다.
  // 페이지 정책 때문에 워커가 막히면 평소 setTimeout 이 대신 끝내 준다(둘 중 먼저 오는 쪽).
  const Timer = (() => {
    let w = null, seq = 0; const cbs = new Map();
    try {
      const src = "onmessage=e=>{const[i,ms]=e.data;setTimeout(()=>postMessage(i),ms)}";
      w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      w.onmessage = e => { const f = cbs.get(e.data); cbs.delete(e.data); if (f) f(); };
      w.onerror = () => { w = null; cbs.clear(); };
    } catch (_) { w = null; }
    return {
      sleep(ms) {
        return new Promise(res => {
          let done = false; const fin = () => { if (!done) { done = true; res(); } };
          setTimeout(fin, ms);
          if (w) { const id = ++seq; cbs.set(id, fin); try { w.postMessage([id, ms]); } catch (_) {} }
        });
      },
      get ok() { return !!w; }
    };
  })();
  const sleep = ms => Timer.sleep(ms);
  const pad2 = n => String(n).padStart(2, "0");
  const nowStr = () => new Date().toLocaleTimeString("ko-KR", { hour12: false });
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  // 크랙은 *별표*를 <em>으로 렌더해서 화면 텍스트에는 별표가 없다.
  // 보낸 문자열과 화면 텍스트를 비교하려면 양쪽에서 마크다운 기호를 떼야 한다.
  const stripMd = s => (s || "").replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim();
  let sentHist = [];                      // 최근 보낸 것(마크다운 제거본)
  const isEcho = t => { const x = stripMd(t); return !x || sentHist.includes(x); };

  // ===================== 저장소 =====================
  const Store = {
    async all() {
      try {
        const r = await chrome.storage.local.get(STORE_KEY);
        return r?.[STORE_KEY] || {};
      } catch (_) { return {}; }
    },
    async put(name, text) {
      const a = await this.all(); a[name] = text;
      try { await chrome.storage.local.set({ [STORE_KEY]: a }); } catch (_) {}
      return a;
    },
    async del(name) {
      const a = await this.all(); delete a[name];
      try { await chrome.storage.local.set({ [STORE_KEY]: a }); } catch (_) {}
      return a;
    }
  };

  // ===================== 원문 읽기 =====================
  // 화면에 렌더된 본문에는 마크다운 주석이 없다. 렌더러가 지운다.
  // 원문은 API 응답의 content 필드에 있다. 읽기만 하고 쓰지 않는다.
  const Api = {
    token() {
      const p = ("; " + document.cookie).split("; access_token=");
      return p.length === 2 ? decodeURIComponent(p.pop().split(";").shift()) : null;
    },
    async get(path, tries = 3) {
      const tk = this.token();
      if (!tk) throw new Error("access_token 쿠키 없음");
      let last;
      for (let i = 0; i < tries; i++) {
        try {
          const r = await fetch(API_BASE + path, { headers: { Authorization: "Bearer " + tk, platform: "web" } });
          if (r.ok) return await r.json();
          if (r.status === 429) { last = new Error("요청 제한(429)"); await sleep(2000 * (i + 1)); continue; }
          last = new Error("HTTP " + r.status);
        } catch (e) { last = e; }
        await sleep(600 * (i + 1));
      }
      throw last;
    },
    async resolveRoom() {
      const m = location.pathname.match(/\/stories\/([a-f0-9]+)\/episodes\/([a-f0-9]+)/);
      if (m) return m[2];
      const s = location.pathname.match(/\/stories\/([a-f0-9]+)/);
      const sid = s ? s[1] : null;
      const list = await this.get("/chats?limit=40");
      const chats = list?.data?.chats || [];
      const hit = chats.find(c => (c.story?._id || c.storyId || c.character?._id || c.story?.id) === sid) || chats[0];
      return hit?._id || hit?.id || null;
    },
    // 이 API 는 대화 '처음'부터 돌려준다. limit 을 작게 주면 초반 메시지만 온다.
    // 크게 받고 커서로 끝까지 따라간 뒤, 뒤에서부터 찾는다.
    async allMessages(per = 300, maxPages = 5) {
      if (!chatroomId) return [];
      let out = [], cursor = null;
      for (let i = 0; i < maxPages; i++) {
        const q = `/chats/${chatroomId}/messages?limit=${per}` +
                  (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
        const d = await this.get(q);
        const arr = d?.data?.messages || d?.data?.list || [];
        out = out.concat(arr);
        const nc = d?.data?.nextCursor || d?.data?.next_cursor || d?.data?.cursor || null;
        if (!nc || arr.length < per) break;
        cursor = nc;
      }
      // 실제 API 는 최신 메시지부터 준다 (2026-10-28 확인: 맨 끝이 첫 인사 메시지, parentTurnId 없음).
      // 아래 코드는 전부 '배열 끝 = 최신'을 가정하므로 여기서 순서를 맞춘다.
      if (out.length > 1 && !out[out.length - 1]?.parentTurnId && out[0]?.parentTurnId) out.reverse();
      return out;
    },
    async latest(n = 1) { return (await this.allMessages()).slice(-n); }
  };

  // 마크다운 주석 한 줄을 찾아 | 로 자른다. 칸 이름은 시나리오가 정한다.
  function parseHud(raw) {
    const m = (raw || "").match(/\[\/\/\]:\s*#\s*["'(]([\s\S]*?)["')]\s*(?:\n|$)/);
    if (!m) return { 있음: "X", 칸수: 0, cells: [] };
    const cells = m[1].split("|").map(s => s.trim());
    return { 있음: "O", 칸수: cells.length, cells, raw: m[1].slice(0, 200) };
  }
  // 칸에 숫자가 있으면 숫자만, 없으면 원문 그대로. "호감3" → 3 / "단서 -" → "단서 -"
  const digit = v => (String(v ?? "").match(/(\d+)/) || [])[1] || "";

  // ===================== 시나리오 파서 =====================
  function parseScenario(src) {
    const out = { cfg: DEFAULTS(), turns: [], errors: [] };
    const lines = src.replace(/\r\n?/g, "\n").split("\n");
    let i = 0;
    const push = t => out.turns.push({ text: t });
    const readBlock = stop => {
      const b = [];
      while (i < lines.length && lines[i].trim().toLowerCase() !== stop) {
        const t = lines[i].trim();
        if (t && !t.startsWith("#")) {
          if (t === "<<<") {
            const buf = []; i++;
            while (i < lines.length && lines[i].trim() !== ">>>") { buf.push(lines[i]); i++; }
            b.push(buf.join("\n").trim());
          } else b.push(t);
        }
        i++;
      }
      i++; return b;
    };

    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t || t.startsWith("#")) { i++; continue; }

      if (t.startsWith("@")) {
        const m = t.match(/^@(\w+)\s*([\s\S]*)$/);
        const k = (m?.[1] || "").toLowerCase(), v = (m?.[2] || "").trim();

        if (k === "meta") {
          for (const p of v.split("|")) {
            const [a, b] = p.split("=").map(x => (x || "").trim());
            if (a === "이름" || a === "name") out.cfg.name = b;
            else if (a === "모델" || a === "model") out.cfg.model = b;
            else if (a === "시나리오" || a === "scenario") out.cfg.scenario = b;
          }
          i++; continue;
        }
        if (k === "gap") {
          const r = v.match(/^([\d.]+)\s*[-~]\s*([\d.]+)$/);
          if (r) {
            const a = parseFloat(r[1]), b = parseFloat(r[2]);
            out.cfg.gap = Math.min(a, b); out.cfg.gapMax = Math.max(a, b);
          } else {
            const n = parseFloat(v);
            if (!isNaN(n)) { out.cfg.gap = n; out.cfg.gapMax = null; }
            else out.errors.push(`${i + 1}행: @gap 값 오류`);
          }
          i++; continue;
        }
        if (["timeout", "settle", "status", "read"].includes(k)) {
          const n = parseFloat(v);
          if (!isNaN(n)) out.cfg[k] = n; else out.errors.push(`${i + 1}행: @${k} 값 오류`);
          i++; continue;
        }
        if (k === "blank") { out.cfg.blank = v; i++; continue; }
        if (k === "continue") { out.cfg.cont = /^off$/i.test(v) ? "off" : (v || null); i++; continue; }
        if (k === "pool") {
          if (v) { out.cfg.pool = v.split("|").map(s => s.trim()).filter(Boolean); i++; continue; }
          i++;
          out.cfg.pool = readBlock("@end");
          if (!out.cfg.pool.length) out.errors.push("@pool 블록 비어 있음");
          continue;
        }
        if (k === "hud")   { out.cfg.hud = v.split("|").map(s => s.trim()).filter(Boolean); i++; continue; }
        if (k === "watch") { out.cfg.watch = v.split("|").map(s => s.trim()).filter(Boolean); i++; continue; }
        if (k === "header") {
          out.cfg.header = /^(off|0|no)$/i.test(v) ? 0 : (parseInt(v, 10) || 3);
          i++; continue;
        }
        if (k === "grab") {
          const eq = v.indexOf("=");
          if (eq < 1) out.errors.push(`${i + 1}행: @grab 은 이름=정규식 형식`);
          else {
            const nm = v.slice(0, eq).trim(), pat = v.slice(eq + 1).trim();
            try { out.cfg.grab.push({ name: nm, re: new RegExp(pat) }); }
            catch (e) { out.errors.push(`${i + 1}행: @grab ${nm} 정규식 오류`); }
          }
          i++; continue;
        }
        if (k === "repeat") {
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 1) { out.errors.push(`${i + 1}행: @repeat 값 오류`); i++; continue; }
          i++;
          const b = readBlock("@end");
          if (!b.length) { out.errors.push("@repeat 블록 비어 있음"); continue; }
          for (let x = 0; x < n; x++) push(b[x % b.length]);
          continue;
        }
        out.errors.push(`${i + 1}행: 모르는 지시어 @${k}`); i++; continue;
      }

      if (t === "<<<") {
        const buf = []; i++;
        while (i < lines.length && lines[i].trim() !== ">>>") { buf.push(lines[i]); i++; }
        i++; push(buf.join("\n").trim()); continue;
      }
      push(t); i++;
    }

    if (out.cfg.status > 0) {
      const w = [];
      out.turns.forEach((t, n) => { w.push(t); if ((n + 1) % out.cfg.status === 0) w.push({ text: "/상태", isStatus: true }); });
      out.turns = w;
    }
    return out;
  }
  const resolveText = t => (t === "[빈칸]" ? cfg.blank : t);

  // ===================== 열 구성 (시나리오가 정한다) =====================
  const headCols = () => Array.from({ length: cfg.header }, (_, n) => "헤더" + (n + 1));
  const hudCols  = () => cfg.hud.length ? cfg.hud : [];
  const cols = () => [
    "turn", "구분", "sent", ...(turns.some(t => t && isSpecial(t.text)) ? ["입력방식"] : []), "sentAt", "seconds", "출처", "본문일치", "HUD", "칸수",
    ...hudCols(), ...cfg.grab.map(g => g.name), ...headCols(), ...cfg.watch,
    "장면전환", "이미지", "길이", "완료판정", "오류"
  ];

  // ===================== DOM =====================
  const getEditor = () => document.querySelector(SEL.editor);
  const cleanText = el => (el?.textContent || "").replace(/\u200B/g, "").replace(/\u00A0/g, " ").trim();
  const isEmpty = ed => cleanText(ed).length === 0;
  const groupIds = () => new Set([...document.querySelectorAll(SEL.group)].map(e => e.getAttribute("data-message-group-id")));
  const bodyOf = el => (el.querySelector(SEL.markdown)?.innerText || "").trim();
  const isDone = el => [...el.querySelectorAll("svg path")].some(p => (p.getAttribute("d") || "").startsWith(SEL.rerollPath));

  function getSendButton(editor) {
    if (!editor) return null;
    const box = editor.parentElement?.parentElement;
    if (box) {
      const b = [...box.querySelectorAll("button")].filter(x => !x.closest("#" + PANEL_ID));
      if (b.length) return b[b.length - 1];
    }
    let p = editor.parentElement;
    for (let n = 0; n < 6 && p; n++, p = p.parentElement)
      for (const b of [...p.querySelectorAll("button")].reverse()) {
        if (b.closest("#" + PANEL_ID)) continue;
        const d = b.querySelector("svg path")?.getAttribute("d") || "";
        if (SEL.sendPath.every(s => d.includes(s))) return b;
      }
    return null;
  }

  function insertText(editor, text) {
    editor.focus({ preventScroll: true });
    const s = window.getSelection(), r = document.createRange();
    r.selectNodeContents(editor); r.collapse(false); s.removeAllRanges(); s.addRange(r);
    let ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch (_) {}
    if (!ok || cleanText(editor) !== text.trim()) {
      try { editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text })); } catch (_) {}
      if (isEmpty(editor)) {
        editor.innerHTML = "";
        for (const ln of String(text).split("\n")) { const p = document.createElement("p"); p.textContent = ln; editor.appendChild(p); }
        try { editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })); }
        catch (_) { editor.dispatchEvent(new Event("input", { bubbles: true })); }
      }
    }
    return !isEmpty(editor);
  }

  // 전송 버튼을 누른 뒤 실제로 나갔는지 본다: 입력칸이 비거나 새 메시지 칸이 생기면 성공.
  async function confirmSent(editor, before) {
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < 20; i++) {          // 약 5초
        await sleep(250);
        if (isEmpty(editor)) return true;
        if ([...document.querySelectorAll(SEL.group)].some(g => !before.has(g.getAttribute("data-message-group-id")))) return true;
      }
      const b = getSendButton(editor);        // 안 나갔으면 한 번 더
      if (b && !b.disabled) b.click(); else editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    }
    return isEmpty(editor);
  }

  async function waitForSendButton(editor, ms = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const b = getSendButton(editor); if (b && !b.disabled) return b; await sleep(80); }
    return getSendButton(editor);
  }

  // ===================== 단축어 (/이름 인자) =====================
  // 크랙은 "/" 를 치면 메뉴가 뜨고 항목을 골라야 한다. 글자로 보내면 안 먹는다.
  // 항목 텍스트가 "/이름" 으로 시작하므로 텍스트로 찾아 클릭한다. 셀렉터 의존 없음.
  const isShortcut = t => /^\/\S/.test(t) && !t.startsWith("//");
  function splitShortcut(t) {
    const m = t.match(/^\/(\S+)\s*([\s\S]*)$/);
    return { name: m[1], arg: (m[2] || "").trim() };
  }
  // 실제 구조 (2026-09 확인):
  //   <li><div class="… cursor-pointer …">            ← 클릭은 여기
  //     <div><div><span>/검열</span><span>제작자</span></div><span>설명</span></div>
  //     <div data-slash-command-row-actions>…</div>   ← "…" 버튼, 피함
  const visible = el => el.getClientRects().length > 0;
  function findMenuItem(name, editor) {
    const needle = "/" + name;
    const exact = [], prefix = [];
    for (const el of document.body.querySelectorAll("span,div,li,button,p,a")) {
      if (el.children.length > 4) continue;
      if (el.closest("#" + PANEL_ID)) continue;
      if (editor && (el === editor || editor.contains(el))) continue;
      if (el.closest("[data-slash-command-row-actions]")) continue;
      const t = (el.textContent || "").replace(/\u200B/g, "").trim();
      if (t === needle) { exact.push(el); continue; }
      if (t.startsWith(needle) && t.length < needle.length + 80) {
        const nx = t.charAt(needle.length);
        if (!/[가-힣A-Za-z0-9_]/.test(nx)) prefix.push(el);   // /사건 ≠ /사건일지
      }
    }
    // 메뉴가 둘 이상 마운트돼 있을 수 있음 → 화면에 그려진 것 중 마지막(최신)
    const pickVisible = arr => { const v = arr.filter(visible); return (v.length ? v : arr).slice(-1)[0] || null; };
    if (exact.length) return pickVisible(exact);
    prefix.sort((a, b) => a.textContent.length - b.textContent.length);
    return pickVisible(prefix.slice(0, 3));
  }
  function rowOf(el) {
    let n = el;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement)
      if (n.classList && n.classList.contains("cursor-pointer")) return n;
    return el.closest('[role="option"],[role="menuitem"],button') || el.parentElement || el;
  }
  function clickRow(el) {
    const row = rowOf(el);
    const r = row.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, view: window,
                  clientX: r.left + Math.min(40, r.width / 2), clientY: r.top + r.height / 2 };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try { row.dispatchEvent(new MouseEvent(type, opt)); } catch (_) {}
    }
  }
  async function sendShortcut(editor, name, arg) {
    // 1) "/" 만 쳐서 메뉴를 띄운다
    if (!insertText(editor, "/")) return { ok: false, error: "/ 입력 실패" };
    let item = null;
    for (let i = 0; i < 12 && !item; i++) { await sleep(150); item = findMenuItem(name, editor); }
    // 2) 안 보이면 이름을 이어 쳐서 목록을 거른다 (가상화 목록 대비)
    if (!item) {
      insertText(editor, name);
      for (let i = 0; i < 12 && !item; i++) { await sleep(150); item = findMenuItem(name, editor); }
    }
    if (item) { clickRow(item); await sleep(350); }
    else {
      // 3) 마지막 수단: 강조된 항목을 Enter 로 선택
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      await sleep(350);
    }
    // 4) 선택 결과 확인
    const now = cleanText(editor);
    if (!now) return { ok: true, autoSent: true, argAttached: false, found: !!item };   // 고르자마자 전송된 경우
    if (!now.includes("/" + name)) return { ok: false, error: `메뉴에서 /${name} 못 고름`, found: !!item };
    // 5) 인자 붙이고 전송
    if (arg) {
      if (!insertText(editor, (now.endsWith(" ") ? "" : " ") + arg)) return { ok: false, error: "인자 입력 실패" };
      await sleep(150);
    }
    const btn = await waitForSendButton(editor);
    if (!btn || btn.disabled) return { ok: false, error: "전송 버튼 없음/비활성" };
    btn.click();
    return { ok: true, autoSent: false, argAttached: !!arg, found: !!item };
  }

  // ===================== 추천답변 ([추천] 턴) =====================
  // 입력칸 아래 툴바의 <button aria-label="추천답변"> (2026-10 확인).
  // 누른 뒤 무엇이 뜨는지는 아직 실물로 못 봤다. 세 경우를 모두 받는다:
  //   A) 입력칸에 바로 문장이 채워진다 → 채움이 멈출 때까지 기다렸다 전송
  //   B) 선택지 목록이 뜬다 → 그 묶음에서 무작위로 하나 클릭 → A 로 이어지거나 C
  //   C) 고르자마자 전송된다 → 새 메시지 묶음이 생긴 걸로 판단
  // 특수 턴 세 가지. 시나리오 한 줄에 그대로 쓴다.
  const MODES = { "[추천]": "추천", "[랜덤]": "랜덤", "[이어서]": "이어서", "[재생성]": "재생성", "[섞기]": "섞기" };
  // [섞기] 가 매 턴 이 중 하나를 고른다. 재생성은 이야기가 안 나아가고 비용만 들어서 절반 비율.
  const MIX = ["추천", "추천", "랜덤", "랜덤", "이어서", "이어서", "재생성"];
  const modeOf = t => MODES[t] || "";
  const isSpecial = t => !!modeOf(t);
  const CLICKABLE = 'button,[role="option"],[role="menuitem"],[role="radio"],li,[class*="cursor-pointer"]';
  const NOT_A_CHOICE = /^(취소|닫기|확인|충전하기|충전|다시|다시 생성|재생성|새로고침|×|x|X|\.\.\.|…)$/;

  function getSuggestButton() {
    const outside = b => !b.closest("#" + PANEL_ID);
    const byLabel = [...document.querySelectorAll('button[aria-label="추천답변"]')].filter(outside);
    const v = byLabel.filter(visible);
    if (v.length || byLabel.length) return (v.length ? v : byLabel).slice(-1)[0];
    return [...document.querySelectorAll("button")].filter(outside)
      .find(b => cleanText(b) === "추천답변") || null;
  }

  function press(el) {
    const r = el.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, view: window,
                  clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      try { el.dispatchEvent(new MouseEvent(type, opt)); } catch (_) {}
    }
    el.click();
  }

  // 누른 뒤 새로 붙은 노드들 안에서 '선택지 묶음'을 찾는다.
  // 같은 부모 아래 나란히 있는 클릭 가능한 글 덩어리 = 선택지. 가장 큰 묶음을 고른다.
  function pickChoice(added, editor) {
    const items = new Set();
    for (const root of added) {
      if (!root.isConnected) continue;
      const pool = root.matches?.(CLICKABLE) ? [root, ...root.querySelectorAll(CLICKABLE)] : [...root.querySelectorAll(CLICKABLE)];
      for (const el of pool) {
        if (el.closest("#" + PANEL_ID) || el.closest(SEL.group)) continue;
        if (el.closest("[data-crack-ui-bottom-model-group]")) continue;   // 입력칸 툴바 자체
        if (el === editor || editor.contains(el) || el.contains(editor)) continue;
        if (el.getAttribute("aria-label") === "추천답변") continue;
        if (!visible(el)) continue;
        const t = cleanText(el);
        if (t.length < 2 || t.length > 600 || NOT_A_CHOICE.test(t)) continue;
        items.add(el);
      }
    }
    // 다른 후보 안에 들어 있는 것은 빼고 바깥 것만 (li 안의 button 등 중복 방지)
    const arr = [...items].filter(el => ![...items].some(o => o !== el && o.contains(el)));
    if (!arr.length) return null;
    const groups = new Map();
    for (const el of arr) {
      const k = el.parentElement;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(el);
    }
    const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
    const el = best[Math.floor(Math.random() * best.length)];
    return { el, text: cleanText(el), of: best.length };
  }

  // 실제 구조 (2026-10-28 실물 확인):
  //   응답이 끝나면(자동 추천이 켜진 방) 메시지 목록 끝에 추천 말풍선 3개가 뜬다.
  //   각 말풍선 = <button class="hover:bg-state_hover"> + 옆에 <button aria-label="답변 수정">.
  //   말풍선을 누르면 바로 전송된다. 자동 추천이 꺼진 방은 입력칸 아래 '추천답변' 버튼을 눌러야 뜬다.
  function suggestionBubbles() {
    return [...document.querySelectorAll('button[aria-label="답변 수정"]')]
      .map(e => [...(e.parentElement?.children || [])].find(c => c.tagName === "BUTTON" && !c.hasAttribute("aria-label")))
      .filter(b => b && visible(b) && !b.disabled && cleanText(b).length > 0 && !b.closest(SEL.group));
  }
  async function clickBubble(n, how) {
    const list = suggestionBubbles();
    if (!list.length) return null;
    const b = list[Math.floor(Math.random() * list.length)];
    const text = cleanText(b);
    await typeDelay(text, n);                       // 사람처럼: 고르고 누르기 전 잠깐
    const before = groupIds();
    setStatus(`${n + 1}턴 · 추천 ${list.length}개 중 하나 고름`, "#c4b5fd");
    press(b);
    for (let i = 0; i < 40; i++) {                  // 보통 바로 전송된다
      await sleep(150);
      if ([...document.querySelectorAll(SEL.group)].some(g => !before.has(g.getAttribute("data-message-group-id"))))
        return { ok: true, autoSent: true, text, how: `${how} ${list.length}개 중 1` };
      if (cleanText(getEditor())) return { ok: true, autoSent: false, text: cleanText(getEditor()), how: `${how} ${list.length}개 중 1 (입력칸)` };
    }
    return { ok: false, error: "추천 말풍선을 눌렀는데 전송이 안 됨" };
  }

  // 원문 경로: 마지막 응답 메시지의 dynamicChipList 가 바로 추천 3개다 (2026-10-28 확인).
  // 화면을 안 그리는 숨김 탭에서도 읽힌다.
  async function chipsFromApi() {
    if (!apiOn) return [];
    try {
      const msgs = await Api.allMessages();
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (!m || m.role === "user") continue;
        return (Array.isArray(m.dynamicChipList) ? m.dynamicChipList : []).map(x => String(x || "").trim()).filter(Boolean);
      }
    } catch (_) {}
    return [];
  }
  const pickOne = a => a[Math.floor(Math.random() * a.length)];

  async function useSuggestion(editor, n, limit = 60000) {
    setStatus(`${n + 1}턴 · 추천답변 기다리는 중`, "#c4b5fd");
    const t0 = Date.now();
    // 1) 자동 추천: 응답이 끝나고 몇 초 안에 원문(또는 화면 말풍선)에 생긴다
    let chips = await chipsFromApi();
    while (!abort && !chips.length && !suggestionBubbles().length && Date.now() - t0 < 6000) {
      await sleep(700); chips = await chipsFromApi();
    }
    if (chips.length) return { ok: true, autoSent: false, needInsert: true, text: pickOne(chips), how: `자동 추천 ${chips.length}개 중 1` };
    if (suggestionBubbles().length) { const r = await clickBubble(n, "자동 추천"); if (r) return r; }

    // 2) 자동 추천이 없으면 추천답변 버튼 → 원문 또는 말풍선에 뜨길 기다린다
    let sb = getSuggestButton();
    if (sb && !sb.disabled) { setStatus(`${n + 1}턴 · 추천답변 받는 중`, "#c4b5fd"); press(sb); }
    let lastApi = 0, lastTxt = "", lastChange = Date.now();
    while (!abort && Date.now() - t0 < limit) {
      await sleep(250);
      if (Date.now() - lastApi > 1500) {
        lastApi = Date.now(); chips = await chipsFromApi();
        if (chips.length) return { ok: true, autoSent: false, needInsert: true, text: pickOne(chips), how: `추천답변 버튼 → ${chips.length}개 중 1` };
      }
      if (suggestionBubbles().length) { const r = await clickBubble(n, "추천답변 버튼 →"); if (r) return r; }
      // 옛 방식: 입력칸에 바로 채워지는 경우
      const txt = cleanText(editor);
      if (txt !== lastTxt) { lastTxt = txt; lastChange = Date.now(); }
      if (txt && Date.now() - lastChange >= 1200) return { ok: true, autoSent: false, text: txt, how: "추천답변 버튼 → 입력칸" };
    }
    if (abort) return { ok: false, error: "정지됨" };
    return { ok: false, error: `추천답변이 ${Math.round(limit / 1000)}초 안에 안 나옴` + (document.hidden ? " (탭이 숨겨져 있었음)" : "") };
  }

  // ===================== 랜덤답변 ([랜덤] 턴) =====================
  // 장르를 타지 않는 유저 행동들. 말/행동(별표)/침묵을 섞어 둔다.
  const FALLBACK_POOL = [
    "...", "*가만히 지켜본다.*", "응.", "아니.", "왜?", "그래서 어떻게 됐어?",
    "*자리를 뜬다.*", "*주변을 둘러본다.*", "잠깐만.", "좋아, 그렇게 하자.", "싫어.",
    "*하품을 한다.*", "다른 얘기 하자.", "*고개를 끄덕인다.*", "누구야?", "*창밖을 본다.*",
    "그건 나중에.", "*아무 말 없이 따라간다.*", "흥미롭네.", "*잠이 든다.*"
  ];
  const DEFAULT_POOL = Array.isArray(globalThis.CRACK_QA_POOL) && globalThis.CRACK_QA_POOL.length
    ? globalThis.CRACK_QA_POOL : FALLBACK_POOL;
  let lastRandom = "";
  function pickRandom() {
    const pool = cfg.pool.length ? cfg.pool : DEFAULT_POOL;
    let t = pool[Math.floor(Math.random() * pool.length)];
    for (let k = 0; k < 5 && pool.length > 1 && t === lastRandom; k++) t = pool[Math.floor(Math.random() * pool.length)];
    lastRandom = t;
    return { text: t, how: `${cfg.pool.length ? "@pool" : "기본 풀"} ${pool.length}개 중` };
  }

  // ===================== 이어서 생성 ([이어서] 턴) =====================
  // 유저 입력 없이 모델이 이어 쓰게 한다. 버튼 위치를 실물로 못 봤으므로:
  //   1) 화면 어디든 '이어서 …/계속 생성' 컨트롤이 있으면 누른다
  //   2) 없으면 마지막 응답의 "메시지 옵션" 메뉴를 열어 그 안에서 찾는다
  //   3) 끝내 없으면 @continue 문구(기본 @blank)를 보낸다 → 입력방식 열에 남는다
  const CONT_RE = /^(이어서|계속)\s*(생성|쓰기|작성|하기)?(하기)?$/;
  function findContinueControl() {
    const els = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"]')]
      .filter(el => !el.closest("#" + PANEL_ID) && visible(el) && !el.disabled);
    const hit = els.filter(el => {
      const lab = (el.getAttribute("aria-label") || "").trim(), t = cleanText(el);
      return CONT_RE.test(lab) || CONT_RE.test(t);
    });
    return hit.slice(-1)[0] || null;
  }
  // 목록이 역순이라 DOM 첫 번째가 최신. 재생성 버튼이 달린 것 = 마지막 응답.
  const latestAnswer = () => {
    const gs = [...document.querySelectorAll(SEL.group)];
    return gs.find(isDone) || gs[0] || null;
  };
  // 우리 Esc 단축키는 사람이 누른 것(isTrusted)만 받는다. 메뉴 닫기용 가짜 Esc 로 정지되지 않게.
  const closeMenus = () => {
    const t = document.activeElement || document.body;
    t.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  };
  async function useContinue(n) {
    setStatus(`${n + 1}턴 · 이어서 생성 찾는 중`, "#c4b5fd");
    // 크랙은 응답이 잘렸을 때만 '이어서 생성' 버튼을 보여 준다. 메시지 옵션 메뉴엔 없다(분기/수정/삭제).
    const c = findContinueControl();
    if (c) { press(c); return { ok: true, how: "이어서 버튼" }; }
    return { ok: false };
  }

  // ===================== 재생성 ([재생성] 턴) =====================
  // 마지막 응답의 ↻ 버튼(경로 M3.8 12a8.2…). 확인 창이 뜨면 확인을 누른다.
  async function useReroll(n) {
    setStatus(`${n + 1}턴 · 재생성 누르는 중`, "#c4b5fd");
    const la = latestAnswer();
    const b = la && [...la.querySelectorAll("button")].find(x =>
      [...x.querySelectorAll("svg path")].some(p => (p.getAttribute("d") || "").startsWith(SEL.rerollPath)));
    if (!b || b.disabled) return { ok: false, error: "재생성 버튼 못 찾음" };
    press(b);
    // 누르면 "재생성 지침" 창이 뜬다 (지침 입력칸 + 취소 / 답변 재생성). 지침은 비워 두고 '답변 재생성'.
    const CONFIRM = /^(답변 재생성|재생성|다시 생성|확인|네|예)$/;
    for (let i = 0; i < 25; i++) {
      await sleep(200);
      const ok = [...document.querySelectorAll("button")].find(x =>
        CONFIRM.test(cleanText(x)) && visible(x) && !x.disabled && !x.closest(SEL.group) && x !== b);
      if (ok) { press(ok); return { ok: true, how: "재생성 버튼 → 답변 재생성" }; }
    }
    return { ok: true, how: "재생성 버튼 (확인 창 없음)" };
  }

  async function waitForResponse(before, sent, onTick, grow) {
    const t0 = Date.now();
    let target = null, lastLen = -1, lastGrow = Date.now();
    while (!abort) {
      const el = (Date.now() - t0) / 1000;
      if (!target)
        for (const g of document.querySelectorAll(SEL.group)) {
          if (before.has(g.getAttribute("data-message-group-id"))) continue;
          if (isEcho(bodyOf(g))) continue;
          target = g; break;
        }
      // 이어서 생성이 새 메시지 대신 기존 응답을 늘리는 경우
      if (!target && grow) {
        const ge = (grow.id && document.querySelector(`[data-message-group-id="${CSS.escape(grow.id)}"]`)) || (grow.el.isConnected ? grow.el : null);
        const b = ge ? bodyOf(ge) : "";
        if (ge && (grow.changed ? (b.length >= 20 && b !== grow.text) : b.length > grow.from + 5)) { target = ge; grow.hit = true; }
      }
      if (target && !grow?.hit && isEcho(bodyOf(target))) { target = null; lastLen = -1; }

      let len = 0;
      if (target) {
        len = bodyOf(target).length;
        if (len !== lastLen) { lastLen = len; lastGrow = Date.now(); }
      }
      const q = target ? (Date.now() - lastGrow) / 1000 : 0;
      onTick?.(el, q, len);

      // 늘어난 기존 응답에는 재생성 버튼이 원래 붙어 있으므로 '안 늘어남'으로만 판정
      if (target && len > 0 && !grow?.hit && isDone(target)) return { ok: true, el: target, by: "reroll" };
      // 탭이 안 보이면 크랙이 화면을 늦게 그린다. 원문 경로가 있으면 거기서 완료를 본다.
      if (apiOn && document.hidden && el >= 2) return { ok: true, el: target, by: "hidden→원문" };
      if (apiOn && !target && el >= 8) return { ok: true, el: null, by: "화면 대신 원문" };
      if (target && len >= 20 && q >= cfg.settle) return { ok: true, el: target, by: "settle" };
      if (el >= cfg.timeout) return { ok: false, el: target, by: "timeout" };
      await sleep(250);
    }
    return { ok: false, el: target, by: "abort" };
  }

  // 화면 본문의 한 조각으로 원문 메시지를 특정한다.
  // 배열 순서 가정에 의존하지 않고, 내용이 실제로 맞는 것만 채택한다.
  const squash = t => stripMd(t).replace(/\s+/g, "");
  function pickRaw(msgs, domText) {
    const probe = squash(domText).slice(40, 110);
    if (probe.length >= 20)
      for (let i = msgs.length - 1; i >= 0; i--) {
        const c = msgs[i] && msgs[i].content;
        if (c && squash(c).includes(probe)) return { msg: msgs[i], matched: true };
      }
    for (let i = msgs.length - 1; i >= 0; i--)
      if (msgs[i] && msgs[i].role !== "user" && (msgs[i].content || "").length > 20)
        return { msg: msgs[i], matched: false };
    return { msg: null, matched: false };
  }

  // ===================== 실행 =====================
  async function runTurn(n) {
    const raw = turns[n].text, isStatus = !!turns[n].isStatus;
    let mode = modeOf(raw);
    const mixed = mode === "섞기";
    if (mixed) mode = MIX[Math.floor(Math.random() * MIX.length)];
    let text = mode ? "" : resolveText(raw);
    const editor = getEditor();
    if (!editor) return { ok: false, error: "입력칸 못 찾음" };

    const before = groupIds(), t0 = Date.now();
    const remember = t => { sentHist.unshift(stripMd(t)); sentHist = sentHist.slice(0, 6); };

    if (!mode) remember(text);

    // 보내기 전, 이미 존재하는 메시지 id 를 전부 기억한다.
    // 새 응답 = 이 집합에 없던 assistant 메시지. 화면 조각 매칭보다 확실하다.
    // [이어서] 는 기존 응답이 늘어날 수도 있으므로 길이도 같이 기억한다.
    let priorIds = new Set();
    const priorLen = new Map(), priorText = new Map();
    if (apiOn) {
      try {
        for (const m of await Api.allMessages()) {
          const id = m._id || m.id || m.messageId;
          priorIds.add(id); priorLen.set(id, (m.content || "").length); priorText.set(id, m.content || "");
        }
      } catch (_) {}
    }
    let grow = null;
    if (mode === "이어서" || mode === "재생성") {
      const la = latestAnswer();
      if (la) grow = { el: la, id: la.getAttribute("data-message-group-id"), from: bodyOf(la).length, text: bodyOf(la), changed: mode === "재생성", hit: false };
    }

    if (!isEmpty(editor)) {
      editor.focus({ preventScroll: true });
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      await sleep(120);
    }
    await waitVisible();
    if (abort || state !== "running") return { ok: false, error: "정지됨" };
    let note = "", how = "", plainSend = !mode;
    if (mode === "추천") {
      const r = await useSuggestion(editor, n, mixed ? 25000 : 60000);
      if (!r.ok && mixed && !abort) {
        // 섞기에서는 추천답변이 안 되면 그 턴을 랜덤답변으로 넘긴다
        if (!isEmpty(editor)) { editor.focus({ preventScroll: true }); document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); }
        const q = pickRandom();
        mode = "랜덤"; text = q.text; how = `추천 실패(${r.error}) → ${q.how}`; remember(text); plainSend = true;
      } else if (!r.ok) return { ok: false, error: r.error };
      else {
      text = r.text;
      remember(text);
      how = r.how;
      if (!r.autoSent) {
        await typeDelay(text, n);
        await waitVisible();
        if (r.needInsert) {
          setStatus(`${n + 1}턴 · 보내는 중`, "#7dd3fc");
          if (!isEmpty(editor)) { editor.focus({ preventScroll: true }); document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); }
          if (!insertText(editor, text)) return { ok: false, error: "입력 실패 (추천)" };
        }
        await sleep(200);
        const btn = await waitForSendButton(editor);
        if (!btn || btn.disabled) return { ok: false, error: "전송 버튼 없음/비활성 (추천 후)" };
        btn.click();
        if (!(await confirmSent(editor, before))) return { ok: false, error: "보내기를 눌렀는데 안 나감 (추천)" };
      }
      }
    } else if (mode === "랜덤") {
      const r = pickRandom();
      text = r.text; how = r.how; remember(text); plainSend = true;
    } else if (mode === "재생성") {
      if (human.type) await pause(rnd(1, 3), `${n + 1}턴 · 재생성 누르는 중`, "#7dd3fc");
      await waitVisible();
      const r = await useReroll(n);
      if (!r.ok) return { ok: false, error: r.error };
      text = "(재생성)"; how = r.how;
    } else if (mode === "이어서") {
      if (human.type) await pause(rnd(1, 3), `${n + 1}턴 · 이어서 생성 누르는 중`, "#7dd3fc");
      const r = await useContinue(n);
      if (r.ok) { text = "(이어서 생성)"; how = r.how; }
      else {
        const fb = cfg.cont === "off" ? null : (cfg.cont || cfg.blank);
        if (!fb) return { ok: false, error: "이어서 생성 버튼 못 찾음 (@continue off)" };
        text = fb; how = "버튼 없음 → 침묵 입력"; remember(text); plainSend = true; grow = null;
      }
    }
    if (!plainSend) { /* 이미 전송됨 */ }
    else if (isShortcut(text)) {
      const { name, arg } = splitShortcut(text);
      setStatus(`${n + 1}턴 · 단축어 /${name}`, "#c4b5fd");
      const r = await sendShortcut(editor, name, arg);
      if (!r.ok) return { ok: false, error: r.error };
      if (arg && !r.argAttached) note = "인자 미부착(고르자마자 전송됨)";
      if (!r.found) note = (note ? note + " · " : "") + "메뉴 항목 못 찾아 Enter 로 선택";
    } else {
      setStatus(`${n + 1}턴 · 보내는 중`, "#7dd3fc");
      await typeDelay(text, n);
      await waitVisible();
      if (!insertText(editor, text)) return { ok: false, error: "입력 실패" };
      await sleep(200);
      const btn = await waitForSendButton(editor);
      if (!btn || btn.disabled) return { ok: false, error: "전송 버튼 없음/비활성" };
      btn.click();
      if (!(await confirmSent(editor, before))) return { ok: false, error: "보내기를 눌렀는데 안 나감" };
    }

    setStatus(`${n + 1}턴 · 응답 기다리는 중`, "#c4b5fd");
    const res = await waitForResponse(before, text, (e, q, l) => {
      elapsedEl.textContent = Math.round(e); quietEl.textContent = q.toFixed(1); lenEl.textContent = l;
    }, grow);
    if (grow?.hit) how += mode === "재생성" ? " · 같은 자리에서 바뀜" : " · 기존 응답에 이어 붙음";
    if (mixed) how = "섞기 · " + how;

    const rendered = res.el ? bodyOf(res.el) : "";
    let source = "DOM", content = rendered, matched = "", note2 = "";

    if (apiOn) {
      // 새 assistant 메시지가 뜨고, 그 길이가 안정될 때까지 폴링한다.
      // 이어서 생성으로 응답이 여러 조각에 나뉘어도 길이가 계속 늘면 계속 기다린다.
      const startWait = Date.now();
      let newMsg = null, lastLen = -1, lastGrow = Date.now();
      const NEED_STABLE = Math.max(3, cfg.settle) * 1000;  // 이 시간만큼 안 늘면 완성
      while (Date.now() - startWait < cfg.timeout * 1000 && !abort) {
        let msgs = [];
        try { msgs = await Api.allMessages(); } catch (_) {}
        // priorIds 에 없던 assistant 메시지 중 가장 뒤(최신)
        let cand = null;
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i], id = m && (m._id || m.id || m.messageId);
          if (!m || m.role === "user") continue;
          if (priorIds.has(id)) continue;
          if ((m.content || "").length < 1) continue;
          cand = m; break;
        }
        if (!cand && mode === "재생성")
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i], id = m && (m._id || m.id || m.messageId);
            if (!m || m.role === "user" || !priorText.has(id)) continue;
            if ((m.content || "").length >= 20 && m.content !== priorText.get(id)) { cand = m; break; }
          }
        if (!cand && mode === "이어서")
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i], id = m && (m._id || m.id || m.messageId);
            if (!m || m.role === "user" || !priorLen.has(id)) continue;
            if ((m.content || "").length > priorLen.get(id) + 5) { cand = m; break; }
          }
        if (cand) {
          newMsg = cand;
          const L = cand.content.length;
          if (L !== lastLen) { lastLen = L; lastGrow = Date.now(); }
          else if (Date.now() - lastGrow >= NEED_STABLE) break;   // 길이 안정 = 완성
        }
        await sleep(700);
      }
      if (newMsg) {
        content = newMsg.content; source = "API"; matched = "O";
      } else {
        // 새 메시지를 끝내 못 찾음 → 절대 이전 응답으로 대체하지 않는다
        source = "API(신규없음)"; matched = "X"; content = rendered;
        note2 = "새 응답 미검출";
      }
    }

    const hud = parseHud(content);
    const rec = {
      ok: true, turn: n + 1, 구분: isStatus ? "상태" : (mode || "본턴"),
      sent: text, sentAt: nowStr(),
      seconds: Math.round((Date.now() - t0) / 10) / 100,
      출처: source, 본문일치: matched, HUD: hud.있음, 칸수: hud.칸수,
      장면전환: /(^|\n)\s*---\s*(\n|$)/.test(content) ? "O" : "",
      이미지: (res.el?.querySelectorAll("img").length || 0),
      길이: content.length, 완료판정: res.by, 오류: [note, note2].filter(Boolean).join(" · "),
      응답: content, hudRaw: hud.raw || "", 입력방식: how
    };

    // HUD 칸 → 시나리오가 정한 이름으로
    hudCols().forEach((name, k) => {
      const cell = hud.cells[k] ?? "";
      const d = digit(cell);
      rec[name] = d !== "" ? d : cell;
    });
    // 사용자 정규식
    for (const g of cfg.grab) {
      const m = content.match(g.re);
      rec[g.name] = m ? (m[1] ?? m[0]).slice(0, 60) : "";
    }
    // 응답 앞 N줄
    const hl = (rendered || content).split("\n").map(s => s.trim()).filter(Boolean);
    headCols().forEach((name, k) => { rec[name] = (hl[k] || "").slice(0, 50); });
    // 감시 단어
    for (const w of cfg.watch) rec[w] = content.includes(w) ? "O" : "";

    return rec;
  }

  // ===================== 사람처럼 속도 조절 =====================
  // 탐지를 속이는 장치가 아니라, 사람이 할 법한 리듬(읽고, 쓰고, 딴짓하고, 쉬는)으로 간격을 잡는다.
  let human = { read: true, type: true, idle: true, rest: true, visible: false };
  let sinceRest = 0, nextRest = 20;
  const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const leftText = s => s >= 90 ? `${Math.ceil(s / 60)}분` : `${Math.ceil(s)}초`;
  async function pause(sec, label, tone) {
    const until = Date.now() + sec * 1000;
    while (Date.now() < until && state === "running") {
      const left = (until - Date.now()) / 1000;
      elapsedEl.textContent = Math.ceil(left);
      if (label) setStatus(`${label} · ${leftText(left)} 남았어요`, tone || "#94a3b8");
      await sleep(250);
    }
  }
  async function typeDelay(t, n) {
    if (!human.type || !t) return;
    const sec = Math.min(25, rnd(0.8, 2) + t.length * rnd(0.12, 0.25));   // 생각 + 입력
    await pause(sec, `${n + 1}턴 · 입력하는 중`, "#7dd3fc");
  }
  // 크랙은 탭이 가려지면 이전 응답 처리를 끝내지 않아 보내기 버튼이 먹지 않는다 (2026-10-28 실측).
  // 그래서 보내기·재생성처럼 화면을 건드리는 단계 전에는 탭이 보일 때까지 기다린다. 실패로 세지 않는다.
  async function waitVisible() {
    if (!document.hidden) return;
    while (document.hidden && state === "running" && !abort) {
      setStatus("크랙 탭이 가려져서 기다리는 중이에요 · 탭을 보이게 하면 이어서 해요", "#fbbf24");
      await sleep(500);
    }
    if (state === "running") await sleep(1500);   // 보이자마자 크랙이 밀린 화면을 그릴 시간
  }

  // ===================== 멈추는 기준 =====================
  // 턴 · 금액 은 턴 수가 정해지고, 시간 · 무제한 은 턴을 하나씩 늘려 가며 돈다.
  let openEnded = false, limitMs = 0, runStartAt = 0;

  async function loop() {
    while (state === "running" && (idx < turns.length || openEnded)) {
      if (openEnded) {
        if (limitMs && Date.now() - runStartAt >= limitMs) break;      // 시간 다 됨
        if (idx >= turns.length) turns.push({ text: turns[0]?.text || freeMode });
      }
      await waitVisible();
      if (state !== "running") break;
      const tStart = Date.now(); curTurnStart = tStart;
      const r = await runTurn(idx);
      if (!r.ok) {
        fails++;
        log.push({ turn: idx + 1, sent: resolveText(turns[idx].text), sentAt: nowStr(), 오류: r.error, 응답: "" });
        setStatus(`${idx + 1}턴 실패 · ${r.error}`, "#f87171");
        if (fails >= 3) { state = "error"; setStatus("3턴 연속 실패해서 멈췄어요", "#f87171"); renderTabs(); renderControls(); return; }
        idx++; await sleep(2000); durs.push(Date.now() - tStart); renderProgress(); continue;
      }
      // 원문 경로가 켜져 있는데 새 응답을 못 잡았다 = 로그가 오염됐다 → 즉시 정지
      if (apiOn && r.본문일치 === "X") {
        log.push(r); renderProgress();
        state = "error";
        setStatus(`${r.turn}턴: 새 응답을 못 찾아 멈췄어요 (기록 오염 방지)`, "#f87171");
        renderTabs(); renderControls();
        return;
      }
      fails = 0; log.push(r); idx++; renderProgress();

      const axes = hudCols().map(c => r[c]).filter(v => v !== "" && v != null).slice(0, 5).join("·");
      const hits = cfg.watch.filter(w => r[w]).join(" ");
      const flags = [
        cfg.hud.length && r.HUD === "X" && "HUD없음",
        cfg.hud.length && r.칸수 && r.칸수 !== cfg.hud.length && `칸${r.칸수}`,
        r.장면전환 && "---", r.완료판정 === "timeout" && "TIMEOUT"
      ].filter(Boolean).join(" ");
      setStatus(`${r.turn}턴 끝 ${axes} ${hits} ${flags}`.replace(/\s+/g, " ").trim(),
        ((cfg.hud.length && r.HUD === "X") || r.완료판정 === "timeout") ? "#fbbf24" : "#86efac");

      if (!openEnded && idx >= turns.length) { durs.push(Date.now() - tStart); break; }
      if (openEnded && limitMs && Date.now() - runStartAt >= limitMs) { durs.push(Date.now() - tStart); break; }

      // 다음 턴까지: 기본 간격 + 읽는 시간 (+ 가끔 딴짓)
      let wait = cfg.gapMax != null ? rnd(cfg.gap, cfg.gapMax) : cfg.gap;
      wait += (r.길이 || 0) / 1000 * (human.read ? rnd(10, 20) : (cfg.read || 0));
      let label = "";
      if (human.idle && Math.random() < 0.1) { wait += rnd(30, 120); label = "잠깐 딴짓하는 중"; }
      await pause(wait, label);
      // 중간중간 쉬기
      if (human.rest && state === "running" && ++sinceRest >= nextRest) {
        await pause(rnd(180, 480), "쉬는 중", "#fbbf24");
        sinceRest = 0; nextRest = randInt(15, 25);
      }
      if (state === "running") durs.push(Date.now() - tStart);
      renderEta();
    }
    if (state === "running") {
      state = "done";
      setStatus(openEnded && limitMs ? `정한 시간이 돼서 멈췄어요 · ${idx}턴` : `${idx}턴을 모두 끝냈어요`, "#86efac");
      renderTabs(); renderControls(); renderProgress();
    }
  }

  // ===================== 기존 대화 회수 =====================
  // 이미 진행된 방의 대화를 그대로 읽어 로그로 만든다. 전송하지 않으므로 비용 0.
  async function harvestRoom() {
    if (!apiOn) { setStatus("원문 경로가 없어 회수 불가", "#f87171"); return; }
    setStatus("대화 불러오는 중…", "#7dd3fc");
    let msgs = [];
    try { msgs = await Api.allMessages(); }
    catch (e) { setStatus("불러오기 실패: " + String(e.message).slice(0, 30), "#f87171"); return; }
    if (!msgs.length) { setStatus("메시지가 없습니다", "#f87171"); return; }

    log = []; turns = []; openEnded = false; limitMs = 0;
    let lastUser = "", n = 0;
    for (const m of msgs) {
      const c = m && m.content ? m.content : "";
      if (!c) continue;
      if (m.role === "user") { lastUser = c; continue; }

      n++;
      const hud = parseHud(c);
      const rec = {
        turn: n, 구분: "회수", sent: lastUser, sentAt: (m.createdAt || m.created_at || "").toString().slice(0, 19),
        seconds: "", 출처: "API", 본문일치: "O", HUD: hud.있음, 칸수: hud.칸수,
        장면전환: /(^|\n)\s*---\s*(\n|$)/.test(c) ? "O" : "",
        이미지: (c.match(/\{\{img::/g) || []).length,
        길이: c.length, 완료판정: "회수", 오류: "", 응답: c, hudRaw: hud.raw || ""
      };
      hudCols().forEach((name, k) => {
        const cell = hud.cells[k] ?? ""; const d = digit(cell);
        rec[name] = d !== "" ? d : cell;
      });
      for (const g of cfg.grab) { const mm = c.match(g.re); rec[g.name] = mm ? (mm[1] ?? mm[0]).slice(0, 60) : ""; }
      const hl = c.split("\n").map(x => x.trim()).filter(x => x && !x.startsWith("[//]:"));
      headCols().forEach((name, k) => { rec[name] = (hl[k] || "").slice(0, 50); });
      for (const w of cfg.watch) rec[w] = c.includes(w) ? "O" : "";

      log.push(rec); lastUser = "";
    }
    turns = new Array(log.length);
    idx = log.length; state = "done"; renderProgress(); renderControls();
    const okHud = log.filter(r => r.HUD === "O").length;
    const uniq = new Set(log.map(r => r.길이)).size;
    setStatus(`응답 ${log.length}건 회수 · HUD ${okHud} · 고유 ${uniq}`,
      uniq > 1 ? "#86efac" : "#fbbf24");
  }

  // ===================== 내보내기 =====================
  const esc = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const buildCsv = () => { const C = cols(); return "\uFEFF" + [C.join(","), ...log.map(r => C.map(c => esc(r[c])).join(","))].join("\n"); };

  function buildMd() {
    const show = ["turn", "sent", "HUD", "칸수", ...hudCols(), ...cfg.watch, "장면전환", "길이"];
    const L = [`# ${cfg.name}`, "", `- 모델: ${cfg.model || "-"}`, `- 시나리오: ${cfg.scenario || "-"}`,
      `- 턴: ${log.length} / ${turns.length}`,
      `- 원문 출처: ${apiOn ? "API (주석 포함)" : "DOM (주석 없음)"}`, "",
      "| " + show.join(" | ") + " |", "|" + show.map(() => "---").join("|") + "|"];
    for (const r of log)
      L.push("| " + show.map(c => String(r[c] ?? "").replace(/\|/g, "\\|").slice(0, 22)).join(" | ") + " |");
    L.push("", "---", "", "## 전문 (원문)", "");
    for (const r of log) {
      L.push(`### t${r.turn} ${r.구분 || ""} ${r.sentAt || ""}${r.완료판정 === "timeout" ? "  ⚠TIMEOUT" : ""}`, "",
        "**보낸 것**", "", "```", String(r.sent || ""), "```", "");
      if (r.오류) L.push(`**오류**: ${r.오류}`, "");
      L.push("**응답 원문**", "", "```markdown", String(r.응답 || "(없음)"), "```", "", "---", "");
    }
    return L.join("\n");
  }

  function download(fn, c, mime) {
    const url = URL.createObjectURL(new Blob([c], { type: mime + ";charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = fn;
    document.documentElement.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const safeName = () => { const d = new Date();
    if (!cfg.name || cfg.name === "이름없음") cfg.name = "회수_" + String(chatroomId || "").slice(-6);
    return `${cfg.name}_${d.getMonth() + 1}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`.replace(/[^\w가-힣.\-]/g, "_"); };

  // ===================== UI =====================
  // 오토세이버와 같은 맥 스타일: 유리 패널, Apple 색, 세그먼트 컨트롤, 해요체.
  // Shadow DOM 안에 그려서 크랙 페이지나 다른 확장의 CSS 가 섞이지 않게 한다.
  document.querySelector("#" + PANEL_ID)?.remove();
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = "all:initial;";
  const shadow = panel.attachShadow({ mode: "open" });

  const ICON = {
    auto:  '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5v13a6.5 6.5 0 0 0 0-13z" fill="currentColor" stroke="none"/></svg>',
    light: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="3.6"/><path d="M10 2.2v2M10 15.8v2M2.2 10h2M15.8 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M4.5 15.5l1.4-1.4M14.1 5.9l1.4-1.4"/></svg>',
    dark:  '<svg viewBox="0 0 20 20"><path d="M15.8 12.6A6.6 6.6 0 0 1 7.4 4.2a6.6 6.6 0 1 0 8.4 8.4z"/></svg>',
    fold:  '<svg viewBox="0 0 20 20"><path d="M5 10h10"/></svg>',
    unfold:'<svg viewBox="0 0 20 20"><path d="M5.5 8l4.5 4.5L14.5 8"/></svg>',
    close: '<svg viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8"/></svg>',
    trash: '<svg viewBox="0 0 20 20"><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6"/></svg>',
    plus:  '<svg viewBox="0 0 20 20"><path d="M10 5v10M5 10h10"/></svg>'
  };

  shadow.innerHTML = `
  <style>
    :host { all: initial; }
    .win {
      --accent:#007AFF; --accent-soft:rgba(0,122,255,.12); --text:#1D1D1F; --text2:#6E6E73; --text3:rgba(60,60,67,.36);
      --sep:rgba(60,60,67,.14); --fill:rgba(120,120,128,.12); --fill2:rgba(120,120,128,.2); --card:rgba(255,255,255,.88);
      --glass:rgba(242,242,247,.9); --glass-border:rgba(255,255,255,.65); --ring:rgba(0,0,0,.1);
      --seg-on:#FFFFFF; --ok:#34C759; --warn:#FF9500; --danger:#FF3B30; --shadow:0 22px 60px rgba(0,0,0,.22);
      color-scheme: light;
    }
    .win[data-theme="dark"] {
      --accent:#0A84FF; --accent-soft:rgba(10,132,255,.2); --text:#F5F5F7; --text2:#A1A1A6; --text3:rgba(235,235,245,.32);
      --sep:rgba(84,84,88,.55); --fill:rgba(120,120,128,.24); --fill2:rgba(120,120,128,.34); --card:rgba(44,44,46,.66);
      --glass:rgba(30,30,32,.76); --glass-border:rgba(255,255,255,.1); --ring:rgba(0,0,0,.5);
      --seg-on:#636366; --ok:#30D158; --warn:#FF9F0A; --danger:#FF453A; --shadow:0 22px 60px rgba(0,0,0,.55);
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .win {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; width: 320px; max-height: calc(100vh - 24px);
      display: flex; flex-direction: column; color: var(--text);
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Pretendard", "Malgun Gothic", system-ui, sans-serif;
      letter-spacing: -0.01em; word-break: keep-all; -webkit-font-smoothing: antialiased;
      background: var(--glass); border: 0.5px solid var(--glass-border); border-radius: 16px;
      -webkit-backdrop-filter: blur(30px) saturate(180%); backdrop-filter: blur(30px) saturate(180%);
      box-shadow: 0 0 0 0.5px var(--ring), var(--shadow);
    }
    button, input, select { font: inherit; color: inherit; letter-spacing: inherit; }
    svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

    /* 제목줄 */
    .head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 10px 16px; cursor: grab; user-select: none; }
    .head:active { cursor: grabbing; }
    .titles { flex: 1; min-width: 0; }
    .title { font-size: 15px; font-weight: 700; }
    .sub { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text2); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text3); flex: none; }
    .dot[data-tone="ok"] { background: var(--ok); } .dot[data-tone="warn"] { background: var(--warn); }
    .icon { width: 26px; height: 26px; border: none; border-radius: 13px; background: var(--fill); color: var(--text2);
      display: inline-flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; flex: none; }
    .icon:hover { background: var(--fill2); color: var(--text); }
    .icon.danger:hover { color: var(--danger); }

    .body { padding: 2px 12px 12px; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 10px;
      flex: 1 1 auto; min-height: 0; scrollbar-width: thin; }
    .body > * { flex: none; }

    /* 세그먼트 컨트롤 */
    .seg { display: flex; padding: 2px; border-radius: 9px; background: var(--fill); gap: 2px; }
    .seg button { flex: 1; min-width: 0; border: none; background: transparent; border-radius: 7px; padding: 5px 4px;
      font-size: 12.5px; font-weight: 500; cursor: pointer; white-space: nowrap; color: var(--text); }
    .seg button[aria-pressed="true"] { background: var(--seg-on); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 0 0 .5px rgba(0,0,0,.04); }
    .seg button:disabled { opacity: .45; cursor: default; }

    .seg.mini button { font-size: 12px; padding: 3px 2px; }
    .row .k small { display: block; font-size: 11px; color: var(--text2); line-height: 1.35; margin-top: 1px; }
    .switch { position: relative; width: 38px; height: 23px; flex: none; }
    .switch input { opacity: 0; width: 0; height: 0; position: absolute; }
    .switch .slider { position: absolute; inset: 0; cursor: pointer; background: var(--fill2); border-radius: 999px; transition: background .2s; }
    .switch .slider::before { content: ""; position: absolute; width: 19px; height: 19px; left: 2px; top: 2px; background: #fff; border-radius: 50%;
      box-shadow: 0 2px 5px rgba(0,0,0,.18), 0 1px 1px rgba(0,0,0,.12); transition: transform .22s cubic-bezier(.3,.7,.4,1); }
    .switch input:checked + .slider { background: var(--ok); }
    .switch input:checked + .slider::before { transform: translateX(15px); }
    .switch input:disabled + .slider { opacity: .5; cursor: default; }
    .label { font-size: 11.5px; font-weight: 600; color: var(--text2); margin: 0 4px 5px; }
    .help { font-size: 12px; color: var(--text2); margin: 6px 4px 0; line-height: 1.45; }

    /* iOS 설정식 묶음 목록 */
    .list { border-radius: 10px; background: var(--card); overflow: hidden; }
    .row { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 10px 4px 12px; position: relative; }
    .row + .row::before { content: ""; position: absolute; top: 0; left: 12px; right: 0; border-top: 0.5px solid var(--sep); }
    .row > .k { flex: 1; font-size: 13px; }
    .row input[type="number"] { width: 52px; text-align: right; border: none; border-radius: 6px; background: var(--fill); padding: 3px 7px; outline: none; }
    .row input[type="number"]:focus, .row select:focus { box-shadow: 0 0 0 3px var(--accent-soft); }
    .row .pair { display: inline-flex; align-items: center; gap: 4px; color: var(--text2); font-size: 12.5px; }
    .row .pair input { width: 40px; }
    .row .pair input#price { width: 60px; }
    .row select { max-width: 170px; border: none; border-radius: 6px; background: var(--fill); padding: 4px 6px; outline: none; cursor: pointer; }
    .row select.grow { flex: 1; max-width: none; }
    .row.link { color: var(--accent); cursor: pointer; gap: 6px; }
    .row.link:hover { background: var(--fill); }
    .meta { font-size: 12px; color: var(--text2); margin: 6px 4px 0; line-height: 1.5; }
    .meta b { color: var(--text); font-weight: 600; }
    .meta .bad { color: var(--danger); }

    /* 진행 카드 */
    .card { border-radius: 12px; background: var(--card); padding: 12px 12px 10px; }
    .prog-top { display: flex; align-items: baseline; gap: 4px; }
    .big { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1; }
    .of { font-size: 13px; color: var(--text2); }
    .eta { margin-left: auto; text-align: right; font-size: 12px; color: var(--text2); line-height: 1.35; font-variant-numeric: tabular-nums; }
    .eta b { color: var(--text); font-weight: 600; }
    .bar { height: 4px; border-radius: 2px; background: var(--fill); overflow: hidden; margin: 10px 0 8px; }
    .bar i { display: block; height: 100%; width: 0; background: var(--accent); border-radius: 2px; transition: width .3s ease; }
    .status { font-size: 12.5px; font-weight: 600; color: var(--text2); }
    .status[data-tone="ok"] { color: var(--ok); } .status[data-tone="warn"] { color: var(--warn); }
    .status[data-tone="danger"] { color: var(--danger); } .status[data-tone="info"] { color: var(--accent); }
    .cost { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--text2); margin-top: 8px; padding-top: 8px; border-top: 0.5px solid var(--sep); font-variant-numeric: tabular-nums; }
    .cost b { color: var(--text); font-weight: 600; }
    .cost:empty { display: none; }
    .stats { font-size: 11.5px; color: var(--text3); margin-top: 2px; font-variant-numeric: tabular-nums; }

    /* 버튼 */
    .actions, .secondary { display: flex; gap: 6px; flex-wrap: wrap; }
    .btn { flex: 1; min-width: 0; height: 32px; border: none; border-radius: 8px; padding: 0 10px; font-size: 13px; font-weight: 600; cursor: pointer;
      background: var(--fill); color: var(--text); white-space: nowrap; }
    .btn:hover { background: var(--fill2); }
    .btn:active { opacity: .75; }
    .btn.primary { background: var(--accent); color: #fff; }
    .btn.primary:hover { filter: brightness(1.08); }
    .btn.danger { color: var(--danger); }
    .secondary .btn { height: 28px; font-size: 12px; font-weight: 500; }
    .foot { font-size: 11px; color: var(--text3); text-align: center; margin: 0; }

    .win[data-folded="true"] .body { display: none; }
  </style>

  <div class="win" id="root" hidden>
    <div class="head" id="head">
      <div class="titles">
        <div class="title">크랙 자동 진행</div>
        <div class="sub"><span class="dot" id="dot"></span><span id="sub">연결 확인 중이에요</span></div>
      </div>
      <button class="icon" id="theme" title="테마"></button>
      <button class="icon" id="fold" title="접기"></button>
      <button class="icon" id="close" title="닫기 (툴박스 팝업의 QA 러너 「열기」로 다시 열어요)">${ICON.close}</button>
    </div>

    <div class="body" id="body">
      <div class="seg" id="tabs">
        <button data-tab="free" aria-pressed="true">자유 진행</button>
        <button data-tab="scn" aria-pressed="false">시나리오</button>
      </div>

      <section id="tab-free">
        <div class="label">넘기는 방식</div>
        <div class="seg" id="mode">
          <button data-mode="[추천]" aria-pressed="true" title="추천답변">추천</button>
          <button data-mode="[랜덤]" aria-pressed="false" title="랜덤답변">랜덤</button>
          <button data-mode="[이어서]" aria-pressed="false" title="이어서 생성">이어서</button>
          <button data-mode="[재생성]" aria-pressed="false" title="마지막 응답 다시 뽑기">재생성</button>
          <button data-mode="[섞기]" aria-pressed="false" title="매 턴 무작위로">섞기</button>
        </div>
        <p class="help" id="mode-help"></p>
        <div class="list" style="margin-top:10px">
          <div class="row"><span class="k">멈추는 기준</span>
            <div class="seg mini" id="limit" style="width:178px">
              <button data-limit="턴" aria-pressed="true">턴</button><button data-limit="금액" aria-pressed="false">금액</button>
              <button data-limit="시간" aria-pressed="false">시간</button><button data-limit="무제한" aria-pressed="false">무제한</button></div></div>
          <div class="row" id="limit-row"><span class="k" id="limit-k">턴 수</span>
            <span class="pair"><input id="n" type="number" min="1" max="100000" value="30" style="width:64px"><span id="limit-unit">턴</span></span></div>
          <div class="row"><span class="k">다음 턴까지</span>
            <span class="pair"><input id="gmin" type="number" min="0" max="600" step="0.5" value="1">~<input id="gmax" type="number" min="0" max="600" step="0.5" value="5">초</span></div>
          <div class="row"><span class="k">작품 설정</span><select id="borrow" title="고른 시나리오의 @hud·@watch·@pool·@read 를 빌려 써요"><option value="">없음</option></select></div>
        </div>
        <p class="meta" id="free-meta"></p>
      </section>

      <section id="tab-scn" hidden>
        <div class="list">
          <div class="row"><select id="pick" class="grow"><option value="">시나리오를 골라 주세요</option></select>
            <button class="icon danger" id="del" title="목록에서 지우기">${ICON.trash}</button></div>
          <label class="row link" for="file">${ICON.plus}<span>시나리오 txt 추가하기</span></label>
        </div>
        <input id="file" type="file" accept=".txt,.md" multiple hidden>
        <p class="meta" id="meta">시나리오를 고르면 여기에 내용이 보여요.</p>
      </section>

      <div>
        <div class="label">사람처럼</div>
        <div class="list">
          <div class="row"><span class="k">읽는 시간<small>응답 1000자당 10~20초 더 기다려요</small></span>
            <label class="switch"><input type="checkbox" data-human="read"><span class="slider"></span></label></div>
          <div class="row"><span class="k">쓰는 시간<small>보내기 전 글자 수만큼 잠깐 기다려요</small></span>
            <label class="switch"><input type="checkbox" data-human="type"><span class="slider"></span></label></div>
          <div class="row"><span class="k">가끔 딴짓<small>10번에 1번쯤 30초~2분 멈춰요</small></span>
            <label class="switch"><input type="checkbox" data-human="idle"><span class="slider"></span></label></div>
          <div class="row"><span class="k">중간중간 쉬기<small>15~25턴마다 3~8분 쉬어요</small></span>
            <label class="switch"><input type="checkbox" data-human="rest"><span class="slider"></span></label></div>

        </div>
      </div>

      <div class="list">
        <div class="row"><span class="k">작은 창으로 떼기<small>크랙은 탭이 가려지면 멈춰요. 따로 창으로 떼서 화면 구석에 보이게 두면 다른 일 하면서도 돌아가요.</small></span>
          <button class="btn" id="detach" style="flex:none;height:28px;font-size:12px">떼기</button></div>
      </div>

      <div class="list">
        <div class="row"><span class="k">턴당 비용</span>
          <span class="pair" title="파워챗 기본 출력량 기준 25원. 모델·출력량에 맞게 바꿔 주세요"><input id="price" type="number" min="0" max="100000" step="1" value="25">원</span></div>
      </div>

      <div class="card">
        <div class="prog-top">
          <span class="big" id="progress">0</span><span class="of" id="of">/ 0턴</span>
          <span class="eta" id="eta"></span>
        </div>
        <div class="bar"><i id="bar"></i></div>
        <div class="status" id="status">대기 중이에요</div>
        <div class="stats"><span id="elapsed">0</span>초 · 정적 <span id="quiet">0.0</span>초 · <span id="len">0</span>자</div>
        <div class="cost" id="cost"></div>
      </div>

      <div class="actions" id="controls"></div>
      <div class="secondary" id="controls2"></div>
      <p class="foot">Esc를 누르면 바로 멈춰요 · 창을 닫아도 진행은 계속돼요</p>
    </div>
  </div>`;
  document.documentElement.appendChild(panel);

  const $ = s => shadow.querySelector(s);
  const statusEl = $("#status"), elapsedEl = $("#elapsed"), quietEl = $("#quiet"), lenEl = $("#len"),
        progressEl = $("#progress"), ofEl = $("#of"), barEl = $("#bar"), etaEl = $("#eta"), metaEl = $("#meta"),
        freeMetaEl = $("#free-meta"), controlsEl = $("#controls"), controls2El = $("#controls2"),
        pickEl = $("#pick"), borrowEl = $("#borrow"), subEl = $("#sub"), dotEl = $("#dot"),
        rootEl = $("#root"), headEl = $("#head");

  // 기존 코드가 넘기는 색 코드를 의미로 바꾼다
  const TONE = { "#f87171": "danger", "#fca5a5": "danger", "#fbbf24": "warn", "#86efac": "ok",
                 "#7dd3fc": "info", "#c4b5fd": "info", "#94a3b8": "" };
  // 진행 기록: 상태가 바뀔 때마다 이 페이지의 localStorage 에 남긴다 (최근 300줄).
  // 멈췄을 때 어디서 멈췄는지 보려고. 키: crack_qa_debug
  const DBG_KEY = "crack_qa_debug";
  let dbg = []; try { dbg = JSON.parse(localStorage.getItem(DBG_KEY) || "[]"); } catch (_) {}
  let dbgLast = "", dbgTimer = 0;
  function debugLog(t) {
    const line = t.replace(/ · \d+(초|분) 남았어요$/, "");
    if (line === dbgLast) return; dbgLast = line;
    const d = new Date();
    dbg.push(`${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${document.hidden ? "[숨김] " : ""}${state} ${idx}/${openEnded ? "∞" : turns.length} ${line}`);
    if (dbg.length > 300) dbg = dbg.slice(-300);
    clearTimeout(dbgTimer);
    dbgTimer = setTimeout(() => { try { localStorage.setItem(DBG_KEY, JSON.stringify(dbg)); } catch (_) {} }, 500);
  }
  function setStatus(t, c) { statusEl.textContent = t; statusEl.dataset.tone = TONE[c] ?? ""; try { debugLog(t); } catch (_) {} }

  // ---------- 탭 · 방식 ----------
  let tab = "free", freeMode = "[추천]";
  const MODE_HELP = {
    "[추천]": "응답 아래 뜨는 추천 3개 중 하나를 골라 보내요. 안 뜨는 방이면 추천답변 버튼을 먼저 눌러요.",
    "[랜덤]": "정해 둔 문장 중 하나를 무작위로 보내요. 작품 설정에 @pool 이 있으면 그걸 써요.",
    "[이어서]": "유저가 아무것도 안 하는 턴이에요. 응답이 잘려 '이어서 생성'이 보이면 그걸 누르고, 아니면 침묵 문구를 보내요.",
    "[재생성]": "마지막 응답의 ↻ 버튼을 눌러 같은 입력에서 다시 뽑아요. 이야기는 앞으로 안 나가요.",
    "[섞기]": "매 턴 추천 · 랜덤 · 이어서 · 재생성 중 하나를 무작위로 골라요. 재생성은 다른 것의 절반만 나와요. 추천이 안 되는 턴은 랜덤으로 넘겨요."
  };
  const busy = () => state === "running" || state === "paused";
  function pressSeg(box, attr, val) {
    for (const b of box.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset[attr] === val));
  }
  function renderTabs() {
    pressSeg($("#tabs"), "tab", tab);
    pressSeg($("#mode"), "mode", freeMode);
    $("#tab-free").hidden = tab !== "free";
    $("#tab-scn").hidden = tab !== "scn";
    $("#mode-help").textContent = MODE_HELP[freeMode];
    for (const b of shadow.querySelectorAll("#tabs button, #mode button")) b.disabled = busy();
    for (const el of shadow.querySelectorAll("#n, #gmin, #gmax, #borrow, #pick, #del, #limit button")) el.disabled = busy();
  }
  $("#tabs").onclick = e => {
    const b = e.target.closest("button[data-tab]"); if (!b || busy()) return;
    tab = b.dataset.tab;
    if (tab === "scn") { if (pickEl.value && saved[pickEl.value]) loadScenario(saved[pickEl.value]); else { turns = []; idx = 0; log = []; state = "idle"; } }
    else prepareFree();
    renderTabs(); renderProgress(); renderControls();
  };
  $("#mode").onclick = e => {
    const b = e.target.closest("button[data-mode]"); if (!b || busy()) return;
    freeMode = b.dataset.mode; renderTabs(); prepareFree(); renderControls(); saveUi();
  };
  // 버튼은 다시 그리지 않는다: 숫자를 고치고 바로 '시작'을 누르면, 입력칸이 포커스를 잃으며
  // change 가 먼저 터지고 그때 버튼을 새로 만들면 누른 클릭이 허공에 떨어진다.
  for (const id of ["#n", "#gmin", "#gmax"]) $(id).addEventListener("change", () => { if (!busy()) prepareFree(); });
  borrowEl.onchange = () => {
    if (busy()) return;
    const c = borrowEl.value && saved[borrowEl.value] ? parseScenario(saved[borrowEl.value]).cfg : null;
    if (c) { $("#gmin").value = c.gap; $("#gmax").value = c.gapMax != null ? c.gapMax : c.gap; }
    prepareFree(); renderControls();
  };

  // 멈추는 기준
  let limitKind = "턴";
  const limitVals = { "턴": 30, "금액": 1000, "시간": 30 };
  const LIMIT_UI = { "턴": ["턴 수", "턴"], "금액": ["쓸 금액", "원"], "시간": ["진행 시간", "분"] };
  function renderLimit() {
    pressSeg($("#limit"), "limit", limitKind);
    $("#limit-row").hidden = limitKind === "무제한";
    if (LIMIT_UI[limitKind]) {
      $("#limit-k").textContent = LIMIT_UI[limitKind][0]; $("#limit-unit").textContent = LIMIT_UI[limitKind][1];
      $("#n").value = limitVals[limitKind];
    }
  }
  $("#limit").onclick = e => {
    const b = e.target.closest("button[data-limit]"); if (!b || busy()) return;
    limitKind = b.dataset.limit; renderLimit(); prepareFree(); saveUi();
  };
  $("#n").addEventListener("input", () => { const v = parseFloat($("#n").value); if (v > 0 && LIMIT_UI[limitKind]) limitVals[limitKind] = v; });

  // 사람처럼 스위치
  for (const cb of shadow.querySelectorAll("input[data-human]")) {
    cb.addEventListener("change", () => { human[cb.dataset.human] = cb.checked; saveUi(); });
  }
  const renderHuman = () => { for (const cb of shadow.querySelectorAll("input[data-human]")) cb.checked = !!human[cb.dataset.human]; };

  $("#detach").onclick = () => {
    try { chrome.runtime.sendMessage({ type: "CRACK_QA_DETACH" }); } catch (_) {}
  };
  const UI_KEY = "crack_qa_ui";
  function saveUi() { try { chrome.storage.local.set({ [UI_KEY]: { human, limitKind, limitVals, freeMode } }); } catch (_) {} }

  // 자유 진행: 방식·멈추는 기준·간격으로 턴 목록을 만든다. 작품 설정은 고른 시나리오에서 빌린다.
  function prepareFree() {
    if (busy()) return;
    const base = borrowEl.value && saved[borrowEl.value] ? parseScenario(saved[borrowEl.value]).cfg : DEFAULTS();
    cfg = base;
    let a = parseFloat($("#gmin").value), b = parseFloat($("#gmax").value);
    if (isNaN(a)) a = 1; if (isNaN(b)) b = a;
    cfg.gap = Math.max(0, Math.min(a, b)); cfg.gapMax = Math.max(a, b) > cfg.gap ? Math.max(a, b) : null;
    const v = Math.max(1, parseFloat($("#n").value) || limitVals[limitKind] || 30);
    if (LIMIT_UI[limitKind]) limitVals[limitKind] = v;
    openEnded = limitKind === "시간" || limitKind === "무제한";
    limitMs = limitKind === "시간" ? v * 60000 : 0;
    const nT = openEnded ? 0
      : limitKind === "금액" ? Math.max(1, Math.floor(v / (price || 1)))
      : Math.max(1, Math.min(100000, Math.round(v)));
    if (!borrowEl.value || !cfg.name || cfg.name === "이름없음") cfg.name = "자유진행_" + modeOf(freeMode);
    else cfg.name = cfg.name + "_자유진행_" + modeOf(freeMode);
    turns = Array.from({ length: nT }, () => ({ text: freeMode }));
    idx = 0; log = []; state = "idle"; fails = 0; durs = []; sinceRest = 0; nextRest = randInt(15, 25);
    const bits = [
      cfg.hud.length && `HUD ${cfg.hud.length}칸`, cfg.watch.length && `감시 단어 ${cfg.watch.length}개`,
      (freeMode === "[랜덤]" || freeMode === "[섞기]") && (cfg.pool.length ? `랜덤 문장 ${cfg.pool.length}개(@pool)` : `랜덤 문장 ${DEFAULT_POOL.length.toLocaleString()}개`),
      cfg.read && `1000자당 +${cfg.read}초`
    ].filter(Boolean);
    freeMetaEl.innerHTML = borrowEl.value
      ? `<b>${escHtml(borrowEl.value)}</b> 설정을 빌려 써요${bits.length ? " · " + bits.join(" · ") : ""}`
      : (bits.length ? bits.join(" · ") : "작품 설정 없이 진행해요. HUD 칸은 비워 둬요.");
    renderProgress();
    setStatus("시작을 누르면 진행해요");
  }
  const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- 진행 · 예상 시간 ----------
  let durs = [], curTurnStart = 0;   // 턴 하나(전송~다음 턴 직전)에 걸린 시간 ms

  function fmtLeft(ms) {
    const m = Math.round(ms / 60000);
    if (ms < 60000) return "1분 안";
    if (m < 60) return `약 ${m}분`;
    return `약 ${Math.floor(m / 60)}시간 ${m % 60 ? (m % 60) + "분" : ""}`.trim();
  }
  const avgDur = () => {
    const arr = human.rest ? durs : durs.slice(-6);           // 쉬는 시간이 섞이면 전체 평균이 더 맞다
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  };
  function renderEta() {
    if (openEnded) {
      const el = Date.now() - runStartAt;
      if (state === "paused") { etaEl.innerHTML = "일시정지 중이에요"; return; }
      if (state === "running" && limitMs) {
        const ms = Math.max(0, limitMs - el), end = new Date(runStartAt + limitMs);
        etaEl.innerHTML = `<b>${fmtLeft(ms)}</b> 남았어요<br>${pad2(end.getHours())}:${pad2(end.getMinutes())}에 멈춰요`;
      } else if (state === "running") {
        etaEl.innerHTML = (el < 60000 ? "방금 시작했어요" : `진행 <b>${fmtLeft(el).replace(/^약 /, "")}</b>째`) + "<br>멈출 때까지 계속해요";
      } else if (state === "done" || state === "idle" && durs.length) {
        etaEl.innerHTML = durs.length ? `${fmtLeft(durs.reduce((a, b) => a + b, 0)).replace(/^약 /, "")} 동안 했어요` : "";
      } else etaEl.innerHTML = limitMs ? `${Math.round(limitMs / 60000)}분 동안 진행해요` : "직접 멈출 때까지 진행해요";
      return;
    }
    const left = turns.length - idx;
    if (state === "paused") { etaEl.innerHTML = "일시정지 중이에요"; return; }
    if (state !== "running" || left <= 0) {
      const tot = durs.reduce((a, b) => a + b, 0);
      etaEl.innerHTML = state === "done" && durs.length
        ? (tot < 60000 ? "1분 안에 끝났어요" : `${fmtLeft(tot).replace(/^약 /, "")} 걸렸어요`) : "";
      return;
    }
    if (!durs.length) { etaEl.innerHTML = "남은 시간 계산 중…<br>첫 턴이 끝나면 보여요"; return; }
    const avg = avgDur();
    const ms = Math.max(0, left * avg - (Date.now() - curTurnStart));
    const end = new Date(Date.now() + ms);
    etaEl.innerHTML = `<b>${fmtLeft(ms)}</b> 남았어요<br>${pad2(end.getHours())}:${pad2(end.getMinutes())}쯤 끝나요`;
  }
  setInterval(() => { renderEta(); renderSub(); keepAwake(); }, 1000);
  // 진행 중일 때만 탭을 '안 재움'으로 잠근다 (배경 스크립트가 처리)
  let awake = false;
  function keepAwake() {
    const want = busy();
    if (want === awake) return;
    awake = want;
    try { chrome.runtime.sendMessage({ type: "CRACK_QA_KEEPALIVE", on: want }); } catch (_) {}
  }

  // ---------- 예상 비용 ----------
  const PRICE_KEY = "crack_qa_price";
  let price = 25;
  const won = n => Math.round(n).toLocaleString("ko-KR") + "원";
  function renderCost() {
    const el = $("#cost");
    const sentTurns = log.filter(r => r.구분 !== "회수" && r.sent != null).length;
    if (log.some(r => r.구분 === "회수")) { el.innerHTML = ""; return; }
    if (openEnded) {
      const spent = won(sentTurns * price);
      const perHour = durs.length ? won(3600000 / avgDur() * price) : null;
      if (limitMs && durs.length) {
        const remainTurns = Math.max(0, (limitMs - (Date.now() - runStartAt)) / avgDur());
        el.innerHTML = `<span>예상 약 <b>${won((sentTurns + (state === "running" ? remainTurns : 0)) * price)}</b></span><span>지금까지 <b>${spent}</b></span>`;
      } else
        el.innerHTML = `<span>지금까지 <b>${spent}</b></span><span>${perHour ? `시간당 약 ${perHour}` : limitMs ? "첫 턴 뒤에 예상해요" : "멈출 때까지 쌓여요"}</span>`;
      return;
    }
    if (!turns.length) { el.innerHTML = ""; return; }
    const total = turns.length * price;
    el.innerHTML = busy() || state === "done" || state === "error"
      ? `<span>예상 <b>${won(total)}</b></span><span>지금까지 <b>${won(sentTurns * price)}</b> · 남은 ${won(Math.max(0, turns.length - idx) * price)}</span>`
      : `<span>예상 <b>${won(total)}</b></span><span>${turns.length}턴 × ${won(price)}</span>`;
  }
  $("#price").addEventListener("input", () => {
    const v = parseFloat($("#price").value);
    if (!isNaN(v) && v >= 0) {
      price = v; if (tab === "free" && limitKind === "금액" && !busy()) prepareFree();
      renderCost(); try { chrome.storage.local.set({ [PRICE_KEY]: price }); } catch (_) {}
    }
  });
  try { chrome.storage.local.get(PRICE_KEY).then(r => { if (typeof r?.[PRICE_KEY] === "number") { price = r[PRICE_KEY]; $("#price").value = price; renderCost(); } }); } catch (_) {}

  function renderProgress() {
    renderCost();
    progressEl.textContent = idx;
    const el = runStartAt && (busy() || state === "done") ? Date.now() - runStartAt : 0;
    if (openEnded) {
      ofEl.textContent = limitMs ? `턴 · ${Math.round(limitMs / 60000)}분 동안` : "턴 · 무제한";
      barEl.style.width = limitMs ? Math.min(100, el / limitMs * 100) + "%" : "0%";
    } else {
      ofEl.textContent = `/ ${turns.length}턴`;
      barEl.style.width = turns.length ? (idx / turns.length * 100) + "%" : "0%";
    }
    renderEta(); renderSub();
  }

  // ---------- 버튼 ----------
  function btn(label, kind, f, title) {
    const b = document.createElement("button"); b.className = "btn" + (kind ? " " + kind : ""); b.textContent = label;
    if (title) b.title = title; b.onclick = f; return b;
  }
  async function startRun() {
    if (tab === "free") prepareFree();
    if (!turns.length && !openEnded) return;
    setStatus("방을 확인하고 있어요", "#94a3b8");
    await connectRoom();
    runStartAt = Date.now();
    state = "running"; abort = false; renderTabs(); renderControls(); setStatus("진행 중이에요", "#86efac"); loop();
  }
  function renderControls() {
    controlsEl.innerHTML = ""; controls2El.innerHTML = "";
    if (state === "idle" && (turns.length || (tab === "free" && openEnded))) controlsEl.appendChild(btn("시작", "primary", startRun));
    else if (state === "running") {
      controlsEl.appendChild(btn("일시정지", "", () => { state = "paused"; renderTabs(); renderControls(); setStatus("일시정지했어요", "#fbbf24"); renderEta(); }));
      controlsEl.appendChild(btn("정지", "danger", stopAll));
    } else if (state === "paused") {
      controlsEl.appendChild(btn("이어서 하기", "primary", () => { state = "running"; renderTabs(); renderControls(); setStatus("진행 중이에요", "#86efac"); loop(); }));
      controlsEl.appendChild(btn("정지", "danger", stopAll));
    } else if ((state === "done" || state === "error") && (turns.length || openEnded)) {
      controlsEl.appendChild(btn("처음부터", "primary", () => {
        idx = 0; log = []; state = "idle"; fails = 0; durs = [];
        if (tab === "free") prepareFree();
        renderTabs(); renderProgress(); renderControls(); setStatus("대기 중이에요");
      }));
    }
    if (log.length) {
      controls2El.appendChild(btn("CSV 저장", "", () => download(safeName() + ".csv", buildCsv(), "text/csv")));
      controls2El.appendChild(btn("전문 저장", "", () => download(safeName() + ".md", buildMd(), "text/markdown"), "보낸 것과 응답 원문 전체 (.md)"));
    }
    if (!busy())
      controls2El.appendChild(btn("이 방 대화 회수", "", harvestRoom, "이미 진행한 대화를 보내지 않고 기록으로만 뽑아요 (비용 없음)"));
  }
  function stopAll() { state = "idle"; abort = true; renderTabs(); renderControls(); setStatus(`멈췄어요 · ${idx}턴 기록됨`, "#fca5a5"); renderEta(); }

  // ---------- 테마 (자동 = 크랙 화면을 따라감) ----------
  const THEME_KEY = "crack_qa_theme", FOLD_KEY = "crack_qa_fold";
  let themePref = "auto";
  const pageDark = () => {
    const h = document.documentElement;
    const t = (h.getAttribute("data-theme") || "").toLowerCase();
    if (t === "dark" || h.classList.contains("dark")) return true;
    if (t === "light" || h.classList.contains("light")) return false;
    return matchMedia("(prefers-color-scheme: dark)").matches;
  };
  function applyTheme() {
    rootEl.dataset.theme = themePref === "auto" ? (pageDark() ? "dark" : "light") : themePref;
    const b = $("#theme");
    b.innerHTML = ICON[themePref];
    b.title = { auto: "테마: 자동 (크랙 화면을 따라가요)", light: "테마: 라이트", dark: "테마: 다크" }[themePref];
  }
  $("#theme").onclick = () => {
    themePref = { auto: "light", light: "dark", dark: "auto" }[themePref];
    applyTheme(); try { chrome.storage.local.set({ [THEME_KEY]: themePref }); } catch (_) {}
  };
  new MutationObserver(() => { if (themePref === "auto") applyTheme(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (themePref === "auto") applyTheme(); }); } catch (_) {}

  // ---------- 접기 ----------
  let folded = false;
  function applyFold() {
    rootEl.dataset.folded = String(folded);
    $("#fold").innerHTML = folded ? ICON.unfold : ICON.fold;
    $("#fold").title = folded ? "펼치기" : "접기";
    renderSub();
  }
  $("#fold").onclick = () => { folded = !folded; applyFold(); try { chrome.storage.local.set({ [FOLD_KEY]: folded }); } catch (_) {} };

  // 제목줄 아랫줄: 평소엔 연결 상태, 접혀 있으면 진행 상황
  let connText = "연결 확인 중이에요", connTone = "";
  function renderSub() {
    if (folded && (turns.length || openEnded) && (busy() || state === "done")) {
      const left = etaEl.textContent.match(/(약 [^남]+|1분 안) 남았어요/) || (openEnded && !limitMs && state === "running" ? [0, "무제한"] : null);
      subEl.textContent = (openEnded ? `${idx}턴` : `${idx}/${turns.length}턴`) + (state === "paused" ? " · 일시정지"
        : left ? ` · ${left[1]}${left[1] === "무제한" ? "" : " 남음"}` : state === "done" ? " · 끝났어요" : "");
      dotEl.dataset.tone = state === "running" ? "ok" : "warn";
    } else { subEl.textContent = connText; dotEl.dataset.tone = connTone; }
  }
  function setConn(ok, detail) {
    const why = ok ? "" :
      /fetch|network/i.test(detail) ? "네트워크 오류" :
      /401|403|쿠키/.test(detail) ? "로그인이 풀린 것 같아요" :
      /429/.test(detail) ? "요청이 너무 많대요" :
      /채팅방/.test(detail) ? "채팅방을 못 찾았어요" : detail;
    connText = ok ? `원문 연결됨 · ${detail}` : "화면 기준으로만 기록해요";
    connTone = ok ? "ok" : "warn";
    subEl.parentElement.title = ok ? "응답 원문(숨은 상태 주석 포함)을 읽어요"
      : `원문을 못 읽어서 HUD 칸이 비어요 (${why}). 채팅방에서 새로고침해 보세요.`;
    renderSub();
  }

  // ---------- 열고 닫기: 툴바 아이콘 ----------
  const POS_KEY = "crack_qa_pos";
  async function restorePos() {
    try {
      const r = await chrome.storage.local.get([POS_KEY, THEME_KEY, FOLD_KEY]);
      if (r?.[THEME_KEY]) { themePref = r[THEME_KEY]; applyTheme(); }
      if (typeof r?.[FOLD_KEY] === "boolean") { folded = r[FOLD_KEY]; applyFold(); }
      const p = r?.[POS_KEY];
      if (p && typeof p.left === "number") {
        const L = Math.max(0, Math.min(innerWidth - 320, p.left));
        const T = Math.max(0, Math.min(innerHeight - 80, p.top));
        rootEl.style.left = L + "px"; rootEl.style.top = T + "px";
        rootEl.style.right = "auto"; rootEl.style.bottom = "auto";
      }
    } catch (_) {}
    fitHeight();
  }
  const savePos = () => {
    try { chrome.storage.local.set({ [POS_KEY]: { left: rootEl.offsetLeft, top: rootEl.offsetTop } }); } catch (_) {}
  };
  // 창이 화면 아래로 넘치지 않게: 지금 위치에서 화면 끝까지를 최대 높이로
  function fitHeight() {
    const top = rootEl.style.top ? parseFloat(rootEl.style.top) : null;
    rootEl.style.maxHeight = top != null ? Math.max(160, innerHeight - top - 12) + "px" : "calc(100vh - 24px)";
  }
  window.addEventListener("resize", fitHeight);
  // 크랙(또는 다른 확장)이 휠을 가로채 페이지를 굴리지 못하게, 패널 안 휠은 여기서 끝낸다
  rootEl.addEventListener("wheel", e => e.stopPropagation(), { passive: true });
  const isOpen = () => !rootEl.hidden;
  function setOpen(v) { rootEl.hidden = !v; if (v) restorePos(); }
  $("#close").onclick = () => setOpen(false);
  try {
    chrome.runtime.onMessage.addListener(msg => { if (msg?.type === "CRACK_QA_TOGGLE") setOpen(!isOpen()); });
  } catch (_) {}

  // ---------- 제목줄 끌어 옮기기 ----------
  let drag = null;
  headEl.addEventListener("mousedown", e => {
    if (e.target.closest("button")) return;
    const r = rootEl.getBoundingClientRect();
    rootEl.style.left = r.left + "px"; rootEl.style.top = r.top + "px";
    rootEl.style.right = "auto"; rootEl.style.bottom = "auto";
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault();
  });
  window.addEventListener("mousemove", e => {
    if (!drag) return;
    rootEl.style.left = Math.max(0, Math.min(innerWidth - rootEl.offsetWidth, e.clientX - drag.dx)) + "px";
    rootEl.style.top  = Math.max(0, Math.min(innerHeight - 120, e.clientY - drag.dy)) + "px";
    fitHeight();
  });
  window.addEventListener("mouseup", () => { if (drag) { drag = null; savePos(); } });

  // ---------- 시나리오 ----------
  const gapLabel = () => `간격 ${cfg.gapMax != null ? cfg.gap + "~" + cfg.gapMax : cfg.gap}초` + (cfg.read ? ` · 1000자당 +${cfg.read}초` : "");

  function loadScenario(text) {
    const p = parseScenario(text);
    cfg = p.cfg; turns = p.turns; idx = 0; log = []; state = "idle"; fails = 0; durs = []; openEnded = false; limitMs = 0;
    const kinds = ["추천", "랜덤", "이어서", "재생성", "섞기"].map(k => [k, turns.filter(t => modeOf(t.text) === k).length]).filter(x => x[1]);
    const bits = [
      `${turns.length}턴`,
      cfg.hud.length ? `HUD ${cfg.hud.length}칸` : "HUD 이름 없음",
      cfg.watch.length ? `감시 단어 ${cfg.watch.length}개` : null,
      gapLabel()
    ].filter(Boolean).join(" · ");
    metaEl.innerHTML = `<b>${escHtml(cfg.name)}</b> · ${escHtml(cfg.model || "모델 미지정")}<br>${bits}` +
      (kinds.length ? `<br>${kinds.map(([k, n]) => `${k} ${n}턴`).join(" · ")}` : "") +
      (p.errors.length ? `<br><span class="bad">확인 필요 ${p.errors.length}개: ${escHtml(p.errors[0])}</span>` : "");
    renderProgress(); renderControls();
    setStatus(turns.length ? "시작을 누르면 진행해요" : "턴이 없어요", turns.length ? "#86efac" : "#f87171");
  }

  function fillPicker(all, select) {
    saved = all;
    const names = Object.keys(all).sort();
    const keepBorrow = borrowEl.value;
    pickEl.innerHTML = '<option value="">시나리오를 골라 주세요</option>';
    borrowEl.innerHTML = '<option value="">없음</option>';
    for (const k of names) {
      const o = document.createElement("option"); o.value = k; o.textContent = k; pickEl.appendChild(o);
      borrowEl.appendChild(o.cloneNode(true));
    }
    if (keepBorrow && all[keepBorrow]) borrowEl.value = keepBorrow;
    if (select && all[select]) {
      pickEl.value = select;
      if (tab === "scn") loadScenario(all[select]);
    }
  }

  pickEl.onchange = () => {
    if (pickEl.value && saved[pickEl.value]) loadScenario(saved[pickEl.value]);
    else { turns = []; metaEl.textContent = "시나리오를 고르면 여기에 내용이 보여요."; renderProgress(); renderControls(); }
  };
  $("#del").onclick = async () => {
    if (!pickEl.value) return;
    if (!confirm(`"${pickEl.value}" 시나리오를 목록에서 지울까요?`)) return;
    fillPicker(await Store.del(pickEl.value));
    metaEl.textContent = "시나리오를 고르면 여기에 내용이 보여요."; turns = []; renderProgress(); renderControls();
  };
  $("#file").onchange = async e => {
    const files = [...(e.target.files || [])]; if (!files.length) return;
    let all = saved, last = null;
    for (const f of files) {
      const nm = f.name.replace(/\.(txt|md)$/i, "");
      all = await Store.put(nm, await f.text()); last = nm;
    }
    tab = "scn"; renderTabs();
    fillPicker(all, last);
    e.target.value = "";
  };

  document.addEventListener("keydown", ev => { if (ev.key === "Escape" && ev.isTrusted && busy()) stopAll(); });
  applyTheme(); applyFold(); renderTabs(); renderLimit(); renderHuman(); prepareFree(); renderControls();
  try {
    chrome.storage.local.get(UI_KEY).then(r => {
      const u = r?.[UI_KEY]; if (!u || busy()) return;
      if (u.human) human = { ...human, ...u.human };
      if (u.limitVals) Object.assign(limitVals, u.limitVals);
      if (u.limitKind) limitKind = u.limitKind;
      if (u.freeMode && MODES[u.freeMode]) freeMode = u.freeMode;
      renderTabs(); renderLimit(); renderHuman(); if (tab === "free") { prepareFree(); renderControls(); }
    });
  } catch (_) {}
  Store.all().then(a => { fillPicker(a); if (tab === "free") { prepareFree(); renderControls(); } });

  // 방 ID 는 페이지 로드 때 한 번이 아니라 '시작' 누를 때마다 다시 잡는다.
  // 크랙은 SPA 라 새 대화로 옮겨도 페이지가 안 바뀌어서, 안 그러면 이전 방을 읽는다.
  async function connectRoom() {
    try {
      const prev = chatroomId;
      chatroomId = await Api.resolveRoom();
      if (!chatroomId) throw new Error("채팅방 ID 못 찾음");
      const all = await Api.allMessages();
      apiOn = true;
      const moved = prev && prev !== chatroomId ? " · 방 바뀜" : "";
      setConn(true, `방 …${String(chatroomId).slice(-6)} · 메시지 ${all.length}개${moved}`);
      return true;
    } catch (e) {
      apiOn = false;
      setConn(false, String(e.message).slice(0, 40));
      return false;
    }
  }
  connectRoom();
  // URL 이 바뀌면 (새 대화로 이동) 자동으로 다시 잡는다
  let lastHref = location.href;
  setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; connectRoom(); } }, 1000);

  let lastCancel = 0;
  function autoCancel() {
    const now = Date.now(); if (now - lastCancel < 500) return;
    for (const d of document.querySelectorAll('[role="dialog"][data-state="open"]')) {
      if (![...d.querySelectorAll("h1,h2,h3,p,div")].some(e => (e.textContent || "").trim() === "생성을 중단하시겠어요?")) continue;
      const c = [...d.querySelectorAll("button")].find(b => (b.textContent || "").trim() === "취소");
      if (c && !c.disabled) { lastCancel = now; c.click(); return; }
    }
  }
  new MutationObserver(autoCancel).observe(document.documentElement,
    { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "role"] });
  setInterval(autoCancel, 400);
})();
