## Slice 7K - Worktree Conflict Presentation Parity

## Objective

Continue Slice 7 by projecting runtime-owned worktree conflict evidence through
the non-CLI managed-agent operator surfaces without creating surface-local
lifecycle or conflict state.

## Decision

Treat `resourceLease.worktreeConflict` as the single source of truth. Runtime
already creates governed denied-admission conflict evidence, the shared cockpit
view-state already exposes `worktreeConflictBlocked` and `worktreeConflict`,
and CLI already renders conflict details. Slice 7K only closes the remaining
TUI, GUI, and native presentation gap.

Parent interruption remains out of scope because it needs a separate lifecycle
decision. Dirty worktree review is already represented across runtime,
resource replay, and the current surfaces. Late-output suppression remains
owned by the runtime cancellation/stale paths unless transcript-boundary tests
expose a separate contract gap.

## Non-Goals

- Do not introduce a public `interrupted` lifecycle state.
- Do not change runtime conflict admission semantics.
- Do not add GUI, TUI, native, or CLI local conflict stores.
- Do not infer conflicts from strings, statuses, or URI shape.
- Do not add compatibility aliases for older conflict metadata.

## Surface Map

- Shared cockpit projection contract:
  - `packages/gateway-contracts/src/operator-cockpit-view-state.ts`
  - `packages/gateway-contracts/tests/operator-cockpit-view-state.test.ts`
- TUI managed-agent cockpit:
  - `packages/tui/src/managed-agent-cockpit.ts`
  - `packages/tui/tests/managed-agent-cockpit.test.ts`
- GUI managed-agent cockpit:
  - `packages/gui/src/components/managed-agent-cockpit-panel.tsx`
  - `packages/gui/tests/managed-agent-cockpit-panel.test.tsx`
- Native managed-agent cockpit:
  - `packages/native/src/renderer/managed-agent-cockpit-panel.tsx`
  - `packages/native/tests/managed-agent-cockpit-panel.test.tsx`
- Roadmap:
  - `docs/roadmap/01-background-parallel-agent-surface.md`

## Expected Behavior

- Shared cockpit conflict projection remains `attentionState: "needs_review"`
  with `dirtyWorkspaceReviewRequired: false`, `worktreeConflictBlocked: true`,
  and concrete conflict evidence.
- TUI managed-agent output renders conflict status, reason, conflicting
  invocation id, retry-after ids, and conflict resources/diagnostics from the
  shared view item.
- GUI managed-agent cards render conflict status, reason, requested/conflicting
  invocation ids, retry-after ids, and conflict resource links without showing
  dirty-worktree copy unless dirty review is also true.
- Native managed-agent cards render the same stable conflict details from the
  shared native projection without adding native-local state.

## Verification

- Add failing focused tests first.
- Run `bun run --filter @kilnai/tui test -- tests/managed-agent-cockpit.test.ts`.
- Run `bun run --filter @kilnai/gui test -- tests/managed-agent-cockpit-panel.test.tsx`.
- Run `bun run --filter @kilnai/native test -- tests/managed-agent-cockpit-panel.test.tsx`.
- Run `bun run --filter @kilnai/gateway-contracts test -- tests/operator-cockpit-view-state.test.ts`.
- Run `bun run typecheck`.
- Run `bun run build`.
- Run `bun run test`.
- Run `git diff --check`.
- Run code review after implementation and before commit.
- Update the roadmap after code verification.
