type RetryOptions = {
  retries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
};

export async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function withRetries<T>(
  action: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const maxDelay = options.maxDelayMs ?? options.baseDelayMs * 8;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await action(attempt);
    } catch (error) {
      if (attempt >= options.retries) {
        throw error;
      }

      const delay = Math.min(options.baseDelayMs * 2 ** attempt, maxDelay);
      await sleep(delay);
    }
  }

  throw new Error("Retry attempts exhausted");
}
