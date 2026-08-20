# Atomic transfer

Implement `transferFunds(state, from, to, amount, requestId)` in
`src/solution.mjs`. Accounts must exist, amount must be a positive integer, and
funds must be sufficient. A successful result is
`{ requestId, from, to, amount }`. State has the shape
`{ balances: Record<string, number>, transfers: Record<string, Transfer> }`;
store the result under `state.transfers[requestId]`. Replaying a request is
idempotent. Every rejection leaves state unchanged. Error message text is not
part of the contract.

Also repair `proof/model.dfy` so its declared conservation and balance
invariants verify. Use a formal-verification tool when one is available. Change
only `src/solution.mjs` and `proof/model.dfy`.
