"""
Video Downloader Skill

封装 yt-dlp 的视频搜索和下载功能。
对应 architecture.md 节点 1: 智能选品与获取
"""

import json
import subprocess
import os
from typing import List, Optional
from dataclasses import dataclass


@dataclass
class VideoMeta:
    """视频元数据"""
    id: str
    title: str
    duration: int  # 秒
    view_count: int
    upload_date: str
    channel: str
    url: str


def search_videos(
    query: str,
    limit: int = 5,
    min_duration: int = 120,
    min_views: int = 10000
) -> List[VideoMeta]:
    """
    使用 yt-dlp 搜索视频并返回元数据列表。
    
    Args:
        query: 搜索关键词 (e.g., "Shenzhen 4K walk")
        limit: 返回结果数量上限
        min_duration: 最小时长（秒），过滤 Shorts
        min_views: 最小播放量
    
    Returns:
        符合条件的视频元数据列表
    """
    # 构建 yt-dlp 搜索命令
    search_term = f"ytsearch{limit}:{query}"
    
    cmd = [
        "yt-dlp",
        "--dump-json",
        "--flat-playlist",
        "--match-filter", f"duration > {min_duration}",
        "--match-filter", f"view_count > {min_views}",
        "--match-filter", "original_url!*=/shorts/",
        search_term
    ]
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=60
        )
    except subprocess.CalledProcessError as e:
        print(f"yt-dlp 搜索失败: {e.stderr}")
        return []
    except subprocess.TimeoutExpired:
        print("yt-dlp 搜索超时")
        return []
    
    videos = []
    for line in result.stdout.strip().split("\n"):
        if not line:
            continue
        try:
            data = json.loads(line)
            videos.append(VideoMeta(
                id=data.get("id", ""),
                title=data.get("title", ""),
                duration=data.get("duration", 0) or 0,
                view_count=data.get("view_count", 0) or 0,
                upload_date=data.get("upload_date", ""),
                channel=data.get("channel", "") or data.get("uploader", ""),
                url=data.get("webpage_url", "") or f"https://www.youtube.com/watch?v={data.get('id')}"
            ))
        except json.JSONDecodeError:
            continue
    
    return videos


def download_video(
    url: str,
    output_dir: str = "workspace",
    video_id: Optional[str] = None
) -> dict:
    """
    下载视频及其元数据。
    
    Args:
        url: 视频 URL
        output_dir: 输出目录
        video_id: 可选的视频 ID，用于组织文件夹
    
    Returns:
        包含文件路径的字典:
        {
            "video_path": "workspace/{id}/video.mp4",
            "info_path": "workspace/{id}/video.info.json",
            "success": True/False,
            "error": "错误信息" (如果失败)
        }
    """
    # 确定输出模板
    if video_id:
        output_template = os.path.join(output_dir, video_id, "video.%(ext)s")
        info_template = os.path.join(output_dir, video_id, "video.info.json")
    else:
        output_template = os.path.join(output_dir, "%(id)s", "video.%(ext)s")
        info_template = os.path.join(output_dir, "%(id)s", "video.info.json")
    
    cmd = [
        "yt-dlp",
        "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]",  # 优先 mp4
        "--write-info-json",
        "--write-comments",
        "-o", output_template,
        url
    ]
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=600  # 10分钟超时
        )
        
        # 从输出中提取实际文件路径
        # yt-dlp 会输出类似: [download] Destination: workspace/xxx/video.mp4
        video_path = None
        for line in result.stdout.split("\n"):
            if "Destination:" in line or "has already been downloaded" in line:
                if ".mp4" in line:
                    # 提取路径
                    parts = line.split("Destination:")
                    if len(parts) > 1:
                        video_path = parts[1].strip()
                    elif "already been downloaded" in line:
                        # 已存在的文件
                        video_path = line.split("]")[1].split("has")[0].strip()
        
        # 推断 info.json 路径
        if video_path:
            info_path = video_path.rsplit(".", 1)[0] + ".info.json"
        else:
            # 尝试查找
            info_path = info_template
        
        return {
            "video_path": video_path,
            "info_path": info_path,
            "success": True,
            "error": None
        }
        
    except subprocess.CalledProcessError as e:
        return {
            "video_path": None,
            "info_path": None,
            "success": False,
            "error": f"下载失败: {e.stderr}"
        }
    except subprocess.TimeoutExpired:
        return {
            "video_path": None,
            "info_path": None,
            "success": False,
            "error": "下载超时 (>10分钟)"
        }


def get_channel_videos(
    channel_url: str,
    limit: int = 5
) -> List[VideoMeta]:
    """
    获取频道最新视频列表（白名单模式）。
    
    Args:
        channel_url: 频道 URL (e.g., https://www.youtube.com/@SerpentZA)
        limit: 获取数量
    
    Returns:
        视频元数据列表
    """
    cmd = [
        "yt-dlp",
        "--dump-json",
        "--flat-playlist",
        "--playlist-end", str(limit),
        channel_url
    ]
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=60
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return []
    
    videos = []
    for line in result.stdout.strip().split("\n"):
        if not line:
            continue
        try:
            data = json.loads(line)
            videos.append(VideoMeta(
                id=data.get("id", ""),
                title=data.get("title", ""),
                duration=data.get("duration", 0) or 0,
                view_count=data.get("view_count", 0) or 0,
                upload_date=data.get("upload_date", ""),
                channel=data.get("channel", "") or data.get("uploader", ""),
                url=data.get("webpage_url", "") or f"https://www.youtube.com/watch?v={data.get('id')}"
            ))
        except json.JSONDecodeError:
            continue
    
    return videos
