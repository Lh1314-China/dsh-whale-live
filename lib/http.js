/**
 * 给左侧栏面板用的同源 JSON API。
 * 只在本机回环上开着；POST 必须带本插件的请求头，挡掉跨站请求。
 */
export const API_BASE = '/api/whale-live';
const MAX_BODY_BYTES = 64 * 1024;

function header(request, name) {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function isLoopbackAddress(value) {
  const address = value?.toLowerCase().replace(/^\[|\]$/g, '');
  return address === 'localhost'
    || address === 'localhost.'
    || address === '::1'
    || address?.startsWith('127.') === true
    || address?.startsWith('::ffff:127.') === true;
}

function isTrustedRequest(request) {
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return false;
  const site = header(request, 'sec-fetch-site');
  if (site !== undefined && site !== 'same-origin') return false;
  const host = header(request, 'host');
  if (!host) return false;
  const origin = header(request, 'origin');
  if (!origin) {
    try {
      return isLoopbackAddress(new URL(`http://${host}`).hostname);
    } catch {
      return false;
    }
  }
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.host === host
      && isLoopbackAddress(url.hostname);
  } catch {
    return false;
  }
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    request.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_BODY_BYTES) {
        finish(null);
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        finish(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null);
      } catch {
        finish(null);
      }
    });
    request.on('error', () => finish(null));
  });
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

export function registerHttp(ctx, { store, danmaku, voice, avatar, stage, diagnose, config, logger }) {
  async function snapshot() {
    const state = store.state();
    const skin = await avatar.status();
    const docs = {
      consciousness: store.readDoc('consciousness', 200000),
      diary: store.readDoc('diary', 200000),
    };
    const candidates = store.listCandidates(60);
    return {
      session: state.session ?? null,
      lastClosedId: state.lastClosedId ?? null,
      sessions: store.listSessions(10),
      candidates,
      pendingCount: candidates.filter((item) => item.status === 'pending').length,
      docs: {
        consciousness: { chars: docs.consciousness.chars, updatedAt: docs.consciousness.updatedAt },
        diary: { chars: docs.diary.chars, updatedAt: docs.diary.updatedAt },
      },
      recent: state.session ? store.recentEvents(state.session.id, 80) : [],
      voice: voice.status(),
      danmaku: danmaku.status(),
      avatar: skin,
      config: {
        roomId: config.roomId,
        roomName: config.roomName ?? '',
        voice: config.voice ?? '',
        dataDir: store.paths.dataDir,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  async function act(body) {
    const action = body.action;
    if (action === 'open') {
      if (store.state().session) store.closeSession({ text: '面板重新开播，上一场先收了。' });
      const opened = store.openSession({ roomId: config.roomId, roomName: config.roomName });
      danmaku.prime();
      return { session: opened.session, created: opened.created };
    }
    if (action === 'close') {
      const meta = store.closeSession({ text: '从面板下播。' });
      danmaku.prime();
      return { closed: meta };
    }
    if (action === 'say') {
      const text = String(body.text ?? '').trim();
      if (!text) throw Object.assign(new Error('没有要念的字'), { code: 'INVALID_INPUT' });
      const result = await voice.say(text, { interrupt: body.interrupt !== false });
      if (result.ok && store.state().session) store.appendEvent({ kind: 'say', text });
      return { voice: result };
    }
    if (action === 'stop') {
      return { stopped: voice.stop() };
    }
    if (action === 'avatar') {
      if (body.step === 'open') {
        const now = await avatar.status();
        if (now.up) return { avatar: now, launched: false };
        return { avatar: await avatar.status(), ...avatar.open() };
      }
      return { avatar: await avatar.status() };
    }
    if (action === 'stage') {
      return { stage: await stage.stage() };
    }
    if (action === 'diagnose') {
      return { diagnose: await diagnose({ store, danmaku, avatar, stage, config }) };
    }
    if (action === 'note') {
      const text = String(body.text ?? '').trim();
      if (!text) throw Object.assign(new Error('没有要记的内容'), { code: 'INVALID_INPUT' });
      const meta = store.appendEvent({ kind: 'note', text });
      if (!meta) throw Object.assign(new Error('现在没有开着的场'), { code: 'INVALID_STATE' });
      return { session: meta };
    }
    if (action === 'candidate') {
      const id = String(body.id ?? '');
      const decision = body.decision === 'commit' ? 'committed' : body.decision === 'reject' ? 'rejected' : null;
      if (!id || !decision) throw Object.assign(new Error('候选需要 id 和 decision'), { code: 'INVALID_INPUT' });
      return { candidate: store.decideCandidate(id, decision, body.note) };
    }
    throw Object.assign(new Error(`不认识的动作：${String(action)}`), { code: 'INVALID_INPUT' });
  }

  function mountOn(server) {
    if (!server || typeof server.register !== 'function') return () => {};

    const handler = async (request, response) => {
      if (!isTrustedRequest(request)) {
        sendJson(response, 403, { ok: false, error: '拒绝非本机同源请求' });
        return;
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { allow: 'GET, HEAD, POST, OPTIONS' });
        response.end();
        return;
      }
      if (request.method === 'POST' && header(request, 'x-whale-live') !== '1') {
        sendJson(response, 403, { ok: false, error: '缺少本插件请求头' });
        return;
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const pathname = url.pathname.replace(/\/+$/, '') || '/';
      if (pathname !== API_BASE && !pathname.startsWith(`${API_BASE}/`)) {
        sendJson(response, 404, { ok: false, error: 'not found' });
        return;
      }
      const route = pathname === API_BASE ? '/' : pathname.slice(API_BASE.length);

      try {
        if (request.method === 'GET' || request.method === 'HEAD') {
          if (route === '/' || route === '/state') {
            sendJson(response, 200, { ok: true, data: await snapshot() });
            return;
          }
          if (route === '/doc') {
            const kind = url.searchParams.get('kind') ?? 'consciousness';
            if (!['consciousness', 'diary', 'session'].includes(kind)) {
              sendJson(response, 400, { ok: false, error: 'kind 只能是 consciousness / diary / session' });
              return;
            }
            const chars = Math.max(500, Math.min(200000, Number(url.searchParams.get('chars')) || 40000));
            const doc = kind === 'session'
              ? store.sessionDoc(url.searchParams.get('id') ?? undefined, chars)
              : store.readDoc(kind, chars);
            sendJson(response, 200, { ok: true, data: doc });
            return;
          }
          if (route === '/room') {
            const info = await danmaku.roomInfo();
            sendJson(response, 200, { ok: true, data: info });
            return;
          }
          if (route === '/diagnose') {
            sendJson(response, 200, { ok: true, data: await diagnose({ store, danmaku, avatar, stage, config }) });
            return;
          }
          sendJson(response, 404, { ok: false, error: 'not found' });
          return;
        }

        if (request.method === 'POST') {
          if (route !== '/action') {
            sendJson(response, 404, { ok: false, error: 'not found' });
            return;
          }
          const body = await readJsonBody(request);
          if (!body) {
            sendJson(response, 400, { ok: false, error: '请求体不是 JSON' });
            return;
          }
          const result = await act(body);
          const state = await snapshot();
          sendJson(response, 200, { ok: true, data: { ...result, state } });
          return;
        }

        sendJson(response, 405, { ok: false, error: 'method not allowed' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = error?.code === 'INVALID_INPUT' ? 400 : error?.code === 'INVALID_STATE' ? 409 : 500;
        if (status === 500) logger?.warn?.(`whale-live: ${message}`);
        sendJson(response, status, { ok: false, error: message, code: error?.code ?? null });
      }
    };

    try {
      const dispose = server.register({ kind: 'prefix', path: API_BASE, handler });
      logger?.info?.(`whale-live: API 已挂载 ${API_BASE}`);
      return dispose;
    } catch (error) {
      logger?.warn?.(`whale-live: API 挂载失败：${error instanceof Error ? error.message : String(error)}`);
      return () => {};
    }
  }

  const server = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined;
  if (server && typeof server.register === 'function') return mountOn(server);

  logger?.warn?.('whale-live: webServer 暂不可用，等宿主注入');
  if (typeof ctx.inject === 'function') {
    try {
      const injected = ctx.inject(['webServer'], (webCtx) => {
        const late = webCtx && typeof webCtx.get === 'function' ? webCtx.get('webServer') : undefined;
        if (!late || typeof late.register !== 'function') return undefined;
        return webCtx.effect(() => mountOn(late), 'whale-live: http (late webServer)');
      });
      if (typeof injected === 'function') return injected;
    } catch (error) {
      logger?.warn?.(`whale-live: 延迟挂载 webServer 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return () => {};
}
