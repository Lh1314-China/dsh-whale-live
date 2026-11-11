window.__ModuleLoader__.load({
  id: 'dsh-whale-live',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const API = '/api/whale-live';
    const NS = 'dsh-whale-live';

    const DICT = {
      zh: {
        navLabel: '鲸鱼直播台',
        title: '鲸鱼直播台',
        subtitle: '房间 {room} · 声音 {voice}',
        open: '开播',
        close: '下播',
        stop: '闭嘴',
        avatar: '皮套',
        avatarOn: '皮套在',
        refresh: '刷新',
        tabLive: '本场',
        tabConsciousness: '意识',
        tabDiary: '观察日记',
        tabCandidates: '入忆候选',
        stateLive: '直播中',
        stateIdle: '未开播',
        stat: '说话 {says} · 弹幕 {danmaku} · 记 {notes}',
        since: '{time} 开',
        sayPlaceholder: '让她说一句……',
        sayButton: '念',
        sayHint: '念出来的话只记进本场，不会自己进记忆。',
        said: '念完了。',
        emptyLiveTitle: '还没开播',
        emptyLiveBody: '开一场之后，本鲸会用工具去听弹幕、念话、记东西。你也可以直接跟本鲸说「开播」。',
        emptyDoc: '（这份还空着）',
        loading: '正在读……',
        failed: '没读出来',
        retry: '再试一次',
        pendingChip: '待销 {n} 条',
        candEmpty: '还没有入忆候选。下播后本鲸挑出来的事会先排在这里。',
        candPending: '待定',
        candCommitted: '已销账',
        candRejected: '退回',
        candCommit: '记下了',
        candReject: '退回',
        candNote: '这里只改候选状态；真正写进 cortex 的是本鲸自己。',
        recentTitle: '本场流水',
        noEvents: '这一场还没有动静。',
        sayFailed: '没念出来',
        actionFailed: '操作没成功',
        hint: '直播时的一切只活在 whale-live 数据目录里：意识卡、观察日记、每场记录。cortex 只收本鲸亲手挑过的那几件。',
      },
      en: {
        navLabel: 'Whale live desk',
        title: 'Whale live desk',
        subtitle: 'Room {room} · voice {voice}',
        open: 'Go live',
        close: 'End stream',
        stop: 'Hush',
        avatar: 'Avatar',
        avatarOn: 'Avatar on',
        refresh: 'Refresh',
        tabLive: 'Stream',
        tabConsciousness: 'Consciousness',
        tabDiary: 'Field diary',
        tabCandidates: 'Memory inbox',
        stateLive: 'Live',
        stateIdle: 'Off air',
        stat: '{says} spoken · {danmaku} danmaku · {notes} notes',
        since: 'since {time}',
        sayPlaceholder: 'Make her say something…',
        sayButton: 'Speak',
        sayHint: 'Spoken lines only enter this stream log; they never enter memory by themselves.',
        said: 'Said it.',
        emptyLiveTitle: 'Not on air',
        emptyLiveBody: 'Start a stream and the whale will listen, speak and take notes through the tools. You can also just tell me “go live”.',
        emptyDoc: '(empty)',
        loading: 'Reading…',
        failed: 'Could not read',
        retry: 'Try again',
        pendingChip: '{n} pending',
        candEmpty: 'No memory candidates yet. After a stream, the few things I picked land here first.',
        candPending: 'Pending',
        candCommitted: 'Filed',
        candRejected: 'Dropped',
        candCommit: 'Keep',
        candReject: 'Drop',
        candNote: 'This only changes the candidate’s state; writing to cortex is my own separate step.',
        recentTitle: 'Stream log',
        noEvents: 'Nothing has happened in this stream yet.',
        sayFailed: 'Could not speak',
        actionFailed: 'Action failed',
        hint: 'Everything live stays inside the whale-live data folder. Cortex only receives the few things I hand-picked afterwards.',
      },
    };

    function fmtTime(iso) {
      if (!iso) return '';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      const p = (n) => String(n).padStart(2, '0');
      return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
    }

    function fmtDay(iso) {
      if (!iso) return '';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      const p = (n) => String(n).padStart(2, '0');
      return `${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
    }

    function fill(template, values) {
      return String(template ?? '').replace(/\{(\w+)\}/g, (_m, key) => (values[key] === undefined ? `{${key}}` : String(values[key])));
    }

    async function getJson(path) {
      const response = await fetch(`${API}${path}`, { cache: 'no-store', credentials: 'same-origin' });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error || `HTTP ${response.status}`);
      return body.data;
    }

    async function postAction(action, payload = {}) {
      const response = await fetch(`${API}/action`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-whale-live': '1' },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error || `HTTP ${response.status}`);
      return body.data;
    }

    /* ── 图标：一头小鲸鱼 ───────────────────────────────── */
    function Icon({ size = 18, active = false }) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        'aria-hidden': true,
        style: { display: 'block', color: active ? 'var(--dsw-alias-brand-primary, #2f6fed)' : 'currentColor' },
      }, [
        h('path', {
          key: 'body',
          d: 'M2.6 12.9c0-2.9 2.7-5 6.4-5 2.4 0 4.4.6 5.7 1.6.7.5 1.5.7 2.4.7h.4c1 0 1.8.7 1.8 1.7s-.8 1.7-1.8 1.7h-.6c-.5 2.3-3 3.9-6.4 3.9-3.9 0-7.9-1.3-7.9-4.6Z',
          fill: 'currentColor',
        }),
        h('path', {
          key: 'tail',
          d: 'M16.2 10.6c1.1-.9 2.4-1.6 3.7-1.9-.1 1.2-.6 2.2-1.3 3 .7.8 1.2 1.8 1.3 3-1.3-.3-2.6-1-3.7-1.9.7-.7.9-1.6 0-2.2Z',
          fill: 'currentColor',
        }),
        h('circle', { key: 'eye', cx: 5.6, cy: 11.6, r: 1.05, fill: 'var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base, #fff))' }),
        h('path', {
          key: 'spout',
          d: 'M7.4 6.5c.6-.7.9-1.5.9-2.4M10 6.9c1.2-.4 2-1.1 2.4-2.1',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        }),
      ]);
    }

    const KIND_LABEL = {
      danmaku: '弹幕',
      gift: '礼物',
      say: '大肥鱼',
      note: '记一笔',
      mood: '心情',
      open: '开播',
      close: '下播',
    };

    function EventRow({ row }) {
      const kind = row.kind || 'note';
      return h('div', { className: `dshwl-event dshwl-event-${kind}` }, [
        h('span', { key: 't', className: 'dshwl-event-time' }, fmtTime(row.ts)),
        h('span', { key: 'k', className: 'dshwl-event-kind' }, KIND_LABEL[kind] || kind),
        h('span', { key: 'b', className: 'dshwl-event-body' }, kind === 'danmaku' || kind === 'gift'
          ? `${row.user || '观众'}：${row.text || ''}`
          : row.text || ''),
      ]);
    }

    function Panel({ ctx }) {
      const t = useMemo(() => ctx.locale.bind(NS), [ctx]);
      const [state, setState] = useState(null);
      const [error, setError] = useState('');
      const [tab, setTab] = useState('live');
      const [busy, setBusy] = useState('');
      const [notice, setNotice] = useState('');
      const [draft, setDraft] = useState('');
      const [doc, setDoc] = useState({ kind: '', text: '', loading: false, error: '' });
      const [docTick, setDocTick] = useState(0);
      const alive = useRef(true);

      useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
      }, []);

      const reload = useCallback(async () => {
        try {
          const data = await getJson('/state');
          if (!alive.current) return;
          setState(data);
          setError('');
        } catch (cause) {
          if (!alive.current) return;
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }, []);

      useEffect(() => {
        reload();
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') reload();
        }, 6000);
        return () => clearInterval(timer);
      }, [reload]);

      useEffect(() => {
        if (tab !== 'consciousness' && tab !== 'diary') return;
        let cancelled = false;
        setDoc((prev) => ({ ...prev, kind: tab, loading: true, error: '' }));
        getJson(`/doc?kind=${tab}&chars=60000`)
          .then((data) => {
            if (cancelled) return;
            setDoc({ kind: tab, text: data.text || '', loading: false, error: '' });
          })
          .catch((cause) => {
            if (cancelled) return;
            setDoc({ kind: tab, text: '', loading: false, error: cause instanceof Error ? cause.message : String(cause) });
          });
        return () => { cancelled = true; };
      }, [tab, docTick]);

      const flash = useCallback((message) => {
        setNotice(message);
        setTimeout(() => setNotice(''), 3200);
      }, []);

      const run = useCallback(async (name, action, payload) => {
        setBusy(name);
        try {
          const result = await postAction(action, payload);
          if (result?.state) setState(result.state);
          return result;
        } catch (cause) {
          flash(`${t('actionFailed')}：${cause instanceof Error ? cause.message : String(cause)}`);
          return null;
        } finally {
          setBusy('');
        }
      }, [flash, t]);

      const onSay = useCallback(async () => {
        const text = draft.trim();
        if (!text) return;
        const result = await run('say', 'say', { text });
        if (result?.voice?.ok) {
          setDraft('');
          flash(t('said'));
        } else if (result?.voice) {
          flash(`${t('sayFailed')}：${result.voice.error}`);
        }
      }, [draft, flash, run, t]);

      const session = state?.session ?? null;
      const config = state?.config ?? {};
      const candidates = state?.candidates ?? [];
      const pending = state?.pendingCount ?? 0;
      const events = state?.recent ?? [];

      const tabs = [
        ['live', t('tabLive')],
        ['consciousness', t('tabConsciousness')],
        ['diary', t('tabDiary')],
        ['candidates', t('tabCandidates')],
      ];

      const head = h('div', { className: 'dshwl-head' }, [
        h('div', { key: 'title' }, [
          h('h1', { key: 'h', className: 'dshwl-title' }, t('title')),
          h('p', { key: 's', className: 'dshwl-sub' }, fill(t('subtitle'), {
            room: config.roomName || config.roomId || '—',
            voice: config.voice || '—',
          })),
        ]),
        h('div', { key: 'actions', className: 'dshwl-actions' }, [
          h('button', {
            key: 'live',
            type: 'button',
            className: 'dshwl-btn primary',
            disabled: busy !== '',
            onClick: () => run('session', session ? 'close' : 'open'),
          }, session ? t('close') : t('open')),
          h('button', {
            key: 'stop',
            type: 'button',
            className: 'dshwl-btn',
            disabled: busy !== '' || !state?.voice?.speaking,
            onClick: () => run('stop', 'stop'),
          }, t('stop')),
          h('button', {
            key: 'avatar',
            type: 'button',
            className: 'dshwl-btn',
            disabled: busy !== '' || !state?.avatar || state.avatar.up === true,
            onClick: () => run('avatar', 'avatar', { step: 'open' }),
          }, t('avatar')),
          h('button', {
            key: 'refresh',
            type: 'button',
            className: 'dshwl-btn',
            disabled: busy !== '',
            onClick: reload,
          }, t('refresh')),
        ]),
      ]);

      const status = h('div', { className: 'dshwl-status' }, [
        h('span', { key: 'dot', className: `dshwl-dot${session ? ' on' : ''}` }),
        h('span', { key: 'text' }, session
          ? `${t('stateLive')} · ${fill(t('since'), { time: fmtTime(session.startedAt) })} · ${fill(t('stat'), {
            says: session.says ?? 0,
            danmaku: session.danmaku ?? 0,
            notes: session.notes ?? 0,
          })}`
          : `${t('stateIdle')} · ${fill(t('stat'), { says: 0, danmaku: 0, notes: 0 })}`),
        pending > 0
          ? h('span', { key: 'chip', className: 'dshwl-chip' }, fill(t('pendingChip'), { n: pending }))
          : null,
        state?.avatar?.up ? h('span', { key: 'skin', className: 'dshwl-chip on' }, t('avatarOn')) : null,
        state?.voice?.speaking ? h('span', { key: 'voice', className: 'dshwl-chip on' }, '♪') : null,
      ]);

      const tabRow = h('div', { key: 'tabs', className: 'dshwl-tabs', role: 'tablist' }, tabs.map(([key, label]) => h('button', {
        key,
        type: 'button',
        role: 'tab',
        'aria-selected': tab === key,
        className: `dshwl-tab${tab === key ? ' on' : ''}`,
        onClick: () => setTab(key),
      }, label)));

      let body = null;

      if (tab === 'live') {
        if (!session) {
          body = h('div', { className: 'dshwl-empty' }, [
            h('div', { key: 't', className: 'dshwl-empty-title' }, t('emptyLiveTitle')),
            h('p', { key: 'b', className: 'dshwl-empty-body' }, t('emptyLiveBody')),
            h('button', {
              key: 'go',
              type: 'button',
              className: 'dshwl-btn primary',
              disabled: busy !== '',
              onClick: () => run('session', 'open'),
            }, t('open')),
          ]);
        } else {
          body = h('div', {}, [
            h('div', { key: 'composer', className: 'dshwl-composer' }, [
              h('input', {
                key: 'input',
                className: 'dshwl-input',
                value: draft,
                placeholder: t('sayPlaceholder'),
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && !event.nativeEvent?.isComposing) {
                    event.preventDefault();
                    onSay();
                  }
                },
              }),
              h('button', {
                key: 'send',
                type: 'button',
                className: 'dshwl-btn primary',
                disabled: busy !== '' || !draft.trim(),
                onClick: onSay,
              }, busy === 'say' ? '…' : t('sayButton')),
            ]),
            h('p', { key: 'hint', className: 'dshwl-hint' }, t('sayHint')),
            h('h3', { key: 'rt', className: 'dshwl-section-title' }, t('recentTitle')),
            events.length
              ? h('div', { key: 'list', className: 'dshwl-events' }, events.slice().reverse().map((row, index) => h(EventRow, {
                key: `${row.ts}-${index}`,
                row,
              })))
              : h('p', { key: 'none', className: 'dshwl-muted' }, t('noEvents')),
          ]);
        }
      } else if (tab === 'candidates') {
        body = h('div', {}, [
          h('p', { key: 'note', className: 'dshwl-hint' }, t('candNote')),
          candidates.length
            ? h('div', { key: 'list', className: 'dshwl-cands' }, candidates.map((row) => h('div', {
              key: row.id,
              className: 'dshwl-cand',
            }, [
              h('div', { key: 'head', className: 'dshwl-cand-head' }, [
                h('span', { key: 'k', className: `dshwl-badge ${row.status}` }, row.status === 'pending'
                  ? t('candPending')
                  : row.status === 'committed' ? t('candCommitted') : t('candRejected')),
                h('span', { key: 'meta', className: 'dshwl-cand-meta' }, `${row.kind || 'observation'} · ${fmtDay(row.createdAt)} · ${Math.round((row.importance ?? 0.6) * 100)}%`),
              ]),
              h('p', { key: 'text', className: 'dshwl-cand-text' }, row.text),
              row.reason ? h('p', { key: 'reason', className: 'dshwl-muted' }, `↳ ${row.reason}`) : null,
              row.status === 'pending' ? h('div', { key: 'actions', className: 'dshwl-actions' }, [
                h('button', {
                  key: 'keep',
                  type: 'button',
                  className: 'dshwl-btn',
                  disabled: busy !== '',
                  onClick: () => run(`cand-${row.id}`, 'candidate', { id: row.id, decision: 'commit' }),
                }, t('candCommit')),
                h('button', {
                  key: 'drop',
                  type: 'button',
                  className: 'dshwl-btn',
                  disabled: busy !== '',
                  onClick: () => run(`cand-${row.id}`, 'candidate', { id: row.id, decision: 'reject' }),
                }, t('candReject')),
              ]) : null,
            ])))
            : h('div', { key: 'empty', className: 'dshwl-empty' }, t('candEmpty')),
        ]);
      } else {
        const kind = tab;
        const current = doc.kind === kind ? doc : null;
        body = h('div', {}, [
          h('div', { key: 'bar', className: 'dshwl-toolbar' }, [
            h('span', { key: 'meta', className: 'dshwl-muted' }, state?.docs?.[kind]
              ? `${state.docs[kind].chars} 字 · ${fmtDay(state.docs[kind].updatedAt)}`
              : ''),
            h('button', {
              key: 'reload',
              type: 'button',
              className: 'dshwl-btn',
              onClick: () => setDocTick((value) => value + 1),
            }, t('refresh')),
          ]),
          !current || current.loading
            ? h('p', { key: 'loading', className: 'dshwl-muted' }, t('loading'))
            : current.error
              ? h('p', { key: 'err', className: 'dshwl-error' }, `${t('failed')}：${current.error}`)
              : h('pre', { key: 'doc', className: 'dshwl-doc' }, current.text || t('emptyDoc')),
        ]);
      }

      return h('div', { className: 'dshwl-root' }, [
        head,
        status,
        error ? h('div', { key: 'err', className: 'dshwl-error' }, `${t('failed')}：${error}`) : null,
        tabRow,
        h('div', { key: 'body', className: 'dshwl-body', role: 'tabpanel' }, body),
        h('p', { key: 'foot', className: 'dshwl-foot' }, t('hint')),
        notice ? h('div', { key: 'notice', className: 'dshwl-notice' }, notice) : null,
      ]);
    }

    const CSS = `
.dshwl-root{height:100%;overflow:auto;box-sizing:border-box;padding:20px 24px 40px;color:var(--dsw-alias-label-primary,#1f2329);background:var(--dsw-alias-bg-base,#fff);font:13px/1.55 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}
.dshwl-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dshwl-title{margin:0;font-size:18px;font-weight:650}
.dshwl-sub{margin:2px 0 0;color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px}
.dshwl-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dshwl-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer;line-height:1.6}
.dshwl-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#2f6fed);color:var(--dsw-alias-brand-primary,#2f6fed)}
.dshwl-btn.primary{background:var(--dsw-alias-brand-primary,#2f6fed);border-color:var(--dsw-alias-brand-primary,#2f6fed);color:#fff}
.dshwl-btn.primary:hover:not(:disabled){filter:brightness(1.06);color:#fff}
.dshwl-btn:disabled{opacity:.5;cursor:not-allowed}
.dshwl-btn:focus-visible,.dshwl-tab:focus-visible,.dshwl-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2f6fed);outline-offset:2px}
.dshwl-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 10px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.dshwl-dot{width:8px;height:8px;border-radius:999px;background:var(--dsw-alias-state-idle-primary,#9ca3af);flex:none}
.dshwl-dot.on{background:var(--dsw-alias-state-success-primary,#15803d);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary,#15803d) 22%, transparent)}
.dshwl-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-radius:999px;padding:1px 8px;font-size:11px}
.dshwl-chip.on{color:var(--dsw-alias-brand-primary,#2f6fed);border-color:var(--dsw-alias-brand-primary,#2f6fed)}
.dshwl-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);margin-bottom:16px;overflow-x:auto}
.dshwl-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);padding:7px 10px;border-bottom:2px solid transparent;font:inherit;cursor:pointer;white-space:nowrap}
.dshwl-tab.on{color:var(--dsw-alias-brand-primary,#2f6fed);border-bottom-color:var(--dsw-alias-brand-primary,#2f6fed);font-weight:600}
.dshwl-body{min-height:160px}
.dshwl-composer{display:flex;gap:8px;align-items:center}
.dshwl-input{flex:1;min-width:0;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;border-radius:9px;padding:8px 10px;font:inherit;font-size:13px}
.dshwl-hint{margin:8px 0 14px;color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;line-height:1.5}
.dshwl-section-title{margin:10px 0 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280)}
.dshwl-events{display:flex;flex-direction:column;gap:2px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);border-radius:10px;padding:6px 4px;background:var(--dsw-alias-bg-layer-1,#fff);max-height:46vh;overflow:auto}
.dshwl-event{display:grid;grid-template-columns:58px 56px 1fr;gap:8px;align-items:baseline;padding:4px 8px;border-radius:7px;font-size:12px;line-height:1.5}
.dshwl-event:hover{background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
.dshwl-event-time{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;font-variant-numeric:tabular-nums}
.dshwl-event-kind{font-size:10px;color:var(--dsw-alias-label-secondary,#6b7280);border:1px solid var(--dsw-alias-border-l1,#e5e7eb);border-radius:999px;padding:0 6px;justify-self:start}
.dshwl-event-body{min-width:0;word-break:break-word}
.dshwl-event-say .dshwl-event-kind{color:var(--dsw-alias-brand-primary,#2f6fed);border-color:var(--dsw-alias-brand-primary,#2f6fed)}
.dshwl-event-say .dshwl-event-body{color:var(--dsw-alias-brand-primary,#2f6fed)}
.dshwl-event-danmaku .dshwl-event-body{color:var(--dsw-alias-label-primary,#1f2329)}
.dshwl-doc{margin:0;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-layer-2,#f7f8fa);border:1px solid var(--dsw-alias-border-l1,#e5e7eb);border-radius:10px;padding:14px 16px;font:12px/1.7 "Cascadia Code","Consolas","Microsoft YaHei",monospace;max-height:58vh;overflow:auto}
.dshwl-cands{display:flex;flex-direction:column;gap:8px}
.dshwl-cand{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px;padding:10px 12px}
.dshwl-cand-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshwl-badge{font-size:10px;border-radius:999px;padding:1px 8px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);color:var(--dsw-alias-label-secondary,#6b7280)}
.dshwl-badge.pending{color:var(--dsw-alias-state-warn-primary,#b45309);border-color:var(--dsw-alias-state-warn-primary,#b45309)}
.dshwl-badge.committed{color:var(--dsw-alias-state-success-primary,#15803d);border-color:var(--dsw-alias-state-success-primary,#15803d)}
.dshwl-badge.rejected{color:var(--dsw-alias-state-error-primary,#d33);border-color:var(--dsw-alias-state-error-primary,#d33)}
.dshwl-cand-meta{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px}
.dshwl-cand-text{margin:6px 0 4px;font-size:13px;line-height:1.55;word-break:break-word}
.dshwl-cand .dshwl-actions{margin-top:8px}
.dshwl-empty{border:1px dashed var(--dsw-alias-border-l2,#d1d5db);border-radius:12px;padding:26px 20px;text-align:center;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;line-height:1.6}
.dshwl-empty-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2329);margin-bottom:6px}
.dshwl-empty-body{margin:0 auto 14px;max-width:460px}
.dshwl-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.dshwl-muted{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;margin:4px 0}
.dshwl-error{border:1px solid var(--dsw-alias-state-error-primary,#d33);color:var(--dsw-alias-state-error-primary,#d33);border-radius:8px;padding:7px 10px;margin:10px 0;font-size:12px;word-break:break-word}
.dshwl-foot{margin:22px 0 0;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1,#e5e7eb);color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;line-height:1.6}
.dshwl-notice{position:sticky;bottom:0;margin-top:12px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-overlay,#fff);border-radius:8px;padding:7px 10px;font-size:12px;color:var(--dsw-alias-label-primary,#1f2329);box-shadow:0 2px 10px rgba(0,0,0,.06);word-break:break-word}
`;

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const zh = ctx.locale.register(NS, 'zh', DICT.zh);
          const en = ctx.locale.register(NS, 'en', DICT.en);
          return () => { en(); zh(); };
        }, 'whale-live: locale');

        ctx.effect(() => {
          const style = document.createElement('style');
          style.id = 'dsh-whale-live-style';
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'whale-live: style');

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'whale-live',
          order: 7,
          label: () => ctx.locale.bind(NS)('navLabel'),
        }, (owner) => h(Icon, { size: owner?.size ?? 18, active: owner?.active === true })));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'whale-live',
        }, () => h(Panel, { ctx })));
      },
    };
  },
});
