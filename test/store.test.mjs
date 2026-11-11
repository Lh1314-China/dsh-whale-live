/**
 * 不装插件也能跑的 store 冒烟测试：
 *   node test/store.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-live-test-'));
const store = createStore({ dataDir: root });
store.ensure();

assert.ok(fs.existsSync(store.paths.docs.consciousness), '意识.md 应该被种出来');
assert.ok(fs.existsSync(store.paths.docs.diary), '日记应该被种出来');

// 1. 日记：同一天、同一个人，追加两笔
store.noteDiary({ audience: '观众乙', text: '问我一顿吃几碗饭', date: '2026-11-10' });
store.noteDiary({ audience: '观众乙', text: '说要守碗等我', date: '2026-11-10' });
store.noteDiary({ audience: '观众甲', text: '下播前说下次还来', date: '2026-11-10' });

let diary = fs.readFileSync(store.paths.docs.diary, 'utf8');
assert.match(diary, /## 2026-11-10/);
assert.match(diary, /### 观众乙\n- \[\d\d:\d\d\] 问我一顿吃几碗饭\n- \[\d\d:\d\d\] 说要守碗等我/);
assert.match(diary, /### 观众甲/);
assert.match(diary, /- 2026-11-10 · 2 人 · 3 件/, '索引要跟着重建');

// 2. 新的一天插在最上面，索引也跟着走
store.noteDiary({ audience: '观众', text: '今天也在', date: '2026-11-11' });
diary = fs.readFileSync(store.paths.docs.diary, 'utf8');
const order = [...diary.matchAll(/^## (\d{4}-\d{2}-\d{2})$/gm)].map((m) => m[1]);
assert.deepEqual(order, ['2026-11-11', '2026-11-10'], '新的那天要在最上面');
assert.match(diary, /- 2026-11-11 · 1 人 · 1 件/);

// 3. 往已有那天的空小节里写（桌面旧日记的格式）
fs.writeFileSync(store.paths.docs.diary, [
  '# 人类观察日记',
  '',
  '## 索引',
  '',
  '- 2026-11-09 · 3 人 · 0 件',
  '',
  '## 2026-11-09',
  '',
  '### 观众A',
  '### 观众B',
  '',
].join('\n'), 'utf8');
store.noteDiary({ audience: '观众B', text: '第一次来', date: '2026-11-09' });
diary = fs.readFileSync(store.paths.docs.diary, 'utf8');
assert.match(diary, /### 观众B\n- \[\d\d:\d\d\] 第一次来/);
assert.match(diary, /### 观众A\n### 观众B/, '空小节之间不要被撑开');
assert.match(diary, /- 2026-11-09 · 2 人 · 1 件/);

// 4. 意识卡：核心经历 + 心情 + 性格变化
store.noteConsciousness({ text: '观众乙问饭量，我到现在没数清', section: 'experience', date: '2026-11-10' });
store.noteConsciousness({ text: '（那天的心情：安静得有点冷清）', section: 'experience', date: '2026-11-10' });
store.noteConsciousness({ text: '开始会主动惦记没聊够的人', section: 'personality', date: '2026-11-10' });
const mind = fs.readFileSync(store.paths.docs.consciousness, 'utf8');
assert.match(mind, /## 核心经历\n\n- 2026-11-10　观众乙问饭量/);
assert.match(mind, /- 2026-11-10　（那天的心情：安静得有点冷清）/);
assert.match(mind, /## 性格变化\n\n- 2026-11-10　开始会主动惦记/);

// 5. 场次：开播 → 事件 → 下播
const opened = store.openSession({ roomId: 123456, roomName: '示例直播间' });
assert.equal(opened.created, true);
store.appendEvent({ kind: 'danmaku', user: '观众乙', text: '今天吃几碗' });
store.appendEvent({ kind: 'say', text: '欸嘿，今天先吃五碗' });
store.appendEvent({ kind: 'note', text: '观众乙又问我饭量' });
const closed = store.closeSession({ text: '测试' });
assert.equal(closed.says, 1);
assert.equal(closed.danmaku, 1);
assert.equal(closed.notes, 1);
assert.equal(store.state().session, null);
const transcript = store.sessionDoc(closed.id, 5000).text;
assert.match(transcript, /观众乙：今天吃几碗/);
assert.match(transcript, /大肥鱼：欸嘿/);
assert.match(transcript, /下播。/);
assert.equal(store.listSessions(5)[0].id, closed.id);

// 6. 入忆候选：排队 → 销账
const candidate = store.addCandidate({ text: '观众乙从来没在饭点出现过', kind: 'observation', importance: 0.7, reason: '有点在意' });
assert.equal(store.listCandidates()[0].status, 'pending');
assert.equal(store.decideCandidate(candidate.id, 'committed').status, 'committed');
assert.equal(store.listCandidates()[0].status, 'committed');

// 7. 统计能读出来
const stats = store.stats();
assert.ok(stats.docs.consciousness.chars > 0);
assert.ok(stats.sessions.length >= 1);

// 8. 带 BOM 的文档：读进来要去掉 BOM，写回去也不能再带
fs.writeFileSync(store.paths.docs.diary, '\uFEFF# 人类观察日记\n\n## 索引\n\n', 'utf8');
store.noteDiary({ audience: '观众', text: '带 BOM 的日记', date: '2026-11-12' });
const withBom = fs.readFileSync(store.paths.docs.diary, 'utf8');
assert.ok(!withBom.startsWith('\uFEFF'), 'BOM 要去掉');
assert.match(withBom, /^# 人类观察日记/);
assert.match(withBom, /- 2026-11-12 · 1 人 · 1 件/);

fs.rmSync(root, { recursive: true, force: true });
console.log('store: 全过');
