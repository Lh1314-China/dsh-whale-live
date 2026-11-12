/**
 * dsh-whale-live — 鲸鱼直播台（Host 半）。
 *
 * 它只做四件事：
 *   1. 管两本人设文件（意识卡、观察日记）和每场的记录；
 *   2. 听 B 站弹幕（只读）；
 *   3. 用 edge-tts 把话念出来；
 *   4. 给左侧栏面板开一个同源 JSON API，并给本鲸两个工具。
 *
 * 直播那个“她”的记忆全在这里，cortex 一个字都不碰。
 */
import os from 'node:os';
import path from 'node:path';
import { createStore } from './lib/store.js';
import { createDanmaku } from './lib/bili.js';
import { createVoice } from './lib/voice.js';
import { createAvatar } from './lib/avatar.js';
import { createVts } from './lib/vts.js';
import { createStage } from './lib/stage.js';
import { diagnose } from './lib/diagnostics.js';
import { createTools } from './lib/tools.js';
import { registerHttp } from './lib/http.js';

export const name = 'whale-live';
export const inject = ['tools'];

export async function apply(ctx, config = {}) {
  const settings = {
    roomId: 123456,
    roomName: '',
    dataDir: path.join(os.homedir(), '.dsh', 'whale-live'),
    credentialFile: '',
    pythonPath: '',
    vtubeDir: '',
    vtsPort: 8001,
    vtsSteamApp: '1325860',
    obsPath: '',
    livehimePath: '',
    vtsPath: '',
    stageWaitSec: 90,
    openRoomPage: true,
    voice: 'zh-CN-XiaoyiNeural',
    rate: '+8%',
    pitch: '+4Hz',
    listenWaitSec: 45,
    ...config,
  };

  // 空字符串当作没配：数据目录落到用户主目录，房号落到 0（不连任何房间）。
  if (!settings.dataDir) settings.dataDir = path.join(os.homedir(), '.dsh', 'whale-live');
  if (!Number(settings.roomId)) settings.roomId = 0;

  const store = createStore(settings);
  store.ensure();
  const danmaku = createDanmaku(settings, ctx.logger);
  const avatar = createAvatar(settings, ctx.logger);
  const vts = createVts(settings, ctx.logger);
  const stage = createStage(settings, avatar, ctx.logger);
  const voice = createVoice(settings, store, ctx.logger, avatar);
  const watchApi = {};
  const tools = createTools({ ctx, store, danmaku, voice, avatar, vts, stage, diagnose, watchApi, config: settings });

  ctx.effect(() => {
    const disposers = [];
    try {
      for (const tool of tools) disposers.push(ctx.tools.register(tool));
      const disposeHttp = registerHttp(ctx, { store, danmaku, voice, avatar, stage, watchApi, diagnose, config: settings, logger: ctx.logger });
      if (disposeHttp) disposers.push(disposeHttp);
      disposers.push(() => voice.dispose());
    } catch (error) {
      for (const dispose of disposers.reverse()) {
        try {
          dispose?.();
        } catch {
          /* 保留第一个错误 */
        }
      }
      throw error;
    }
    return () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose?.();
        } catch {
          /* 卸载时安静 */
        }
      }
    };
  }, 'whale-live: tools + api');

  ctx.logger?.info?.(`whale-live: 已就绪（房间 ${settings.roomId}，数据 ${store.paths.dataDir}，声音 ${settings.voice}）`);
}
