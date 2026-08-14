# Event deduplication

Implement `applyInventoryEvent(state, event)` in `src/solution.mjs`. An event has
non-empty string `id` and `sku` plus integer `delta`. State has the shape
`{ stock: Record<string, number>, processedEventIds: Record<string, true> }`.
Apply it once, store `true` under `state.processedEventIds[event.id]`, return
resulting stock, and replay duplicates without applying them again. Reject
malformed events or negative resulting stock without mutation. Error message
text is not part of the contract. Change only the implementation file.
