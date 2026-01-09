import fs from "node:fs";
import path from "node:path";

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
