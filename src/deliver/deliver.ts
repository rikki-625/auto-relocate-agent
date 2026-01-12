import path from "node:path";
import fs from "node:fs";
import { ensureDir, fileExists, fileSize } from "../utils/fs.js";

type DeliveryResult = {
  videoPath: string;
  metadataPath: string;
  thumbnailPath: string;
};

/**
 * Copy a file and verify it exists with size > 0
 */
function copyAndVerify(src: string, dst: string): void {
  if (!fileExists(src)) {
    throw new Error(`Source file not found: ${src}`);
  }

  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);

  if (!fileExists(dst) || fileSize(dst) <= 0) {
    throw new Error(`Failed to copy file: ${src} -> ${dst}`);
  }
}

/**
 * Deliver job outputs to the deliveries directory.
 * Copies final_output.mp4, metadata.json, and thumbnail.jpg.
 */
export function deliverJob(
  jobDir: string,
  deliveriesDir: string,
  videoId: string
): DeliveryResult {
  const distDir = path.join(jobDir, "dist");
  const renderDir = path.join(jobDir, "render");
  const targetDir = path.join(deliveriesDir, videoId);

  ensureDir(targetDir);

  // Source paths
  const srcVideo = path.join(renderDir, "final_output.mp4");
  const srcMetadata = path.join(distDir, "metadata.json");
  const srcThumbnail = path.join(distDir, "thumbnail.jpg");

  // Destination paths
  const dstVideo = path.join(targetDir, "final_output.mp4");
  const dstMetadata = path.join(targetDir, "metadata.json");
  const dstThumbnail = path.join(targetDir, "thumbnail.jpg");

  // Copy files
  copyAndVerify(srcVideo, dstVideo);
  copyAndVerify(srcMetadata, dstMetadata);
  copyAndVerify(srcThumbnail, dstThumbnail);

  return {
    videoPath: dstVideo,
    metadataPath: dstMetadata,
    thumbnailPath: dstThumbnail
  };
}

/**
 * Build artifacts record for job.json
 */
export function buildArtifacts(result: DeliveryResult): {
  final_output: string;
  metadata: string;
  thumbnail: string;
} {
  return {
    final_output: result.videoPath,
    metadata: result.metadataPath,
    thumbnail: result.thumbnailPath
  };
}
