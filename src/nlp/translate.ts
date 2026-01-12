import path from "node:path";
import { ensureDir, readJson, writeJson } from "../utils/fs.js";
import { Segment, Segments, parseSegments } from "./segments.js";
import { writeSrt } from "../subtitles/srt.js";

type TranslateOptions = {
  targetLanguage?: string;
  maxCharsPerLine?: number;
  maxLines?: number;
};

/**
 * Post-process translated text to fit subtitle display constraints.
 * Split long lines and trim excess.
 */
export function postProcessText(
  text: string,
  maxCharsPerLine: number = 18,
  maxLines: number = 2
): string {
  // Remove leading/trailing whitespace
  text = text.trim();

  // If already fits, return as-is
  if (text.length <= maxCharsPerLine) {
    return text;
  }

  // Split into words/characters for CJK
  const isCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(text);

  let lines: string[] = [];

  if (isCJK) {
    // For CJK, split by character count
    let currentLine = "";
    for (const char of text) {
      if (currentLine.length >= maxCharsPerLine) {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine += char;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  } else {
    // For non-CJK, split by words
    const words = text.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (testLine.length > maxCharsPerLine && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  }

  // Limit to max lines
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    // Add ellipsis if truncated
    const lastLine = lines[maxLines - 1];
    if (lastLine.length > maxCharsPerLine - 3) {
      lines[maxLines - 1] = lastLine.substring(0, maxCharsPerLine - 3) + "...";
    }
  }

  return lines.join("\n");
}

/**
 * Translate segments using simple placeholder logic.
 * In production, this would call an LLM API.
 * 
 * For MVP, we simulate translation by adding a prefix.
 * The actual LLM integration will be added when the Claude Agent SDK is configured.
 */
export async function translateSegments(
  sourceSegments: Segments,
  options: TranslateOptions = {}
): Promise<Segments> {
  const { targetLanguage = "zh", maxCharsPerLine = 18, maxLines = 2 } = options;

  // TODO: Replace with actual LLM call using Claude Agent SDK
  // For now, we just copy the source text (simulating no-op translation)
  // and apply post-processing for display constraints

  const translatedSegments: Segment[] = sourceSegments.map((seg) => {
    // In real implementation, this would call LLM to translate seg.text
    // For now, just apply post-processing
    const processedText = postProcessText(seg.text, maxCharsPerLine, maxLines);

    return {
      start: seg.start,
      end: seg.end,
      text: processedText
    };
  });

  return translatedSegments;
}

/**
 * Run translation pipeline on ASR output.
 * Reads source segments, translates, writes translated segments and SRT.
 */
export async function runTranslation(
  asrDir: string,
  nlpDir: string,
  options: TranslateOptions = {}
): Promise<{ segmentsPath: string; srtPath: string }> {
  ensureDir(nlpDir);

  // Read source segments from ASR output
  const sourceSegmentsPath = path.join(asrDir, "source_segments.json");
  const sourceData = readJson<unknown>(sourceSegmentsPath);
  const sourceSegments = parseSegments(sourceData);

  // Validate env var is loaded (User request)
  if (process.env.ANTHROPIC_BASE_URL) {
    console.log(`[Translation] Using ANTHROPIC_BASE_URL: ${process.env.ANTHROPIC_BASE_URL}`);
  } else {
    console.warn("[Translation] ANTHROPIC_BASE_URL not set");
  }

  // Translate
  const translatedSegments = await translateSegments(sourceSegments, options);

  // Write translated segments JSON
  const translatedSegmentsPath = path.join(nlpDir, "translated_segments.json");
  writeJson(translatedSegmentsPath, translatedSegments);

  // Write SRT
  const srtPath = path.join(nlpDir, "translated.srt");
  writeSrt(translatedSegments, srtPath);

  return { segmentsPath: translatedSegmentsPath, srtPath };
}
