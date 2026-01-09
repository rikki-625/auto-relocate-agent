import { withRetries } from "./retry.js";

type FetchOptions = {
  timeoutMs: number;
  retries: number;
  baseDelayMs?: number;
};

export async function fetchText(url: string, options: FetchOptions): Promise<string> {
  return withRetries(
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        return await response.text();
      } finally {
        clearTimeout(timeoutId);
      }
    },
    {
      retries: options.retries,
      baseDelayMs: options.baseDelayMs ?? 500
    }
  );
}
