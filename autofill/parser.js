(() => {
  const clean = (value) => String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();

  const EXPECTED = { main: 1, start: 3, media: 50, keyword: 20, shortcut: 20, guide: 3, recs: 3 };

  // ---------------------------------------------------------------- 공통 유틸

  // 이름 비교용 키. 괄호 부기와 공백·구분자 차이를 무시합니다.
  // 예) "백지 초대장 (자유설정)" 과 "백지 초대장" 을 같은 이름으로 봅니다.
  const foldName = (value) => String(value ?? "")
    .normalize("NFKC")
    .replace(/[（(\[【{][^)）\]】}]*[)）\]】}]?/g, " ")
    .replace(/[\s_.,\-–—~〜·・:：]+/g, "")
    .toLowerCase();

  const tightName = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

  const splitRecommendations = (body) => String(body ?? "")
    .split(/\n\s*\n+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3);

  // ------------------------------------------------------------ 시작 설정 파서

  const START_KINDS = [
    ["prologue", /^(.*?)[\s\-–—:：|/]*프\s*롤\s*로\s*그$/],
    ["situation", /^(.*?)[\s\-–—:：|/]*시\s*작\s*상\s*황$/],
    ["playGuide", /^(.*?)[\s\-–—:：|/]*플\s*레\s*이\s*가\s*이\s*드$/],
    ["recommendations", /^(.*?)[\s\-–—:：|/]*추\s*천\s*답\s*변$/],
  ];

  function classifyStartHeader(header) {
    const text = String(header ?? "").trim();
    for (const [key, pattern] of START_KINDS) {
      const parsed = text.match(pattern);
      if (parsed) return { key, name: tightName(parsed[1]) };
    }
    return null;
  }

  function collectStartSections(source) {
    const found = [];

    // 1) 권장 형식: *[이름 프롤로그] / **[이름 시작상황]
    //    앞뒤 별표·샵·인용부호 개수는 자유롭게 허용합니다.
    const bracketed = /^[ \t]*[*#>\-–—•]*[ \t]*[\[【]([^\]】\n]+)[\]】][ \t]*[*#]*[ \t]*$/gm;
    for (const match of source.matchAll(bracketed)) {
      const kind = classifyStartHeader(match[1]);
      if (kind) found.push({ index: match.index, fullLength: match[0].length, ...kind });
    }

    // 2) 대괄호 없이 "이름 프롤로그" 한 줄만 쓴 형식도 읽습니다.
    //    본문 문장을 헤더로 오인하지 않도록 짧은 한 줄로 제한합니다.
    const bare = /^[ \t]*[*#>\-–—•]*[ \t]*([^\[\]【】\n]{1,32}?(?:프롤로그|시작\s*상황|플레이\s*가이드|추천\s*답변))[ \t]*[*#]*[ \t]*$/gm;
    for (const match of source.matchAll(bare)) {
      const kind = classifyStartHeader(match[1]);
      if (kind) found.push({ index: match.index, fullLength: match[0].length, ...kind });
    }

    found.sort((a, b) => a.index - b.index);

    // 같은 줄이 두 규칙에 모두 걸린 경우 제거
    const unique = found.filter((item, i) => i === 0 || item.index !== found[i - 1].index);

    return unique.map((item, i) => {
      const from = item.index + item.fullLength;
      const to = i + 1 < unique.length ? unique[i + 1].index : source.length;
      return { ...item, order: i, body: source.slice(from, to).replace(/^\n/, "").trim() };
    });
  }

  function emptyStartGroup(order) {
    return { names: [], prologue: "", situation: "", playGuide: "", recommendations: [], order };
  }

  function assignSection(group, section) {
    if (section.name) group.names.push(section.name);
    if (section.key === "recommendations") {
      if (!group.recommendations.length) group.recommendations = splitRecommendations(section.body);
    } else if (!group[section.key]) {
      group[section.key] = section.body;
    }
  }

  // 이름이 이미 채워진 칸을 또 만나면 다음 세트가 시작된 것으로 봅니다.
  function groupStartByOrder(sections) {
    const groups = [];
    let current = null;
    for (const section of sections) {
      const filled = section.key === "recommendations"
        ? current?.recommendations.length > 0
        : !!current?.[section.key];
      if (!current || filled) {
        current = emptyStartGroup(groups.length);
        groups.push(current);
      }
      assignSection(current, section);
    }
    return groups;
  }

  function groupStartByName(sections) {
    const byKey = new Map();
    for (const section of sections) {
      if (!section.name) continue;
      const key = tightName(section.name);
      if (!byKey.has(key)) byKey.set(key, emptyStartGroup(section.order));
      assignSection(byKey.get(key), section);
    }

    // 이름 철자가 조금 다른 짝(괄호 부기·띄어쓰기)을 합칩니다.
    const groups = [...byKey.values()];
    const merged = [];
    for (const group of groups) {
      const complete = group.prologue && group.situation;
      const fold = foldName(group.names[0] || "");
      const partner = complete ? null : merged.find((item) =>
        !(item.prologue && item.situation) &&
        foldName(item.names[0] || "") === fold &&
        ((item.prologue && group.situation) || (item.situation && group.prologue))
      );
      if (!partner) {
        merged.push(group);
        continue;
      }
      partner.names.push(...group.names);
      for (const key of ["prologue", "situation", "playGuide"]) {
        if (!partner[key] && group[key]) partner[key] = group[key];
      }
      if (!partner.recommendations.length) partner.recommendations = group.recommendations;
      partner.order = Math.min(partner.order, group.order);
    }
    return merged;
  }

  function finishStartGroups(groups) {
    return groups
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((group, index) => {
        // 같은 세트에 이름 변형이 여러 개면 가장 짧은 쪽을 씁니다.
        // (크랙 이름 칸은 12자 제한이라 "백지 초대장 (자유설정)"보다 "백지 초대장"이 안전합니다.)
        const name = group.names
          .map(tightName)
          .filter(Boolean)
          .sort((a, b) => a.length - b.length)[0] || `설정 ${index + 1}`;
        return {
          name,
          prologue: group.prologue,
          situation: group.situation,
          playGuide: group.playGuide,
          recommendations: group.recommendations,
        };
      })
      .filter((item) => item.prologue && item.situation)
      .slice(0, 3);
  }

  function parseStartDetailed(text) {
    const source = clean(text);
    const sections = collectStartSections(source);
    const notes = [];

    const byName = finishStartGroups(groupStartByName(sections));
    const byOrder = finishStartGroups(groupStartByOrder(sections));

    // 이름 짝이 깨져도 헤더 순서로 복구합니다.
    const items = byOrder.length > byName.length ? byOrder : byName;
    if (byOrder.length > byName.length) {
      notes.push("이름이 서로 다른 헤더가 있어 순서를 기준으로 짝을 맞췄습니다. 프롤로그와 시작상황의 이름을 같게 쓰면 더 안전합니다.");
    }

    if (!sections.length) {
      notes.push("`*[이름 프롤로그]` / `**[이름 시작상황]` 형태의 헤더를 한 줄도 찾지 못했습니다.");
    } else if (items.length < EXPECTED.start) {
      const lonelyPrologue = [];
      const lonelySituation = [];
      for (const group of groupStartByName(sections)) {
        if (group.prologue && group.situation) continue;
        const label = group.names[0] || "(이름 없음)";
        if (group.prologue) lonelyPrologue.push(label);
        if (group.situation) lonelySituation.push(label);
      }
      if (lonelyPrologue.length) notes.push(`시작상황 없이 프롤로그만 있는 이름: ${lonelyPrologue.join(", ")}`);
      if (lonelySituation.length) notes.push(`프롤로그 없이 시작상황만 있는 이름: ${lonelySituation.join(", ")}`);
      const kinds = new Set(sections.map((section) => section.key));
      if (!kinds.has("prologue")) notes.push("프롤로그 헤더가 하나도 없습니다.");
      if (!kinds.has("situation")) notes.push("시작상황 헤더가 하나도 없습니다.");
    }

    return { items, notes, sections };
  }

  function parseStart(text) {
    return parseStartDetailed(text).items;
  }


  // ------------------------------------------- 플레이가이드 · 추천 답변 파일
  // 플레이가이드.md:  "## 시작설정 이름" 아래 본문 (칸마다 500자)
  // 추천답변.md:      "## 시작설정 이름" 아래 "### 1" ~ "### 3" (칸마다 200자)
  // "# 제목" 줄과 첫 "## " 앞의 안내문은 버립니다. `[이름 플레이가이드]` 헤더도 읽습니다.
  function splitByStartName(text) {
    const source = clean(text);
    const out = [];
    const header = /^[ \t]*##(?!#)[ \t]*(.+?)[ \t]*#*[ \t]*$/gm;
    const marks = [...source.matchAll(header)];
    marks.forEach((mark, i) => {
      const from = mark.index + mark[0].length;
      const to = i + 1 < marks.length ? marks[i + 1].index : source.length;
      out.push({ name: tightName(mark[1].replace(/^[\[【]|[\]】]$/g, "")), body: source.slice(from, to).trim() });
    });
    return out;
  }

  function parseGuideDetailed(text) {
    const notes = [];
    let items = splitByStartName(text)
      .map((item) => ({ name: item.name.replace(/[\s\-–—:：|/]*플\s*레\s*이\s*가\s*이\s*드$/, "").trim() || item.name, body: item.body }))
      .filter((item) => item.body);
    if (!items.length) {
      items = collectStartSections(clean(text)).filter((s) => s.key === "playGuide" && s.body).map((s) => ({ name: s.name, body: s.body }));
    }
    if (!items.length) notes.push("`## 시작설정 이름` 아래에 본문이 있는 구역을 찾지 못했습니다.");
    return { items, notes };
  }

  function parseRecsDetailed(text) {
    const notes = [];
    let items = splitByStartName(text).map((item) => {
      const parts = item.body.split(/^[ \t]*###[ \t]*(?:추천\s*답변\s*)?\d+[ \t.)]*$/m).map((v) => v.trim());
      const list = parts.length > 1 ? parts.slice(1).filter(Boolean) : splitRecommendations(item.body);
      return { name: item.name.replace(/[\s\-–—:：|/]*추\s*천\s*답\s*변$/, "").trim() || item.name, items: list };
    }).filter((item) => item.items.length);
    if (!items.length) {
      items = collectStartSections(clean(text)).filter((s) => s.key === "recommendations" && s.body)
        .map((s) => ({ name: s.name, items: splitRecommendations(s.body) }));
    }
    if (!items.length) notes.push("`## 시작설정 이름` 아래 `### 1`~`### 3` 구역을 찾지 못했습니다.");
    return { items, notes };
  }

  // 시작설정 이름 목록에 맞춰 줄을 세웁니다. 이름이 하나라도 안 맞으면 파일에 적힌 순서대로 붙입니다.
  function alignExtras(names, list) {
    const aligned = names.map(() => null);
    const used = new Set();
    const unmatched = [];
    for (const item of list || []) {
      const key = foldName(item.name);
      const index = names.findIndex((name, i) => !used.has(i) && foldName(name) === key);
      if (index >= 0) { aligned[index] = item; used.add(index); }
      else unmatched.push(item.name);
    }
    if (!unmatched.length) return { aligned, unmatched, byOrder: false };
    if ((list || []).length <= names.length) {
      return { aligned: names.map((_, i) => list[i] || null), unmatched: [], byOrder: true };
    }
    return { aligned, unmatched, byOrder: false };
  }

  // -------------------------------------------------------- 번호 목록 파서

  // 숫자와 제목 사이에 공백이나 . ) : 같은 구분이 반드시 있어야 헤더로 봅니다.
  // "3년을 그랬더니" 같은 본문 줄이 새 항목으로 잘리지 않게 하기 위한 조건입니다.
  const NUMBERED_HEADER = /^[ \t]*(?:[#>*\-–—•]+[ \t]*)?(?:[\[(【<][ \t]*)?(\d{1,3})[ \t]*(?:[\])】>][ \t]*)?(?:[.)．。:：、,][ \t]*|[ \t]+)(\S[^\n]*?)[ \t]*$/;
  const KEYWORD_LINE = /^[ \t]*[-*·•]?[ \t]*(?:키\s*워\s*드|keywords?|태그|tags?)[ \t]*[:：][ \t]*(.*)$/i;

  function numberedCandidate(line) {
    const match = line.match(NUMBERED_HEADER);
    if (!match) return null;
    return { num: parseInt(match[1], 10), title: match[2].trim() };
  }

  // mode: "sequence" = 1,2,3 순서 그대로 / "ascending" = 번호가 커지기만 하면 인정 / "any" = 전부 인정
  function splitNumbered(lines, mode) {
    const items = [];
    let current = null;
    let next = null;
    let last = null;
    for (const line of lines) {
      const candidate = numberedCandidate(line);
      let accept = !!candidate;
      if (candidate && mode === "sequence" && next !== null) accept = candidate.num === next;
      if (candidate && mode === "ascending" && last !== null) accept = candidate.num > last;
      if (accept) {
        last = candidate.num;
        if (current) items.push(current);
        current = { title: candidate.title, number: candidate.num, lines: [] };
        next = candidate.num + 1;
      } else if (current) {
        current.lines.push(line);
      }
    }
    if (current) items.push(current);
    return items;
  }

  // 번호가 아예 없는 TXT 대비: 키워드 줄이나 빈 줄로 항목을 나눕니다.
  function splitUnnumbered(lines, withKeywords) {
    const items = [];
    let buffer = [];
    const flush = () => {
      const body = buffer.filter((line) => line.trim().length);
      if (body.length) {
        const titleIndex = buffer.findIndex((line) => line.trim().length);
        items.push({ title: buffer[titleIndex].trim(), number: null, lines: buffer.slice(titleIndex + 1) });
      }
      buffer = [];
    };

    if (withKeywords && lines.some((line) => KEYWORD_LINE.test(line))) {
      for (const line of lines) {
        buffer.push(line);
        if (KEYWORD_LINE.test(line)) flush();
      }
      flush();
      return items;
    }

    for (const line of lines) {
      if (!line.trim()) flush();
      else buffer.push(line);
    }
    flush();
    return items;
  }

  // GPT가 습관처럼 붙이는 굵게 표시(**제목**, __제목__)를 벗겨 냅니다.
  const stripBold = (line) => line
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/__([^_\n]+?)__/g, "$1");

  function parseNumberedDetailed(text, withKeywords = false, expected = 0) {
    const lines = clean(text).split("\n").map(stripBold);
    const notes = [];

    const strict = splitNumbered(lines, "sequence");
    const ascending = splitNumbered(lines, "ascending");
    const loose = splitNumbered(lines, "any");

    let raw = strict;
    // 기준 개수에 정확히 맞는 해석이 있으면 그쪽을 씁니다.
    if (expected && strict.length !== expected) {
      if (ascending.length === expected) {
        raw = ascending;
        notes.push("번호가 중간에 건너뛰어 있어 번호 순서 검사를 완화했습니다.");
      } else if (loose.length === expected) {
        raw = loose;
        notes.push("번호가 1, 2, 3 순서로 이어지지 않아 번호 순서 검사를 건너뛰었습니다.");
      }
    }
    if (raw.length < 2 && loose.length > raw.length) {
      raw = loose;
      notes.push("번호가 순서대로 이어지지 않아 번호 순서 검사를 건너뛰었습니다.");
    }
    if (!raw.length) {
      raw = splitUnnumbered(lines, withKeywords);
      if (raw.length) notes.push("번호로 시작하는 제목 줄이 없어 " + (withKeywords ? "`키워드:` 줄" : "빈 줄") + " 기준으로 항목을 나눴습니다.");
    }

    const items = raw.map((item) => {
      const bodyLines = [...item.lines];
      let keywords = [];
      if (withKeywords) {
        const index = bodyLines.findIndex((line) => KEYWORD_LINE.test(line));
        if (index >= 0) {
          const matched = bodyLines[index].match(KEYWORD_LINE);
          keywords = String(matched?.[1] ?? "")
            .split(/[\s,、·]+/)
            .map((value) => value.trim().replace(/^[#＃]+/, ""))
            .filter(Boolean)
            .slice(0, 5);
          bodyLines.splice(index, 1);
        }
      }
      return { title: item.title, body: bodyLines.join("\n").trim(), keywords };
    });

    if (withKeywords) {
      const missing = items
        .map((item, index) => (item.keywords.length ? null : index + 1))
        .filter(Boolean);
      if (missing.length) notes.push(`\`키워드:\` 줄이 없는 항목: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " 외" : ""}`);
    }

    return { items, notes };
  }

  function parseNumbered(text, withKeywords = false) {
    return parseNumberedDetailed(text, withKeywords).items;
  }

  // ------------------------------------------------------------- 단축어 파서

  const SHORTCUT_SEPARATOR = /^[ \t]*[*＊]{4,}[ \t]*$/m;
  const SHORTCUT_SEPARATOR_SPLIT = /^[ \t]*[*＊]{4,}[ \t]*$/gm;

  function parseShortcutsDetailed(text) {
    const source = clean(text);
    const notes = [];
    // 코드 블록 안의 빈 줄을 단축어 경계로 오인하지 않도록, 구분선이 하나라도 있으면
    // 오직 별표 구분선으로만 블록을 나눕니다. 구분선이 없는 TXT는 종전 방식과 호환됩니다.
    const useSeparator = SHORTCUT_SEPARATOR.test(source);
    const blocks = useSeparator ? source.split(SHORTCUT_SEPARATOR_SPLIT) : source.split(/\n\s*\n+/);
    if (!useSeparator) notes.push("별표 구분선(******)이 없어 빈 줄 기준으로 나눴습니다. 본문에 빈 줄이나 코드 블록이 있으면 구분선을 넣어 주세요.");

    const dropped = [];
    const items = blocks
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const lines = block.split("\n");
        while (lines.length && !lines[0].trim()) lines.shift();
        const name = stripBold((lines.shift() || "").trim())
          .replace(/^(?:이름|단축어\s*명?|name)[ \t]*[:：][ \t]*/i, "")
          .replace(/^\d{1,2}[.)][ \t]*/, "")
          .replace(/^[\s*#>\-–—•/／]+/, "")
          .replace(/[\s*#]+$/, "")
          .trim();
        const description = stripBold((lines.shift() || "").trim())
          .replace(/^[-*•]?[ \t]*(?:설명|description)[ \t]*[:：][ \t]*/i, "")
          .trim();
        if (lines.length) lines[0] = lines[0].replace(/^[ \t]*[-*•]?[ \t]*(?:\*\*)?(?:프롬프트|본문|prompt)(?:\*\*)?[ \t]*[:：][ \t]*/i, "");
        const body = lines.join("\n").trim();
        return { name, description, body };
      })
      .filter((item) => {
        const ok = item.name && item.description && item.body;
        if (!ok && (item.name || item.description)) dropped.push(item.name || item.description);
        return ok;
      });

    if (dropped.length) notes.push(`이름·설명·본문 3줄이 모두 없어 제외한 덩어리: ${dropped.slice(0, 5).join(", ")}${dropped.length > 5 ? " 외" : ""}`);
    return { items, notes };
  }

  function parseShortcuts(text) {
    return parseShortcutsDetailed(text).items;
  }

  // ------------------------------------------------------------------ 검증

  function inspect(kind, text) {
    if (kind === "main") {
      const value = clean(text);
      return { count: value ? 1 : 0, expected: 1, notes: value ? [] : ["파일이 비어 있습니다."], items: value };
    }
    if (kind === "start") {
      const { items, notes } = parseStartDetailed(text);
      return { count: items.length, expected: EXPECTED.start, notes, items };
    }
    if (kind === "media") {
      const { items, notes } = parseNumberedDetailed(text, false, EXPECTED.media);
      return { count: items.length, expected: EXPECTED.media, notes, items };
    }
    if (kind === "keyword") {
      const { items, notes } = parseNumberedDetailed(text, true, EXPECTED.keyword);
      return { count: items.length, expected: EXPECTED.keyword, notes, items };
    }
    if (kind === "shortcut") {
      const { items, notes } = parseShortcutsDetailed(text);
      return { count: items.length, expected: EXPECTED.shortcut, notes, items };
    }
    if (kind === "guide") {
      const { items, notes } = parseGuideDetailed(text);
      return { count: items.length, expected: EXPECTED.guide, notes, items };
    }
    if (kind === "recs") {
      const { items, notes } = parseRecsDetailed(text);
      return { count: items.length, expected: EXPECTED.recs, notes, items };
    }
    return { count: 0, expected: 0, notes: [], items: null };
  }

  function validate(files = {}) {
    const has = (kind) => Object.prototype.hasOwnProperty.call(files, kind);
    const kinds = ["main", "start", "guide", "recs", "media", "keyword", "shortcut"];
    const selected = kinds.filter(has);

    const reports = {};
    const parsed = { main: null, start: null, guide: null, recs: null, media: null, keyword: null, shortcut: null };
    for (const kind of selected) {
      reports[kind] = inspect(kind, files[kind]);
      parsed[kind] = reports[kind].items;
    }

    const errors = [];
    const warnings = [];
    // 사람이 아니라 GPT에게 되돌려 보낼 수정 요청을 만들기 위한 구조화된 문제 목록
    const issues = [];
    const fail = (kind, text, ask) => { errors.push(text); issues.push({ kind, text: ask || text, blocking: true }); };
    if (!selected.length) errors.push("처리할 TXT가 하나도 선택되지 않았습니다.");

    for (const kind of selected) {
      const { count, expected, notes } = reports[kind];
      const tail = notes.length ? `\n  · ${notes.join("\n  · ")}` : "";
      if (kind === "main") {
        if (!count) fail("main", `main TXT가 비어 있습니다.${tail}`, "내용이 비어 있어.");
        continue;
      }
      if (!count) fail(kind, `${kind}에서 항목을 하나도 인식하지 못했습니다.${tail}`, `형식을 하나도 인식하지 못했어. 규칙의 형식 그대로 다시 써 줘.`);
      else if (count > expected) fail(kind, `${kind}는 최대 ${expected}개인데 ${count}개가 인식됐습니다. 초과분은 넣을 자리가 없습니다.${tail}`, `정확히 ${expected}개여야 하는데 ${count}개로 읽혔어.`);
      else if (count < expected) {
        warnings.push(`${kind} ${count}/${expected} · 인식된 ${count}개만 입력합니다.${tail}`);
        if (kind !== "guide" && kind !== "recs") issues.push({ kind, text: `${expected}개가 필요한데 ${count}개만 읽혔어. 빠진 항목까지 채워서 ${expected}개로 맞춰 줘.` });
      }
      else if (notes.length) warnings.push(`${kind} ${count}/${expected}${tail}`);
    }

    (parsed.start || []).forEach((item, index) => {
      if (item.name.length > 12) fail("start", `시작 설정 ${index + 1} 이름이 12자를 넘습니다: ${item.name}`);
      if (item.prologue.length > 1000) fail("start", `시작 설정 ${index + 1}(${item.name}) 프롤로그가 1000자를 넘습니다. (${item.prologue.length}자)`);
      if (item.situation.length > 1000) fail("start", `시작 설정 ${index + 1}(${item.name}) 시작 상황이 1000자를 넘습니다. (${item.situation.length}자)`);
      if (item.playGuide.length > 500) fail("start", `시작 설정 ${index + 1}(${item.name}) 플레이 가이드가 500자를 넘습니다. (${item.playGuide.length}자)`);
      if (item.recommendations.length > 3) fail("start", `시작 설정 ${index + 1}(${item.name}) 추천 답변이 3개를 넘습니다.`);
    });
    (parsed.guide || []).forEach((item) => {
      if (item.body.length > 500) fail("guide", `플레이가이드 ‘${item.name}’이(가) 500자를 넘습니다. (${item.body.length}자)`);
    });
    (parsed.recs || []).forEach((item) => {
      if (item.items.length > 3) fail("recs", `추천 답변 ‘${item.name}’이(가) 3개를 넘습니다. (${item.items.length}개)`);
      item.items.forEach((value, k) => {
        if (value.length > 200) fail("recs", `추천 답변 ‘${item.name}’ ${k + 1}번이 200자를 넘습니다. (${value.length}자)`);
      });
    });
    (parsed.start || []).forEach((item, index) => {
      (item.recommendations || []).forEach((value, k) => {
        if (value.length > 200) fail("start", `시작 설정 ${index + 1}(${item.name}) 추천 답변 ${k + 1}번이 200자를 넘습니다. (${value.length}자)`);
      });
    });

    // start와 함께 고르면 이름(안 맞으면 순서)으로 짝지어 같은 탭에 넣습니다.
    if (parsed.start && (parsed.guide || parsed.recs)) {
      const names = parsed.start.map((item) => item.name);
      for (const [kind, apply] of [["guide", (item, extra) => { item.playGuide = extra.body; }], ["recs", (item, extra) => { item.recommendations = extra.items.slice(0, 3); }]]) {
        if (!parsed[kind]) continue;
        const { aligned, unmatched, byOrder } = alignExtras(names, parsed[kind]);
        aligned.forEach((extra, i) => { if (extra) apply(parsed.start[i], extra); });
        if (byOrder) warnings.push(`${kind}: start의 이름과 다른 제목이 있어 파일에 적힌 순서대로 짝지었습니다.`);
        if (unmatched.length) warnings.push(`${kind}: start에 없는 이름이라 넣지 않습니다 → ${unmatched.join(", ")}`);
      }
    }

    (parsed.media || []).forEach((item, index) => {
      if (!item.title) fail("media", `미디어 ${index + 1} 제목이 비어 있습니다.`);
      if (item.body.length > 50) fail("media", `미디어 ${index + 1} 상황이 50자를 넘습니다. (${item.body.length}자)`);
    });
    (parsed.keyword || []).forEach((item, index) => {
      if (!item.title) fail("keyword", `키워드북 ${index + 1} 제목이 비어 있습니다.`);
      if (item.body.length > 400) fail("keyword", `키워드북 ${index + 1}(${item.title}) 정보가 400자를 넘습니다. (${item.body.length}자)`);
      if (!item.keywords.length) fail("keyword", `키워드북 ${index + 1}(${item.title}) 키워드가 비어 있습니다. \`키워드: 단어1 단어2\` 줄을 넣어 주세요.`);
      if (item.keywords.length > 5) fail("keyword", `키워드북 ${index + 1}(${item.title}) 키워드가 5개를 넘습니다.`);
    });
    (parsed.shortcut || []).forEach((item, index) => {
      if (item.name.length > 10) fail("shortcut", `단축어 ${index + 1}(${item.name}) 이름이 10자를 넘습니다.`);
      if (item.description.length > 30) fail("shortcut", `단축어 ${index + 1}(${item.name}) 설명이 30자를 넘습니다. (${item.description.length}자)`);
      if (item.body.length > 400) fail("shortcut", `단축어 ${index + 1}(${item.name}) 프롬프트 본문이 400자를 넘습니다. (${item.body.length}자)`);
    });

    return { parsed, selected, errors, warnings, reports, issues };
  }


  // ------------------------------------------------ 붙여넣기 통합 분리기
  // GPT 답변을 통째로 붙여넣으면 "===== keyword =====" 같은 구분 줄로 구역을 나눕니다.
  // 구분 줄은 느슨하게 인식합니다: "### keyword", "📄 천사실격_keyword.txt", "**[main] 스토리 설정**",
  // "파일명: start.txt", "===== 키워드북 =====" 등.

  const KINDS = ["main", "start", "media", "keyword", "shortcut"];
  const KIND_ALIASES = [
    ["main", /^(?:메인|스토리\s*설정|세계관)$/],
    ["start", /^(?:시작\s*설정|시작\s*상황|프롤로그)$/],
    ["media", /^(?:미디어)$/],
    ["keyword", /^(?:키워드\s*북|키워드)$/],
    ["shortcut", /^(?:단축어)$/],
  ];
  const FENCE = /^[ \t]*(?:```|~~~)/;

  function markerKind(line) {
    const raw = String(line ?? "").normalize("NFKC").trim();
    if (!raw || raw.length > 80 || FENCE.test(raw)) return null;
    // 별표만 있는 줄(단축어 구분선)이나 대괄호 헤더 본문(*[이름 프롤로그])은 구분 줄이 아닙니다.
    if (/^[*＊\s]+$/.test(raw)) return null;
    const strong = /={3,}|-{3,}|^#{1,6}\s|\.txt\b|파일\s*명?\s*[:：]|file\s*name/i.test(raw);
    const decorated = strong || /\*\*|`|[\[【]|📄|📁|→/.test(raw);

    // "스토리 설정 (main)" 처럼 괄호 안에 종류가 있는 경우
    const inParen = raw.match(/[（(]\s*(?:[^()（）\s]*[_\-])?(main|start|media|keyword|shortcut)(?:\.txt)?\s*[)）]/i);
    if (inParen && raw.replace(inParen[0], "").replace(/[=#*`\[\]【】\-\s:：]/g, "").length <= 12) {
      return inParen[1].toLowerCase();
    }

    let core = raw
      .replace(/[（(][^)）]*[)）]/g, " ")
      .replace(/\.txt\b/gi, " ")
      .replace(/(?:파일\s*명?|file\s*name|file)\s*[:：]?/gi, " ")
      .replace(/[=#*`\[\]【】<>:：|~\-–—→•·📄📁\s]+/gu, " ")
      .trim();
    const lower = core.toLowerCase();

    const m = lower.match(/^(?:(\S{1,30})[_ ])?(main|start|media|keyword|shortcut)(?:\s+[가-힣 ]{1,12})?$/);
    if (m) {
      const prefix = m[1] || "";
      if (/^\d+$/.test(prefix)) return null;          // "1 start" 같은 번호 제목은 제외
      if (!m[1] && lower === m[2]) return m[2];       // 한 줄에 종류 이름만
      if (decorated) return m[2];
      return null;
    }
    // 한글 이름("키워드북", "세계관")은 ===== 구분 줄일 때만 인정합니다.
    // "# 세계관" 같은 본문 제목 줄이 구역을 쪼개지 않게 하기 위해서입니다.
    if (/={3,}/.test(raw)) {
      for (const [kind, pattern] of KIND_ALIASES) if (pattern.test(core)) return kind;
    }
    return null;
  }

  function trimFences(text) {
    let lines = String(text).split("\n");
    const isFence = (line) => FENCE.test(line);
    // 구역 전체를 감싼 코드블록: 첫 펜스와 마지막 펜스 사이만 사용
    const firstReal = lines.findIndex((line) => line.trim());
    if (firstReal >= 0 && isFence(lines[firstReal])) {
      let last = -1;
      for (let i = lines.length - 1; i > firstReal; i -= 1) if (isFence(lines[i])) { last = i; break; }
      lines = last > firstReal ? lines.slice(firstReal + 1, last) : lines.slice(firstReal + 1);
    }
    // 펜스 개수가 홀수면 마지막 펜스는 바깥 코드블록을 닫는 줄 → 그 뒤 GPT 잡담은 버림
    const fences = lines.map((line, i) => (isFence(line) ? i : -1)).filter((i) => i >= 0);
    if (fences.length % 2 === 1) lines = lines.slice(0, fences[fences.length - 1]);
    // 가장자리의 빈 줄·펜스 줄 정리
    while (lines.length && (!lines[0].trim() || isFence(lines[0]))) lines.shift();
    while (lines.length && (!lines[lines.length - 1].trim() || isFence(lines[lines.length - 1]))) lines.pop();
    return lines.join("\n");
  }

  function splitCombined(text) {
    const lines = clean(text).split("\n");
    const marks = [];
    lines.forEach((line, index) => {
      const kind = markerKind(line);
      if (kind) marks.push({ kind, index });
    });
    const sections = {};
    const order = [];
    marks.forEach((mark, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].index : lines.length;
      const body = trimFences(lines.slice(mark.index + 1, end).join("\n"));
      if (!body.trim()) return;
      if (sections[mark.kind]) sections[mark.kind] += `\n\n${body}`;   // 같은 구역이 이어서 온 경우
      else order.push(mark.kind);
      sections[mark.kind] = sections[mark.kind] ? sections[mark.kind] : body;
    });
    return { sections, order, marked: marks.length > 0 };
  }

  // 구분 줄이 없을 때 내용만 보고 종류를 추정합니다. 확신이 없으면 null.
  function guessKind(text) {
    const source = trimFences(clean(text));
    if (!source) return null;
    const lines = source.split("\n");
    if (collectStartSections(source).some((item) => item.key === "prologue" || item.key === "situation")) return "start";
    if (lines.filter((line) => /^[ \t]*[*＊]{4,}[ \t]*$/.test(line)).length >= 2) return "shortcut";
    if (lines.filter((line) => KEYWORD_LINE.test(stripBold(line))).length >= 2) return "keyword";
    return null;
  }

  globalThis.CrackTxtParser = {
    clean,
    inspect,
    expectedCount: (kind) => EXPECTED[kind],
    parseStart,
    parseStartDetailed,
    parseNumbered,
    parseNumberedDetailed,
    parseShortcuts,
    parseShortcutsDetailed,
    parseGuideDetailed,
    parseRecsDetailed,
    alignExtras,
    validate,
    splitCombined,
    guessKind,
    trimFences,
    markerKind,
  };
})();
