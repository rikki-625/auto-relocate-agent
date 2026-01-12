import path from "node:path";
import { ensureDir, fileExists, fileSize, writeJson } from "../utils/fs.js";
import { runCommand } from "./command.js";

export type YtDlpInfo = Record<string, unknown>;

type PreflightResult = {
  info: YtDlpInfo;
  durationSeconds: number | null;
  isLive: boolean;
  liveStatus: string | null;
  url: string;
};

const DEFAULT_TIMEOUT_MS = 60_000;

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return null;
}

function normalizePreflight(info: YtDlpInfo, url: string): PreflightResult {
  const duration =
    readNumber(info.duration) ??
    readNumber(info.duration_seconds) ??
    readNumber(info["duration"] as unknown);
  const isLive =
    Boolean(info.is_live) ||
    String(info.live_status ?? "").toLowerCase() === "live" ||
    String(info.live_status ?? "").toLowerCase() === "is_live";
  const liveStatus = readString(info.live_status) ?? readString(info.live_status_text);

  return {
    info,
    durationSeconds: duration,
    isLive,
    liveStatus,
    url
  };
}

export async function preflight(videoUrl: string): Promise<PreflightResult> {
  const result = await runCommand(
    "yt-dlp",
    ["--dump-json", "--skip-download", videoUrl],
    // yt-dlp JSON for YouTube can be much larger than a few KB; keep this high enough
    // to avoid truncation causing JSON.parse failures.
    { timeoutMs: DEFAULT_TIMEOUT_MS, maxOutputChars: 2_000_000 }
  );

  if (result.exitCode !== 0 || !result.stdout) {
    throw new Error(
      `yt-dlp preflight failed (code=${result.exitCode ?? "null"}): ${result.stderr}`
    );
  }

  try {
    const info = JSON.parse(result.stdout) as YtDlpInfo;
    return normalizePreflight(info, videoUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to parse yt-dlp JSON output (stdoutLength=${result.stdout.length}): ${message}`
    );
  }
}

export function preflightPasses(
  preflight: PreflightResult,
  maxDurationSeconds: number,
  excludeShorts = false
): { ok: boolean; reason?: string } {
  if (preflight.isLive) {
    return { ok: false, reason: "live stream" };
  }

  if (preflight.durationSeconds === null) {
    return { ok: false, reason: "missing duration" };
  }

  if (preflight.durationSeconds > maxDurationSeconds) {
    return { ok: false, reason: `duration ${preflight.durationSeconds}s exceeds limit` };
  }

  if (excludeShorts) {
    const url = String(preflight.info.webpage_url ?? preflight.url);
    if (url.includes("/shorts/")) {
      return { ok: false, reason: "shorts excluded" };
    }
  }

  return { ok: true };
}

export async function download(
  videoUrl: string,
  outputDir: string,
  archivePath: string
): Promise<void> {
  ensureDir(outputDir);
  ensureDir(path.dirname(archivePath));

  const outputTemplate = path.join(outputDir, "video.%(ext)s");

  const result = await runCommand(
    "yt-dlp",
    [
      "--no-playlist",
      "--download-archive",
      archivePath,
      "-f",
      "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]",
      "--write-info-json",
      "--write-thumbnail",
      "-o",
      outputTemplate,
      videoUrl
    ],
    { timeoutMs: DEFAULT_TIMEOUT_MS * 5 }
  );

  if (result.exitCode !== 0) {
    throw new Error(`yt-dlp download failed (code=${result.exitCode ?? "null"}): ${result.stderr}`);
  }

  const videoPath = path.join(outputDir, "video.mp4");
  if (!fileExists(videoPath) || fileSize(videoPath) <= 0) {
    throw new Error("yt-dlp download did not produce video.mp4");
  }

  const infoPath = path.join(outputDir, "video.info.json");
  if (fileExists(infoPath)) {
    return;
  }

  const jsonPath = path.join(outputDir, "video.info.json");
  writeJson(jsonPath, {});
}

/**
 * Resolve a channel handle (e.g. @Handle) to a Channel ID (UC...) using yt-dlp.
 * If the input already looks like a Channel ID (starts with UC), returns it as-is.
 */
export async function resolveChannelId(handleOrId: string): Promise<string> {
  // Already a Channel ID?
  if (handleOrId.startsWith("UC")) {
    return handleOrId;
  }

  // Assume it's a handle (with or without @)
  const handle = handleOrId.startsWith("@") ? handleOrId : `@${handleOrId}`;
  // Fetch first video's metadata and print ONLY channel_id
  const url = `https://www.youtube.com/${handle}/videos`;

  const result = await runCommand(
    "yt-dlp",
    [
      "--print", "channel_id",
      "--playlist-items", "1",
      "--skip-download",
      url
    ],
    { timeoutMs: 60000 }
  );

  if (result.exitCode !== 0 || !result.stdout) {
    throw new Error(`Failed to resolve channel handle ${handle}: ${result.stderr || "No output from yt-dlp"}`);
  }

  const channelId = result.stdout.trim();
  if (channelId.startsWith("UC")) {
    return channelId;
  }

  throw new Error(`Invalid channel_id resolved: ${channelId}`);
}
