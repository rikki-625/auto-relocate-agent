import fs from "node:fs";
import path from "node:path";

export function ensureDir(target: string): void {
  fs.mkdirSync(target, { recursive: true });
}

export function resolvePath(base: string, target: string): string {
  if (path.isAbsolute(target)) {
    return target;
  }

  return path.join(base, target);
}

export function fileExists(target: string): boolean {
  return fs.existsSync(target);
}

export function readJson<T>(target: string): T {
  const raw = fs.readFileSync(target, "utf8");
  return JSON.parse(raw) as T;
}

export function writeJson(target: string, data: unknown): void {
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, JSON.stringify(data, null, 2), "utf8");
}

export function copyFile(source: string, dest: string): void {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(source, dest);
}

export function fileSize(target: string): number {
  return fs.statSync(target).size;
}
