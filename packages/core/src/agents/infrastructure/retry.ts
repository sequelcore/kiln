/** Shared retry utility with exponential backoff */

export interface RetryOptions {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly isRetryable: (error: unknown) => boolean;
  /** Injectable sleep for testing */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 0; attempt < options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      if (!options.isRetryable(error)) {
        throw error;
      }
      if (attempt < options.maxRetries - 1) {
        await sleep(options.baseDelayMs * 2 ** attempt);
      }
    }
  }

  throw lastError;
}
