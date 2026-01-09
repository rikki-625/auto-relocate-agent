# Claude Agent 视频自动化流水线（MVP v0.1）

目标：在**无人值守**的情况下作为长期服务运行，通过定时触发从指定 YouTube `channel_id`（`UC...`）拉取最新视频，自动产出可直接上传的视频平台交付物：

- `final_output.mp4`
- `metadata.json`
- `thumbnail.jpg`

MVP 约束：

- 部署：`Linux + Docker`，**宿主机定时触发**，容器每次“跑一轮然后退出”
- 选品：只做 **Channel 白名单 + 最新 N 个**
- 去重：视频一旦进入系统（存在 `workspace/jobs/{video_id}/job.json`），**不再重复处理**
- 无并发：单进程顺序处理（时间换空间）
- 视频长度：下载阶段过滤 `> 5 分钟`（`> 300s`）的视频
- ASR：必须支持 CPU fallback；MVP 不处理长视频切块拼接
- 上传：不做自动化上传，只产出交付物并落盘等待验收

时区：`Asia/Shanghai`

---

## 1. 运行与部署模型

### 1.1 定时触发（在容器外）

- 由宿主机 `cron` / `systemd timer` 定时执行容器命令
- “触发频率/触发时间”由宿主机定时器配置；“每次处理多少视频”等业务参数由应用配置文件控制

### 1.2 一次性 Worker 模式（Run-once）

- 容器启动 → 读取配置 → 拉取 RSS → 选择候选视频 → 逐个处理 → 产出交付物 → 退出
- 优点：最容易做到可恢复/可观测/可运维（失败重跑 = 下次定时再跑）

---

## 2. 配置与目录结构

### 2.1 `config.yaml`（建议字段）

```yaml
timezone: Asia/Shanghai

max_videos_per_run: 1
max_duration_seconds: 300
retries_max: 5

channels:
  - UCxxxxxxxxxxxxxxxxxxxxxx
  - UCyyyyyyyyyyyyyyyyyyyyyy

paths:
  workspace: workspace
  jobs_dir: workspace/jobs
  deliveries_dir: workspace/deliveries
  state_dir: workspace/state
  logs_dir: workspace/logs

render:
  font_path: /usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc
  subtitle_fontsize: 24
  bgm_path: null # MVP: 可为空
```

### 2.2 Workspace 目录建议

```
workspace/
  jobs/
    {video_id}/
      job.json
      source/
        video.mp4
        video.info.json
        thumbnail.*          # yt-dlp 写入，后续统一为 jpg
      asr/
        audio.wav
        source_segments.json
        source.srt
      nlp/
        translated_segments.json
        translated.srt
      render/
        final_output.mp4
      dist/
        metadata.json
        thumbnail.jpg
  deliveries/
    {run_id}/
      {video_id}/
        final_output.mp4
        metadata.json
        thumbnail.jpg
  state/
    download_archive.txt
  logs/
    {run_id}.log
```

### 2.3 `run_id`

每次运行生成一个批次 ID（用于验收与回溯），例如：`20260109_153000+0800`（`Asia/Shanghai`）。

---

## 3. 幂等与重试（MVP 规则）

### 3.1 `job.json`（最小状态机）

`job.json` 用于“出现过就不再做”、失败记录与交付物索引。

最小字段建议：

```json
{
  "video_id": "dQw4w9WgXcQ",
  "channel_id": "UCxxxxxxxxxxxxxxxxxxxxxx",
  "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "created_at": "2026-01-09T15:30:00+08:00",
  "updated_at": "2026-01-09T15:42:10+08:00",
  "status": "succeeded",
  "attempts": 3,
  "step": "deliver",
  "last_error": null,
  "artifacts": {
    "final_output": "workspace/jobs/.../render/final_output.mp4",
    "metadata": "workspace/jobs/.../dist/metadata.json",
    "thumbnail": "workspace/jobs/.../dist/thumbnail.jpg"
  }
}
```

### 3.2 去重规则

- 若 `workspace/jobs/{video_id}/job.json` 存在：直接跳过（MVP 不做续跑/恢复）
- 若同一 `video_id` 再次出现在 RSS：仍跳过

### 3.3 重试与失败处理

- 每个视频最多重试 `retries_max=5` 次
- 超过重试次数后：`status=failed`，记录 `last_error`，跳过继续处理下一个候选（如果本次 run 还允许处理更多）

---

## 4. 核心架构图（Linear Chain with Checks）

```mermaid
graph TD
    Trigger[宿主机定时触发] --> Run[容器 Run-once 启动]
    Run --> Discover[节点 1: RSS 拉取 + 最新 N 个]
    Discover -->|Check: job.json 存在则跳过| Preflight[节点 2: yt-dlp 预检(<=300s/非直播)]
    Preflight -->|Check: 不满足则记录并跳过| Download[节点 3: 下载/落盘(info/thumbnail)]
    Download --> ASR[节点 4: ASR(faster-whisper, CPU/GPU 自适应)]
    ASR --> Translate[节点 5: 翻译/本地化(JSON→SRT)]
    Translate --> Render[节点 6: 渲染(字幕烧录+响度标准化+可选BGM)]
    Render --> Package[节点 7: metadata + thumbnail 整理]
    Package --> Deliver[节点 8: 交付到 deliveries/{run_id}]
```

---

## 5. 节点设计（MVP 细化）

### 节点 1：RSS 拉取 + 最新 N 个

输入：`channel_id` 白名单（`UC...`）

实现建议：

- RSS：`https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}`
- 合并所有白名单的条目后按发布时间倒序，取最新 `max_videos_per_run=N` 个
- 取到 `video_id` 后先检查 `job.json`，存在则跳过

输出：候选 `video_id` 列表

### 节点 2：yt-dlp 预检（过滤 > 5 分钟）

目的：在下载前拿到 `duration` 等元信息，避免拉取长视频。

实现建议：

- `yt-dlp --dump-json --skip-download {video_url}`
- 过滤条件（MVP）：
  - `duration <= max_duration_seconds`（默认 300）
  - `is_live != true`（或 `live_status` 不为 live）
  - 可选：排除 `shorts` URL

输出：预检通过的 `video_url` 与元信息（可写入 `video.info.json` 供后续复用）

### 节点 3：下载与落盘（不抓评论）

目标：下载视频 + 基础元信息 + 封面图（MVP 不抓评论）。

实现建议（示例命令要点）：

- `--download-archive workspace/state/download_archive.txt`（避免重复下载）
- `-f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]"`（优先 MP4）
- `--write-info-json`（生成 `video.info.json`）
- `--write-thumbnail`（下载封面图）
- 输出目录：`workspace/jobs/{video_id}/source/`

输出：

- `video.mp4`
- `video.info.json`
- `thumbnail.*`

### 节点 4：ASR（CPU/GPU 自适应）

目标：产出稳定的时间轴文本与可机器处理的 segments。

实现建议：

1. FFmpeg 转音频：`16kHz, mono, wav`（提升一致性）
2. faster-whisper（策略）：
   - 优先 GPU；无 GPU 自动降级 CPU（`compute_type="int8"`）
   - 开启 VAD（减少静音段误识别）
3. 输出两份：
   - `source_segments.json`：`[{start,end,text}, ...]`
   - `source.srt`：用于人工检查/对照

### 节点 5：翻译/本地化（JSON 中间层 → SRT）

目标：不改时间戳，只改文本；确保产物在无人值守下也能稳定进入渲染环节。

策略（MVP）：

- 输入：`source_segments.json`
- 输出：`translated_segments.json`（结构化）与 `translated.srt`
- LLM 输出使用 JSON Schema（Claude Agent SDK 的 `output_format`），避免直接生成 SRT 导致格式错误
- “屏幕占用”控制（MVP 简化规则）：
  - 每条字幕最多 2 行
  - 每行最多 16–18 个中文字符（可配置）
  - 超出：优先断行；仍超则触发一次“压缩改写更短”重写（仍不改时间戳）

### 节点 6：渲染（字幕烧录 + 响度标准化 + 可选 BGM）

目标：产出可直接上传的 `final_output.mp4`，并做最低限度的质量保障。

实现建议：

- 字幕烧录：FFmpeg `subtitles`（依赖 `libass`）+ 指定中文字体（容器内固定路径）
- 响度标准化：`loudnorm`（MVP 先用单遍；后续可升级双遍）
- BGM：MVP 先留接口（配置中 `bgm_path` 可为空）
- 最终校验：`ffprobe` 可正常读取时长与音视频流（作为“可播放”的最低门槛）

输出：`workspace/jobs/{video_id}/render/final_output.mp4`

### 节点 7：Packaging（metadata + thumbnail）

metadata（MVP 初版建议字段）：

```json
{
  "title": "…",
  "description": "…",
  "tags": ["…", "…"],
  "language": "zh-CN",
  "source_url": "…",
  "source_channel_id": "…"
}
```

thumbnail（MVP）：

- 优先使用 yt-dlp 下载的原视频封面
- 如封面不可用：从视频中截取关键帧（例如 2–5 秒处）作为兜底

输出：`workspace/jobs/{video_id}/dist/metadata.json`、`workspace/jobs/{video_id}/dist/thumbnail.jpg`

### 节点 8：交付（落盘等待验收）

- 将 `final_output.mp4`、`metadata.json`、`thumbnail.jpg` 复制到：
  - `workspace/deliveries/{run_id}/{video_id}/`
- 终端输出交付路径；不做自动上传

---

## 6. Claude Agent SDK 落地方式（推荐）

推荐：**TypeScript 业务编排 + `query()` 做“纯函数步骤”**。

- 编排（RSS、状态机、重试、文件落盘、ffmpeg/yt-dlp 调用）由应用代码负责，可测试、可运维。
- LLM 负责：
  - 翻译 `translated_segments.json`（结构化输出）
  - 生成 `metadata.json`（结构化输出）

安全/可控原则（MVP 也建议遵守）：

- `allowed_tools` 最小化（只开放需要的工具封装）
- `permission_mode` 显式设置（不要依赖默认值）
- hooks 记录 `PreToolUse`/`PostToolUse`（日志避免泄露密钥与个人信息）

---

## 7. Phase 2 Roadmap（非 MVP）

- BGM 可检索素材库 + 基于内容的选择策略
- 关键词搜索补充（非白名单频道）
- 病毒式开头（高光时刻前置）
- 更严格的视频质量检查（黑屏/无声/字幕覆盖率/响度指标）
