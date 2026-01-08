"""
Video Agent Pipeline - Main Entry Point

基于 Claude Agent SDK 的自动化视频流水线系统入口。
"""

import os
import yaml
import json
from pathlib import Path
from typing import Dict, Any, List, Optional

# 加载 .env 文件
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv 未安装时静默跳过

# 强制清除代理设置 (在导入 anthropic 之前)
for proxy_var in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]:
    os.environ.pop(proxy_var, None)

import anthropic

# 导入 Skills
from skills.video_processing import (
    search_videos,
    download_video,
    transcribe_audio_to_srt,
    render_standard_video,
)
from skills.video_processing.downloader import get_channel_videos
from skills.video_processing.transcriber import extract_audio_from_video
from skills.video_processing.renderer import extract_thumbnail, check_video_playable


# ============================================================================
# 工具定义 (供 Claude API 使用)
# ============================================================================

TOOLS = [
    {
        "name": "search_videos",
        "description": "使用 yt-dlp 搜索视频并返回元数据列表。用于发现目标内容。",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索关键词 (e.g., 'Shenzhen 4K walk')"
                },
                "limit": {
                    "type": "integer",
                    "description": "返回结果数量上限",
                    "default": 5
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "download_video",
        "description": "下载视频及其元数据到 workspace 目录。",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "视频 URL"
                },
                "video_id": {
                    "type": "string",
                    "description": "可选的视频 ID，用于组织文件夹"
                }
            },
            "required": ["url"]
        }
    },
    {
        "name": "get_channel_videos",
        "description": "获取指定频道的最新视频列表（白名单模式）。",
        "input_schema": {
            "type": "object",
            "properties": {
                "channel_url": {
                    "type": "string",
                    "description": "频道 URL"
                },
                "limit": {
                    "type": "integer",
                    "description": "获取数量",
                    "default": 5
                }
            },
            "required": ["channel_url"]
        }
    },
    {
        "name": "extract_audio_from_video",
        "description": "使用 FFmpeg 从视频中提取音频。",
        "input_schema": {
            "type": "object",
            "properties": {
                "video_path": {
                    "type": "string",
                    "description": "视频文件路径"
                }
            },
            "required": ["video_path"]
        }
    },
    {
        "name": "transcribe_audio_to_srt",
        "description": "使用 faster-whisper 将音频转录为 SRT 字幕文件。",
        "input_schema": {
            "type": "object",
            "properties": {
                "audio_path": {
                    "type": "string",
                    "description": "音频文件路径"
                },
                "model_size": {
                    "type": "string",
                    "description": "Whisper 模型大小",
                    "default": "large-v3"
                }
            },
            "required": ["audio_path"]
        }
    },
    {
        "name": "render_standard_video",
        "description": "标准 MVP 渲染：烧录字幕 + 可选 BGM 混音。",
        "input_schema": {
            "type": "object",
            "properties": {
                "video_path": {
                    "type": "string",
                    "description": "源视频路径"
                },
                "srt_path": {
                    "type": "string",
                    "description": "SRT 字幕文件路径"
                },
                "bgm_path": {
                    "type": "string",
                    "description": "背景音乐路径 (可选)"
                }
            },
            "required": ["video_path", "srt_path"]
        }
    },
    {
        "name": "extract_thumbnail",
        "description": "从视频中提取缩略图。",
        "input_schema": {
            "type": "object",
            "properties": {
                "video_path": {
                    "type": "string",
                    "description": "视频路径"
                },
                "timestamp": {
                    "type": "string",
                    "description": "提取时间点 (HH:MM:SS)",
                    "default": "00:00:05"
                }
            },
            "required": ["video_path"]
        }
    },
    {
        "name": "check_video_playable",
        "description": "检查视频文件是否可播放（完整性校验）。",
        "input_schema": {
            "type": "object",
            "properties": {
                "video_path": {
                    "type": "string",
                    "description": "视频路径"
                }
            },
            "required": ["video_path"]
        }
    }
]


# ============================================================================
# 工具执行器
# ============================================================================

def execute_tool(tool_name: str, tool_input: Dict[str, Any]) -> Any:
    """执行指定的工具并返回结果。"""
    
    tool_map = {
        "search_videos": lambda inp: [
            vars(v) for v in search_videos(
                inp["query"],
                inp.get("limit", 5)
            )
        ],
        "download_video": lambda inp: download_video(
            inp["url"],
            "workspace",
            inp.get("video_id")
        ),
        "get_channel_videos": lambda inp: [
            vars(v) for v in get_channel_videos(
                inp["channel_url"],
                inp.get("limit", 5)
            )
        ],
        "extract_audio_from_video": lambda inp: extract_audio_from_video(
            inp["video_path"]
        ),
        "transcribe_audio_to_srt": lambda inp: transcribe_audio_to_srt(
            inp["audio_path"],
            inp.get("model_size", "large-v3")
        ),
        "render_standard_video": lambda inp: render_standard_video(
            inp["video_path"],
            inp["srt_path"],
            inp.get("bgm_path")
        ),
        "extract_thumbnail": lambda inp: extract_thumbnail(
            inp["video_path"],
            inp.get("timestamp", "00:00:05")
        ),
        "check_video_playable": lambda inp: check_video_playable(
            inp["video_path"]
        ),
    }
    
    if tool_name not in tool_map:
        return {"error": f"未知工具: {tool_name}"}
    
    try:
        return tool_map[tool_name](tool_input)
    except Exception as e:
        return {"error": str(e)}


# ============================================================================
# Agent 加载器
# ============================================================================

def load_agent_prompt(agent_name: str) -> str:
    """从 YAML 文件加载 Agent 的 System Prompt。"""
    agent_path = Path(__file__).parent / "agents" / "video_ops" / f"{agent_name}.yaml"
    
    if not agent_path.exists():
        raise FileNotFoundError(f"Agent 定义不存在: {agent_path}")
    
    with open(agent_path, "r", encoding="utf-8") as f:
        agent_config = yaml.safe_load(f)
    
    return agent_config.get("system_prompt", "")


# ============================================================================
# 主 Agent 循环
# ============================================================================

def run_agent(user_message: str, agent_name: str = "director") -> str:
    """
    运行 Agent 处理用户请求。
    
    Args:
        user_message: 用户输入
        agent_name: 使用的 Agent (默认: director)
    
    Returns:
        Agent 的最终回复
    """
    client = anthropic.Anthropic()
    
    # 加载 Agent Prompt
    system_prompt = load_agent_prompt(agent_name)
    
    # 初始化消息
    messages = [
        {"role": "user", "content": user_message}
    ]
    
    print(f"\n{'='*60}")
    print(f"🎬 Video Agent Pipeline - {agent_name.upper()}")
    print(f"{'='*60}")
    print(f"📝 用户输入: {user_message}")
    print(f"{'='*60}\n")
    
    # Agent 循环
    while True:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=system_prompt,
            tools=TOOLS,
            messages=messages
        )
        
        # 处理响应
        assistant_content = response.content
        messages.append({"role": "assistant", "content": assistant_content})
        
        # 检查是否需要执行工具
        tool_use_blocks = [
            block for block in assistant_content 
            if block.type == "tool_use"
        ]
        
        if not tool_use_blocks:
            # 无工具调用，提取文本回复
            text_blocks = [
                block.text for block in assistant_content 
                if hasattr(block, "text")
            ]
            final_response = "\n".join(text_blocks)
            print(f"\n{'='*60}")
            print("✅ Agent 完成")
            print(f"{'='*60}")
            return final_response
        
        # 执行工具
        tool_results = []
        for tool_block in tool_use_blocks:
            tool_name = tool_block.name
            tool_input = tool_block.input
            tool_id = tool_block.id
            
            print(f"🔧 执行工具: {tool_name}")
            print(f"   输入: {json.dumps(tool_input, ensure_ascii=False, indent=2)}")
            
            result = execute_tool(tool_name, tool_input)
            
            print(f"   结果: {json.dumps(result, ensure_ascii=False)[:200]}...")
            
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": json.dumps(result, ensure_ascii=False)
            })
        
        # 将工具结果添加到消息
        messages.append({"role": "user", "content": tool_results})


# ============================================================================
# CLI 入口
# ============================================================================

def main():
    """命令行入口。"""
    import sys
    
    # 确保 workspace 目录存在
    Path("workspace").mkdir(exist_ok=True)
    
    if len(sys.argv) > 1:
        # 命令行模式
        user_input = " ".join(sys.argv[1:])
        result = run_agent(user_input)
        print(result)
    else:
        # 交互模式
        print("\n🎬 Video Agent Pipeline")
        print("输入你的视频制作需求，或输入 'exit' 退出。\n")
        
        while True:
            try:
                user_input = input("📝 你: ").strip()
                if user_input.lower() in ["exit", "quit", "q"]:
                    print("👋 再见！")
                    break
                if not user_input:
                    continue
                    
                result = run_agent(user_input)
                print(f"\n🤖 Agent:\n{result}\n")
                
            except KeyboardInterrupt:
                print("\n👋 再见！")
                break


if __name__ == "__main__":
    main()
