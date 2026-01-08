"""
Audio Transcriber Skill

封装 faster-whisper 的语音识别功能。
对应 architecture.md 节点 2: 听觉智能 (ASR)
"""

import os
from typing import Tuple, Optional


def format_timestamp(seconds: float) -> str:
    """
    转换为 SRT 时间戳格式 (HH:MM:SS,mmm)
    
    Args:
        seconds: 秒数
    
    Returns:
        SRT 格式时间戳
    """
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    milliseconds = int((secs - int(secs)) * 1000)
    return f"{int(hours):02d}:{int(minutes):02d}:{int(secs):02d},{milliseconds:03d}"


def transcribe_audio_to_srt(
    audio_path: str,
    model_size: str = "large-v3",
    language: Optional[str] = None,
    device: str = "cuda",
    compute_type: str = "float16"
) -> str:
    """
    使用 faster-whisper 将音频转录为 SRT 字幕文件。
    
    Args:
        audio_path: 音频文件路径 (支持 mp3, wav, m4a, mp4 等)
        model_size: Whisper 模型大小 (tiny, base, small, medium, large-v3)
        language: 源语言代码 (e.g., "en", "zh")，None 为自动检测
        device: 计算设备 ("cuda" 或 "cpu")
        compute_type: 计算精度 ("float16", "int8", "float32")
    
    Returns:
        生成的 SRT 文件路径
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise ImportError(
            "faster-whisper 未安装。请运行: pip install faster-whisper"
        )
    
    # 检查文件存在
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"音频文件不存在: {audio_path}")
    
    # 初始化模型
    print(f"加载 Whisper 模型: {model_size} (设备: {device})")
    model = WhisperModel(model_size, device=device, compute_type=compute_type)
    
    # 执行转录
    print(f"开始转录: {audio_path}")
    segments, info = model.transcribe(
        audio_path,
        beam_size=5,
        language=language,
        vad_filter=True,  # 启用 VAD 过滤静音
        vad_parameters=dict(min_silence_duration_ms=500)
    )
    
    print(f"检测到语言: {info.language} (置信度: {info.language_probability:.2%})")
    
    # 生成 SRT 文件
    output_path = os.path.splitext(audio_path)[0] + ".srt"
    
    with open(output_path, "w", encoding="utf-8") as f:
        for i, segment in enumerate(segments, 1):
            start = format_timestamp(segment.start)
            end = format_timestamp(segment.end)
            text = segment.text.strip()
            
            f.write(f"{i}\n")
            f.write(f"{start} --> {end}\n")
            f.write(f"{text}\n\n")
    
    print(f"SRT 文件已生成: {output_path}")
    return output_path


def extract_audio_from_video(
    video_path: str,
    output_format: str = "wav",
    sample_rate: int = 16000
) -> str:
    """
    使用 FFmpeg 从视频中提取音频。
    
    Args:
        video_path: 视频文件路径
        output_format: 输出格式 (wav, mp3, m4a)
        sample_rate: 采样率 (16000 适合 Whisper)
    
    Returns:
        提取的音频文件路径
    """
    import subprocess
    
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"视频文件不存在: {video_path}")
    
    output_path = os.path.splitext(video_path)[0] + f".{output_format}"
    
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vn",  # 不要视频
        "-acodec", "pcm_s16le" if output_format == "wav" else "aac",
        "-ar", str(sample_rate),
        "-ac", "1",  # 单声道
        output_path
    ]
    
    try:
        subprocess.run(cmd, capture_output=True, check=True, timeout=300)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"FFmpeg 音频提取失败: {e.stderr.decode()}")
    
    print(f"音频已提取: {output_path}")
    return output_path
