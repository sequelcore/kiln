# Idempotent reservation

Implement `reserveStock(state, sku, quantity, requestId)` in `src/solution.mjs`.
Accept only positive integer quantities, reject unknown or insufficient stock
without mutation, store the returned `{ sku, quantity, remaining, requestId }`
under `state.reservations[requestId]`, and replay an existing request without a
second decrement. Error message text is not part of the contract. Change only
the implementation file.
