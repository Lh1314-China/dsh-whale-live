/**
 * 实时蹲点：轮询弹幕 + 叫醒 Agent。
 * 共享给工具（模型侧）和面板（用户点开关）。
 */
export function createWatch({ danmaku, store, logger = null }) {
  let timer = null;
  let agent = null;
  let busy = false;

  function setAgent(value) {
    if (value) agent = value;
  }

  function wake(text) {
    if (!agent) return false;
    try {
      agent.followup(text);
      return true;
    } catch {
      try {
        agent.followup({ role: 'user', content: text });
        return true;
      } catch {
        try {
          agent.inject(text);
        } catch {
          /* 叫不醒也不能影响轮询 */
        }
        return false;
      }
    }
  }

  async function tick() {
    if (busy || !store.state().session) return;
    busy = true;
    try {
      const { messages } = await danmaku.pollOnce();
      if (!messages.length) return;
      for (const message of messages) {
        store.appendEvent({ kind: 'danmaku', user: message.user, text: message.text, self: message.self === true });
      }
      const lines = messages.map((message) => `${message.user}：${message.text}`).join('\n');
      wake(`[直播间新弹幕]\n${lines}\n\n（去看看，想接就接；不想接也可以记一笔。）`);
    } catch (error) {
      logger?.warn?.(`whale-live: watch 轮询失败 ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false;
    }
  }

  function start() {
    if (timer) return { running: true, already: true };
    if (!store.state().session) return { running: false, error: '还没开播，先 open 或点「开播」' };
    timer = setInterval(tick, 4000);
    return { running: true };
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    return { running: false };
  }

  function status() {
    return { running: Boolean(timer), hasAgent: Boolean(agent) };
  }

  return { setAgent, wake, start, stop, status, tick };
}
