import { z } from "zod";
import path from "node:path";
import { readJson, writeJson, ensureDir } from "../utils/fs.js";

/**
 * Metadata schema for video output
 */
export const MetadataSchema = z.object({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  language: z.string(),
  source_url: z.string(),
  source_channel_id: z.string(),
  source_title: z.string().optional(),
  source_channel_name: z.string().optional(),
  created_at: z.string()
});

export type Metadata = z.infer<typeof MetadataSchema>;

type VideoInfo = Record<string, unknown>;

/**
 * Generate metadata from source video info.
 * In production, this would use LLM to generate localized title/description.
 * For MVP, we extract and transform available fields.
 */
export function generateMetadata(
  videoInfo: VideoInfo,
  options: { targetLanguage?: string; now: string }
): Metadata {
  const { targetLanguage = "zh", now } = options;

  // Extract fields from yt-dlp video info
  const sourceTitle = String(videoInfo.title ?? videoInfo.fulltitle ?? "Untitled");
  const sourceDescription = String(videoInfo.description ?? "");
  const sourceUrl = String(videoInfo.webpage_url ?? videoInfo.original_url ?? "");
  const channelId = String(videoInfo.channel_id ?? videoInfo.uploader_id ?? "");
  const channelName = String(videoInfo.channel ?? videoInfo.uploader ?? "Unknown");
  const sourceTags = Array.isArray(videoInfo.tags) ? videoInfo.tags.map(String) : [];

  // For MVP: use source title/description directly
  // In production: LLM would translate and optimize for SEO
  const title = `[${targetLanguage.toUpperCase()}] ${sourceTitle}`;
  const description = sourceDescription.length > 0
    ? `${sourceDescription}\n\n---\nOriginal: ${sourceUrl}`
    : `Translated video from ${channelName}\n\nOriginal: ${sourceUrl}`;

  // Generate tags: include source tags + add language tag
  const tags = [...sourceTags.slice(0, 10), targetLanguage, "translated"];

  return {
    title,
    description,
    tags,
    language: targetLanguage,
    source_url: sourceUrl,
    source_channel_id: channelId,
    source_title: sourceTitle,
    source_channel_name: channelName,
    created_at: now
  };
}

/**
 * Generate and save metadata for a job.
 */
export async function runMetadataGeneration(
  sourceDir: string,
  distDir: string,
  options: { targetLanguage?: string; now: string }
): Promise<string> {
  ensureDir(distDir);

  // Read video info
  const infoPath = path.join(sourceDir, "video.info.json");
  const videoInfo = readJson<VideoInfo>(infoPath);

  // Generate metadata
  const metadata = generateMetadata(videoInfo, options);

  // Write metadata
  const metadataPath = path.join(distDir, "metadata.json");
  writeJson(metadataPath, metadata);

  return metadataPath;
}
