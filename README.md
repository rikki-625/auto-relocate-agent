# Video Agent Pipeline

基于 Claude Agent SDK 的自动化视频流水线系统。

## 项目结构

```
video_agent/
├── main.py                  # 入口点
├── agents/                  # Agent 定义 (System Prompts)
│   └── video_ops/
│       ├── director.yaml    # 总编排 Agent
│       ├── scout.yaml       # 选品 Agent (Node 1)
│       └── editor.yaml      # 剪辑 Agent (Node 4)
├── skills/                  # 工具/技能封装
│   └── video_processing/
│       ├── __init__.py
│       ├── downloader.py    # yt-dlp 封装
│       ├── transcriber.py   # faster-whisper 封装
│       └── renderer.py      # ffmpeg 封装
├── workspace/               # 运行时工作目录
└── assets/
    └── bgm/                 # 背景音乐资源
```

## 快速开始

```bash
# 安装依赖
pip install -r requirements.txt

# 运行主程序
python main.py
```
