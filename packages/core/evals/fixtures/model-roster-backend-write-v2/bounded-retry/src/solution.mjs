export function planRetry(attempt, maxAttempts, baseDelayMs) {
  return { retry: true, delayMs: baseDelayMs * attempt, nextAttempt: attempt + 1 };
}
