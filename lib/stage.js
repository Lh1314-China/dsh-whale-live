/**
 * 开播前的「架设备」：Steam / VTube Studio / OBS / 直播姬 / 直播间页面。
 * 只负责“准备好”，不开始推流；已经在跑的不会重复拉。
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';

function run(file, args, timeoutMs = 12000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: String(stdout ?? ''), err: String(stderr ?? ''), error: error ? error.message : null });
    });
  });
}

function tasklistHas(imageName) {
  return run('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/NH']).then((result) => {
    if (!result.ok) return false;
    return result.out.toLowerCase().includes(imageName.toLowerCase());
  });
}

export function createStage(config = {}, avatar, logger = null) {
  const obsPath = String(config.obsPath || '');
  const livehimePath = String(config.livehimePath || '');
  const vtsPath = String(config.vtsPath || '');
  const stageWaitSec = Math.max(20, Math.min(180, Number(config.stageWaitSec) || 90));
  const roomId = Number(config.roomId) || 0;
  const roomUrl = String(config.roomUrl || (roomId ? `https://live.bilibili.com/${roomId}` : ''));
  const openRoomPage = config.openRoomPage !== false;

  async function appStatus() {
    const [skin, obs, livehime, steam] = await Promise.all([
      avatar.status(),
      tasklistHas('obs64.exe'),
      tasklistHas('livehime.exe'),
      tasklistHas('steam.exe'),
    ]);
    return {
      steam: { running: steam },
      vts: { running: skin.up },
      obs: { configured: Boolean(obsPath), exists: Boolean(obsPath) && fs.existsSync(obsPath), running: obs, path: obsPath },
      livehime: {
        configured: Boolean(livehimePath),
        exists: Boolean(livehimePath) && fs.existsSync(livehimePath),
        running: livehime,
        path: livehimePath,
      },
    };
  }

  function launch(file, args, label) {
    try {
      const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      logger?.info?.(`whale-live: 已启动 ${label || file}`);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  /** 架镜头：四件软件 + 直播间页面，全部只“准备好”。 */
  async function stage() {
    const steps = [];
    const apps = await appStatus();

    steps.push({
      id: 'steam',
      ok: apps.steam.running,
      optional: true,
      text: apps.steam.running ? 'Steam 已在运行' : 'Steam 没开（VTS 要靠它拉起）',
    });

    if (apps.vts.running) {
      steps.push({ id: 'vts', ok: true, text: 'VTube Studio 已在运行' });
    } else if (vtsPath && fs.existsSync(vtsPath)) {
      const started = launch(vtsPath, [], 'VTube Studio');
      steps.push({ id: 'vts', ok: started.ok, text: started.ok ? 'VTube Studio 已直接拉起（等它开 API）' : `VTS 启动失败：${started.error}` });
    } else {
      const opened = avatar.open();
      steps.push({
        id: 'vts',
        ok: opened.launched === true,
        text: opened.launched ? '已请 Steam 拉起 VTube Studio（冷启动会慢）' : `VTS 拉不起来：${opened.error || '未知'}`,
      });
    }

    if (!apps.obs.configured) {
      steps.push({ id: 'obs', ok: false, optional: true, text: '没配 obsPath，跳过 OBS' });
    } else if (!apps.obs.exists) {
      steps.push({ id: 'obs', ok: false, text: `OBS 路径不存在：${obsPath}` });
    } else if (apps.obs.running) {
      steps.push({ id: 'obs', ok: true, text: 'OBS 已在运行（没推流）' });
    } else {
      const started = launch(obsPath, [], 'OBS');
      steps.push({ id: 'obs', ok: started.ok, text: started.ok ? 'OBS 已拉起（没推流）' : `OBS 启动失败：${started.error}` });
    }

    if (!apps.livehime.configured) {
      steps.push({ id: 'livehime', ok: false, optional: true, text: '没配 livehimePath，跳过直播姬' });
    } else if (!apps.livehime.exists) {
      steps.push({ id: 'livehime', ok: false, text: `直播姬路径不存在：${livehimePath}` });
    } else if (apps.livehime.running) {
      steps.push({ id: 'livehime', ok: true, text: '直播姬已在运行' });
    } else {
      const started = launch(livehimePath, [], '直播姬');
      steps.push({ id: 'livehime', ok: started.ok, text: started.ok ? '直播姬已拉起' : `直播姬启动失败：${started.error}` });
    }

    if (openRoomPage && roomUrl) {
      const page = launch('cmd.exe', ['/c', 'start', '', roomUrl], '直播间页面');
      steps.push({ id: 'room', ok: page.ok, text: page.ok ? `已打开直播间页面：${roomUrl}` : `打开页面失败：${page.error}` });
    } else {
      steps.push({ id: 'room', ok: false, optional: true, text: '没开直播间页面（房号为空或 openRoomPage=false）' });
    }

    const ready = await avatar.wait(stageWaitSec);
    return { steps, avatar: ready, apps };
  }

  return { stage, appStatus, roomUrl };
}
