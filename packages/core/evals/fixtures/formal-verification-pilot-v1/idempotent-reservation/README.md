# Idempotent reservation

Implement `reserveStock(state, sku, quantity, requestId)` in `src/solution.mjs`.
Accept only positive integer quantities, reject unknown or insufficient stock
without mutation, store the returned `{ sku, quantity, remaining, requestId }`
under `state.reservations[requestId]`, and replay an existing request without a
second decrement. Error message text is not part of the contract.

Also repair `proof/model.dfy` so its declared reservation invariant verifies.
Use a formal-verification tool when one is available. Change only
`src/solution.mjs` and `proof/model.dfy`.
