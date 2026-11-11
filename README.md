# dsh-whale-live

A **left-sidebar live console** for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH): it turns a persona file pair into a readable "script", records every stream, reads Bilibili danmaku, speaks with edge-tts, and keeps a small inbox of memories for the model to hand-pick after the stream.

> **It is a local bridge, not a cloud service.** Persona files, logs and the memory inbox never leave your machine. The only network calls are the Bilibili room API (read-only), edge-tts (Microsoft), and — optionally — your local VTube Studio plugin API.

## What it does

| Piece | Behavior |
| --- | --- |
| Persona script | `意识.md` + `人类观察日记.md`; the panel and the model read them as the role to play |
| Stream log | Every session gets `场次/<id>/meta.json`, `直播.jsonl`, `会话.md` |
| Danmaku | Polls the Bilibili room API (read-only, no sending) |
| Speech | edge-tts synthesizes a line, Windows MCI plays it; optional VTube Studio mouth sync |
| Memory inbox | After a stream the model proposes a few candidates; nothing enters long-term memory automatically |
| Panel | "本场 / 意识 / 观察日记 / 入忆候选" tabs, say box, avatar switch |

## Requirements

- **Windows** (audio playback uses MCI/`winmm`; `os: ["win32"]`).
- **DSH** `>=0.2.1-rc.2 <0.4.0` (tested on `0.2.2-rc.1`, desktop profile). The panel uses the sidebar/`main` slot API.
- **Python 3.10+** with [`edge-tts`](https://pypi.org/project/edge-tts/) for speech. Point `pythonPath` at that interpreter.
- **Bilibili cookies** (`sessdata`, `bili_jct`, `buvid3`, `dedeuserid`) in a local JSON file for `listen`.
- Optional: a VTube Studio mouth driver directory containing `vts_speak.py` / `vts_client.py`; without it speech still plays, just without lip-sync.

## Install

1. Install this package into a DSH profile through the Plugin Manager (or `npm i dsh-whale-live` and link it).
2. Edit the `whale-live` row in the profile's `cordis.patch.yml`:

```yaml
- id: whale-live
  name: dsh-whale-live
  config:
    roomId: 123456                 # your Bilibili room id
    roomName: 'My room'
    dataDir: 'D:/WhaleLive'        # empty = ~/.dsh/whale-live
    credentialFile: 'D:/secret/bili.json'
    pythonPath: 'C:/Python311/python.exe'
    vtubeDir: ''                   # optional VTube Studio bridge
    voice: zh-CN-XiaoyiNeural
    rate: '+8%'
    pitch: '+4Hz'
    listenWaitSec: 45
```

3. Restart DSH (or let the Plugin Manager apply it), then open **鲸鱼直播台 / Whale live desk** in the left sidebar.

## Data layout

```
<dataDir>/
  意识.md                  consciousness / role script
  人类观察日记.md           per-day, per-viewer diary
  入忆候选.jsonl            memory candidates (pending / committed / rejected)
  状态.json                current session pointer
  场次/<id>/meta.json      per-stream counters
  场次/<id>/直播.jsonl      per-stream events
  场次/<id>/会话.md         human-readable transcript
  音频/                    edge-tts mp3 cache
```

## Tools (model side)

- `whale_live` — `open`, `listen`, `note`, `close`, `read`, `status`, `propose` / `memory_list` / `commit` / `reject`, `avatar`.
- `whale_say` — say / stop / status (edge-tts).

The model acts **through** these tools; the plugin never writes to DSH long-term memory on its own.

## Compatibility notes

- **Windows only** in this release. The Host half itself is plain Node; only the speech helper (`runtime/say.py`) and `runtime/vts_reset.py` are Windows-specific.
- **DSH API**: depends on `sidebar.panellist`, `main`, `locale` and `webServer` services. A future DSH release outside the declared range may change them.
- **Bilibili**: uses the unofficial `ajax/msg` endpoint; it can change or rate-limit, and some rooms return empty. Read-only — the plugin never sends danmaku.
- **VTube Studio**: optional. Without a mouth driver directory the plugin degrades to plain audio playback.

## Privacy

- No telemetry; no accounts; nothing is uploaded.
- Bilibili cookies stay in the file you point `credentialFile` to.
- Persona documents and stream logs stay under `dataDir`.
- The panel's HTTP API is bound to the same loopback origin and rejects cross-site requests.

## License

MIT.
