# Plan: Slice 3J Dirty Worktree Review Policy

## Objective

Finish Slice 3 by making dirty isolated-worktree preservation an explicit
runtime lifecycle policy. A dirty worktree must remain preserved for operator
review, must not be auto-adopted or silently cleaned, and must project typed
evidence through core, runtime recovery, and operator surfaces.

## Scope

- Add typed dirty-worktree review evidence to managed resource leases.
- Keep absence valid for leases that do not require review.
- Attach review-required evidence only from the runtime-owned dirty worktree
  cleanup path.
- Reject manager-supplied review evidence so lease managers cannot forge
  adoption state.
- Preserve review evidence through terminal cleanup, persistent recovery, and
  lease merge paths.
- Project review evidence through gateway cockpit state and operator event
  presentation.
- Update roadmap state after verification.

## Out Of Scope

- Auto-adopting dirty worktrees into the parent checkout.
- Capturing raw `git status` or diff content in the lifecycle contract.
- Adding mutation commands for approve/reject/adopt.
- Reworking Slice 6 handoff, review, and adoption flows.

## Affected Files

- `packages/core/src/agents/managed-invocation/index.ts`
- `packages/core/tests/managed-agent/invocation-contracts.test.ts`
- `packages/runtime/src/agents/managed-invocation/index.ts`
- `packages/runtime/tests/managed-agent/invocation-service.test.ts`
- `packages/gateway-contracts/src/frames.ts`
- `packages/gateway-contracts/src/index.ts`
- `packages/gateway-contracts/src/operator-cockpit-projection.ts`
- `packages/gateway-contracts/src/operator-event-presentation.ts`
- `packages/gateway-contracts/tests/operator-cockpit-projection.test.ts`
- `packages/gateway-contracts/tests/operator-event-presentation.test.ts`
- `docs/roadmap/01-background-parallel-agent-surface.md`
- `docs/roadmap/README.md`

## TDD Targets

1. Core preserves and validates `worktreeReview` evidence on terminal resource
   leases.
2. Runtime marks dirty isolated worktree preservation as `worktreeReview:
   required`.
3. Runtime rejects manager-injected `worktreeReview` evidence.
4. Persisted restart recovery keeps dirty-worktree review evidence in recovered
   records and recovery manifests.
5. Gateway cockpit and operator event projections expose the typed review
   evidence without URI parsing.

## Verification

```bash
bun run --cwd packages/core test -- tests/managed-agent/invocation-contracts.test.ts
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts
bun run --cwd packages/gateway-contracts test -- tests/operator-cockpit-projection.test.ts tests/operator-event-presentation.test.ts
bun run typecheck
bun run --filter @kilnai/core test
bun run --filter @kilnai/gateway-contracts test
bun run --filter @kilnai/runtime test
bun run --filter "*" build
git diff --check
```

## Risks

- `worktreeReview` must remain runtime-owned; lease managers and adapters cannot
  forge adoption state.
- Review evidence must be typed, not inferred from diagnostic URI strings.
- Dirty preservation must remain fail-closed: no automatic cleanup, adoption, or
  parent checkout mutation.
