import path from "node:path";
import { z } from "zod";
import { ensureDir, fileExists, readJson, writeJson } from "../utils/fs.js";

const ArtifactsSchema = z
  .object({
    final_output: z.string().min(1),
    metadata: z.string().min(1),
    thumbnail: z.string().min(1)
  })
  .partial();

const JobSchema = z.object({
  video_id: z.string().min(1),
  channel_id: z.string().min(1),
  source_url: z.string().min(1),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  status: z.string().min(1),
  attempts: z.number().int().min(0),
  step: z.string().min(1),
  last_error: z.string().nullable(),
  artifacts: ArtifactsSchema.optional()
});

export type Job = z.infer<typeof JobSchema>;

export function jobPath(jobsDir: string, videoId: string): string {
  return path.join(jobsDir, videoId, "job.json");
}

export function jobExists(jobsDir: string, videoId: string): boolean {
  return fileExists(jobPath(jobsDir, videoId));
}

export function loadJob(targetPath: string): Job {
  return JobSchema.parse(readJson<Job>(targetPath));
}

export function saveJob(targetPath: string, job: Job): void {
  ensureDir(path.dirname(targetPath));
  writeJson(targetPath, job);
}

export function createJob(params: {
  videoId: string;
  channelId: string;
  sourceUrl: string;
  now: string;
}): Job {
  return {
    video_id: params.videoId,
    channel_id: params.channelId,
    source_url: params.sourceUrl,
    created_at: params.now,
    updated_at: params.now,
    status: "pending",
    attempts: 0,
    step: "discovered",
    last_error: null,
    artifacts: {}
  };
}
