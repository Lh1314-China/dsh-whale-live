/**
 * 不带 DSH 也能跑的宿主装配测试：
 * 用最小 ctx 桩把 apply 跑一遍，确认激活阶段不抛错、两个工具都注册上。
 *   node test/apply.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../index.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-live-apply-'));
const registered = [];
const disposers = [];
const logs = [];

const ctx = {
  logger: {
    info: (...args) => logs.push(['info', ...args]),
    warn: (...args) => logs.push(['warn', ...args]),
    error: (...args) => logs.push(['error', ...args]),
  },
  effect(fn) {
    const dispose = fn();
    disposers.push(dispose);
    return dispose;
  },
  tools: {
    register(tool) {
      registered.push(tool.name);
      return () => {};
    },
  },
  get() {
    return undefined;
  },
  inject() {
    return () => {};
  },
};

await apply(ctx, {
  dataDir,
  roomId: 123456,
  roomName: '测试房',
  pythonPath: process.execPath,
  listenWaitSec: 3,
});

assert.deepEqual(registered.sort(), ['whale_live', 'whale_say'], '两个工具都要注册');
assert.ok(fs.existsSync(path.join(dataDir, '意识.md')), '意识.md 要种出来');
assert.ok(fs.existsSync(path.join(dataDir, '人类观察日记.md')), '日记要种出来');
assert.ok(logs.some(([level, msg]) => level === 'info' && String(msg).includes('whale-live')), '要留一行启动日志');

for (const dispose of disposers) {
  if (typeof dispose === 'function') dispose();
}

fs.rmSync(dataDir, { recursive: true, force: true });
console.log('apply: 全过');
