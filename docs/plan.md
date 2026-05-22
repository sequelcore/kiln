## Objective

Continue Slice 3 of `docs/roadmap/01-background-parallel-agent-surface.md` by
adding a runtime lease guard for same-checkout parallel write children.

## Non-Goals

- Do not provision real worktrees, sandboxes, ports, credentials, or cleanup
  daemons.
- Do not add a surface-local lifecycle store.
- Do not relax core admission or adapter record equality.
- Do not infer safety from provider-specific names or adapter internals.

## Scout Summary

Owning bounded context:

- Runtime managed invocation registry:
  `packages/runtime/src/agents/managed-invocation/index.ts`
- Runtime managed invocation tests:
  `packages/runtime/tests/managed-agent/invocation-service.test.ts`
- Core write authority contract:
  `packages/core/src/agents/managed-invocation/write-authority.ts`

Current facts:

- Core validates each managed invocation request independently.
- Runtime is the first layer with visibility into concurrently active child
  invocations.
- Write-capable children already carry `writeAuthority.scope.workspace` and
  `authority.workingDirectory`.
- There is no active runtime guard that rejects two write-capable children in
  the same mutable checkout.

## This Cut

1. Add a failing runtime test that rejects a second active
   `foundation-apply-approved-writes` invocation in the same checkout when
   scopes overlap.
2. Add a failing runtime test that permits the second invocation only when both
   active and incoming approved-write scopes are explicit and disjoint.
3. Implement the guard in runtime start admission, before adapter invocation and
   registration of unsafe children.
4. Keep read-only and write-proposal children unaffected.

## Test Plan

Focused red test first:

```bash
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts
```

Verification for this cut:

```bash
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts tests/managed-agent/write-boundary.test.ts
bun run --filter @kilnai/core test -- tests/managed-agent/write-admission-policy.test.ts
bun run typecheck
git diff --check
```

## Risks

- Path overlap checks must be conservative: unclear scope means conflict, not
  permission.
- The guard must run after core admission succeeds but before adapter execution,
  so unsafe children do not start and do not appear as registered background
  invocations.
