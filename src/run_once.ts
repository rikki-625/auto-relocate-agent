import path from "node:path";
import { AppConfig } from "./config.js";
import { buildRunId } from "./utils/time.js";
import { ensureDir } from "./utils/fs.js";
import { createLogger } from "./utils/logger.js";
import { fetchAndFilterCandidates, processSingleVideo } from "./pipeline.js";

type RunContext = {
  runId: string;
  jobsDir: string;
  deliveriesDir: string;
  logsDir: string;
};

function prepareWorkspace(config: AppConfig): RunContext {
  const deliveriesDir = path.resolve(config.paths.deliveries_dir);
  const jobsDir = path.resolve(config.paths.jobs_dir);
  const logsDir = path.resolve(config.paths.logs_dir);
  const stateDir = path.resolve(config.paths.state_dir);
  const workspaceDir = path.resolve(config.paths.workspace);

  ensureDir(workspaceDir);
  ensureDir(jobsDir);
  ensureDir(deliveriesDir);
  ensureDir(stateDir);
  ensureDir(logsDir);

  const runId = buildRunId(config.timezone);
  const runDeliveriesDir = path.join(deliveriesDir, runId);
  ensureDir(runDeliveriesDir);

  return { runId, jobsDir, deliveriesDir: runDeliveriesDir, logsDir };
}

export async function runOnce(config: AppConfig): Promise<void> {
  const context = prepareWorkspace(config);
  const logger = createLogger(context.runId, context.logsDir);

  logger.info("=== Run started ===");
  logger.info(`Deliveries: ${context.deliveriesDir}`);

  // Step 1: Fetch and filter candidates from RSS
  logger.info("Fetching RSS feeds...");
  const candidates = await fetchAndFilterCandidates(config, context.jobsDir, logger);

  if (candidates.length === 0) {
    logger.info("No new videos to process");
    logger.info("=== Run completed ===");
    return;
  }

  logger.info(`Found ${candidates.length} candidate(s):`);
  for (const c of candidates) {
    logger.info(`  - ${c.videoId} (${c.channelId})`);
  }

  // Step 2: Process each candidate
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    logger.info(`Processing: ${candidate.videoId}`);
    const result = await processSingleVideo(candidate, config, context.jobsDir, context.deliveriesDir, logger);

    switch (result.status) {
      case "succeeded":
        succeeded++;
        logger.info(`[${candidate.videoId}] Succeeded`);
        break;
      case "failed":
        failed++;
        logger.warn(`[${candidate.videoId}] Failed: ${result.reason}`);
        break;
      case "skipped":
        skipped++;
        logger.info(`[${candidate.videoId}] Skipped: ${result.reason}`);
        break;
    }
  }

  // Summary
  logger.info("=== Run completed ===");
  logger.info(`Summary: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped`);
}

