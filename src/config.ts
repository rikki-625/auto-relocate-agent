import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

const PathValueSchema = z
  .string()
  .min(1, "path must not be empty")
  .refine((value) => value.trim().length > 0, "path must not be blank")
  .refine((value) => !value.includes("\0"), "path must not contain null bytes");

const PathsSchema = z.object({
  workspace: PathValueSchema,
  jobs_dir: PathValueSchema,
  deliveries_dir: PathValueSchema,
  state_dir: PathValueSchema,
  logs_dir: PathValueSchema
});

const RenderSchema = z.object({
  font_path: z.string(),
  subtitle_fontsize: z.number().int().positive(),
  bgm_path: z.string().nullable()
});

const ConfigSchema = z.object({
  timezone: z.string(),
  max_videos_per_run: z.number().int().positive(),
  max_duration_seconds: z.number().int().min(30).max(3600),
  retries_max: z.number().int().min(0).max(10),
  channels: z.array(z.string().min(1)),
  paths: PathsSchema,
  render: RenderSchema
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(configPath: string): AppConfig {
  const absolute = path.isAbsolute(configPath)
    ? configPath
    : path.join(process.cwd(), configPath);
  const raw = fs.readFileSync(absolute, "utf8");
  const parsed = YAML.parse(raw);
  const config = ConfigSchema.parse(parsed);
  const invalidChannels = config.channels.filter((channel) => !channel.startsWith("UC"));
  if (invalidChannels.length > 0) {
    console.warn(
      `[config] channel_id should start with UC: ${invalidChannels.join(", ")}`
    );
  }
  return config;
}
