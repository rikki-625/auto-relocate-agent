import path from "node:path";
import fs from "node:fs";
import { ensureDir, fileExists, fileSize } from "../utils/fs.js";
import { runCommand } from "./command.js";

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Find thumbnail file in directory (yt-dlp may produce various formats like webp, jpg, png)
 */
export function findThumbnail(dir: string): string | null {
  const extensions = [".webp", ".jpg", ".jpeg", ".png"];
  for (const ext of extensions) {
    const candidate = path.join(dir, `video${ext}`);
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  // Also check for thumbnail.* pattern
  for (const ext of extensions) {
    const candidate = path.join(dir, `thumbnail${ext}`);
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Convert thumbnail to JPEG format using ffmpeg
 */
export async function normalizeThumbnail(
  sourceDir: string,
  distDir: string
): Promise<string> {
  const inputPath = findThumbnail(sourceDir);
  if (!inputPath) {
    throw new Error(`No thumbnail found in ${sourceDir}`);
  }

  ensureDir(distDir);
  const outputPath = path.join(distDir, "thumbnail.jpg");

  // If already a jpg, just copy
  if (inputPath.endsWith(".jpg") || inputPath.endsWith(".jpeg")) {
    fs.copyFileSync(inputPath, outputPath);
    return outputPath;
  }

  // Convert using ffmpeg
  const result = await runCommand(
    "ffmpeg",
    [
      "-y",
      "-i", inputPath,
      "-vf", "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease",
      "-q:v", "2",
      outputPath
    ],
    { timeoutMs: DEFAULT_TIMEOUT_MS }
  );

  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg thumbnail conversion failed: ${result.stderr}`);
  }

  if (!fileExists(outputPath) || fileSize(outputPath) <= 0) {
    throw new Error("ffmpeg did not produce thumbnail.jpg");
  }

  return outputPath;
}

/**
 * Extract audio from video as 16kHz mono WAV (for ASR)
 */
export async function extractAudio(
  videoPath: string,
  wavPath: string
): Promise<void> {
  ensureDir(path.dirname(wavPath));

  const result = await runCommand(
    "ffmpeg",
    [
      "-y",
      "-i", videoPath,
      "-vn",
      "-acodec", "pcm_s16le",
      "-ar", "16000",
      "-ac", "1",
      wavPath
    ],
    { timeoutMs: DEFAULT_TIMEOUT_MS * 3 }
  );

  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg audio extraction failed: ${result.stderr}`);
  }

  if (!fileExists(wavPath) || fileSize(wavPath) <= 0) {
    throw new Error("ffmpeg did not produce audio.wav");
  }
}

/**
 * Burn subtitles into video
 */
export async function burnSubtitles(
  videoPath: string,
  srtPath: string,
  fontPath: string,
  outputPath: string
): Promise<void> {
  ensureDir(path.dirname(outputPath));

  // Escape special characters for ffmpeg filter (Windows paths need special handling)
  const escapedSrt = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");

  const result = await runCommand(
    "ffmpeg",
    [
      "-y",
      "-i", videoPath,
      "-vf", `subtitles='${escapedSrt}':force_style='FontName=${path.basename(fontPath, path.extname(fontPath))},FontSize=24,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2'`,
      "-c:a", "copy",
      outputPath
    ],
    { timeoutMs: DEFAULT_TIMEOUT_MS * 10 }
  );

  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg subtitle burn failed: ${result.stderr}`);
  }

  if (!fileExists(outputPath) || fileSize(outputPath) <= 0) {
    throw new Error("ffmpeg did not produce output video");
  }
}

/**
 * Normalize audio loudness using loudnorm filter (single pass)
 */
export async function normalizeLoudness(
  inputPath: string,
  outputPath: string
): Promise<void> {
  ensureDir(path.dirname(outputPath));

  const result = await runCommand(
    "ffmpeg",
    [
      "-y",
      "-i", inputPath,
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-c:v", "copy",
      outputPath
    ],
    { timeoutMs: DEFAULT_TIMEOUT_MS * 5 }
  );

  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg loudnorm failed: ${result.stderr}`);
  }

  if (!fileExists(outputPath) || fileSize(outputPath) <= 0) {
    throw new Error("ffmpeg did not produce normalized video");
  }
}

/**
 * Check video is playable using ffprobe
 */
export async function probeVideo(videoPath: string): Promise<{
  hasVideo: boolean;
  hasAudio: boolean;
  durationSeconds: number | null;
}> {
  const result = await runCommand(
    "ffprobe",
    [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      "-show_format",
      videoPath
    ],
    { timeoutMs: DEFAULT_TIMEOUT_MS }
  );

  if (result.exitCode !== 0 || !result.stdout) {
    throw new Error(`ffprobe failed: ${result.stderr}`);
  }

  const data = JSON.parse(result.stdout) as {
    streams?: Array<{ codec_type?: string }>;
    format?: { duration?: string };
  };

  const streams = data.streams ?? [];
  const hasVideo = streams.some((s) => s.codec_type === "video");
  const hasAudio = streams.some((s) => s.codec_type === "audio");
  const durationStr = data.format?.duration;
  const durationSeconds = durationStr ? parseFloat(durationStr) : null;

  return { hasVideo, hasAudio, durationSeconds };
}
