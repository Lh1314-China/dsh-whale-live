/**
 * 皮套（VTube Studio）这一侧：
 *   - status：8001 的插件 API 通不通
 *   - open  ：没开就通过 Steam 拉起来（就是桌面「大肥鱼开播」干的第一件事）
 *
 * 注意：不再拉起旧的 run_vts.py 守护。旧的守护自带一套弹幕→大脑→说话，
 * 会和本鲸抢话说；现在说话的脑子是本鲸自己，皮套只负责张嘴。
 */
import { spawn } from 'node:child_process';
import net from 'node:net';

const VTS_PORT = 8001;
const VTS_STEAM_APP = '1325860';

function portOpen(port, timeout = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}

export function createAvatar(config = {}, logger = null) {
  const steamApp = String(config.vtsSteamApp || VTS_STEAM_APP);
  const port = Number(config.vtsPort || VTS_PORT);
  let cache = { at: 0, up: false };

  async function status() {
    if (Date.now() - cache.at < 4000) return { port, up: cache.up, steamApp };
    const up = await portOpen(port);
    cache = { at: Date.now(), up };
    return { port, up, steamApp };
  }

  /** 交给 Steam 拉起 VTS，不等它就绪（它可能要几十秒）。 */
  function open() {
    try {
      const child = spawn('cmd.exe', ['/c', 'start', '', `steam://rungameid/${steamApp}`], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      cache = { at: 0, up: false };
      logger?.info?.(`whale-live: 已请 Steam 拉起 VTS（${steamApp}）`);
      return { launched: true, steamApp };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.warn?.(`whale-live: 拉起 VTS 失败：${message}`);
      return { launched: false, steamApp, error: message };
    }
  }

  /** 等皮套的 API 上来；最多 waitSec 秒。 */
  async function wait(waitSec = 45) {
    const started = Date.now();
    const deadline = started + Math.max(3, Number(waitSec) || 45) * 1000;
    while (Date.now() < deadline) {
      if (await portOpen(port)) {
        cache = { at: Date.now(), up: true };
        return { up: true, port, waitedMs: Date.now() - started, done: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return { up: false, port, waitedMs: Date.now() - started, done: false };
  }

  return { port, steamApp, status, open, wait };
}
