/**
 * VTube Studio 的“手”：热键、表情、嘴型。
 * 走 vtube-bridge 里现成的 vts_client.py，不重复造轮子。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function createVts(config = {}, logger = null) {
  const dir = String(config.vtubeDir || '');
  const pythonPath = String(config.pythonPath || '');

  function runCli(args, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const script = dir ? path.join(dir, 'vts_client.py') : '';
      if (!dir || !pythonPath || !fs.existsSync(script)) {
        resolve({ ok: false, error: '没配 vtubeDir / pythonPath，或找不到 vts_client.py' });
        return;
      }
      const child = spawn(pythonPath, [script, ...args], {
        cwd: dir,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      let out = '';
      let err = '';
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk) => { out += chunk; });
      child.stderr?.on('data', (chunk) => { err += chunk; });
      const killer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* 已退出 */
        }
      }, timeoutMs);
      child.on('error', (error) => {
        clearTimeout(killer);
        resolve({ ok: false, error: error.message });
      });
      child.on('close', (code) => {
        clearTimeout(killer);
        resolve({ ok: code === 0, out: out.trim().slice(-600), err: err.trim().slice(-300) });
      });
    });
  }

  return {
    async hotkey(name) {
      const result = await runCli(['hotkey', String(name ?? '')]);
      logger?.info?.(`whale-live: VTS hotkey ${name} ok=${result.ok}`);
      return { ...result, action: `hotkey:${name}` };
    },
    async expression(name, on = true) {
      const result = await runCli(['expr', String(name ?? ''), on ? 'on' : 'off']);
      logger?.info?.(`whale-live: VTS expr ${name} ${on ? 'on' : 'off'} ok=${result.ok}`);
      return { ...result, action: `expr:${name}:${on ? 'on' : 'off'}` };
    },
    async mouth(value) {
      const result = await runCli(['mouth', String(Number(value) || 0)]);
      return { ...result, action: `mouth:${Number(value) || 0}` };
    },
  };
}
