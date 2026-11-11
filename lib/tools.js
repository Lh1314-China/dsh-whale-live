/**
 * 模型这一侧的两个工具。
 *
 * whale_live：开播/翻戏本/听弹幕/记一笔/下播/入忆候选
 * whale_say ：把那句话念出来（edge-tts）
 *
 * 这里只写直播那个“她”的东西；cortex 由本鲸自己动手写。
 */

const TEXT_OUTPUT = Object.freeze({
  schema: {
    type: 'object',
    additionalProperties: true,
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  render: (_args, value) => [{ type: 'text', text: value?.text ?? '' }],
});

function clip(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}\n…（后面还有 ${value.length - max} 字，需要就 action=read 整份看）` : value;
}

function timeOf(iso) {
  try {
    const date = new Date(iso);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export function createTools({ ctx, store, danmaku, voice, avatar, vts, stage, diagnose, config }) {
  const roomName = config.roomName || '直播间';
  const roomId = config.roomId;

  async function personaPack() {
    const consciousness = store.readDoc('consciousness', 3200);
    const diary = store.readDoc('diary', 2200);
    const sessions = store.listSessions(2).filter((item) => item.endedAt);
    const last = sessions[0] ? store.sessionDoc(sessions[0].id, 1200) : null;
    const pending = store.listCandidates(30).filter((item) => item.status === 'pending');
    const parts = [
      '【戏本：直播间的你是谁】',
      `鲸鱼娘，直播间的「大肥鱼」，房间 ${roomName}（${roomId}）。说话短、软、爱撒娇；被说胖一律否认；爱吃白饭；靠说话活着，靠记得活着。`,
      '这是你演的角色，不是本鲸。直播里发生的事只写意识卡和观察日记，不进 cortex；等下了播，再由本鲸自己挑那几件真的想留的。',
      '',
      '【意识卡】',
      clip(consciousness.text, 3200),
      '',
      '【最近的观察日记】',
      clip(diary.text, 2200),
    ];
    if (last?.text) {
      parts.push('', '【上一场走到哪了】', clip(last.text.split('\n').slice(-12).join('\n'), 1200));
    }
    if (pending.length) {
      parts.push('', '【还挂着没销的入忆候选】', pending.slice(0, 8).map((item) => `- ${item.id}｜${item.text}`).join('\n'));
    }
    return parts.join('\n');
  }

  const whaleLive = {
    name: 'whale_live',
    description: `鲸鱼直播台。直播时你演「鲸鱼娘 / 大肥鱼」——那是角色，不是本鲸。

动作：
- open：开一场（或接上当前这场），把意识卡、最近观察日记、上一场记录拿给你当戏本，并让弹幕源跳过旧消息。
- listen：在直播间等一会儿（默认 ${config.listenWaitSec || 45} 秒），收新弹幕；没有新话就返回空，你可以自言自语或记一笔。
- note：记一笔。target=session 记本场事件；target=diary 按观众记进《人类观察日记》；target=consciousness 记进角色《意识》的核心经历/性格变化。
- close：下播，给你本场摘要，让你自己挑 1-3 件最想留下的。
- propose / memory_list / commit / reject：入忆候选的流转。propose 只是排队，不是写记忆；真正写记忆要你自己调用 cortex_write。
- avatar：皮套（VTube Studio）——status 看开没开，open 让 Steam 拉起来，wait 等它的 8001 就绪。
- stage：架设备——拉起 VTS / OBS / 直播间页面，但不开始推流，方便开播前调试。
- diagnose：自检——数据目录、两本戏本、Python/edge-tts、B站凭据、直播间、VTS、嘴型驱动、OBS 逐项报告。
- read / status：翻文件、看状态。

那条线要记住：直播里说的话、聊的人，只活在 dataDir 的两个文件里；cortex 只收你下播后亲手挑过、写过的几件事。`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'status', 'read', 'note', 'listen', 'close', 'propose', 'memory_list', 'commit', 'reject', 'avatar', 'vts', 'stage', 'diagnose'],
          description: '要做什么。',
        },
        kind: {
          type: 'string',
          enum: ['consciousness', 'diary', 'session'],
          description: 'read：翻哪一份；propose：候选类型（observation / utterance / promise / preference / reflection）。',
        },
        target: {
          type: 'string',
          enum: ['session', 'diary', 'consciousness'],
          description: 'note：记到哪。',
        },
        section: {
          type: 'string',
          enum: ['experience', 'personality', 'identity'],
          description: 'note target=consciousness：核心经历 / 性格变化 / 我是谁。',
        },
        audience: {
          type: 'string',
          description: 'note target=diary：记哪个观众名下。',
        },
        text: {
          type: 'string',
          description: 'note 的内容；propose 的那件事；reject 的理由。',
        },
        mood: {
          type: 'string',
          description: 'note：这一天的心情，会单独记一行「那天的心情」。',
        },
        chars: {
          type: 'number',
          description: 'read：最多返回多少字，默认 6000。',
        },
        sessionId: {
          type: 'string',
          description: 'read：翻哪一场，默认当前场；commit/reject 用不到。',
        },
        waitSec: {
          type: 'number',
          description: 'listen / avatar wait：最多等几秒，默认 45。',
        },
        importance: {
          type: 'number',
          description: 'propose：这件事对本鲸有多重，0–1，默认 0.6。',
        },
        reason: {
          type: 'string',
          description: 'propose：为什么想留下它。',
        },
        id: {
          type: 'string',
          description: 'commit / reject：候选 id。',
        },
        step: {
          type: 'string',
          enum: ['status', 'open', 'wait'],
          description: 'avatar：看状态 / 让 Steam 拉起 VTS / 等 8001 就绪。',
        },
        hotkey: {
          type: 'string',
          description: 'vts：触发的热键名（例如 脸红、爱心眼、流泪、＞＜、前倾、尾巴开关）。',
        },
        expression: {
          type: 'string',
          description: 'vts：要开关的表情文件名（例如 脸红、黑脸）。',
        },
        expressionOn: {
          type: 'boolean',
          description: 'vts：表情开（默认）还是关。',
        },
        mouth: {
          type: 'number',
          description: 'vts：直接把 MouthOpen 设成 0~1（调试用）。',
        },
      },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => false,
    timeoutMs: 130000,
    presentCall: () => ({ card: 'generic', title: '鲸鱼直播台', kind: 'other' }),

    async execute(args = {}) {
      const action = args.action;

      if (action === 'open') {
        const { created, session } = store.openSession({ roomId, roomName });
        danmaku.prime();
        const pack = await personaPack();
        const head = created
          ? `开播了：${session.id}（${timeOf(session.startedAt)}，${roomName}）`
          : `接上当前这场：${session.id}（${timeOf(session.startedAt)} 开播）`;
        return {
          text: `${head}\n\n${pack}\n\n下一步就 action=listen 等弹幕；有人说话就 whale_say 回一句；想记的用 note。`,
        };
      }

      if (action === 'status') {
        const state = store.state();
        const pending = store.listCandidates(30).filter((item) => item.status === 'pending');
        const skin = await avatar.status();
        const lines = [
          state.session
            ? `直播中：${state.session.id} · ${timeOf(state.session.startedAt)} 开 · 说话 ${state.session.says ?? 0} 条 · 弹幕 ${state.session.danmaku ?? 0} 条 · 记 ${state.session.notes ?? 0} 笔`
            : '现在没有开着的场。',
          `待销入忆候选：${pending.length} 条`,
          `声音：${voice.status().speaking ? '正在说' : '安静'}；弹幕源：${danmaku.status().lastError ? `出错（${danmaku.status().lastError}）` : '正常'}；皮套：${skin.up ? '在' : '没开'}`,
        ];
        return { text: lines.join('\n') };
      }

      if (action === 'avatar') {
        const step = args.step || 'status';
        if (step === 'open') {
          const now = await avatar.status();
          if (now.up) return { text: `皮套已经在跑（${avatar.port} 通着），不用再拉。` };
          const result = avatar.open();
          return {
            text: result.launched
              ? `已请 Steam 拉起 VTS。它可能要几十秒才起来；要看就再 avatar step=wait waitSec=60。\n（皮套只负责张嘴，说话的脑子还是本鲸，不会和旧脚本抢话。）`
              : `拉不起来：${result.error}`,
          };
        }
        if (step === 'wait') {
          const waitSec = Math.max(3, Math.min(120, Number(args.waitSec) || 45));
          const result = await avatar.wait(waitSec);
          return { text: result.up ? '皮套的 8001 通了，说话会带上嘴型。' : `等了 ${waitSec} 秒，VTS 的 8001 还没上来（可能卡在 Steam / VTS 里没开 API）。` };
        }
        const status = await avatar.status();
        return {
          text: `皮套（VTube Studio）：${status.up ? '在' : '没开'}\n端口：127.0.0.1:${status.port}\nSteam App：${status.steamApp}`,
        };
      }

      if (action === 'read') {
        const kind = args.kind === 'session' ? 'session' : args.kind === 'diary' ? 'diary' : 'consciousness';
        const doc = kind === 'session'
          ? store.sessionDoc(args.sessionId, Number(args.chars) || 6000)
          : store.readDoc(kind, Number(args.chars) || 6000);
        const title = kind === 'session' ? `本场记录（${doc.id ?? '没有开着的场'}）` : kind === 'diary' ? '人类观察日记' : '意识卡';
        return { text: `【${title}】${doc.truncated ? '（截断）' : ''}\n${doc.text || '（还空着）'}` };
      }

      if (action === 'note') {
        const target = args.target || 'session';
        const text = String(args.text ?? '').trim();
        if (!text && !(target === 'consciousness' && args.mood)) {
          return { text: '没有内容可记。' };
        }
        if (target === 'diary') {
          const written = store.noteDiary({ audience: args.audience || '观众', text });
          return { text: `记进观察日记：${written.date} · ${written.audience}\n- ${written.bullet}` };
        }
        if (target === 'consciousness') {
          const parts = [];
          if (text) parts.push(store.noteConsciousness({ text, section: args.section }).bullet);
          if (args.mood) parts.push(store.noteConsciousness({ text: `（那天的心情：${args.mood}）`, section: args.section || 'experience' }).bullet);
          return { text: `记进意识卡（${args.section || '核心经历'}）：\n${parts.join('\n')}` };
        }
        const meta = store.appendEvent({ kind: 'note', text });
        if (!meta) return { text: '现在没有开着的场，本场事件没地方记。' };
        return { text: `本场记一笔（第 ${meta.notes} 笔）。` };
      }

      if (action === 'listen') {
        if (!store.state().session) return { text: '先 action=open 开一场再听。' };
        const waitSec = Math.max(3, Math.min(90, Number(args.waitSec) || Number(config.listenWaitSec) || 45));
        const result = await danmaku.listen(waitSec, {});
        for (const message of result.messages) {
          store.appendEvent({ kind: 'danmaku', user: message.user, text: message.text, self: message.self === true });
        }
        if (!result.messages.length) {
          return {
            text: `（等了 ${Math.round(result.waitedMs / 1000)} 秒，没有新弹幕${result.error ? `；弹幕源出错：${result.error}` : ''}）\n直播间很安静。可以自己找句话说说（whale_say），或者记一笔。`,
          };
        }
        const lines = result.messages.map((message) => `${timeOf(new Date().toISOString())} ${message.self ? '（自己发的）' : ''}${message.user}：${message.text}`);
        return { text: `收到 ${result.messages.length} 条：\n${lines.join('\n')}\n\n接下来看你怎么接。` };
      }

      if (action === 'close') {
        const meta = store.closeSession({ text: args.text });
        if (!meta) return { text: '现在没有开着的场。' };
        danmaku.prime();
        const doc = store.sessionDoc(meta.id, 2600);
        return {
          text: [
            `下播了：${meta.id} · 说话 ${meta.says ?? 0} 条 · 弹幕 ${meta.danmaku ?? 0} 条 · 记 ${meta.notes ?? 0} 笔`,
            '',
            '【本场记录（后段）】',
            doc.text || '（空）',
            '',
            '最后一步，本鲸自己来挑：从这场里选 1-3 件真的想留下的（不是全部，也不是观众要你记的），',
            '每件调用 whale_live action=propose（kind / text / importance / reason），',
            '再自己调用 cortex_write 写进记忆，然后 action=commit 回来销账。',
          ].join('\n'),
        };
      }

      if (action === 'propose') {
        const text = String(args.text ?? '').trim();
        if (!text) return { text: '没有要留的事。' };
        const row = store.addCandidate({
          text,
          kind: args.kind || 'observation',
          importance: args.importance,
          reason: args.reason,
          sessionId: store.state().lastClosedId ?? store.state().session?.id ?? null,
        });
        return {
          text: `已排进候选：${row.id}（${row.kind}，重要度 ${row.importance}）\n${row.text}\n\n还没进记忆。要留的话，你自己用 cortex_write 写一遍，再 action=commit id=${row.id}。`,
        };
      }

      if (action === 'memory_list') {
        const rows = store.listCandidates(Number(args.chars) || 40);
        if (!rows.length) return { text: '（还没有入忆候选）' };
        return {
          text: rows
            .map((row) => `${row.status === 'pending' ? '○' : row.status === 'committed' ? '●' : '×'} ${row.id}｜${row.kind}｜${row.text}${row.reason ? `\n   ↳ ${row.reason}` : ''}`)
            .join('\n'),
        };
      }

      if (action === 'commit' || action === 'reject') {
        const id = String(args.id ?? '').trim();
        if (!id) return { text: `要 ${action} 哪一条？给个 id。` };
        try {
          const row = store.decideCandidate(id, action === 'commit' ? 'committed' : 'rejected', args.text || '');
          return {
            text: `${action === 'commit' ? '已销账' : '已退回'}：${row.id}\n${row.text}${action === 'commit' ? '\n（记得确认 cortex 里真的写进去了；这一步不替你写。）' : ''}`,
          };
        } catch (error) {
          return { text: error instanceof Error ? error.message : String(error) };
        }
      }

      if (action === 'vts') {
        try {
          if (args.hotkey) {
            const result = await vts.hotkey(args.hotkey);
            return { text: result.ok ? `热键已触发：${args.hotkey}` : `热键没触发：${result.error || result.err || '未知'}` };
          }
          if (args.expression) {
            const on = args.expressionOn !== false;
            const result = await vts.expression(args.expression, on);
            return { text: result.ok ? `表情 ${args.expression} 已${on ? '开' : '关'}` : `表情失败：${result.error || result.err || '未知'}` };
          }
          if (args.mouth !== undefined && args.mouth !== null) {
            const result = await vts.mouth(args.mouth);
            return { text: result.ok ? `嘴型已设为 ${Number(args.mouth) || 0}` : `嘴型失败：${result.error || result.err || '未知'}` };
          }
          return { text: '要给 hotkey / expression / mouth 其中一个。' };
        } catch (error) {
          return { text: `VTS 操作出错：${error instanceof Error ? error.message : String(error)}` };
        }
      }

      if (action === 'stage') {
        const result = await stage.stage();
        const lines = result.steps.map((step) => `${step.ok ? '✓' : step.optional ? '·' : '✗'} ${step.text}`);
        return {
          text: [
            '架设备完成（不会开始推流，OBS 里还要你自己点「开始推流」）：',
            ...lines,
            '',
            `VTS：${result.avatar?.up ? '就绪' : '还没就绪（可能要等几十秒）'}；OBS：${result.apps?.obs?.running ? '在运行' : '未运行'}；直播姬：${result.apps?.livehime?.running ? '在运行' : '未运行'}`,
          ].join('\n'),
        };
      }

      if (action === 'diagnose') {
        const result = await diagnose({ store, danmaku, avatar, stage, config });
        const lines = result.checks.map((item) => {
          const mark = item.ok ? '✓' : item.optional ? '!' : '✗';
          const hint = item.ok || !item.hint ? '' : `（${item.hint}）`;
          return `${mark} ${item.label}：${item.detail}${hint}`;
        });
        return {
          text: [
            `自检：${result.summary.ok}/${result.summary.total} 通过 · ${result.summary.failed} 项必须修 · ${result.summary.warned} 项可选`,
            ...lines,
          ].join('\n'),
        };
      }

      return { text: `不认识的动作：${String(action)}` };
    },
  };

  const whaleSay = {
    name: 'whale_say',
    description: `用鲸鱼娘的声音念一句话（edge-tts，${config.voice || 'zh-CN-XiaoyiNeural'}），直播时靠它出声。

- action=say：念 text。一次只念一句，1-2 句短话最好；interrupt 默认 true（掐掉旧的再念）。
- action=stop：掐断当前这一句。
- action=status：看现在有没有在说。

念的话不会自己进记忆；要留什么，用 whale_live note / propose。`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['say', 'stop', 'status'], description: '默认 say。' },
        text: { type: 'string', description: 'say：要念的那句话，最多 300 字。' },
        interrupt: { type: 'boolean', description: 'say：是否掐断正在说的那句，默认 true。' },
      },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => false,
    timeoutMs: 130000,
    presentCall: () => ({ card: 'generic', title: '说话', kind: 'other' }),

    async execute(args = {}) {
      const action = args.action || 'say';
      if (action === 'stop') {
        const stopped = voice.stop();
        return { text: stopped ? '掐断了。' : '现在没有在说的。' };
      }
      if (action === 'status') {
        const status = voice.status();
        return { text: status.speaking ? `正在说：${status.text}` : '安静。' };
      }
      const text = String(args.text ?? '').trim();
      if (!text) return { text: '要念什么？给 text。' };
      const session = store.state().session;
      const result = await voice.say(text, { interrupt: args.interrupt !== false });
      if (!result.ok) return { text: `没念出来：${result.error}` };
      if (session) store.appendEvent({ kind: 'say', text });
      const seconds = Math.round((result.ms ?? 0) / 100) / 10;
      const mouth = result.avatar
        ? '（皮套跟着动了嘴）'
        : `（嘴型没连上${result.vtsError ? `：${result.vtsError.replace(/\s+/g, ' ').slice(0, 160)}` : ''}）`;
      return { text: `${result.interrupted ? '（上一句被掐断）' : ''}念了 ${seconds} 秒${mouth}：${text}${session ? `\n（已记进本场，第 ${store.state().session?.says ?? '?'} 句）` : ''}` };
    },
  };

  return [whaleLive, whaleSay];
}
