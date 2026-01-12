import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../utils/fs.js";
import { Segment, Segments } from "../nlp/segments.js";

/**
 * Format seconds to SRT timestamp (HH:MM:SS,mmm)
 */
function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  const hStr = hours.toString().padStart(2, "0");
  const mStr = minutes.toString().padStart(2, "0");
  const sStr = secs.toString().padStart(2, "0");
  const msStr = millis.toString().padStart(3, "0");

  return `${hStr}:${mStr}:${sStr},${msStr}`;
}

/**
 * Convert segments to SRT format string
 */
export function segmentsToSrt(segments: Segments): string {
  const lines: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const index = i + 1;
    const start = formatTimestamp(seg.start);
    const end = formatTimestamp(seg.end);
    const text = seg.text.trim();

    lines.push(String(index));
    lines.push(`${start} --> ${end}`);
    lines.push(text);
    lines.push(""); // blank line between entries
  }

  return lines.join("\n");
}

/**
 * Write segments to SRT file
 */
export function writeSrt(segments: Segments, srtPath: string): void {
  ensureDir(path.dirname(srtPath));
  const content = segmentsToSrt(segments);
  fs.writeFileSync(srtPath, content, "utf8");
}

/**
 * Parse SRT file to segments (basic parser)
 */
export function parseSrt(content: string): Segment[] {
  const segments: Segment[] = [];
  const blocks = content.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) continue;

    // Line 0: index (ignored)
    // Line 1: timestamps
    // Line 2+: text
    const timestampLine = lines[1];
    const match = timestampLine.match(
      /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
    );

    if (!match) continue;

    const startH = parseInt(match[1], 10);
    const startM = parseInt(match[2], 10);
    const startS = parseInt(match[3], 10);
    const startMs = parseInt(match[4], 10);
    const endH = parseInt(match[5], 10);
    const endM = parseInt(match[6], 10);
    const endS = parseInt(match[7], 10);
    const endMs = parseInt(match[8], 10);

    const start = startH * 3600 + startM * 60 + startS + startMs / 1000;
    const end = endH * 3600 + endM * 60 + endS + endMs / 1000;
    const text = lines.slice(2).join("\n").trim();

    segments.push({ start, end, text });
  }

  return segments;
}

/**
 * Validate SRT format (basic check)
 */
export function validateSrt(content: string): { valid: boolean; error?: string } {
  try {
    const segments = parseSrt(content);
    if (segments.length === 0) {
      return { valid: false, error: "No valid segments found" };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}
