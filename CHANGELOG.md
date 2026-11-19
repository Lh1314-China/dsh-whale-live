# Changelog

## 0.3.3 — 2026-11-20

第一次以通用形态公开发布。

### 变了

- **人设种子中性化**：`意识.md` / `观察日记.md` 首次生成的是空模板，不再写死任何角色设定。
- **人设可配置**：新增 `persona`，`open` 时作为「你是谁」注入；留空则用中性说明。
- **嘴型参数可配**：默认 `MouthOpen` / `MouthSmile`，可用环境变量
  `DSH_WHALE_LIVE_MOUTH_PARAM` / `DSH_WHALE_LIVE_SMILE_PARAM` 覆盖。
- **配置默认值全空**：房号、路径、凭据、外部程序路径都不再写死；空值落到
  `~/.dsh/whale-live`、房号 0（不连任何房间）。
- **新增 `scripts/check-env.ps1`**：只读自检（Python/edge-tts、VTS 端口、OBS、
  直播姬、凭据文件），不安装任何东西。
- **首次启动会生成两本空模板**（之前只建目录），与 README 描述一致。

### 没变

- 不推流、不代登录、不打包凭据。
- 下播只产生入忆候选；真正写长期记忆仍要模型自己调 `cortex_write`。
