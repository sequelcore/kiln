## Slice 7H - Failed Child Attention Parity

## Objective

Continue Slice 7 by proving ordinary managed-child adapter failures remain a
distinct operator attention state across shared cockpit view-state and the
existing operator surfaces.

## Decision

Treat a terminal `agent_invocation_failed` event with `lifecycleState:
"failed"` as failed-child attention unless stronger review states apply. Do
not collapse it into timeout, stale heartbeat, cancellation, worktree review,
or worktree conflict. Evidence remains pointer-only and replayable through the
shared managed-agent resource list.

## Non-Goals

- Do not add a new lifecycle state or attention state.
- Do not change timeout, stale, cancellation, worktree review, or conflict
  precedence.
- Do not expose raw adapter logs or filesystem content.
- Do not add legacy aliases for older event shapes.

## Surface Map

- Shared operator cockpit view-state:
  - `packages/gateway-contracts/src/operator-cockpit-view-state.ts`
  - `packages/gateway-contracts/tests/operator-cockpit-view-state.test.ts`
- CLI managed-agent command:
  - `packages/cli/src/commands/managed-agent.ts`
  - `packages/cli/src/commands/managed-agent.test.ts`
- TUI managed-agent cockpit:
  - `packages/tui/src/managed-agent-cockpit.ts`
  - `packages/tui/tests/managed-agent-cockpit.test.ts`
- Native managed-agent cockpit panel:
  - `packages/native/src/renderer/managed-agent-cockpit-panel.tsx`
  - `packages/native/tests/managed-agent-cockpit-panel.test.tsx`
- GUI managed-agent cockpit panel:
  - `packages/gui/src/components/managed-agent-cockpit-panel.tsx`
  - `packages/gui/tests/managed-agent-cockpit-panel.test.tsx`
- Roadmap:
  - `docs/roadmap/01-background-parallel-agent-surface.md`

## Expected Behavior

- Shared view-state projects ordinary adapter failure as `attentionState:
  "failed"`, `status: "failed"`, and `lifecycleState: "failed"`.
- Failed-child diagnostics and handoff pointers are de-duplicated and replayable
  in the shared resource list.
- Failed children are counted in attention, never active, and cancellation is
  unavailable.
- CLI, TUI, native, and GUI surfaces render the shared failed state without
  local fallback lifecycle logic.

## Verification

- Add failing focused tests first.
- Run `bun run --filter @kilnai/gateway-contracts test -- tests/operator-cockpit-view-state.test.ts`.
- Run `bun run --filter @kilnai/cli test -- src/commands/managed-agent.test.ts`.
- Run `bun run --filter @kilnai/tui test -- tests/managed-agent-cockpit.test.ts`.
- Run `bun run --filter @kilnai/native test -- tests/managed-agent-cockpit-panel.test.tsx`.
- Run `bun run --filter @kilnai/gui test -- tests/managed-agent-cockpit-panel.test.tsx`.
- Run `bun run typecheck`.
- Run `bun run build`.
- Run `bun run test`.
- Run `git diff --check`.
- Update the roadmap after code verification.
