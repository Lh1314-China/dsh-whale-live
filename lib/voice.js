/**
 * 说话：spawn runtime/say.py（edge-tts 合成 + MCI 播放）。
 *
 * 皮套开着的话顺便推嘴型（say.py 自己连 VTS；连不上就只出声）。
 * 一个时刻只允许一句在响；interrupt 就先掐断旧的再念新的。
 * 掐断靠杀进程 + 写 stop 文件；进程没了，MCI 设备跟着关，嘴上再归零一次。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAY_SCRIPT = path.join(HERE, '..', 'runtime', 'say.py');
const RESET_SCRIPT = path.join(HERE, '..', 'runtime', 'vts_reset.py');
const MAX_TEXT = 300;

export function createVoice(config = {}, store = null, logger = null, avatar = null) {
  const pythonPath = config.pythonPath;
  const audioDir = path.join(store?.paths?.dataDir ?? process.cwd(), '音频');
  const tmpDir = path.join(store?.paths?.dataDir ?? process.cwd(), 'tmp');
  const stopFile = path.join(tmpDir, 'stop.flag');
  const vtubeDir = config.vtubeDir ?? '';

  let current = null;

  function cleanup() {
    try {
      fs.rmSync(stopFile, { force: true });
    } catch {
      /* 清不掉就算 */
    }
  }

  function resetMouth() {
    if (!vtubeDir || !pythonPath || !fs.existsSync(RESET_SCRIPT)) return;
    try {
      const child = spawn(pythonPath, [RESET_SCRIPT, '--vts-dir', vtubeDir], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      // spawn 失败是异步 'error' 事件，try/catch 抓不到；不接住会打死宿主。
      child.on('error', (error) => {
        logger?.warn?.(`whale-live: 复位口型失败：${error?.message ?? error}`);
      });
      child.unref();
    } catch {
      /* 皮套没开就算了 */
    }
  }

  function stop() {
    if (!current) return false;
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(stopFile, '1', 'utf8');
    } catch {
      /* 写不进 stop 文件就只杀进程 */
    }
    try {
      current.child.kill();
    } catch {
      /* 已经退出 */
    }
    current = null;
    resetMouth();
    return true;
  }

  async function say(rawText, options = {}) {
    const text = String(rawText ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return { ok: false, error: '没有要念的字' };
    if (text.length > MAX_TEXT) {
      return { ok: false, error: `这句太长（${text.length} 字，上限 ${MAX_TEXT}）` };
    }
    if (!pythonPath || !fs.existsSync(pythonPath)) {
      return { ok: false, error: `找不到 python：${pythonPath ?? '(未配置)'}` };
    }
    if (options.interrupt !== false) stop();
    if (current) {
      return { ok: false, busy: true, error: '上一句还在说（要打断请带 interrupt）' };
    }

    // 不靠端口探测决定：只要配了 vtubeDir 就带上，say.py 自己连不上会安静回退。
    const useVts = Boolean(vtubeDir) && fs.existsSync(path.join(vtubeDir, 'vts_speak.py'));

    cleanup();
    fs.mkdirSync(audioDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const args = [
      SAY_SCRIPT,
      '--text', text,
      '--voice', config.voice || 'zh-CN-XiaoyiNeural',
      '--rate', config.rate || '+0%',
      '--pitch', config.pitch || '+0Hz',
      '--out-dir', audioDir,
      '--stop-file', stopFile,
      '--max-sec', String(config.maxSec || 60),
    ];
    if (useVts) args.push('--vts-dir', vtubeDir);

    const started = Date.now();
    const child = spawn(pythonPath, args, {
      cwd: audioDir,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const entry = { child, text, startedAt: started, vts: useVts };
    current = entry;

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 64_000) stdout = stdout.slice(-64_000);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });

    const killer = setTimeout(() => {
      logger?.warn?.('whale-live: 说话超时，掐断');
      try {
        child.kill();
      } catch {
        /* 已退出 */
      }
    }, Math.min(120_000, 20_000 + text.length * 500));

    return new Promise((resolve) => {
      child.on('error', (error) => {
        clearTimeout(killer);
        if (current === entry) current = null;
        resolve({ ok: false, error: `启动 python 失败：${error.message}` });
      });
      child.on('close', (code) => {
        clearTimeout(killer);
        if (current === entry) current = null;
        cleanup();
        let payload = null;
        for (const line of stdout.split(/\r?\n/).reverse()) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('{')) continue;
          try {
            payload = JSON.parse(trimmed);
            break;
          } catch {
            /* 继续往前找 */
          }
        }
        if (payload?.ok) {
          resolve({
            ok: true,
            path: payload.path,
            ms: payload.ms ?? Date.now() - started,
            interrupted: payload.interrupted === true,
            avatar: payload.avatar === true,
            vtsError: payload.avatar === true ? '' : stderr.trim().slice(-240),
            text,
          });
          return;
        }
        resolve({
          ok: false,
          error: payload?.error || stderr.trim().slice(-400) || `播放进程退出（code=${code}）`,
          text,
        });
      });
    });
  }

  return {
    say,
    stop,
    dispose: () => stop(),
    status: () => ({ speaking: Boolean(current), text: current?.text ?? null, since: current?.startedAt ?? null, avatar: current?.vts ?? false }),
  };
}
