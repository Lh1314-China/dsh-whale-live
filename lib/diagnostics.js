/**
 * 装好之后的自检：不装任何东西，只如实报告「少了什么、去哪补」。
 * 软件（OBS / VTube Studio / 直播姬）需要人自己装；Python 依赖给 pip 提示。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function run(file, args, timeoutMs = 12000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: String(stdout ?? '').trim(), err: String(stderr ?? '').trim(), error: error ? error.message : null });
    });
  });
}

function check(id, label, ok, detail, hint = '', optional = false) {
  return { id, label, ok: Boolean(ok), detail: String(detail ?? ''), hint: String(hint ?? ''), optional };
}

export async function diagnose({ store, danmaku, avatar, stage, config }) {
  const checks = [];

  try {
    fs.accessSync(store.paths.dataDir, fs.constants.W_OK);
    checks.push(check('data', '数据目录', true, store.paths.dataDir));
  } catch (error) {
    checks.push(check('data', '数据目录', false, String(error?.message ?? error), '把 dataDir 改到可写目录'));
  }

  const pythonPath = String(config.pythonPath || '');
  if (!pythonPath) {
    checks.push(check('python', 'Python / edge-tts', false, '没配 pythonPath', '填一个装了 edge-tts 的 python.exe', true));
  } else if (!fs.existsSync(pythonPath)) {
    checks.push(check('python', 'Python / edge-tts', false, `找不到 ${pythonPath}`, '检查路径'));
  } else {
    const r = await run(pythonPath, ['-c', 'import edge_tts; print(getattr(edge_tts, "__version__", "ok"))']);
    checks.push(check('python', 'Python / edge-tts', r.ok, r.ok ? `edge-tts ${r.out}` : (r.err || r.error || '导入失败'), r.ok ? '' : 'pip install edge-tts'));
  }

  const credentialFile = String(config.credentialFile || '');
  if (!credentialFile) {
    checks.push(check('cred', 'B站凭据', false, '没配 credentialFile', '导出 cookie JSON 后填路径', true));
  } else if (!fs.existsSync(credentialFile)) {
    checks.push(check('cred', 'B站凭据', false, `找不到 ${credentialFile}`, '检查路径'));
  } else {
    try {
      const data = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
      const missing = ['sessdata', 'bili_jct', 'buvid3', 'dedeuserid'].filter((key) => !data[key]);
      checks.push(check('cred', 'B站凭据', missing.length === 0, missing.length ? `缺 ${missing.join(',')}` : '字段齐全'));
    } catch {
      checks.push(check('cred', 'B站凭据', false, 'JSON 解析失败', '重新导出 cookie'));
    }
  }

  const room = await danmaku.roomInfo();
  if (room?.roomId) {
    checks.push(check('room', '直播间', true, `${room.title || '(无标题)'} · ${room.liveStatus ? '直播中' : '未开播'} · 在线 ${room.online ?? '?'}`));
  } else {
    checks.push(check('room', '直播间', false, '房号没配或接口不可达', '检查 roomId / 网络', true));
  }

  const skin = await avatar.status();
  checks.push(check('vts', 'VTube Studio', skin.up, skin.up ? `8001 端口可用` : '还没开', '面板点「架好设备」会拉起', true));

  const vtubeDir = String(config.vtubeDir || '');
  if (!vtubeDir) {
    checks.push(check('bridge', 'VTS 嘴型驱动', false, '没配 vtubeDir', '可选：有驱动目录才能动嘴', true));
  } else {
    const missing = ['vts_speak.py', 'vts_client.py'].filter((file) => !fs.existsSync(path.join(vtubeDir, file)));
    checks.push(check('bridge', 'VTS 嘴型驱动', missing.length === 0, missing.length ? `缺 ${missing.join(',')}` : '就绪', '', true));
  }

  const apps = await stage.appStatus();
  checks.push(check('obs', 'OBS', apps.obs.running || (apps.obs.configured && apps.obs.exists),
    apps.obs.running ? '运行中' : apps.obs.configured ? (apps.obs.exists ? '没运行（架设备时会拉起）' : '路径不存在') : '没配 obsPath',
    '可选；填 obs64.exe 路径', true));
  checks.push(check('livehime', '直播姬', apps.livehime.running || (apps.livehime.configured && apps.livehime.exists),
    apps.livehime.running ? '运行中' : apps.livehime.configured ? (apps.livehime.exists ? '没运行（需要管理员权限，请手动打开）' : '路径不存在') : '没配 livehimePath',
    '可选；填 livehime.exe 路径（需手动启动，插件不自动拉起）', true));

  const ok = checks.filter((item) => item.ok).length;
  const failed = checks.filter((item) => !item.ok && !item.optional).length;
  const warned = checks.filter((item) => !item.ok && item.optional).length;
  return { checks, summary: { total: checks.length, ok, failed, warned } };
}
