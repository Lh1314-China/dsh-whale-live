/**
 * B 站弹幕源（只读）。
 *
 * 用老接口 ajax/msg：这个房间的新接口返回空，老接口反而有数据。
 * 打开一场直播时先 prime() 一次，下一轮把“开播前就挂在页面上的历史弹幕”吞掉，
 * 之后才算是本场的新话。
 */
import fs from 'node:fs';

const API = 'https://api.live.bilibili.com/ajax/msg';
const ROOM_INFO = 'https://api.live.bilibili.com/room/v1/Room/get_info';

function readCredential(file) {
  if (!file) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const pick = (...keys) => {
      for (const key of keys) {
        const value = raw[key];
        if (value !== undefined && value !== null && String(value) !== '') return String(value);
      }
      return '';
    };
    return {
      sessdata: pick('sessdata', 'SESSDATA'),
      biliJct: pick('bili_jct', 'biliJct'),
      buvid3: pick('buvid3', 'buvid3'),
      userId: pick('dedeuserid', 'DedeUserID', 'dedeuserid'),
    };
  } catch {
    return {};
  }
}

function cookieHeader(cred) {
  return [
    ['SESSDATA', cred.sessdata],
    ['bili_jct', cred.biliJct],
    ['buvid3', cred.buvid3],
    ['DedeUserID', cred.userId],
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

export function createDanmaku(config = {}, logger = null) {
  const roomId = Number(config.roomId) || 0;
  const cred = readCredential(config.credentialFile);
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    referer: `https://live.bilibili.com/${roomId}`,
    accept: 'application/json, text/plain, */*',
  };
  const cookie = cookieHeader(cred);
  if (cookie) headers.cookie = cookie;

  let seen = new Set();
  let primed = false;
  let lastError = null;
  let lastPollAt = 0;
  let roomCache = { at: 0, value: null };

  async function fetchJson(url) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function pollOnce() {
    if (!roomId) return { messages: [], error: '没有配置 roomId' };
    try {
      const body = await fetchJson(`${API}?roomid=${roomId}&token=&csrf_token=${encodeURIComponent(cred.biliJct || '')}`);
      if (body?.code !== 0) throw new Error(`接口返回 code=${body?.code}`);
      const room = body?.data?.room ?? [];
      const messages = [];
      for (const item of room) {
        const nickname = String(item?.nickname ?? '观众');
        const text = String(item?.text ?? '').trim();
        const timeline = String(item?.timeline ?? '');
        if (!text) continue;
        const key = `${nickname}\u0000${text}\u0000${timeline}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!primed) continue;
        messages.push({
          kind: 'danmaku',
          user: nickname,
          text,
          uid: item?.uid ?? null,
          self: cred.userId && String(item?.uid ?? '') === cred.userId,
        });
      }
      if (seen.size > 1200) seen = new Set([...seen].slice(-600));
      lastError = null;
      lastPollAt = Date.now();
      if (!primed) primed = true;
      return { messages, error: null };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger?.warn?.(`whale-live: 弹幕轮询失败 ${lastError}`);
      return { messages: [], error: lastError };
    }
  }

  /** 下一轮把已有弹幕当历史吞掉。 */
  function prime() {
    primed = false;
  }

  function sleep(ms, signal) {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener?.('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  /**
   * 最多等 waitSec 秒，收这一段时间里的新弹幕。
   * 没有新话就返回空，让本鲸自己决定要不要自言自语。
   */
  async function listen(waitSec = 20, options = {}) {
    const started = Date.now();
    const deadline = started + Math.max(3, Number(waitSec) || 20) * 1000;
    const messages = [];
    while (Date.now() < deadline) {
      if (options.signal?.aborted) break;
      const { messages: fresh } = await pollOnce();
      if (fresh.length) messages.push(...fresh);
      if (messages.length >= 30) break;
      if (Date.now() >= deadline) break;
      await sleep(messages.length ? 250 : 1500, options.signal);
    }
    return {
      messages,
      waitedMs: Date.now() - started,
      error: lastError,
      roomId,
    };
  }

  async function roomInfo() {
    if (!roomId) return null;
    if (Date.now() - roomCache.at < 60_000) return roomCache.value;
    try {
      const body = await fetchJson(`${ROOM_INFO}?room_id=${roomId}`);
      const data = body?.data ?? {};
      const value = {
        roomId,
        title: data.title ?? '',
        owner: data.uid ?? null,
        liveStatus: data.live_status === 1,
        online: data.online ?? 0,
        area: data.area_name ?? '',
        fetchedAt: new Date().toISOString(),
      };
      roomCache = { at: Date.now(), value };
      return value;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      return roomCache.value;
    }
  }

  return {
    roomId,
    hasCookie: Boolean(cookie),
    prime,
    pollOnce,
    listen,
    roomInfo,
    status: () => ({ roomId, primed, hasCookie: Boolean(cookie), lastError, lastPollAt }),
  };
}
