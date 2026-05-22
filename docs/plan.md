## Objective

Continue Slice 3 of `docs/roadmap/01-background-parallel-agent-surface.md` by
projecting managed-agent resource leases through the read-only operator gateway
contracts.

## Non-Goals

- Do not provision worktrees, sandboxes, ports, or cleanup daemons in this cut.
- Do not add a surface-local lifecycle or lease store.
- Do not change runtime admission semantics.
- Do not add compatibility shims for capability snapshots without leases.

## Scout Summary

Owning bounded context:

- Gateway frame contract:
  `packages/gateway-contracts/src/frames.ts`
- Operator event presentation:
  `packages/gateway-contracts/src/operator-event-presentation.ts`
- Read-only cockpit projection:
  `packages/gateway-contracts/src/operator-cockpit-projection.ts`

Current facts:

- Core/runtime now include `capabilitySnapshot.resourceLease`.
- Gateway frame types still expose `resourcePlane` but not `resourceLease`.
- Operator event presentation shows route health, provider proof, resource
  plane, and child identity, but hides lease evidence.
- Cockpit invocation summaries preserve lifecycle state and provider route, but
  not the resource lease behind the child.

## This Cut

1. Add an operator-facing resource lease snapshot type and include it in
   `OperatorManagedAgentCapabilitySnapshot`.
2. Present lease mode, working directory, and lease resource URIs in managed
   invocation event details.
3. Preserve the latest observed lease in read-only cockpit invocation
   projections.
4. Prefer the runtime capability snapshot as the lease source; fall back to
   terminal lifecycle evidence only when the snapshot is not present.
5. Keep all changes in gateway-contracts and tests; runtime already emits the
   snapshot and lifecycle evidence.

## Test Plan

Focused red tests first:

```bash
bun run --filter @kilnai/gateway-contracts test -- tests/operator-event-presentation.test.ts tests/operator-cockpit-projection.test.ts
```

Verification for this cut:

```bash
bun run --filter @kilnai/gateway-contracts test
bun run typecheck
git diff --check
```

## Risks

- Operator presentation must not dump the full capability snapshot as
  "Structured value".
- Cockpit projection must remain read-only and target-aware; lease data is
  evidence, not an action target by itself.
- Runtime/GUI/TUI tests may need rebuilt core outputs if they consume local
  package builds, but no runtime production change is expected.
