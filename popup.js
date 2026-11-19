const KINDS = ["main", "start", "guide", "recs", "keyword", "shortcut", "media"];
const OPTIONAL = ["guide", "recs", "media"];             // 있을 때만 줄을 보여 주는 항목
const LABEL = { main: "스토리 설정", start: "시작 설정", guide: "플레이가이드", recs: "추천 답변", keyword: "키워드북", shortcut: "단축어", media: "미디어" };
const STORE_KEY = "crackTxtAutofill.v48.state";
const P = CrackTxtParser;

const state = Object.create(null);   // kind -> { source, text }
let imageState = null;
let pendingText = null;              // 종류를 몰라 사용자 선택을 기다리는 붙여넣기

const $ = (id) => document.getElementById(id);
const paste = $("paste"), runButton = $("run"), message = $("message");

// --------------------------------------------------------------- 저장·복원
// chrome.storage.local에 둡니다. 팝업이 닫혀도 남습니다.
function replaceState(saved) {
  for (const kind of KINDS) delete state[kind];
  for (const kind of KINDS) if (saved?.[kind]?.text) state[kind] = saved[kind];
}
function save() {
  const plain = Object.fromEntries(KINDS.filter((k) => state[k]).map((k) => [k, state[k]]));
  chrome.storage.local.set({ [STORE_KEY]: plain }).catch(() => {});
}
async function restore() {
  let saved = null;
  try { saved = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY]; } catch (_) {}
  if (!saved) {
    // v4.8 초기 버전은 팝업 localStorage에 저장했습니다. 한 번만 옮깁니다.
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); localStorage.removeItem(STORE_KEY); } catch (_) {}
    if (saved) await chrome.storage.local.set({ [STORE_KEY]: saved }).catch(() => {});
  }
  replaceState(saved);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORE_KEY]) return;
  replaceState(changes[STORE_KEY].newValue);
  render();
});

// --------------------------------------------------------------- 공통
async function copyText(text, button, doneLabel = "복사됨 ✓") {
  try { await navigator.clipboard.writeText(text); }
  catch (_) {
    const area = document.createElement("textarea");
    area.value = text; document.body.appendChild(area); area.select();
    document.execCommand("copy"); area.remove();
  }
  const before = button.textContent;
  button.textContent = doneLabel; button.classList.add("done");
  setTimeout(() => { button.textContent = before; button.classList.remove("done"); }, 1600);
}

function selectedKinds() { return KINDS.filter((kind) => !!state[kind]); }
function filesObject() { return Object.fromEntries(selectedKinds().map((kind) => [kind, state[kind].text])); }
function validation() { return selectedKinds().length ? P.validate(filesObject()) : null; }

function setKind(kind, text, source) {
  state[kind] = { source, text };
}

function notice(kind, text) {
  message.className = kind;
  message.textContent = text;
}

// --------------------------------------------------------------- 붙여넣기 처리
function ingest(text, source) {
  const { sections, order, marked } = P.splitCombined(text);
  if (marked && order.length) {
    for (const kind of order) setKind(kind, sections[kind], source);
    return order;
  }
  const guessed = P.guessKind(text);
  if (guessed) { setKind(guessed, P.trimFences(text), source); return [guessed]; }
  return null;
}

function handlePaste() {
  const text = paste.value;
  if (!text.trim()) return;
  const applied = ingest(text, "붙여넣기");
  if (applied) {
    paste.value = "";
    pendingText = null;
    $("chooser").hidden = true;
    save();
    render(`${applied.map((kind) => `${kind}(${LABEL[kind]})`).join(", ")} 반영했습니다.`);
  } else {
    pendingText = text;
    $("chooser").hidden = false;
    render();
  }
}

let pasteTimer = null;
paste.addEventListener("input", () => { clearTimeout(pasteTimer); pasteTimer = setTimeout(handlePaste, 250); });

$("chooser").addEventListener("click", (event) => {
  const kind = event.target?.dataset?.choose;
  if (!kind || !pendingText) return;
  setKind(kind, P.trimFences(pendingText), "붙여넣기");
  pendingText = null; paste.value = ""; $("chooser").hidden = true;
  save();
  render(`${kind}(${LABEL[kind]}) 반영했습니다.`);
});

$("status").addEventListener("click", (event) => {
  if (!event.target.classList.contains("x")) return;
  const kind = event.target.closest("[data-kind]").dataset.kind;
  delete state[kind];
  save();
  render(`${kind}를 비웠습니다.`);
});

$("clearAll").addEventListener("click", () => {
  for (const kind of KINDS) delete state[kind];
  pendingText = null; paste.value = ""; $("chooser").hidden = true;
  save();
  render("모두 비웠습니다.");
});

// --------------------------------------------------------------- 화면 갱신
function render(info = "") {
  const result = validation();
  const blocked = new Set((result?.issues || []).filter((issue) => issue.blocking).map((issue) => issue.kind));
  for (const kind of KINDS) {
    const row = document.querySelector(`[data-kind="${kind}"]`);
    const value = row.querySelector("b");
    row.classList.remove("ok", "warn", "bad", "has");
    row.hidden = OPTIONAL.includes(kind) && !state[kind];
    if (!state[kind]) { value.textContent = "없음"; continue; }
    row.classList.add("has");
    const report = P.inspect(kind, state[kind].text);
    value.textContent = kind === "main"
      ? `${state[kind].source} · ${state[kind].text.length.toLocaleString()}자`
      : `${state[kind].source} · ${report.count}/${report.expected}`;
    if (blocked.has(kind)) row.classList.add("bad");
    else if (report.count === report.expected) row.classList.add(report.notes.length ? "warn" : "ok");
    else if (report.count === 0 || report.count > report.expected) row.classList.add("bad");
    else row.classList.add("warn");
  }

  $("imagePicker").hidden = !state.media;
  const imageReady = !state.media || (imageState && imageState.size <= 5 * 1024 * 1024);
  runButton.disabled = !result || result.errors.length > 0 || !imageReady;

  if (pendingText) return notice("warn", "위에서 이 내용이 어느 항목인지 골라 주세요.");
  if (!result) return notice("", info);
  if (result.errors.length) return notice("bad", `${info ? `${info}\n` : ""}${result.errors.join("\n")}\n\n파일을 고친 뒤 다시 넣어 주세요.`);
  if (!imageReady) return notice("bad", "media가 있으면 5MB 이하 이미지를 선택해야 합니다.");
  if (result.warnings.length) return notice("warn", `${info ? `${info}\n` : ""}${result.warnings.join("\n")}\n이대로 실행해도 됩니다.`);
  notice("ok", `${info ? `${info}\n` : ""}입력할 항목: ${result.selected.join(", ")}`);
}

// --------------------------------------------------------------- 파일로 불러오기(기존 방식)
function detectKindByName(filename) {
  const name = filename.normalize("NFKC").toLowerCase();
  if (/플레이\s*가이드|play[\s_-]*guide/.test(name)) return "guide";
  if (/추천\s*답변|recommend|[_\- ]recs?[._(]/.test(name)) return "recs";
  return KINDS.find((kind) =>
    name.includes(`_${kind}`) || name.includes(`-${kind}`) || name.includes(` ${kind}`) ||
    name.startsWith(`${kind}.`) || name.startsWith(`${kind}(`)
  ) || null;
}

// 사용자가 직접 고른 파일은 원문 그대로 넣습니다.
async function loadFiles(event) {
  const applied = [];
  const unknown = [];
  for (const file of event.target.files) {
    const text = await file.text();
    const { sections, order, marked } = P.splitCombined(text);
    if (marked && order.length) {
      for (const kind of order) { state[kind] = { source: file.name, text: sections[kind], locked: true }; applied.push(kind); }
      continue;
    }
    const kind = detectKindByName(file.name) || P.guessKind(text);
    if (kind) { state[kind] = { source: file.name, text, locked: true }; applied.push(kind); }
    else unknown.push(file.name);
  }
  event.target.value = "";
  save();
  const parts = [];
  if (applied.length) parts.push(`${[...new Set(applied)].join(", ")} 불러왔습니다.`);
  if (unknown.length) parts.push(`종류를 알 수 없어 제외: ${unknown.join(", ")} (파일명에 _main, _keyword, 플레이가이드, 추천답변 등을 넣어 주세요)`);
  render(parts.join("\n"));
}
$("txtFilesQuick").addEventListener("change", loadFiles);

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

$("imageFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  imageState = file ? { name: file.name, type: file.type || "image/png", size: file.size, dataUrl: await readAsDataUrl(file) } : null;
  render();
});

// --------------------------------------------------------------- 실행
async function sendToPage(tabId, payload) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, payload);
    if (response) return response;
  } catch (_) {}
  await chrome.scripting.executeScript({ target: { tabId }, files: ["autofill/parser.js", "autofill/content.js"] });
  return await chrome.tabs.sendMessage(tabId, payload);
}

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  notice("", "사전 점검을 시작합니다…");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://crack.wrtn.ai/builder/story")) {
    render();
    notice("bad", "크랙 스토리 수정 페이지를 먼저 열어 주세요.");
    return;
  }
  const files = filesObject();
  const result = P.validate(files);
  if (result.errors.length) { render(); return; }
  if (files.media && (!imageState || imageState.size > 5 * 1024 * 1024)) { render(); return; }
  try {
    const response = await sendToPage(tab.id, {
      type: "CRACK_TXT_AUTOFILL_RUN_V47",
      payload: { files, image: files.media ? imageState : null },
    });
    notice(response?.ok ? "ok" : "bad", response?.ok ? "페이지 오른쪽 아래 진행 창을 확인하세요." : (response?.error || "실행하지 못했습니다."));
  } catch (error) {
    notice("bad", `실행 오류: ${error.message}`);
  } finally {
    setTimeout(() => { runButton.disabled = false; }, 700);
  }
});

restore().then(() => render());

// --------------------------------------------------------------- 툴박스: 도구 열기 · 업데이트
$("version").textContent = `v${chrome.runtime.getManifest().version}`;
async function openTool(tool) {
  try { await chrome.runtime.sendMessage({ type: "TOOLBOX_OPEN", tool }); } catch (_) {}
  window.close();
}
$("openQa").addEventListener("click", () => openTool("qa"));
$("openBump").addEventListener("click", () => openTool("bump"));

function showUpdate(info, checked = false) {
  const note = $("updateNote");
  $("update").hidden = !(info && info.available);
  if (!info) { note.textContent = ""; return; }
  if (info.available) { $("update").textContent = `새 버전 ${info.latest} 업데이트`; note.textContent = ""; return; }
  if (!checked) { note.textContent = ""; return; }
  if (!info.eligible) note.textContent = "· 스토어 설치본은 크롬이 알아서 업데이트해요";
  else note.textContent = info.error ? `· 확인하지 못했어요 (${info.error})` : "· 최신 버전이에요";
}
async function updateStatus(force) {
  try { return await chrome.runtime.sendMessage({ type: "TOOLBOX_UPDATE_STATUS", force }); } catch (_) { return null; }
}
$("update").addEventListener("click", async () => {
  try { await chrome.runtime.sendMessage({ type: "TOOLBOX_OPEN_UPDATE" }); } catch (_) {}
  window.close();
});
$("checkUpdate").addEventListener("click", async () => {
  $("updateNote").textContent = "· 확인하는 중…";
  showUpdate(await updateStatus(true), true);
});
updateStatus(false).then((info) => showUpdate(info));
