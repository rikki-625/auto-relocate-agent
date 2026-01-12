#!/usr/bin/env python3
"""
Faster-Whisper ASR CLI for auto-video-workflow.
Outputs segments as JSON and SRT.

Usage:
  python asr_cli.py <audio_path> <output_dir> [--language <lang>] [--vad]
"""
import sys
import json
import argparse
from pathlib import Path

def format_timestamp(seconds: float) -> str:
    """Format seconds to SRT timestamp (HH:MM:SS,mmm)."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

def segments_to_srt(segments: list) -> str:
    """Convert segments to SRT format."""
    lines = []
    for i, seg in enumerate(segments, 1):
        start = format_timestamp(seg["start"])
        end = format_timestamp(seg["end"])
        text = seg["text"].strip()
        lines.append(f"{i}")
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)

def main():
    parser = argparse.ArgumentParser(description="Faster-Whisper ASR CLI")
    parser.add_argument("audio_path", help="Path to input audio file (WAV)")
    parser.add_argument("output_dir", help="Output directory for segments.json and source.srt")
    parser.add_argument("--language", default="auto", help="Language code (e.g., 'zh', 'en', 'ja') or 'auto'")
    parser.add_argument("--vad", action="store_true", help="Enable VAD filter")
    parser.add_argument("--model", default="base", help="Whisper model size (tiny, base, small, medium, large)")
    args = parser.parse_args()

    audio_path = Path(args.audio_path)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not audio_path.exists():
        print(f"Error: Audio file not found: {audio_path}", file=sys.stderr)
        sys.exit(1)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("Error: faster-whisper not installed. Install with: pip install faster-whisper", file=sys.stderr)
        sys.exit(1)

    # Try GPU first, fallback to CPU with int8
    try:
        import torch
        if torch.cuda.is_available():
            device = "cuda"
            compute_type = "float16"
            print(f"Using GPU (CUDA) with {compute_type}", file=sys.stderr)
        else:
            device = "cpu"
            compute_type = "int8"
            print(f"Using CPU with {compute_type}", file=sys.stderr)
    except ImportError:
        device = "cpu"
        compute_type = "int8"
        print(f"Using CPU with {compute_type} (torch not available)", file=sys.stderr)

    print(f"Loading model: {args.model}", file=sys.stderr)
    model = WhisperModel(args.model, device=device, compute_type=compute_type)

    # Language setting
    language = None if args.language == "auto" else args.language

    # VAD settings
    vad_filter = args.vad
    vad_parameters = None
    if vad_filter:
        vad_parameters = {
            "min_silence_duration_ms": 500,
            "speech_pad_ms": 200
        }

    print(f"Transcribing: {audio_path}", file=sys.stderr)
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        vad_filter=vad_filter,
        vad_parameters=vad_parameters
    )

    if info.language:
        print(f"Detected language: {info.language} (probability: {info.language_probability:.2f})", file=sys.stderr)

    # Collect segments
    segments = []
    for seg in segments_iter:
        segments.append({
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text.strip()
        })
        print(f"  [{seg.start:.2f} -> {seg.end:.2f}] {seg.text.strip()[:50]}...", file=sys.stderr)

    # Write JSON
    json_path = output_dir / "source_segments.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(segments, f, ensure_ascii=False, indent=2)
    print(f"Wrote: {json_path}", file=sys.stderr)

    # Write SRT
    srt_path = output_dir / "source.srt"
    srt_content = segments_to_srt(segments)
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write(srt_content)
    print(f"Wrote: {srt_path}", file=sys.stderr)

    # Output summary to stdout for Node.js to parse
    result = {
        "segments_count": len(segments),
        "language": info.language,
        "language_probability": info.language_probability,
        "json_path": str(json_path),
        "srt_path": str(srt_path)
    }
    print(json.dumps(result))

if __name__ == "__main__":
    main()
