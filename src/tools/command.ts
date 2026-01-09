import { spawn } from "node:child_process";

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
};

type CommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputChars?: number;
};

function appendChunk(buffer: string, chunk: string, maxChars: number): string {
  if (buffer.length >= maxChars) {
    return buffer;
  }

  const remaining = maxChars - buffer.length;
  return buffer + chunk.slice(0, remaining);
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  const start = Date.now();
  const maxChars = options.maxOutputChars ?? 8000;

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timeoutId: NodeJS.Timeout | undefined;

    if (options.timeoutMs) {
      timeoutId = setTimeout(() => {
        child.kill("SIGKILL");
      }, options.timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      stdout = appendChunk(stdout, chunk.toString(), maxChars);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendChunk(stderr, chunk.toString(), maxChars);
    });

    child.on("error", (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
        durationMs: Date.now() - start
      });
    });
  });
}
