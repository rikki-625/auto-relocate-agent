"""
Video Renderer Skill

封装 FFmpeg 的视频渲染功能（字幕烧录、BGM 混音）。
对应 architecture.md 节点 4: 视听工程
"""

import os
import subprocess
from typing import Optional


def render_standard_video(
    video_path: str,
    srt_path: str,
    bgm_path: Optional[str] = None,
    output_path: Optional[str] = None,
    font_name: str = "SimHei",
    font_size: int = 24,
    bgm_volume: float = 0.1
) -> str:
    """
    标准 MVP 渲染：烧录字幕 + 低音量 BGM。
    
    Args:
        video_path: 源视频路径
        srt_path: SRT 字幕文件路径
        bgm_path: 背景音乐路径 (可选)
        output_path: 输出路径 (默认: 源文件名_final.mp4)
        font_name: 字体名称 (Windows: SimHei, macOS: PingFang SC)
        font_size: 字体大小
        bgm_volume: BGM 音量 (0.0 - 1.0)
    
    Returns:
        渲染后的视频文件路径
    """
    # 验证输入文件
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"视频文件不存在: {video_path}")
    if not os.path.exists(srt_path):
        raise FileNotFoundError(f"字幕文件不存在: {srt_path}")
    if bgm_path and not os.path.exists(bgm_path):
        raise FileNotFoundError(f"BGM 文件不存在: {bgm_path}")
    
    # 确定输出路径
    if output_path is None:
        base, ext = os.path.splitext(video_path)
        output_path = f"{base}_final.mp4"
    
    # 处理路径转义 (Windows 兼容)
    srt_escaped = srt_path.replace("\\", "/").replace(":", "\\:")
    
    # 构建滤镜
    force_style = f"Fontname={font_name},FontSize={font_size},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2"
    
    if bgm_path:
        # 带 BGM 的复杂滤镜
        filter_complex = (
            f"[0:v]subtitles='{srt_escaped}':force_style='{force_style}'[v];"
            f"[1:a]volume={bgm_volume}[bgm];"
            f"[0:a][bgm]amix=inputs=2:duration=first[a]"
        )
        
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-stream_loop", "-1", "-i", bgm_path,  # 循环 BGM
            "-filter_complex", filter_complex,
            "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-preset", "medium", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k",
            "-shortest",  # 以视频时长为准
            output_path
        ]
    else:
        # 仅字幕烧录
        vf_filter = f"subtitles='{srt_escaped}':force_style='{force_style}'"
        
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vf", vf_filter,
            "-c:v", "libx264", "-preset", "medium", "-crf", "23",
            "-c:a", "copy",
            output_path
        ]
    
    print(f"开始渲染视频: {video_path}")
    print(f"输出路径: {output_path}")
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=1800  # 30 分钟超时
        )
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"FFmpeg 渲染失败: {e.stderr}")
    except subprocess.TimeoutExpired:
        raise RuntimeError("FFmpeg 渲染超时 (>30分钟)")
    
    print(f"渲染完成: {output_path}")
    return output_path


def extract_thumbnail(
    video_path: str,
    timestamp: str = "00:00:05",
    output_path: Optional[str] = None
) -> str:
    """
    从视频中提取缩略图。
    
    Args:
        video_path: 视频路径
        timestamp: 提取时间点 (HH:MM:SS)
        output_path: 输出路径 (默认: 源文件名_thumb.jpg)
    
    Returns:
        缩略图文件路径
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"视频文件不存在: {video_path}")
    
    if output_path is None:
        base, _ = os.path.splitext(video_path)
        output_path = f"{base}_thumb.jpg"
    
    cmd = [
        "ffmpeg", "-y",
        "-ss", timestamp,
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "2",
        output_path
    ]
    
    try:
        subprocess.run(cmd, capture_output=True, check=True, timeout=60)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"缩略图提取失败: {e.stderr.decode()}")
    
    print(f"缩略图已生成: {output_path}")
    return output_path


def check_video_playable(video_path: str) -> dict:
    """
    检查视频文件是否可播放（完整性校验）。
    
    Args:
        video_path: 视频路径
    
    Returns:
        {
            "playable": True/False,
            "duration": 时长（秒）,
            "has_video": 是否有视频流,
            "has_audio": 是否有音频流,
            "error": 错误信息 (如果有)
        }
    """
    if not os.path.exists(video_path):
        return {
            "playable": False,
            "duration": 0,
            "has_video": False,
            "has_audio": False,
            "error": "文件不存在"
        }
    
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration:stream=codec_type",
        "-of", "json",
        video_path
    ]
    
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, check=True, timeout=30
        )
        import json
        data = json.loads(result.stdout)
        
        streams = data.get("streams", [])
        has_video = any(s.get("codec_type") == "video" for s in streams)
        has_audio = any(s.get("codec_type") == "audio" for s in streams)
        duration = float(data.get("format", {}).get("duration", 0))
        
        return {
            "playable": has_video and duration > 0,
            "duration": duration,
            "has_video": has_video,
            "has_audio": has_audio,
            "error": None
        }
        
    except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
        return {
            "playable": False,
            "duration": 0,
            "has_video": False,
            "has_audio": False,
            "error": str(e)
        }
