# Slice 7E - Stale Heartbeat Attention Parity

## Objective

Continue Slice 7 by projecting heartbeat-recovered managed children as a
distinct `stale` attention state instead of collapsing them into generic
failure across operator surfaces.

## Decision

Keep lifecycle interpretation in `@kilnai/gateway-contracts` shared cockpit
view-state. Runtime already emits `lifecycleState: "stale"` with terminal
evidence; surfaces must consume that shared attention state and only adapt
presentation labels or severity styling locally.

## Non-Goals

- Do not change runtime stale recovery, heartbeat thresholds, or lease cleanup.
- Do not add surface-local stale inference.
- Do not rename existing lifecycle states or compatibility-map old values.
- Do not change cancellation or timeout semantics.

## Surface Map

- Shared contract:
  - `packages/gateway-contracts/src/operator-cockpit-view-state.ts`
  - `packages/gateway-contracts/tests/operator-cockpit-view-state.test.ts`
- Presentation consumers:
  - `packages/tui/src/managed-agent-cockpit.ts`
  - `packages/gui/src/components/managed-agent-cockpit-panel.tsx`
  - `packages/gui/tests/managed-agent-cockpit-panel.test.tsx`
- Roadmap:
  - `docs/roadmap/01-background-parallel-agent-surface.md`

## Expected Behavior

- Managed children with `status: "failed"` and `lifecycleState: "stale"`
  project as `attentionState: "stale"`.
- Stale children count as attention, not active work.
- TUI renders stale children with the same alert prefix as other terminal
  attention states while preserving the canonical `stale` label.
- GUI renders a stable `Stale heartbeat` label and destructive severity for
  stale children.

## Verification

- Add failing shared view-state test first.
- Run `bun run --filter @kilnai/gateway-contracts test -- tests/operator-cockpit-view-state.test.ts`.
- Run `bun run --cwd packages/gui test -- tests/managed-agent-cockpit-panel.test.tsx`.
- Run `bun run typecheck`.
- Run `bun run build`.
- Update the roadmap after code verification.
