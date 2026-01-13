import fs from "node:fs";
import path from "node:path";
import { runCommand } from "../tools/command.js";

type LoadEnvOptions = {
  path?: string;
  override?: boolean;
};

function parseLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const index = trimmed.indexOf("=");
  if (index === -1) {
    return null;
  }

  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();
  if (!key) {
    return null;
  }

  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

export function loadEnv(options: LoadEnvOptions = {}): void {
  const envPath = options.path ?? path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) {
      continue;
    }

    if (options.override || process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

export type EnvSnapshot = {
  node: string;
  python: string | null;
  ffmpeg: string | null;
  ytdlp: string | null;
  timestamp: string;
};

/**
 * Get version string from a command output
 */
export async function getCommandVersion(command: string, args: string[]): Promise<string | null> {
  try {
    const result = await runCommand(command, args, { timeoutMs: 5000 });
    if (result.exitCode === 0 && result.stdout) {
      // Return first line usually containing version
      const firstLine = result.stdout.split('\n')[0].trim();
      return firstLine || null;
    }
  } catch {
    // Ignore errors, tool might be missing
  }
  return null;
}

/**
 * Capture current environment snapshot
 */
export async function getEnvSnapshot(): Promise<EnvSnapshot> {
  const [python, ffmpeg, ytdlp] = await Promise.all([
    getCommandVersion("python", ["--version"]),
    getCommandVersion("ffmpeg", ["-version"]),
    getCommandVersion("yt-dlp", ["--version"]),
  ]);

  return {
    node: process.version,
    python,
    ffmpeg,
    ytdlp,
    timestamp: new Date().toISOString()
  };
}
