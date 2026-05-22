## Objective

Continue Slice 3 of `docs/roadmap/01-background-parallel-agent-surface.md` by
preserving an explicitly admitted managed-agent resource lease through runtime
admission replay.

## Non-Goals

- Do not add worktree, sandbox, port, credential, or cleanup provisioning.
- Do not relax capability snapshot equality.
- Do not add compatibility fallbacks for malformed or incomplete leases.
- Do not change operator surface projection; that was handled in the previous
  slice.

## Scout Summary

Owning bounded context:

- Core admission snapshot contract:
  `packages/core/src/agents/managed-invocation/index.ts`
- Runtime admission replay:
  `packages/runtime/src/agents/managed-invocation/index.ts`
- Runtime service tests:
  `packages/runtime/tests/managed-agent/invocation-service.test.ts`

Current facts:

- Core can now derive or validate `capabilitySnapshot.resourceLease`.
- Runtime `start` admits a snapshot and stores that exact decision.
- Runtime `invokeAdmitted` replays core admission before invoking the adapter.
- The replay helper currently reconstructs snapshot input from the admitted
  snapshot, and must preserve lease evidence exactly so custom lease evidence
  does not become a default working-directory lease.

## This Cut

1. Add a failing runtime service test that starts with explicit resource lease
   evidence and joins successfully.
2. Preserve `resourceLease` in the runtime replay snapshot input.
3. Keep snapshot equality strict so adapters cannot broaden or mutate leases.
4. Verify focused runtime tests, core contract tests, typecheck, and diff
   hygiene.

## Test Plan

Focused red test first:

```bash
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts
```

Verification for this cut:

```bash
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts tests/session/managed-invocation-session-events.test.ts
bun run --filter @kilnai/core test -- tests/managed-agent/invocation-contracts.test.ts
bun run typecheck
git diff --check
```

## Risks

- Runtime replay must preserve exact admitted evidence without creating a
  second policy path.
- The fix must not weaken `assertRecordWithinAdmission`; adapter output must
  still match the admitted capability snapshot byte-for-byte.
