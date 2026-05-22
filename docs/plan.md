## Objective

Continue Slice 3 of `docs/roadmap/01-background-parallel-agent-surface.md` by
adding runtime-owned isolated-worktree lease execution and terminal lease
outcome evidence without mutating the admitted capability snapshot.

## Non-Goals

- Do not provision real worktrees, sandboxes, ports, credentials, or cleanup
- Do not provision sandboxes, ports, environment bindings, credential routes,
  or cleanup daemons.
- Do not add a surface-local lease store.
- Do not add compatibility fallback shapes for incomplete leases.
- Do not weaken adapter record equality or runtime admission replay.
- Do not import or depend on CLI wrapper worktree management.

## Scout Summary

Owning bounded context:

- Core managed invocation contract:
  `packages/core/src/agents/managed-invocation/index.ts`
- Runtime managed invocation registry:
  `packages/runtime/src/agents/managed-invocation/index.ts`
- Runtime session evidence:
  `packages/runtime/src/agents/managed-invocation/session-events.ts`

Current facts:

- Admission snapshots are immutable and runtime currently requires adapter
  records to return the admitted capability snapshot exactly.
- Lifecycle evidence is currently derived from the admitted snapshot lease,
  which cannot honestly represent terminal cleanup/release outcomes.
- Gateway already prefers terminal lifecycle lease evidence over admission
  snapshots when present.
- Runtime has no worktree lease execution boundary. CLI wrapper worktree
  management exists outside this bounded context and must not be imported.

## This Cut

1. Add optional terminal `resourceLease` evidence to
   `ManagedAgentInvocationRecord`.
2. Build lifecycle evidence from terminal record lease when present, otherwise
   from the admitted snapshot lease.
3. Add a runtime `ManagedAgentWorktreeLeaseManager` port for
   `isolated-worktree` invocations only.
4. Reserve the invocation before any asynchronous worktree acquisition, acquire
   the worktree lease before adapter execution, and release it only after the
   adapter reaches a terminal result.
5. Mark cleanup `completed` only when release executes successfully; mark
   cleanup `failed`/health `leaked` with diagnostics when release fails.
6. Fail closed when an `isolated-worktree` invocation starts without a runtime
   worktree lease manager.
7. Constrain git-backed worktree paths to an explicit runtime-configured
   worktree root and reject lease-manager output that changes admitted path,
   mode, identity, or non-invocation resource URIs.
8. Canonicalize worktree paths before root/conflict checks, reject path aliases,
   keep `join` valid while acquire is in flight, and record compensating cleanup
   evidence when acquire fails after external side effects.

## Test Plan

Focused red tests first:

```bash
bun run --filter @kilnai/core test -- tests/managed-agent/invocation-contracts.test.ts
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts tests/session/managed-invocation-session-events.test.ts
```

Verification for this cut:

```bash
bun run --filter @kilnai/core test -- tests/managed-agent/invocation-contracts.test.ts
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts tests/session/managed-invocation-session-events.test.ts
bun run --filter @kilnai/gateway-contracts test -- tests/operator-event-presentation.test.ts tests/operator-cockpit-projection.test.ts
bun run typecheck
git diff --check
```

## Risks

- Dirty worktree policy must fail closed. Runtime must not delete or claim
  cleanup for a worktree when the release boundary reports failure.
- Terminal lease evidence must not mutate or replace the admitted capability
  snapshot; otherwise runtime replay equality weakens.
- Cancellation must not remove an isolated worktree while the adapter is still
  unwinding; release belongs to terminal adapter handling, not the cancel
  request itself.
- Path confinement must treat `.`/`..` and slash variants as the same path
  before checking roots or active isolated-worktree collisions.
