## Objective

Continue Slice 3 of `docs/roadmap/01-background-parallel-agent-surface.md` by
making managed-agent resource leases carry replayable creation, health,
cleanup, and diagnostic evidence across core, runtime, and operator surfaces.

## Non-Goals

- Do not provision real worktrees, sandboxes, ports, credentials, or cleanup
  daemons.
- Do not add a surface-local lease store.
- Do not add compatibility fallback shapes for incomplete leases.
- Do not weaken adapter record equality or runtime admission replay.

## Scout Summary

Owning bounded context:

- Core managed invocation contract:
  `packages/core/src/agents/managed-invocation/index.ts`
- Runtime admission/replay consumers:
  `packages/runtime/src/agents/managed-invocation/index.ts`
- Gateway frame and operator projections:
  `packages/gateway-contracts/src/frames.ts`
  `packages/gateway-contracts/src/operator-event-presentation.ts`
  `packages/gateway-contracts/src/operator-cockpit-projection.ts`

Current facts:

- `resourceLease` is already required on capability snapshots and lifecycle
  evidence.
- The current lease only carries working directory path, mode, and resource
  URIs.
- Slice 3 still requires lease creation, health, cleanup, and leak diagnostic
  evidence before real provisioning can be added safely.
- Gateway and cockpit already project lease path/mode/resources, so they are
  the right surfaces for the next metadata projection.

## This Cut

1. Add required lease metadata: `leaseId`, `createdAt`, `healthStatus`,
   `cleanupStatus`, and `diagnosticUris`.
2. Derive default metadata deterministically from admission input and snapshot
   capture time.
3. Validate metadata strictly at the core snapshot boundary.
4. Project metadata in operator event details and read-only cockpit invocation
   summaries.
5. Update runtime replay tests and session evidence expectations so the same
   lease evidence survives start, join, lifecycle event, and gateway projection.

## Test Plan

Focused red tests first:

```bash
bun run --filter @kilnai/core test -- tests/managed-agent/invocation-contracts.test.ts
bun run --filter @kilnai/gateway-contracts test -- tests/operator-event-presentation.test.ts tests/operator-cockpit-projection.test.ts
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts tests/session/managed-invocation-session-events.test.ts
```

Verification for this cut:

```bash
bun run --filter @kilnai/core test -- tests/managed-agent/invocation-contracts.test.ts
bun run --filter @kilnai/gateway-contracts test
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts tests/session/managed-invocation-session-events.test.ts
bun run typecheck
git diff --check
```

## Risks

- Required metadata touches multiple test fixtures; keep edits limited to the
  resource lease contract and its projections.
- Cleanup status is evidence, not execution. This cut records the admitted
  cleanup obligation; actual cleanup/recovery will be a later runtime slice.
