## Objective

Start Slice 3 of `docs/roadmap/01-background-parallel-agent-surface.md` by
making child resource leases an explicit managed-agent admission contract.

## Non-Goals

- Do not provision worktrees, sandboxes, ports, or cleanup daemons in this cut.
- Do not add a new lease persistence store.
- Do not expose new GUI/operator-frame fields until the core/runtime contract is
  stable.
- Do not relax admission or add backwards-compatible fallback shapes.

## Scout Summary

Owning bounded context:

- Core managed invocation contract:
  `packages/core/src/agents/managed-invocation/index.ts`
- Runtime invocation service:
  `packages/runtime/src/agents/managed-invocation/index.ts`
- Runtime session event projection:
  `packages/runtime/src/agents/managed-invocation/session-events.ts`

Current facts:

- Core already has `ManagedAgentResourceLeaseEvidence`, but it only appears in
  terminal lifecycle evidence.
- `ManagedAgentCapabilitySnapshot` carries `resourcePlane.resourceUris`, but no
  explicit lease object.
- Runtime admission compares capability snapshots by value, so the lease must be
  derived deterministically in core.
- Session terminal evidence already includes lifecycle evidence, which is the
  right first surface for replayable lease proof.

## This Cut

1. Add `resourceLease` to `ManagedAgentCapabilitySnapshot` and
   `ManagedAgentCapabilitySnapshotInput`.
2. Derive the default lease from the admitted working directory and resource
   URIs in `buildManagedAgentCapabilitySnapshot`.
3. Validate lease fields through `defineManagedAgentCapabilitySnapshot`.
4. Source lifecycle evidence from `record.capabilitySnapshot.resourceLease` so
   admission and terminal proof match.
5. Assert runtime start/join and session event projection carry the lease
   without adapter-specific state.

## Test Plan

Focused red tests first:

```bash
bun run --filter @kilnai/core test -- tests/managed-agent/invocation-contracts.test.ts
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts tests/session/managed-invocation-session-events.test.ts
```

Verification for this cut:

```bash
bun run --filter @kilnai/core test
bun run --filter @kilnai/runtime test
bun run typecheck
git diff --check
```

## Risks

- Snapshot equality will reject runtime records if the lease derivation differs
  between admission and adapter records.
- Gateway contracts will remain unaware of leases until the next cross-surface
  projection slice.
- This cut proves the contract shape only; later slices still need real
  worktree/sandbox lease acquisition, health, cleanup, and stale recovery.
