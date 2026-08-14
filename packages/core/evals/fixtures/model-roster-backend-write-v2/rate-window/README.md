# Idempotent rate window

Implement `recordAttempt(state, actorId, nowMs, requestId, limit, windowMs)` in
`src/solution.mjs`. Validate non-empty IDs, finite time, and positive integer
bounds by throwing; the error wording is not part of the contract. Discard
timestamps at or before `nowMs - windowMs`. Return
`{ allowed, remaining }`; denied attempts are not recorded. Store results in
`state.requests` so request IDs replay exactly without reevaluation. Rejections
must not mutate state. Change only the implementation file.
