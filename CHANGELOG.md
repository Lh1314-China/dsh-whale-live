# Changelog

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