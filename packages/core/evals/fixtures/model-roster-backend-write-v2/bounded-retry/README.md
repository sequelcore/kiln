# Bounded retry plan

Implement `planRetry(attempt, maxAttempts, baseDelayMs, maxDelayMs,
retryAfterMs)` in `src/solution.mjs`. All bounds are positive integers;
`attempt` starts at 1 and cannot exceed `maxAttempts`, base delay cannot exceed
the maximum, and a supplied retry-after must be a non-negative integer. Stop at
the maximum by returning `{ retry: false, delayMs: 0, nextAttempt: null }`.
Otherwise use exponential delay for the current attempt, raise it to retry-after
when larger, and cap it. Return `{ retry, delayMs, nextAttempt }`. Error message
text is not part of the contract. Change only the implementation file.
