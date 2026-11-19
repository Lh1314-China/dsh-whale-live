# 直播台 · dsh-whale-live

把一场直播收进 DeepSeek Harness：左侧栏一个入口，看戏本、看本场、管入忆候选；
模型用工具开播、听弹幕、说话、记事、下播。

**一句话边界**：直播里的一切只活在 `dataDir` 里的两本人设文件和每场记录里；
长期记忆只收你下播后亲手挑过、亲手写下的那 1–3 件。

## 前提

| 需要 | 用途 | 不装会怎样 |
|---|---|---|
| Windows | 插件声明 `os: ["win32"]` | 装不上 |
| DSH `>=0.2.1-rc.2`、Node `>=20` | 见 `dsh.compatibility` | 装不上 |
| **你自己的 B 站直播间号** | 连弹幕 | 房号留空 = 不连任何房间 |
| **你自己的 B 站登录凭据 JSON** | 读弹幕 | 只能手动记，不读弹幕 |
| Python + `edge-tts` | 说话（默认后端） | 静音，其余功能照常 |
| VTube Studio（可选） | 皮套动嘴 | 只出声，不动嘴 |
| OBS / B 站直播姬（可选） | 开播前拉设备 | 不自动拉起，手动开 |

先跑一次自检，它只读、不装任何东西：

```powershell
.\scripts\check-env.ps1
```

## 安装

```powershell
# npm
dsh plugin --profile desktop add dsh-whale-live

# 或直接装 GitHub 仓库
dsh plugin --profile desktop add github:Lh1314-China/dsh-whale-live
```

装完重启 DSH。

## 首次配置

配置在 profile 的 `cordis.patch.yml` 里（`whale-live` 那条的 `config` 下）。
**所有路径默认留空**，空值就落到 `~/.dsh/whale-live`。

1. **房间**：填 `roomId`（数字）与 `roomName`（显示用）。
2. **凭据**：把你自己账号的登录态存成 JSON，路径填 `credentialFile`。
   插件**不打包、不代登录、不上传**任何凭据。
3. **说话**：`pip install edge-tts`；`pythonPath` 留空就用 PATH 上的 `python`。
   想用别的 TTS，把配置放到 `<dataDir>/volc.json`，或用环境变量
   `DSH_WHALE_LIVE_VOLC` 指过去；失败会自动退回 edge-tts。
4. **皮套**：打开 VTube Studio，允许插件 API（端口默认 `8001`）。
   嘴型参数名默认是 `MouthOpen` / `MouthSmile`；**你的模型用了别的名字**时，
   用环境变量覆盖：

   ```powershell
   $env:DSH_WHALE_LIVE_MOUTH_PARAM = 'ParamMouthOpenY'
   $env:DSH_WHALE_LIVE_SMILE_PARAM = 'ParamMouthSmile'
   ```

5. **人设**：在 `persona` 里写一段纯文本（名字、称呼、说话方式、边界）。
   留空时用一句中性说明，不会硬塞任何角色设定。
6. 数据目录首次启动自动创建，里面有：

   ```text
   意识.md            核心经历与性格（可手改）
   观察日记.md        按天、按观众记的观察
   场次/<id>.md       每场记录
   入忆候选.jsonl     下播后挑出来的候选
   ```

## 工具

| 工具 | 作用 |
|---|---|
| `whale_live` | `open` 开场 / `listen` 等弹幕 / `note` 记一笔 / `close` 下播 / `propose`·`memory_list`·`commit`·`reject` 管候选 / `avatar` 皮套 / `stage` 架设备 / `diagnose` 自检 / `read`·`status` |
| `whale_say` | 用 edge-tts 念一句（可停） |

入忆候选只是排队：面板和 `commit` 都**不会**替你写记忆，真正写要模型自己调
`cortex_write`（装了 cortex 的话）。

## 边界与声明

- **不推流**：只负责场次、弹幕、说话与皮套，推流仍由 OBS / 直播姬负责。
- **不代登录**：没有内置账号，凭据是你自己的文件。
- **不打包人设**：`意识.md` / `观察日记.md` 首次生成的是空模板。
- 只在本机运行；除了 B 站接口与你显式配置的 TTS，没有其它出站请求。
- **MIT**，见 [LICENSE](LICENSE)。
