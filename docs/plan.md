# Slice 7F - Native Stale Heartbeat Presentation Parity

## Objective

Continue Slice 7 by bringing the native managed-agent cockpit presentation in
line with the shared stale heartbeat attention state added in Slice 7E.

## Decision

Keep lifecycle interpretation in `@kilnai/gateway-contracts`. Native should
consume `item.attentionState === "stale"` from the shared view-state and render
a stable operator label while preserving the canonical raw state on
`data-attention`.

## Non-Goals

- Do not add native-local lifecycle inference.
- Do not change gateway, runtime, CLI, TUI, or GUI behavior.
- Do not change cancellation or heartbeat recovery semantics.
- Do not introduce compatibility aliases for older attention states.

## Surface Map

- Native renderer:
  - `packages/native/src/renderer/managed-agent-cockpit-panel.tsx`
  - `packages/native/tests/managed-agent-cockpit-panel.test.tsx`
- Roadmap:
  - `docs/roadmap/01-background-parallel-agent-surface.md`

## Expected Behavior

- Native renders stale heartbeat children with `data-attention="stale"`.
- Native shows a human stable label, `Stale heartbeat`, instead of only the raw
  state token.
- Native preserves canonical `status: "failed"`, `lifecycleState: "stale"`,
  and heartbeat evidence resources from shared projection.

## Verification

- Add failing native renderer test first.
- Run `bun run --cwd packages/native test -- tests/managed-agent-cockpit-panel.test.tsx`.
- Run `bun run typecheck`.
- Run `bun run build`.
- Run `bun run test`.
- Update the roadmap after code verification.
