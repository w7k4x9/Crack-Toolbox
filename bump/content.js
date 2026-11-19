/*
 * 크랙 버전 설정
 *
 * 스토리 수정 화면(/builder/story?storyId=...&type=edit)에서
 *   한 줄 소개를 살짝 바꾼다 → [수정] → (공개 방식 설정 [확인]) → 업데이트 확인 [등록]
 * 을 목표 버전이 될 때까지 반복한다.
 *
 * - 저장 요청은 크랙 화면이 직접 만든다. 이 스크립트는 사람이 하던 클릭/입력만 대신한다.
 * - 한 줄 소개는 끝/앞에 공백을 넣었다 빼는 식으로 바꾼다(화면에 보이는 문구는 같다).
 *   마지막 저장은 항상 원래 문구로 끝난다.
 * - 현재 버전은 수정 화면 HTML에 들어 있는 작품 정보에서 읽는다(토큰을 다루지 않는다).
 */
(() => {
  'use strict';
  if (window.top !== window || window.__cvbLoaded) return;
  window.__cvbLoaded = true;

  const KEY = 'cvbJob';
  const MAX_DESC = 30; // 한 줄 소개 글자 수 제한
  const MAX_JUMP = 20000; // 오타 방지용 상한(현재 버전 + 2만)
  const OVERHEAD_SEC = 8; // 대기 시간 말고 저장 한 번에 드는 시간(처음 예상치)
  const MAX_RETRY = 3; // 일시적인 문제로 연속 실패할 때 다시 시도하는 횟수
  const PREFS = 'cvbPrefs';
  const SAVE_WAIT_MS = 5 * 60 * 1000; // 저장 후 버전 반영을 기다리는 최대 시간
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- 저장소 ----------
  const cs = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const store = {
    async get() {
      if (cs) return (await cs.get(KEY))[KEY] || null;
      try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
    },
    async set(v) {
      if (cs) return cs.set({ [KEY]: v });
      localStorage.setItem(KEY, JSON.stringify(v));
    },
    async clear() {
      if (cs) return cs.remove(KEY);
      localStorage.removeItem(KEY);
    },
  };

  // 같은 작업을 두 탭이 동시에 돌리지 않도록 탭마다 이름표를 붙인다.
  const TAB_ID = (() => {
    let id = sessionStorage.getItem('cvbTab');
    if (!id) {
      id = Math.random().toString(36).slice(2);
      sessionStorage.setItem('cvbTab', id);
    }
    return id;
  })();

  // ---------- 크랙 페이지 읽기 ----------
  const editUrl = (id) => `/builder/story?storyId=${encodeURIComponent(id)}&type=edit`;

  function editInfo() {
    if (location.pathname !== '/builder/story') return null;
    const q = new URLSearchParams(location.search);
    const storyId = q.get('storyId');
    return storyId && q.get('type') === 'edit' ? { storyId } : null;
  }

  async function fetchStory(id) {
    let html;
    try {
      const res = await fetch(editUrl(id), { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (e) {
      throw new Retryable(`작품 정보를 불러오지 못했어요. 로그인 상태를 확인해 주세요. (${e.message})`);
    }
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    let raw = null;
    try { raw = JSON.parse(m[1]).props.pageProps.initialSavedRawDataInEditMode; } catch { /* 아래에서 처리 */ }
    if (!raw || typeof raw.simpleDescription !== 'string') {
      throw new Error('작품 정보를 읽지 못했어요. 크랙 화면 구조가 바뀌었을 수 있어요.');
    }
    const info = raw.updateInfo || {};
    return {
      version: info.version || 1,
      note: info.releaseNote || '',
      desc: raw.simpleDescription || '',
      name: raw.name || '',
      visibility: raw.visibility || '',
    };
  }

  // ---------- 한 줄 소개 바꿔치기 ----------
  // 원래 문구와 "보기엔 같은" 변형 두 개를 만든다. 자리가 없으면 마지막 수단으로 끝 글자를 뺀다.
  function variants(o) {
    const NBSP = String.fromCharCode(160); // 줄바꿈 없는 공백(보기엔 일반 공백과 같음)
    const cands = [
      o + ' ',
      ' ' + o,
      o + '  ',
      o.replace(' ', NBSP), // 30자를 꽉 채운 경우: 첫 공백을 바꿈
      o.replace(/ (?=[^ ]*$)/, NBSP), // 마지막 공백을 바꿈
      o.slice(0, -1),
      o.slice(0, -2),
    ];
    const out = [];
    for (const v of cands) {
      if (v !== o && v.length <= MAX_DESC && v.trim().length > 0 && !out.includes(v)) out.push(v);
    }
    return out;
  }

  // 남은 저장 횟수를 보고 다음에 넣을 문구를 고른다. 마지막 한 번은 반드시 원래 문구.
  function pickNext(original, current, remaining) {
    if (remaining <= 1) return current !== original ? original : null;
    const [a, b] = variants(original);
    if (!a || !b) return null;
    return current === a ? b : a;
  }

  // ---------- 화면 조작 ----------
  const visible = (el) => !!(el && el.isConnected && el.getClientRects().length);
  const descField = () =>
    [...document.querySelectorAll('textarea')].find((t) => (t.placeholder || '').includes('간단한 소개'));
  const button = (root, text) =>
    [...root.querySelectorAll('button')].find((b) => visible(b) && !b.disabled && (b.innerText || '').trim() === text);
  const openDialogs = () => [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(visible);
  const head = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);

  function saveButton() {
    // 상단의 [임시저장] 옆에 있는 [수정] 버튼
    const draft = button(document, '임시저장');
    let p = draft && draft.parentElement;
    for (let i = 0; p && i < 4; i++, p = p.parentElement) {
      const b = button(p, '수정');
      if (b) return b;
    }
    return null;
  }

  // React가 관리하는 입력칸에 값을 넣는다.
  function setValue(el, value) {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function waitFor(fn, ms, step = 250) {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(step);
    }
  }

  class Stopped extends Error {}
  class Retryable extends Error {} // 다시 시도하면 될 수도 있는 문제

  const randDelay = (job) => job.delayMin + Math.random() * (job.delayMax - job.delayMin);

  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return '1분 미만';
    const m = Math.round(sec / 60);
    if (m < 60) return `약 ${m}분`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `약 ${h}시간 ${r}분` : `약 ${h}시간`;
  }

  function fmtClock(ms) {
    const d = new Date(ms);
    const now = new Date();
    const day = d.toDateString() === now.toDateString() ? '' : '내일 ';
    let h = d.getHours();
    const ap = h < 12 ? '오전' : '오후';
    h = h % 12 || 12;
    return `${day}${ap} ${h}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // 남은 저장 횟수 × 한 번 걸리는 시간
  function etaText(remaining, perSave) {
    if (remaining <= 0) return '';
    const sec = remaining * perSave;
    return `남은 ${remaining.toLocaleString()}회 · ${fmtDur(sec)} (${fmtClock(Date.now() + sec * 1000)}쯤 끝)`;
  }

  // 화면에 떠 있는 알림(토스트) 문구
  const toastText = () =>
    [...document.querySelectorAll('[data-sonner-toast],[role="status"],[class*="oast"]')]
      .map((e) => (e.innerText || '').trim())
      .filter(Boolean)
      .join(' / ');

  async function stillRunning() {
    const j = await store.get();
    return !!(j && j.running);
  }

  // 저장 한 번. [등록]을 누른 뒤에 돌아온다.
  async function saveOnce(job, s) {
    const next = pickNext(job.original, s.desc, job.target - s.version);
    if (next == null) throw new Error('한 줄 소개를 바꿀 방법을 찾지 못했어요.');

    const field = await waitFor(() => {
      const f = descField();
      return f && f.value === s.desc ? f : null;
    }, 20000);
    if (!field) {
      throw new Error('수정 화면의 한 줄 소개가 저장된 내용과 달라요. 임시저장 내용이 불러와졌는지 확인해 주세요.');
    }
    if (openDialogs().length) throw new Error(`열려 있는 창이 있어서 멈췄어요: "${head(openDialogs()[0])}"`);

    setValue(field, next);
    await sleep(300);
    if (field.value !== next) throw new Error('한 줄 소개 입력에 실패했어요.');

    const save = await waitFor(saveButton, 10000);
    if (!save) throw new Retryable('[수정] 버튼을 찾지 못했어요.');
    if (!(await stillRunning())) throw new Stopped();
    save.click();

    const end = Date.now() + 60000;
    while (Date.now() < end) {
      const d = openDialogs()[0];
      if (d) {
        const text = d.innerText || '';
        if (text.includes('업데이트 확인')) {
          const m = text.match(/V\s*(\d+)/);
          if (!m || Number(m[1]) !== s.version + 1) {
            throw new Error(`예상한 버전(V${s.version + 1})과 화면의 버전이 달라서 멈췄어요.`);
          }
          const noteBox = d.querySelector('textarea');
          if (noteBox && job.note) {
            setValue(noteBox, job.note.slice(0, 300));
            await sleep(200);
          }
          const ok = button(d, '등록');
          if (!ok) throw new Error('[등록] 버튼을 찾지 못했어요.');
          if (!(await stillRunning())) throw new Stopped();
          job.phase = 'saving';
          job.expect = s.version + 1;
          job.savingSince = Date.now();
          await store.set(job);
          const before = toastText();
          ok.click();
          // 저장이 끝나면 크랙이 내 작품으로 넘어간다. 그대로 남아서 오류 알림이 뜨면 다시 시도.
          const end2 = Date.now() + 30000;
          while (Date.now() < end2) {
            await sleep(400);
            if (location.pathname !== '/builder/story') return;
            const t = toastText();
            if (t && t !== before) {
              if (t.includes('완료')) return;
              if (/다른 기기에서 수정/.test(t)) return; // 크랙이 알아서 새로고침함
              throw new Retryable(`크랙이 저장을 거절했어요: "${t.slice(0, 80)}"`);
            }
          }
          return; // 검수 화면 등으로 남아 있는 경우: 버전 반영 여부로 판단
        }
        if (text.includes('공개 방식 설정')) {
          const ok = button(d, '확인');
          if (!ok) throw new Error('공개 방식 설정 창의 [확인] 버튼을 누를 수 없어요.');
          ok.click();
          await waitFor(() => !visible(d), 5000);
          continue;
        }
        // 예약 공개 취소 확인 등, 사람이 판단해야 하는 창
        throw new Error(`직접 확인이 필요한 창이 떠서 멈췄어요: "${head(d)}"`);
      }
      await sleep(300);
    }
    throw new Retryable('"업데이트 확인" 창이 뜨지 않았어요.');
  }

  // ---------- 진행 ----------
  let busy = false;
  let savedInThisPage = false;
  let timer = null;
  const schedule = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  };

  async function run() {
    if (busy) return;
    busy = true;
    let job = null;
    try {
      job = await store.get();
      if (!job || !job.running) {
        await renderIdle(job);
        return;
      }
      if (job.owner !== TAB_ID) {
        if (editInfo()) renderOtherTab();
        else hide();
        return;
      }

      const s = await fetchStory(job.storyId);

      if (job.phase === 'saving') {
        if (s.version < job.expect) {
          if (Date.now() - job.savingSince > SAVE_WAIT_MS) {
            throw new Error(`저장하고 5분이 지나도 V${job.expect}로 바뀌지 않았어요. 검수 대기 중인지 확인해 주세요.`);
          }
          renderRunning(job, s, `V${job.expect} 반영을 기다리는 중…`);
          schedule(4000);
          return;
        }
        job.phase = 'idle';
        job.fails = 0;
        const now = Date.now();
        if (job.lastDoneAt) {
          const dt = (now - job.lastDoneAt) / 1000;
          job.avgSec = job.avgSec ? job.avgSec * 0.85 + dt * 0.15 : dt;
        }
        job.lastDoneAt = now;
        await store.set(job);
      }

      if (s.version >= job.target) {
        job.running = false;
        job.result = { ok: true, text: `V${s.version}까지 올렸어요.` };
        await store.set(job);
        await renderIdle(job);
        return;
      }

      const here = editInfo();
      if (!here || here.storyId !== job.storyId || savedInThisPage) {
        renderRunning(job, s, '수정 화면을 여는 중…');
        const url = editUrl(job.storyId);
        if (location.pathname + location.search === url) location.reload();
        else location.assign(url);
        return;
      }

      const wait = randDelay(job);
      renderRunning(job, s, `V${s.version + 1} 저장까지 ${Math.round(wait)}초…`);
      await sleep(wait * 1000);
      if (!(await stillRunning())) throw new Stopped();

      renderRunning(job, s, `V${s.version + 1} 저장 중…`);
      await saveOnce(job, s);
      savedInThisPage = true;
      schedule(2000);
    } catch (e) {
      if (e instanceof Stopped) {
        await renderIdle(await store.get());
        return;
      }
      const cur = (await store.get()) || job || {};
      const msg = e && e.message ? e.message : String(e);
      if (e instanceof Retryable && cur.running && (cur.fails || 0) < MAX_RETRY) {
        cur.fails = (cur.fails || 0) + 1;
        cur.phase = 'idle';
        await store.set(cur);
        const backoff = 20000 * cur.fails;
        renderNote(`${msg}\n${backoff / 1000}초 뒤 다시 시도해요. (${cur.fails}/${MAX_RETRY})`, true);
        savedInThisPage = true; // 수정 화면을 새로 불러와서 다시 시작
        schedule(backoff);
        return;
      }
      cur.running = false;
      cur.phase = 'idle';
      cur.result = { ok: false, text: msg };
      await store.set(cur);
      await renderIdle(cur);
    } finally {
      busy = false;
    }
  }

  async function start(storyId, s, opt) {
    // 수정 화면을 새로 불러와서, 저장된 내용 그대로인 상태에서 시작한다.
    savedInThisPage = true;
    await store.set({
      running: true,
      owner: TAB_ID,
      storyId,
      name: s.name,
      startVersion: s.version,
      target: opt.target,
      delayMin: opt.delayMin,
      delayMax: opt.delayMax,
      note: opt.note,
      original: opt.original,
      phase: 'idle',
      fails: 0,
      startedAt: Date.now(),
      lastDoneAt: Date.now(),
    });
    schedule(0);
  }

  async function stop() {
    const job = await store.get();
    if (!job) return;
    job.running = false;
    job.result = { ok: false, text: '중지했어요.' };
    await store.set(job);
    clearTimeout(timer);
    if (!busy) await renderIdle(job);
    else renderNote('중지하는 중…');
  }

  // ---------- 패널 ----------
  let host = null;
  let root = null;
  let collapsed = true;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Pretendard", "Malgun Gothic", system-ui, sans-serif; letter-spacing: -0.01em; }
    .card, .pill {
      --accent:#007AFF; --accent-soft:rgba(0,122,255,.2); --text:#1D1D1F; --text2:#6E6E73; --sep:rgba(60,60,67,.18);
      --fill:rgba(120,120,128,.12); --fill2:rgba(120,120,128,.2); --field:#FFFFFF; --glass:rgba(242,242,247,.92);
      --glass-border:rgba(255,255,255,.65); --ring:rgba(0,0,0,.1); --ok:#1A7F37; --danger:#D70015; --shadow:0 22px 60px rgba(0,0,0,.22);
      color-scheme: light;
    }
    @media (prefers-color-scheme: dark) {
      .card, .pill {
        --accent:#0A84FF; --accent-soft:rgba(10,132,255,.3); --text:#F5F5F7; --text2:#A1A1A6; --sep:rgba(84,84,88,.6);
        --fill:rgba(120,120,128,.24); --fill2:rgba(120,120,128,.34); --field:rgba(120,120,128,.24); --glass:rgba(30,30,32,.82);
        --glass-border:rgba(255,255,255,.1); --ring:rgba(0,0,0,.5); --ok:#30D158; --danger:#FF453A; --shadow:0 22px 60px rgba(0,0,0,.55);
        color-scheme: dark;
      }
    }
    .card { width: 268px; background: var(--glass); color: var(--text); border: .5px solid var(--glass-border); border-radius: 16px;
            padding: 14px; font-size: 13px; line-height: 1.45; box-shadow: 0 0 0 .5px var(--ring), var(--shadow);
            -webkit-backdrop-filter: blur(30px) saturate(180%); backdrop-filter: blur(30px) saturate(180%); word-break: keep-all; }
    .pill { background: var(--glass); color: var(--text); border: .5px solid var(--glass-border); border-radius: 999px; padding: 7px 13px;
            font-size: 12px; font-weight: 600; cursor: pointer; box-shadow: 0 0 0 .5px var(--ring), 0 6px 18px rgba(0,0,0,.18);
            -webkit-backdrop-filter: blur(30px) saturate(180%); backdrop-filter: blur(30px) saturate(180%); }
    .pill:hover { filter: brightness(.97); }
    .hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .hd b { font-size: 15px; font-weight: 700; }
    .x { width: 24px; height: 24px; border-radius: 12px; background: var(--fill); border: 0; color: var(--text2); cursor: pointer;
         font-size: 14px; line-height: 1; padding: 0; }
    .x:hover { background: var(--fill2); color: var(--text); }
    .name { color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ver { font-size: 20px; font-weight: 700; margin: 2px 0 10px; font-variant-numeric: tabular-nums; }
    .ver small { font-size: 12px; font-weight: 400; color: var(--text2); margin-left: 6px; }
    label { display: block; color: var(--text2); font-size: 12px; margin-top: 8px; }
    input, textarea { width: 100%; margin-top: 4px; background: var(--field); color: var(--text); border: .5px solid var(--sep);
                      border-radius: 8px; padding: 6px 9px; font-size: 13px; outline: none; }
    input:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    textarea { resize: vertical; min-height: 52px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .hint { color: var(--text2); font-size: 11.5px; margin: 10px 0 0; }
    .msg { margin: 6px 0 0; white-space: pre-wrap; word-break: break-all; }
    .msg.bad { color: var(--danger); }
    .msg.good { color: var(--ok); }
    .btn { width: 100%; margin-top: 12px; border: 0; border-radius: 8px; padding: 8px; font-size: 13px; font-weight: 600;
           cursor: pointer; background: var(--accent); color: #fff; }
    .btn:hover { filter: brightness(.96); }
    .btn:disabled { opacity: .45; cursor: default; }
    .btn.sub { background: var(--fill); color: var(--text); }
    .bar { height: 6px; background: var(--fill); border-radius: 99px; overflow: hidden; margin: 4px 0 8px; }
    .bar i { display: block; height: 100%; background: var(--accent); }
  `;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function paint(html) {
    if (!host || !host.isConnected) {
      host = document.createElement('div');
      host.style.cssText = 'position:fixed;top:68px;right:16px;z-index:2147483000;';
      root = host.attachShadow({ mode: 'open' });
      document.documentElement.appendChild(host);
    }
    root.innerHTML = `<style>${CSS}</style>${html}`;
    return root;
  }
  const hide = () => {
    if (host) host.remove();
  };

  function renderNote(text, withStop = false) {
    const r = paint(`<div class="card"><div class="hd"><b>버전 설정</b></div><p class="msg">${esc(text)}</p>
      ${withStop ? '<button class="btn sub" id="stop">중지</button>' : ''}</div>`);
    if (withStop) r.getElementById('stop').onclick = stop;
  }

  function renderOtherTab() {
    const r = paint(`
      <div class="card">
        <div class="hd"><b>버전 설정</b></div>
        <p class="msg">다른 탭에서 진행 중인 작업이 있어요. 그 탭을 이미 닫았다면 작업을 지워 주세요.</p>
        <button class="btn sub" id="clear">작업 지우기</button>
      </div>`);
    r.getElementById('clear').onclick = async () => {
      await store.clear();
      schedule(0);
    };
  }

  function renderRunning(job, s, status) {
    const total = Math.max(1, job.target - job.startVersion);
    const done = Math.min(total, Math.max(0, s.version - job.startVersion));
    const r = paint(`
      <div class="card">
        <div class="hd"><b>버전 올리는 중</b></div>
        <div class="name">${esc(job.name)}</div>
        <div class="ver">V${s.version}<small>/ V${job.target}</small></div>
        <div class="bar"><i style="width:${Math.round((done / total) * 100)}%"></i></div>
        <p class="msg">${esc(status)}</p>
        <p class="hint">${esc(etaText(job.target - s.version, job.avgSec || (job.delayMin + job.delayMax) / 2 + OVERHEAD_SEC))}</p>
        <p class="hint">이 탭은 화면에 띄워 두세요. 다른 걸 하려면 이 탭을 새 창으로 빼 두면 돼요.</p>
        <button class="btn sub" id="stop">중지</button>
      </div>`);
    r.getElementById('stop').onclick = stop;
  }

  async function renderIdle(job) {
    const here = editInfo();

    // 끝났거나 멈춘 작업의 결과 안내
    if (job && job.result) {
      let s = null;
      try { s = await fetchStory(job.storyId); } catch { /* 결과만 보여준다 */ }
      const needRestore = !!(s && job.original != null && s.desc !== job.original);
      const r = paint(`
        <div class="card">
          <div class="hd"><b>버전 설정</b><button class="x" id="close">×</button></div>
          <div class="name">${esc(job.name || '')}</div>
          ${s ? `<div class="ver">V${s.version}</div>` : ''}
          <p class="msg ${job.result.ok ? 'good' : 'bad'}">${esc(job.result.text)}</p>
          ${needRestore ? '<p class="hint">한 줄 소개에 임시 공백이 남아 있어요. 복구하면 버전이 1 더 올라갑니다.</p><button class="btn" id="restore">원래 소개로 복구</button>' : ''}
        </div>`);
      r.getElementById('close').onclick = async () => {
        await store.clear();
        schedule(0);
      };
      if (needRestore) {
        r.getElementById('restore').onclick = () =>
          start(job.storyId, s, {
            target: s.version + 1,
            delayMin: job.delayMin || 3,
            delayMax: job.delayMax || 8,
            note: job.note || '',
            original: job.original,
          });
      }
      return;
    }

    if (!here) return hide();

    if (collapsed) {
      const r = paint('<button class="pill" id="open">버전 설정</button>');
      r.getElementById('open').onclick = () => {
        collapsed = false;
        schedule(0);
      };
      return;
    }

    let s;
    try {
      s = await fetchStory(here.storyId);
    } catch (e) {
      return renderNote(e.message);
    }
    const min = s.version + 2;
    let prefs = {};
    try { prefs = (cs ? (await cs.get(PREFS))[PREFS] : JSON.parse(localStorage.getItem(PREFS))) || {}; } catch { /* 기본값 */ }
    const dMin = prefs.delayMin || 3;
    const dMax = prefs.delayMax || 8;
    const shortened = variants(s.desc).slice(0, 2).some((v) => v.length < s.desc.length);
    const r = paint(`
      <div class="card">
        <div class="hd"><b>버전 설정</b><button class="x" id="close">×</button></div>
        <div class="name">${esc(s.name)}</div>
        <div class="ver">V${s.version}<small>현재</small></div>
        <label>목표 버전<input id="target" type="number" min="${min}" value="${min}"></label>
        <div class="two">
          <label>간격 최소(초)<input id="dmin" type="number" min="2" max="600" value="${dMin}"></label>
          <label>간격 최대(초)<input id="dmax" type="number" min="2" max="600" value="${dMax}"></label>
        </div>
        <p class="hint" id="eta"></p>
        <label>제작자 노트 (매 저장에 그대로 등록)<textarea id="note" maxlength="300">${esc(s.note)}</textarea></label>
        <p class="hint">한 줄 소개에 공백을 넣었다 빼며 저장해요. 보이는 문구는 그대로이고, 마지막 저장은 원래 문구로 끝납니다.</p>
        ${shortened ? '<p class="hint">한 줄 소개가 30자를 꽉 채우고 공백이 적어서, 진행 중에는 끝 글자가 잠깐 빠져 보여요. 마지막 저장에서 원래대로 돌아와요.</p>' : ''}
        <p class="msg bad" id="err"></p>
        <button class="btn" id="go">시작</button>
      </div>`);
    r.getElementById('close').onclick = () => {
      collapsed = true;
      schedule(0);
    };
    const read = () => ({
      target: Number(r.getElementById('target').value),
      delayMin: Number(r.getElementById('dmin').value),
      delayMax: Number(r.getElementById('dmax').value),
    });
    const updateEta = () => {
      const v = read();
      const ok = Number.isInteger(v.target) && v.target >= min && v.delayMin >= 2 && v.delayMax >= v.delayMin;
      r.getElementById('eta').textContent = ok
        ? '예상: ' + etaText(v.target - s.version, (v.delayMin + v.delayMax) / 2 + OVERHEAD_SEC)
        : '';
    };
    ['target', 'dmin', 'dmax'].forEach((id) => r.getElementById(id).addEventListener('input', updateEta));
    updateEta();
    const go = r.getElementById('go');
    go.onclick = async () => {
      const { target, delayMin, delayMax } = read();
      const note = r.getElementById('note').value.trim();
      const err = r.getElementById('err');
      if (!(delayMin >= 2 && delayMax <= 600 && delayMax >= delayMin)) {
        err.textContent = '간격은 2~600초, 최대가 최소보다 크거나 같아야 해요.';
        return;
      }
      if (!Number.isInteger(target) || target < min) {
        err.textContent = `목표 버전은 V${min} 이상이어야 해요. (바꿨다가 되돌려야 해서 최소 2번 저장)`;
        return;
      }
      if (target > s.version + MAX_JUMP) {
        err.textContent = `목표 버전이 너무 커요. 숫자를 다시 확인해 주세요.`;
        return;
      }
      if (variants(s.desc).length < 2) {
        err.textContent = '한 줄 소개가 비어 있거나 너무 짧아서 진행할 수 없어요.';
        return;
      }
      const other = await store.get();
      if (other && other.running) {
        err.textContent = '이미 진행 중인 작업이 있어요.';
        return;
      }
      go.disabled = true;
      const p = { delayMin, delayMax };
      if (cs) await cs.set({ [PREFS]: p });
      else localStorage.setItem(PREFS, JSON.stringify(p));
      await start(here.storyId, s, { target, delayMin, delayMax, note, original: s.desc });
    };
  }

  // 툴바 아이콘을 눌렀을 때 쓰는 안내 카드
  function renderGuide() {
    const onMy = location.pathname === '/my';
    const r = paint(`
      <div class="card">
        <div class="hd"><b>버전 설정</b><button class="x" id="close">×</button></div>
        <p class="msg">스토리 수정 화면에서 쓸 수 있어요.</p>
        <p class="hint">내 작품 → 작품 오른쪽 [⋯] → 수정하기<br>를 누르면 이 자리에 설정 창이 열려요.</p>
        ${onMy ? '' : '<button class="btn" id="go">내 작품으로 가기</button>'}
      </div>`);
    r.getElementById('close').onclick = hide;
    if (!onMy) r.getElementById('go').onclick = () => location.assign('/my');
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== 'cvb-open') return;
      (async () => {
        const job = await store.get();
        if (job && (job.running || job.result)) return schedule(0); // 진행/결과 창을 다시 보여줌
        if (editInfo()) {
          collapsed = false;
          schedule(0);
        } else {
          renderGuide();
        }
      })();
    });
  }

  // ---------- 시작 ----------
  // 크랙은 페이지를 새로 불러오지 않고 주소만 바꾸므로 주소 변화를 지켜본다.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      if (!busy) schedule(300);
    }
  }, 700);

  schedule(800);
})();
