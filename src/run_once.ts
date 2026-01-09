import path from "node:path";
import { AppConfig } from "./config.js";
import { buildRunId } from "./utils/time.js";
import { ensureDir } from "./utils/fs.js";

type RunContext = {
  runId: string;
  deliveriesDir: string;
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

  return { runId, deliveriesDir: runDeliveriesDir };
}

export async function runOnce(config: AppConfig): Promise<void> {
  const context = prepareWorkspace(config);

  console.log(`[run ${context.runId}] start`);
  console.log(`[run ${context.runId}] deliveries: ${context.deliveriesDir}`);

  // TODO: Implement pipeline steps:
  // 1) RSS fetch (channel_id whitelist)
  // 2) preflight with yt-dlp (duration <= max_duration_seconds)
  // 3) download to workspace/jobs/{video_id}/source
  // 4) ASR (CPU/GPU fallback)
  // 5) translate to structured JSON -> SRT
  // 6) render subtitles + loudnorm + optional BGM
  // 7) package metadata + thumbnail
  // 8) deliver to workspace/deliveries/{run_id}/{video_id}

  console.log(`[run ${context.runId}] done`);
}
