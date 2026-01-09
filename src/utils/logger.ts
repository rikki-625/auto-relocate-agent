import fs from "node:fs";
import path from "node:path";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
};

function formatLine(runId: string, level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  return `[run ${runId}] ${timestamp} ${level} ${message}`;
}

function writeLine(logPath: string, line: string): void {
  fs.appendFileSync(logPath, `${line}\n`, "utf8");
}

export function createLogger(runId: string, logsDir: string): Logger {
  const logPath = path.join(logsDir, `${runId}.log`);

  const log = (level: LogLevel, message: string) => {
    const line = formatLine(runId, level, message);
    if (level === "ERROR") {
      console.error(line);
    } else {
      console.log(line);
    }
    writeLine(logPath, line);
  };

  return {
    info: (message) => log("INFO", message),
    warn: (message) => log("WARN", message),
    error: (message) => log("ERROR", message),
    debug: (message) => log("DEBUG", message)
  };
}
