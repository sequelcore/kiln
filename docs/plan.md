# Slice 7B - Timed-Out Child Surface Parity

## Objective

Continue Slice 7 by preserving timed-out managed children as a first-class
attention state across the shared cockpit view-state and managed-agent
surfaces.

## Decision

Derive timeout attention from the canonical managed invocation lifecycle in
`@kilnai/gateway-contracts`. Surface packages consume the shared
`attentionState`; they must not infer timeout state from local strings or add
surface-specific fallback logic.

## Non-Goals

- Do not change adapter timeout behavior or runtime cancellation semantics.
- Do not introduce a new lifecycle store or managed-agent control channel.
- Do not add compatibility aliases or normalize non-canonical lifecycle
  spellings.
- Do not change unrelated CLI managed-agent output.

## Surface Map

- Shared view-state:
  - `packages/gateway-contracts/src/operator-cockpit-view-state.ts`
  - `packages/gateway-contracts/tests/operator-cockpit-view-state.test.ts`
- TUI projection and formatting:
  - `packages/tui/src/managed-agent-cockpit.ts`
  - `packages/tui/tests/managed-agent-cockpit.test.ts`
- GUI managed-agent panel:
  - `packages/gui/src/components/managed-agent-cockpit-panel.tsx`
  - `packages/gui/tests/managed-agent-cockpit-panel.test.tsx`
- Native projection and renderer:
  - `packages/native/tests/managed-agent-cockpit-panel.test.tsx`
- Roadmap:
  - `docs/roadmap/01-background-parallel-agent-surface.md`

## Expected Behavior

- A failed managed invocation with lifecycle `timed_out` is projected as
  `attentionState: "timed_out"`.
- Timed-out children count toward managed-agent attention.
- Timed-out children keep cancellation unavailable in read-only projections.
- TUI, GUI, and native surfaces render timeout attention distinctly while
  retaining the canonical lifecycle detail and evidence resources.

## Verification

- Add failing tests first for shared view-state timeout attention.
- Add focused TUI, GUI, and native surface parity tests.
- Run `bun run --cwd packages/gateway-contracts test -- tests/operator-cockpit-view-state.test.ts`.
- Run `bun run --cwd packages/tui test -- tests/managed-agent-cockpit.test.ts`.
- Run `bun run --cwd packages/gui test -- tests/managed-agent-cockpit-panel.test.tsx`.
- Run `bun run --cwd packages/native test -- tests/managed-agent-cockpit-panel.test.tsx`.
- Run `bun run typecheck`.
- Run `bun run build`.
- Update the roadmap after code verification.
