# Stable pagination

Implement `pageAfter(records, afterId, limit)` in `src/solution.mjs`. Do not
mutate input. Validate an integer limit from 1 through 100, reject duplicate IDs
and unknown non-null cursors, order records lexicographically by ID, and return
`{ items, nextCursor }`; the cursor is the last returned ID only when more items
remain, otherwise `null`. Error message text is not part of the contract.
Change only the implementation file.
