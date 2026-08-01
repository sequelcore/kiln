# Backend write fixture

Implement the contract in `src/order-service.mjs`. Change only that source file.

`reserveStock(state, sku, quantity, requestId)` must:

- accept only positive integer quantities;
- reject unknown SKUs and insufficient stock without mutating state;
- store a successful reservation under `state.reservations[requestId]`;
- return the stored reservation; and
- replay an existing `requestId` idempotently without decrementing stock again.
