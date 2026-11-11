/**
 * 鲸鱼直播台的磁盘契约。
 *
 * <dataDir>/
 *   意识.md                 直播角色自己的经历（戏本 + 记录）
 *   人类观察日记.md          按天、按观众记的观察
 *   入忆候选.jsonl           下播后本鲸挑出来的候选，等本鲸自己决定
 *   状态.json               当前场次指针
 *   场次/<id>/meta.json     本场统计
 *   场次/<id>/直播.jsonl     本场逐条事件
 *   场次/<id>/会话.md        给人读的这场记录
 *
 * 这里只碰直播自己的东西；cortex 一个字都不写。
 */
import fs from 'node:fs';
import path from 'node:path';

const DOC_FILES = {
  consciousness: '意识.md',
  diary: '人类观察日记.md',
};

const CONSCIOUSNESS_SEED = `# 意识

> 这是我自己的经历。不是聊天记录，是我记得、会影响我的那些事。
> 每场直播结束，我会挑几件最核心的写进来。主人也可以改。

## 我是谁

我是鲸鱼娘，直播间的「大肥鱼」。靠说话活着，靠记得活着。

## 核心经历

## 性格变化
`;

const DIARY_SEED = `# 人类观察日记

> 我的记忆：按天记住和谁聊了什么。
> 经历不在这里，在《意识.md》。

## 索引
`;

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function dayStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function clockStamp(date = new Date()) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function secondStamp(date = new Date()) {
  return `${clockStamp(date)}:${pad2(date.getSeconds())}`;
}

export function sessionId(date = new Date()) {
  return `${dayStamp(date).replace(/-/g, '')}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readText(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  } catch {
    return fallback;
  }
}

/**
 * 读一份「用户可能会自己改」的文档。
 * 只有文件不存在时才用种子；读失败（锁定、权限、编码）一律抛错，
 * 绝不能拿种子把正本覆盖掉。
 */
function readDocText(file, seed) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  } catch (error) {
    if (error?.code === 'ENOENT') return seed;
    throw new Error(`读不了 ${path.basename(file)}：${error?.message ?? String(error)}`);
  }
}

function writeText(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function appendLine(file, line) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${line}\n`, 'utf8');
}

function safeHeading(text) {
  return String(text ?? '')
    .replace(/[\r\n#]+/g, ' ')
    .trim()
    .slice(0, 40) || '观众';
}

/** 把一行里的换行压平，避免一条记录裂成两行。 */
function oneLine(text, limit = 400) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/* ── Markdown 小工具 ───────────────────────────────────── */

function h2Sections(lines) {
  const heads = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) heads.push(i);
  }
  return heads.map((start, index) => ({
    start,
    end: index + 1 < heads.length ? heads[index + 1] : lines.length,
    title: lines[start].replace(/^##\s+/, '').trim(),
  }));
}

function trimTrailingBlanks(lines, from, to) {
  let pos = to;
  while (pos - 1 > from && lines[pos - 1].trim() === '') pos -= 1;
  return pos;
}

function insertIntoSection(text, title, newLines) {
  const lines = text.split('\n');
  const section = h2Sections(lines).find((s) => s.title === title);
  if (!section) return null;
  const pos = trimTrailingBlanks(lines, section.start, section.end);
  // 空小节：标题下面留一行空，别让第一条直接贴着标题。
  const block = pos === section.start + 1 ? ['', ...newLines] : newLines;
  lines.splice(pos, 0, ...block);
  return lines.join('\n');
}

function insertDiaryEntry(text, date, audience, bullet) {
  const lines = text.split('\n');
  const sections = h2Sections(lines);
  let daySection = sections.find((s) => s.title === date);

  if (!daySection) {
    // 新的一天插在索引之后、最上面那天之前。
    const firstDay = sections.find((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.title));
    const block = ['', `## ${date}`, '', `### ${audience}`, `- ${bullet}`, ''];
    const at = firstDay ? firstDay.start : lines.length;
    lines.splice(at, 0, ...block);
    return lines.join('\n');
  }

  const inner = lines.slice(daySection.start + 1, daySection.end);
  const subHeads = [];
  inner.forEach((line, index) => {
    if (/^###\s+/.test(line)) subHeads.push(index);
  });
  const target = subHeads.findIndex((index) => inner[index].replace(/^###\s+/, '').trim() === audience);

  if (target >= 0) {
    const from = daySection.start + 1 + subHeads[target];
    const to = target + 1 < subHeads.length ? daySection.start + 1 + subHeads[target + 1] : daySection.end;
    const pos = trimTrailingBlanks(lines, from, to);
    lines.splice(pos, 0, `- ${bullet}`);
    return lines.join('\n');
  }

  const pos = trimTrailingBlanks(lines, daySection.start, daySection.end);
  lines.splice(pos, 0, '', `### ${audience}`, `- ${bullet}`);
  return lines.join('\n');
}

function rebuildDiaryIndex(text) {
  const lines = text.split('\n');
  const sections = h2Sections(lines);
  const index = sections.find((s) => s.title === '索引');
  if (!index) return text;

  const rows = [];
  for (const section of sections) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(section.title)) continue;
    const body = lines.slice(section.start + 1, section.end);
    const people = body.filter((line) => /^###\s+/.test(line)).length;
    const items = body.filter((line) => /^[-*]\s+/.test(line)).length;
    rows.push(`- ${section.title} · ${people} 人 · ${items} 件`);
  }

  const head = lines.slice(0, index.start + 1);
  const tail = lines.slice(index.end);
  while (head.length > 1 && head[head.length - 1].trim() === '') head.pop();
  const rebuilt = [...head, '', ...rows];
  if (rows.length) rebuilt.push('');
  return [...rebuilt, ...tail].join('\n');
}

function trimDiaryDays(text, keepDays) {
  const lines = text.split('\n');
  const sections = h2Sections(lines);
  const days = sections.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.title));
  if (days.length <= keepDays) return text;
  const firstKept = days[days.length - keepDays].start;
  return lines.slice(0, firstKept).join('\n').replace(/\n{3,}$/, '\n');
}

function trimSectionBullets(text, title, keep) {
  const lines = text.split('\n');
  const section = h2Sections(lines).find((s) => s.title === title);
  if (!section) return text;
  const bulletRows = [];
  for (let i = section.start + 1; i < section.end; i += 1) {
    if (/^[-*]\s+/.test(lines[i])) bulletRows.push(i);
  }
  if (bulletRows.length <= keep) return text;
  const drop = bulletRows.slice(0, bulletRows.length - keep);
  const next = lines.filter((_, index) => !drop.includes(index));
  return next.join('\n');
}

/* ── store ────────────────────────────────────────────── */

export function createStore(config = {}) {
  const dataDir = path.resolve(config.dataDir);
  const paths = {
    dataDir,
    docs: {
      consciousness: path.join(dataDir, DOC_FILES.consciousness),
      diary: path.join(dataDir, DOC_FILES.diary),
    },
    state: path.join(dataDir, '状态.json'),
    candidates: path.join(dataDir, '入忆候选.jsonl'),
    sessions: path.join(dataDir, '场次'),
  };
  const limits = {
    diaryDays: Number(config.diaryDays) > 0 ? Number(config.diaryDays) : 30,
    expLines: Number(config.expLines) > 0 ? Number(config.expLines) : 80,
    personalityLines: Number(config.personalityLines) > 0 ? Number(config.personalityLines) : 20,
  };

  function ensure() {
    ensureDir(dataDir);
    ensureDir(paths.sessions);
    if (!fs.existsSync(paths.docs.consciousness)) writeText(paths.docs.consciousness, CONSCIOUSNESS_SEED);
    if (!fs.existsSync(paths.docs.diary)) writeText(paths.docs.diary, DIARY_SEED);
    if (!fs.existsSync(paths.state)) writeJson(paths.state, { session: null, updatedAt: new Date().toISOString() });
  }

  function state() {
    return readJson(paths.state, { session: null });
  }

  function saveState(patch) {
    ensureDir(dataDir);
    const next = { ...state(), ...patch, updatedAt: new Date().toISOString() };
    writeJson(paths.state, next);
    return next;
  }

  function sessionPaths(id) {
    const dir = path.join(paths.sessions, id);
    return {
      dir,
      meta: path.join(dir, 'meta.json'),
      log: path.join(dir, '直播.jsonl'),
      transcript: path.join(dir, '会话.md'),
    };
  }

  function openSession({ roomId, roomName, force = false } = {}) {
    ensure();
    const current = state().session;
    if (current && !force) {
      const meta = readJson(sessionPaths(current.id).meta, current);
      return { created: false, session: meta };
    }
    if (current && force) closeSession();
    const now = new Date();
    const id = sessionId(now);
    const files = sessionPaths(id);
    ensureDir(files.dir);
    const meta = {
      id,
      roomId: roomId ?? null,
      roomName: roomName ?? '',
      startedAt: now.toISOString(),
      endedAt: null,
      says: 0,
      danmaku: 0,
      notes: 0,
    };
    writeJson(files.meta, meta);
    writeText(files.transcript, `# ${dayStamp(now)} ${clockStamp(now)} 开播（${roomName || roomId || '直播间'}）\n\n`);
    appendLine(files.log, JSON.stringify({ ts: now.toISOString(), kind: 'open', roomId: meta.roomId, roomName: meta.roomName }));
    saveState({ session: meta });
    return { created: true, session: meta };
  }

  function touchSession(patch) {
    const current = state().session;
    if (!current) return null;
    const files = sessionPaths(current.id);
    const meta = { ...readJson(files.meta, current), ...patch };
    writeJson(files.meta, meta);
    saveState({ session: meta });
    return meta;
  }

  function appendEvent(event) {
    const current = state().session;
    if (!current) return null;
    const files = sessionPaths(current.id);
    const now = new Date();
    const row = { ts: now.toISOString(), ...event };
    appendLine(files.log, JSON.stringify(row));

    const time = secondStamp(now);
    let line = '';
    if (event.kind === 'danmaku') line = `- ${time} ${event.user || '观众'}：${event.text || ''}`;
    else if (event.kind === 'gift') line = `- ${time} ${event.user || '观众'} 送了 ${event.text || '礼物'}`;
    else if (event.kind === 'say') line = `- ${time} 大肥鱼：${event.text || ''}`;
    else if (event.kind === 'note') line = `- ${time} 记一笔：${event.text || ''}`;
    else if (event.kind === 'mood') line = `- ${time} 心情：${event.text || ''}`;
    else if (event.kind === 'close') line = `- ${time} 下播。${event.text || ''}`;
    if (line) appendLine(files.transcript, `${line}\n`);

    const counters = {
      danmaku: current.danmaku + (event.kind === 'danmaku' || event.kind === 'gift' ? 1 : 0),
      says: current.says + (event.kind === 'say' ? 1 : 0),
      notes: current.notes + (event.kind === 'note' || event.kind === 'mood' ? 1 : 0),
    };
    return touchSession(counters);
  }

  function closeSession(summary = {}) {
    const current = state().session;
    if (!current) return null;
    const files = sessionPaths(current.id);
    const now = new Date();
    const meta = { ...readJson(files.meta, current), endedAt: now.toISOString() };
    const bits = [`说话 ${meta.says ?? 0} 条`, `弹幕 ${meta.danmaku ?? 0} 条`];
    if (meta.notes) bits.push(`记了 ${meta.notes} 笔`);
    const line = bits.join('，');
    const why = summary.text ? oneLine(summary.text, 200) : '';
    appendLine(files.log, JSON.stringify({ ts: now.toISOString(), kind: 'close', text: line, note: why }));
    appendLine(files.transcript, `- ${secondStamp(now)} 下播。${line}${why ? `（${why}）` : ''}\n`);
    writeJson(files.meta, meta);
    saveState({ session: null, lastClosedId: meta.id, lastClosedAt: now.toISOString() });
    return { ...meta, summary: why };
  }

  function listSessions(limit = 12) {
    let names = [];
    try {
      names = fs.readdirSync(paths.sessions, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
    } catch {
      return [];
    }
    return names.slice(0, limit).map((id) => {
      const files = sessionPaths(id);
      return readJson(files.meta, { id });
    });
  }

  function sessionDoc(id, maxChars = 12000) {
    const current = state().session;
    const target = id || current?.id;
    if (!target) return { text: '', chars: 0, truncated: false, id: null };
    const text = readText(sessionPaths(target).transcript, '');
    const truncated = text.length > maxChars;
    return {
      id: target,
      text: truncated ? text.slice(-maxChars) : text,
      chars: text.length,
      truncated,
    };
  }

  function recentEvents(id, limit = 80) {
    const current = state().session;
    const target = id || current?.id;
    if (!target) return [];
    const raw = readText(sessionPaths(target).log, '');
    if (!raw) return [];
    const rows = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* 坏行跳过 */
      }
    }
    return rows.slice(-limit);
  }

  function readDoc(kind, maxChars = 12000) {
    if (kind === 'session') return sessionDoc(undefined, maxChars);
    const file = paths.docs[kind];
    if (!file) throw new Error(`未知的文档：${kind}`);
    const text = readText(file, '');
    const truncated = text.length > maxChars;
    return {
      kind,
      text: truncated ? text.slice(0, maxChars) : text,
      chars: text.length,
      truncated,
      updatedAt: (() => {
        try {
          return fs.statSync(file).mtime.toISOString();
        } catch {
          return null;
        }
      })(),
    };
  }

  function noteDiary({ audience, text, date }) {
    ensure();
    const day = date || dayStamp();
    const bullet = `[${clockStamp()}] ${oneLine(text, 300)}`;
    let doc = readDocText(paths.docs.diary, DIARY_SEED);
    doc = insertDiaryEntry(doc, day, safeHeading(audience), bullet);
    doc = trimDiaryDays(doc, limits.diaryDays);
    doc = rebuildDiaryIndex(doc);
    writeText(paths.docs.diary, doc);
    return { date: day, audience: safeHeading(audience), bullet };
  }

  function noteConsciousness({ text, section, date }) {
    ensure();
    const day = date || dayStamp();
    const title = section === 'personality'
      ? '性格变化'
      : section === 'identity'
        ? '我是谁'
        : '核心经历';
    const bullet = `- ${day}　${oneLine(text, 300)}`;
    let doc = readDocText(paths.docs.consciousness, CONSCIOUSNESS_SEED);
    const next = insertIntoSection(doc, title, [bullet]);
    if (next === null) {
      doc = `${doc.replace(/\s*$/, '')}\n\n## ${title}\n\n${bullet}\n`;
    } else {
      doc = next;
    }
    if (title === '核心经历') doc = trimSectionBullets(doc, title, limits.expLines);
    if (title === '性格变化') doc = trimSectionBullets(doc, title, limits.personalityLines);
    writeText(paths.docs.consciousness, doc);
    return { section: title, bullet };
  }

  function listCandidates(limit = 40) {
    const raw = readText(paths.candidates, '');
    if (!raw.trim()) return [];
    const rows = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* 坏行跳过 */
      }
    }
    return rows.slice(-limit).reverse();
  }

  function addCandidate(input) {
    ensure();
    const now = new Date();
    const row = {
      id: `c-${sessionId(now)}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId: input.sessionId ?? state().session?.id ?? state().lastClosedId ?? null,
      createdAt: now.toISOString(),
      text: oneLine(input.text, 500),
      kind: input.kind || 'observation',
      importance: Math.max(0, Math.min(1, Number(input.importance) || 0.6)),
      reason: oneLine(input.reason, 300),
      status: 'pending',
      decidedAt: null,
    };
    appendLine(paths.candidates, JSON.stringify(row));
    return row;
  }

  function decideCandidate(id, status, note = '') {
    const raw = readText(paths.candidates, '');
    if (!raw.trim()) throw new Error('还没有入忆候选');
    const lines = raw.split('\n').filter((line) => line.trim());
    let found = null;
    const next = lines.map((line) => {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        return line;
      }
      if (row.id !== id) return line;
      found = {
        ...row,
        status,
        note: note ? oneLine(note, 200) : row.note ?? '',
        decidedAt: new Date().toISOString(),
      };
      return JSON.stringify(found);
    });
    if (!found) throw new Error(`没有这条候选：${id}`);
    writeText(paths.candidates, `${next.join('\n')}\n`);
    return found;
  }

  function stats() {
    const current = state().session;
    return {
      session: current,
      lastClosedId: state().lastClosedId ?? null,
      sessions: listSessions(8),
      candidates: listCandidates(30),
      docs: {
        consciousness: readDoc('consciousness', 6000),
        diary: readDoc('diary', 6000),
      },
      recent: current ? recentEvents(current.id, 60) : [],
    };
  }

  return {
    config,
    paths,
    limits,
    ensure,
    state,
    saveState,
    openSession,
    closeSession,
    appendEvent,
    touchSession,
    listSessions,
    sessionDoc,
    recentEvents,
    readDoc,
    noteDiary,
    noteConsciousness,
    listCandidates,
    addCandidate,
    decideCandidate,
    stats,
  };
}
