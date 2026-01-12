import path from "node:path";
import { ensureDir, fileExists, readJson } from "../utils/fs.js";
import { runCommand } from "./command.js";

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes for ASR

type AsrResult = {
  segmentsCount: number;
  language: string | null;
  languageProbability: number | null;
  jsonPath: string;
  srtPath: string;
};

type AsrOptions = {
  language?: string;
  vad?: boolean;
  model?: string;
  timeoutMs?: number;
};

/**
 * Get the path to the ASR Python script
 */
function getAsrScriptPath(): string {
  // Resolve relative to project root
  const projectRoot = path.resolve(import.meta.dirname, "..", "..");
  return path.join(projectRoot, "scripts", "asr_cli.py");
}

/**
 * Run ASR on an audio file using faster-whisper via Python CLI.
 * Produces source_segments.json and source.srt in the output directory.
 */
export async function runAsr(
  audioPath: string,
  outputDir: string,
  options: AsrOptions = {}
): Promise<AsrResult> {
  ensureDir(outputDir);

  const scriptPath = getAsrScriptPath();
  if (!fileExists(scriptPath)) {
    throw new Error(`ASR script not found: ${scriptPath}`);
  }

  const args = ["python", scriptPath, audioPath, outputDir];

  if (options.language && options.language !== "auto") {
    args.push("--language", options.language);
  }

  if (options.vad) {
    args.push("--vad");
  }

  if (options.model) {
    args.push("--model", options.model);
  }

  const result = await runCommand(args[0], args.slice(1), {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  });

  if (result.exitCode !== 0) {
    throw new Error(`ASR failed (code=${result.exitCode}): ${result.stderr}`);
  }

  // Parse the JSON output from stdout (last line)
  const stdout = result.stdout?.trim() ?? "";
  const lines = stdout.split("\n");
  const lastLine = lines[lines.length - 1];

  if (!lastLine) {
    throw new Error("ASR produced no output");
  }

  try {
    const output = JSON.parse(lastLine) as {
      segments_count: number;
      language: string | null;
      language_probability: number | null;
      json_path: string;
      srt_path: string;
    };

    return {
      segmentsCount: output.segments_count,
      language: output.language,
      languageProbability: output.language_probability,
      jsonPath: output.json_path,
      srtPath: output.srt_path
    };
  } catch {
    throw new Error(`Failed to parse ASR output: ${lastLine}`);
  }
}

/**
 * Segment type for ASR output
 */
export type Segment = {
  start: number;
  end: number;
  text: string;
};

/**
 * Load segments from JSON file
 */
export function loadSegments(jsonPath: string): Segment[] {
  if (!fileExists(jsonPath)) {
    throw new Error(`Segments file not found: ${jsonPath}`);
  }
  return readJson<Segment[]>(jsonPath);
}
