# Implementation TODO List (MVP v0.1)

本文件把 `architecture.md` 的框架性描述，落到“可以按顺序做完”的实现任务清单（以当前仓库的 TypeScript + Claude Agent SDK 为准）。

> 约束回顾：Linux + Docker，宿主机定时触发，容器 run-once；白名单 `channel_id(UC...)`；最新 N；出现过就不再做；无并发；>5 分钟过滤；最多 5 次重试；输出 `final_output.mp4 + metadata.json + thumbnail.jpg` 到按 `run_id(Asia/Shanghai)` 分批的目录。

---

## 0. 先把“可执行基线”补齐

- [x] **统一实现语言/文档口径**：已改为 TypeScript 编排、LLM 仅做结构化输出（见 `architecture.md`）。
- [x] **加入 `.env` 加载**：已增加 `.env` 读取（自带 loader，等价于 dotenv），`.env` 已在 `.gitignore`。
- [x] **可观测性基线**：已实现最小日志模块（run_id + 时间戳 + level），输出到 `workspace/logs/{run_id}.log`。
- [x] **配置校验增强**：已在 `src/config.ts` 完成：
  - [x] `channels` 非 `UC` 前缀给出 warning（不阻断运行）
  - [x] `paths.*` 非空与空白校验
  - [x] `retries_max`/`max_duration_seconds` 合理范围约束

---

## 1. 作业模型（job.json）与幂等逻辑（先做）

- [x] **定义 `job.json` TypeScript 类型 + 读写函数**
  - [x] `src/jobs/job.ts`：Job schema（Zod）+ `loadJob()` / `saveJob()` / `jobExists()`
  - [x] 统一字段：`video_id/channel_id/source_url/created_at/updated_at/status/attempts/step/last_error/artifacts`
- [ ] **实现“出现过就不再做”**
  - [ ] 在进入任何重活前（RSS 候选阶段即可）检查 `workspace/jobs/{video_id}/job.json`
  - [ ] 存在则跳过并记录到日志（MVP 不续跑、不恢复）
- [ ] **实现重试计数与失败落盘**
  - [ ] 每次失败 `attempts += 1`，更新 `updated_at`
  - [ ] `attempts > retries_max` → `status=failed` + 写 `last_error` + 跳过

---

## 2. 节点 1：RSS 拉取 + 最新 N 个（白名单 channel_id）

  - [x] **实现 RSS 拉取器**
    - [x] `src/youtube/rss.ts`：`fetchChannelFeed(channelId) -> entries[]`
    - [x] URL：`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
    - [x] 超时/重试：网络失败时有限重试（与 job 重试区分开：RSS 属于 run-level）
- [x] **解析 RSS（XML）**
  - [x] 已实现最小 XML 解析（entry/videoId/published/link）
  - [x] 产出字段：`video_id`、`published_at`、`source_url`、`channel_id`
- [ ] **合并多个 channel 的条目并排序**
  - [ ] 按 `published_at` 倒序取最新 `max_videos_per_run`
  - [ ] 对每条先做 `jobExists(video_id)` 去重过滤

验收标准：
- [ ] `npm run dev -- --config config.yaml` 能打印“本次候选 video_id 列表（最新 N，已过滤 jobExists）”

---

## 3. 节点 2：yt-dlp 预检（过滤 > 5 分钟 / 非直播）

  - [x] **实现 `yt-dlp --dump-json --skip-download` 封装**
    - [x] `src/tools/ytdlp.ts`：`preflight(videoUrl) -> info`
    - [x] 对 `duration`/`is_live`/`live_status` 做兼容读取
    - [x] 超时与 stderr/stdout 捕获（写入日志摘要）
  - [x] **实现预检过滤规则**
    - [x] `duration <= max_duration_seconds`（默认 300）
    - [x] 非 live（按字段兼容）
    - [x] 可选：排除 `shorts`（URL 或 info 字段）
- [ ] **将预检 info 落盘**
  - [ ] 写到 `workspace/jobs/{video_id}/source/video.info.json`（即便后续失败也保留，便于排查）

验收标准：
- [ ] 能对一个给定 video_url 输出“通过/不通过”与原因，并写入 `video.info.json`

---

## 4. 节点 3：下载与落盘（视频 + info + thumbnail）

  - [x] **实现下载命令封装**
    - [x] `src/tools/ytdlp.ts`：`download(videoUrl, outputDir, archivePath)`
    - [x] 参数要点：
      - [x] `--download-archive workspace/state/download_archive.txt`
      - [x] `-f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]"`
      - [x] `--write-info-json`
      - [x] `--write-thumbnail`
      - [x] 输出到 `workspace/jobs/{video_id}/source/`（固定命名：`video.mp4`）
- [ ] **封面格式归一**
  - [ ] 将 `thumbnail.*` 转为 `dist/thumbnail.jpg`（用 ffmpeg 或 imagemagick；Docker 镜像需内置）
  - [ ] **落盘完整性检查**
    - [x] 校验 `video.mp4` 存在且大小 > 0
    - [ ] 失败时写入 `job.json.last_error`

验收标准：
- [ ] 指定 1 个公开视频，能在 `workspace/jobs/{video_id}/source/` 生成 `video.mp4 + video.info.json + thumbnail.*`

---

## 5. 节点 4：ASR（faster-whisper，CPU/GPU fallback）

> 注意：MVP 只处理 <=5 分钟视频，但仍建议 VAD，CPU fallback 用 `int8`。

- [ ] **确定 ASR 运行形态**
  - [ ] 方案 A：Node 调用 Python CLI（容器内装 Python + faster-whisper），最简单可靠
  - [ ] 方案 B：Node 直接调用现成 ASR 服务（不建议 MVP）
- [ ] **实现音频提取**
  - [ ] `src/tools/ffmpeg.ts`：`extractAudio(videoPath, wavPath)`（`16kHz mono wav`）
- [ ] **实现 ASR CLI 工具**
  - [ ] `src/tools/asr.ts`：调用 Python 脚本，输出 `source_segments.json` + `source.srt`
  - [ ] Python 脚本支持：
    - [ ] GPU 可用则用 GPU，否则 CPU（`compute_type=int8`）
    - [ ] VAD 开关
    - [ ] 统一输出 schema：`[{start,end,text}]`

验收标准：
- [ ] 对一个 1–2 分钟视频生成 `workspace/jobs/{video_id}/asr/source_segments.json` 与 `source.srt`

---

## 6. 节点 5：翻译/本地化（JSON → SRT，结构化输出）

> MVP 关键：**不让 LLM 直接吐 SRT**，而是吐 `translated_segments.json`（严格 schema）再由代码渲染 SRT，避免无人值守时格式炸掉。

- [ ] **定义翻译输入/输出 schema**
  - [ ] `src/nlp/segments.ts`：Segments Zod schema（输入/输出）
- [ ] **实现“翻译 segments” agent 调用**
  - [ ] `src/nlp/translate.ts`：
    - [ ] prompt：逐条翻译，不改时间戳，只改 text；保持专有名词策略
    - [ ] `outputFormat`：JSON Schema（strict）
    - [ ] `allowedTools: []`（LLM 不得调用工具）
- [ ] **实现屏幕占用规则（MVP）**
  - [ ] 文本后处理：最多 2 行、每行最多 16–18 字（可配置）
  - [ ] 仍超：触发二次“压缩改写更短”调用（同样结构化输出）
- [ ] **实现 JSON → SRT 渲染**
  - [ ] `src/subtitles/srt.ts`：`segmentsToSrt(segments) -> string` + `writeSrt()`
- [ ] **落盘**
  - [ ] `workspace/jobs/{video_id}/nlp/translated_segments.json`
  - [ ] `workspace/jobs/{video_id}/nlp/translated.srt`

验收标准：
- [ ] 给定一份 `source_segments.json`，能稳定产出 `translated.srt` 且格式合法（可用简单 parser 校验）

---

## 7. 节点 6：渲染（字幕烧录 + 响度标准化 + 可选 BGM）

- [ ] **字幕烧录**
  - [ ] `src/tools/ffmpeg.ts`：`burnSubtitles(videoPath, srtPath, fontPath, outPath)`
  - [ ] Docker 镜像内置中文字体，`config.yaml.render.font_path` 指向固定路径
- [ ] **响度标准化**
  - [ ] `src/tools/ffmpeg.ts`：`normalizeLoudness(inputVideo, outVideo)`（`loudnorm` 单遍）
- [ ] **（可选）BGM 混音接口**
  - [ ] 若 `bgm_path != null`：实现 `amix` 混音；否则跳过
- [ ] **可播放性最低校验**
  - [ ] `ffprobe` 检查音视频流与时长（失败则 job 失败）

验收标准：
- [ ] 在 `workspace/jobs/{video_id}/render/final_output.mp4` 得到可播放视频（字幕正常显示，音频响度稳定）

---

## 8. 节点 7：Packaging（metadata + thumbnail）

- [ ] **定义 `metadata.json` schema（MVP）**
  - [ ] `title/description/tags/language/source_url/source_channel_id`
- [ ] **实现 metadata 生成 agent 调用**
  - [ ] `src/nlp/metadata.ts`：
    - [ ] 输入：`video.info.json`（标题/简介/频道名等）+（可选）翻译字幕摘要
    - [ ] 输出：严格 schema（`outputFormat`，strict）
    - [ ] `allowedTools: []`
- [ ] **拷贝/归一封面到 dist**
  - [ ] 已在节点 3 做格式归一，若未做则在此补齐
- [ ] **落盘**
  - [ ] `workspace/jobs/{video_id}/dist/metadata.json`
  - [ ] `workspace/jobs/{video_id}/dist/thumbnail.jpg`

验收标准：
- [ ] dist 下三件套齐全：`metadata.json + thumbnail.jpg + final_output.mp4(来自 render)`

---

## 9. 节点 8：交付（deliveries/{run_id}/{video_id}）

- [ ] **实现交付拷贝**
  - [ ] `src/deliver/deliver.ts`：复制三件套到 `workspace/deliveries/{run_id}/{video_id}/`
  - [ ] 复制后校验文件存在且大小 > 0
- [ ] **更新 `job.json.artifacts`**
  - [ ] 写入最终 artifacts 路径，`status=succeeded`，`step=deliver`

验收标准：
- [ ] `workspace/deliveries/{run_id}/{video_id}/` 下出现三件套，可直接验收上传

---

## 10. Docker 化与宿主机定时触发

- [ ] **Dockerfile（MVP）**
  - [ ] Node 18+ 运行环境
  - [ ] 内置：`ffmpeg`、`yt-dlp`、中文字体（`NotoSansCJK`）
  - [ ] 若 ASR 选 Python CLI：内置 Python + faster-whisper 及依赖
- [ ] **docker-compose.yml（可选）**
  - [ ] 挂载 `workspace/` 到宿主机目录
  - [ ] 注入 `ANTHROPIC_API_KEY`
- [ ] **宿主机定时器示例**
  - [ ] `cron` / `systemd timer` 示例（文档即可）

验收标准：
- [ ] 宿主机定时触发容器后，`workspace/deliveries/{run_id}/...` 能产出交付物

---

## 11. “最小安全与稳定”清单（上线前）

- [ ] `allowedTools` 坚持最小化（MVP：LLM 仅输出结构化 JSON，**不开放 Bash/Write/Edit**）
- [ ] LLM 调用增加重试与退避（限次 + 指数退避）
- [ ] 关键外部命令（yt-dlp/ffmpeg/asr）增加超时与错误摘要（避免日志爆炸）
- [ ] 对关键产物做校验：
  - [ ] `translated.srt` 格式校验
  - [ ] `final_output.mp4` ffprobe 校验
  - [ ] `metadata.json` schema 校验

---

## 12. 建议的实现顺序（最短路径）

1. [ ] job.json（幂等/重试）+ 日志
2. [ ] RSS 拉取 + 最新 N
3. [ ] yt-dlp 预检 + 下载 + thumbnail 归一
4. [ ] metadata 生成（最容易看到“Agent 能力”）
5. [ ] ASR（先跑通 CPU）
6. [ ] 翻译（JSON→SRT）
7. [ ] 渲染（字幕烧录 + loudnorm）
8. [ ] 交付目录落盘
9. [ ] Dockerfile + 定时触发文档
