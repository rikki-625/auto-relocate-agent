import path from "node:path";
import { AppConfig } from "./config.js";
import { FeedEntry, fetchChannelFeed } from "./youtube/rss.js";
import {
  Job,
  createJob,
  incrementAttempts,
  jobExists,
  jobPath,
  loadJob,
  markFailed,
  markSucceeded,
  saveJob,
  updateStep
} from "./jobs/job.js";
import { download, preflight, preflightPasses, resolveChannelId, YtDlpInfo } from "./tools/ytdlp.js";
import { burnSubtitles, extractAudio, normalizeLoudness, normalizeThumbnail, probeVideo } from "./tools/ffmpeg.js";
import { runAsr } from "./tools/asr.js";
import { runTranslation } from "./nlp/translate.js";
import { runMetadataGeneration } from "./nlp/metadata.js";
import { buildArtifacts, deliverJob } from "./deliver/deliver.js";
import { ensureDir, writeJson } from "./utils/fs.js";
import { nowIso } from "./utils/time.js";

type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

type Candidate = {
  videoId: string;
  channelId: string;
  sourceUrl: string;
  publishedAt: string;
};

/**
 * Fetch RSS feeds from all configured channels, merge entries,
 * sort by published_at descending, filter out existing jobs,
 * and return top N candidates.
 */
export async function fetchAndFilterCandidates(
  config: AppConfig,
  jobsDir: string,
  logger: Logger
): Promise<Candidate[]> {
  const allEntries: FeedEntry[] = [];

  for (const channelInput of config.channels) {
    try {
      // Resolve handle to ID if needed
      const channelId = await resolveChannelId(channelInput);
      if (channelId !== channelInput) {
        logger.info(`Resolved ${channelInput} to ${channelId}`);
      }

      logger.info(`Fetching RSS for channel: ${channelId}`);
      const entries = await fetchChannelFeed(channelId);
      logger.info(`  Found ${entries.length} entries`);
      allEntries.push(...entries);
    } catch (err) {
      logger.warn(`  Failed to process channel ${channelInput}: ${String(err)}`);
    }
  }

  // Sort by published_at descending (newest first)
  allEntries.sort((a, b) => {
    const dateA = new Date(a.published_at).getTime();
    const dateB = new Date(b.published_at).getTime();
    return dateB - dateA;
  });

  // Filter out videos that already have a job
  const candidates: Candidate[] = [];
  for (const entry of allEntries) {
    if (candidates.length >= config.max_videos_per_run) {
      break;
    }
    if (jobExists(jobsDir, entry.video_id)) {
      logger.info(`Skipping ${entry.video_id} (already processed)`);
      continue;
    }
    candidates.push({
      videoId: entry.video_id,
      channelId: entry.channel_id,
      sourceUrl: entry.source_url,
      publishedAt: entry.published_at
    });
  }

  return candidates;
}

/**
 * Save preflight info to the job's source directory.
 */
function savePreflightInfo(outputDir: string, info: YtDlpInfo): void {
  ensureDir(outputDir);
  const infoPath = path.join(outputDir, "video.info.json");
  writeJson(infoPath, info);
}

type ProcessResult = {
  status: "succeeded" | "failed" | "skipped";
  reason?: string;
};

/**
 * Process a single video through the pipeline.
 * Handles job creation, preflight, and error handling with retry logic.
 */
export async function processSingleVideo(
  candidate: Candidate,
  config: AppConfig,
  jobsDir: string,
  deliveriesDir: string,
  logger: Logger
): Promise<ProcessResult> {
  const { videoId, channelId, sourceUrl } = candidate;
  const jobFilePath = jobPath(jobsDir, videoId);
  const sourceDir = path.join(jobsDir, videoId, "source");

  // Check if job already exists (double-check for race conditions)
  let job: Job;
  if (jobExists(jobsDir, videoId)) {
    job = loadJob(jobFilePath);
    if (job.status === "succeeded") {
      return { status: "skipped", reason: "already succeeded" };
    }
    if (job.status === "failed") {
      return { status: "skipped", reason: "already failed (max retries)" };
    }
  } else {
    // Create new job
    job = createJob({
      videoId,
      channelId,
      sourceUrl,
      now: nowIso()
    });
    saveJob(jobFilePath, job);
    logger.info(`Created job for ${videoId}`);
  }

  try {
    // Step 1: Preflight check
    logger.info(`[${videoId}] Running preflight check...`);
    job = updateStep(job, "preflight", nowIso());
    saveJob(jobFilePath, job);

    const preflightResult = await preflight(sourceUrl);

    // Save preflight info immediately (even if check fails, for debugging)
    savePreflightInfo(sourceDir, preflightResult.info);
    logger.info(`[${videoId}] Saved preflight info to ${sourceDir}`);

    const checkResult = preflightPasses(
      preflightResult,
      config.max_duration_seconds,
      true // excludeShorts
    );

    if (!checkResult.ok) {
      logger.warn(`[${videoId}] Preflight failed: ${checkResult.reason}`);
      job = incrementAttempts(job, `preflight: ${checkResult.reason}`, nowIso());
      job = markFailed(job, nowIso());
      saveJob(jobFilePath, job);
      return { status: "failed", reason: checkResult.reason };
    }

    logger.info(`[${videoId}] Preflight passed (duration: ${preflightResult.durationSeconds}s)`);

    // Step 2: Download
    logger.info(`[${videoId}] Downloading video...`);
    job = updateStep(job, "download", nowIso());
    saveJob(jobFilePath, job);

    const stateDir = path.resolve(config.paths.state_dir);
    const archivePath = path.join(stateDir, "download_archive.txt");
    await download(sourceUrl, sourceDir, archivePath);
    logger.info(`[${videoId}] Download complete`);

    // Step 3: Normalize thumbnail
    logger.info(`[${videoId}] Normalizing thumbnail...`);
    job = updateStep(job, "thumbnail", nowIso());
    saveJob(jobFilePath, job);

    const distDir = path.join(jobsDir, videoId, "dist");
    try {
      const thumbnailPath = await normalizeThumbnail(sourceDir, distDir);
      logger.info(`[${videoId}] Thumbnail normalized to ${thumbnailPath}`);
    } catch (thumbErr) {
      // Thumbnail failure is non-fatal, just log warning
      logger.warn(`[${videoId}] Thumbnail normalization failed: ${thumbErr}`);
    }

    // Step 4: ASR (Audio extraction + Speech recognition)
    logger.info(`[${videoId}] Extracting audio...`);
    job = updateStep(job, "asr", nowIso());
    saveJob(jobFilePath, job);

    const asrDir = path.join(jobsDir, videoId, "asr");
    const videoPath = path.join(sourceDir, "video.mp4");
    const audioPath = path.join(asrDir, "audio.wav");

    await extractAudio(videoPath, audioPath);
    logger.info(`[${videoId}] Audio extracted to ${audioPath}`);

    logger.info(`[${videoId}] Running ASR...`);
    const asrResult = await runAsr(audioPath, asrDir, { vad: true });
    logger.info(`[${videoId}] ASR complete: ${asrResult.segmentsCount} segments, language=${asrResult.language}`);

    // Step 5: Translate
    logger.info(`[${videoId}] Translating segments...`);
    job = updateStep(job, "translate", nowIso());
    saveJob(jobFilePath, job);

    const nlpDir = path.join(jobsDir, videoId, "nlp");
    const translateResult = await runTranslation(asrDir, nlpDir);
    logger.info(`[${videoId}] Translation complete: ${translateResult.srtPath}`);

    // Step 6: Render (burn subtitles + normalize loudness)
    logger.info(`[${videoId}] Rendering video with subtitles...`);
    job = updateStep(job, "render", nowIso());
    saveJob(jobFilePath, job);

    const renderDir = path.join(jobsDir, videoId, "render");
    ensureDir(renderDir);
    const subtitledPath = path.join(renderDir, "subtitled.mp4");
    const finalOutputPath = path.join(renderDir, "final_output.mp4");

    await burnSubtitles(videoPath, translateResult.srtPath, config.render.font_path, subtitledPath);
    logger.info(`[${videoId}] Subtitles burned`);

    await normalizeLoudness(subtitledPath, finalOutputPath);
    logger.info(`[${videoId}] Loudness normalized`);

    // Verify output is playable
    const probeResult = await probeVideo(finalOutputPath);
    if (!probeResult.hasVideo || !probeResult.hasAudio) {
      throw new Error(`Output video missing streams: video=${probeResult.hasVideo}, audio=${probeResult.hasAudio}`);
    }
    logger.info(`[${videoId}] Video verified (duration: ${probeResult.durationSeconds}s)`);

    // Step 7: Package (metadata generation)
    logger.info(`[${videoId}] Generating metadata...`);
    job = updateStep(job, "package", nowIso());
    saveJob(jobFilePath, job);

    const metadataPath = await runMetadataGeneration(sourceDir, distDir, { now: nowIso() });
    logger.info(`[${videoId}] Metadata generated: ${metadataPath}`);

    // Step 8: Deliver
    logger.info(`[${videoId}] Delivering outputs...`);
    job = updateStep(job, "deliver", nowIso());
    saveJob(jobFilePath, job);

    const jobDirPath = path.join(jobsDir, videoId);
    const deliveryResult = deliverJob(jobDirPath, deliveriesDir, videoId);
    logger.info(`[${videoId}] Delivered to: ${deliveryResult.videoPath}`);

    // Mark job as succeeded
    job.artifacts = buildArtifacts(deliveryResult);
    job = markSucceeded(job, "deliver", nowIso());
    saveJob(jobFilePath, job);

    return { status: "succeeded" };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[${videoId}] Error: ${errorMsg}`);

    job = incrementAttempts(job, errorMsg, nowIso());

    if (job.attempts >= config.retries_max) {
      logger.error(`[${videoId}] Max retries (${config.retries_max}) reached, marking as failed`);
      job = markFailed(job, nowIso());
    }

    saveJob(jobFilePath, job);
    return { status: "failed", reason: errorMsg };
  }
}
