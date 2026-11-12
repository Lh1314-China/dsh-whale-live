# Changelog

## 0.2.3 — 2026-11-12

### Added
- **Watch toggle in the panel.** The Prepare tab now has a "Watch chat / Stop watching" button, so the host can start or stop the 4-second danmaku poll without asking the model. The toggle reads the live state from `/state` and writes through `action=watch`.
- The watch timer is shared between the model tool and the panel, so either side can start/stop it; the model is still the one woken by `followup()`.

### Notes
- Starting watch requires an open session; it stops when the session closes or the plugin reloads.
- Falls back to `inject` (context only) if `followup` is unavailable.
## 0.2.2 — 2026-11-12

### Added
- **Real-time watching.** `whale_live action=watch` starts a 4-second danmaku poll; when new messages arrive the plugin calls the Agent's `followup()` to wake the model, so it can answer while the stream is live. `watch step=stop` (or closing the session) stops it.
- The plugin now captures the calling Agent from tool execution so it can be woken later.

### Notes
- If `followup` is unavailable in a future DSH version, the plugin falls back to `inject` (context only, no wake) instead of failing the loop.
## 0.2.1 — 2026-11-11

### Fixed
- **Mouth sync failed on non-ASCII data paths.** `miniaudio` could not decode the synthesized mp3 when the audio folder contained Chinese characters (`failed to decode file, -7`), so speech fell back to silent, mouth-less playback. The mp3 is now copied to an ASCII temp path before decoding.
- `whale_say` now surfaces the mouth-sync error instead of quietly omitting the "mouth moved" marker.

### Added
- `whale_live action=vts`: trigger VTube Studio hotkeys / toggle expressions / set the mouth while live, so the model can act on its own judgement.

### Known issues in 0.2.0
- Mouth movement during plugin speech could silently fail whenever `dataDir` contained non-ASCII characters.
- No plugin-side way to trigger expressions or hotkeys during a stream.