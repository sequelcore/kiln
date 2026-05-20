/** Shared retry utility with exponential backoff */

export interface RetryOptions {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly isRetryable: (error: unknown) => boolean;
  /** Injectable sleep for testing */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  signal?: AbortSignal,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 0; attempt < options.maxRetries; attempt++) {
    throwIfAborted(signal);
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      throwIfAborted(signal);
      if (!options.isRetryable(error)) {
        throw error;
      }
      if (attempt < options.maxRetries - 1) {
        await sleep(options.baseDelayMs * 2 ** attempt, signal);
      }
    }
  }

  throw lastError;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw abortError();
  }
}

function abortError(): Error {
  const error = new Error("Operation aborted");
  error.name = "AbortError";
  return error;
}
