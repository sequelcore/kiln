# Optimistic revision

Implement `applyRevision(state, id, expectedRevision, patch)` in
`src/solution.mjs`. Require an existing document and matching revision. Accept a
non-empty plain patch containing only `title` and/or `status`; reject protected,
unknown, or prototype-bearing keys. Return and store the patched document with
revision incremented once. Rejections must not mutate state. Error message text
is not part of the contract. Change only the implementation file.
