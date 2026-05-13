# Roadmap 06 Browser Session State Plan

Objective: implement the next Roadmap 06 slice after the research decision:
promote the existing private interactive browser snapshot into a shared browser
session state projection. This creates the contract needed for future live
viewport streaming without adding a stream transport yet.

Non-goals:

- Do not implement continuous viewport streaming.
- Do not add operator takeover controls in this slice.
- Do not introduce a provider-specific remote browser SDK.
- Do not remove existing `interactive_use_updated` compatibility until all
  consumers are migrated.

Surface map:

- `packages/gateway-contracts/src/frames.ts` currently defines
  `GuiInteractiveUseSnapshot` directly in the GUI frame contract.
- `packages/runtime/src/gateway/interactive-use-frame.ts` projects interactive
  tool metadata into `interactive_use_updated` snapshot frames.
- `packages/gui/src/lib/ws-client.ts` validates incoming interactive snapshot
  frames with a local zod schema.
- `packages/gui/src/lib/session-store.ts` stores `interactiveUseSnapshot` and
  reconstructs it from persisted canonical tool events.
- `packages/gui/src/components/operator-surface-tabs.tsx` renders the Browser
  tab directly from `GuiInteractiveUseSnapshot`.
- `packages/tui/tests/gateway-session.test.ts` verifies terminal degradation
  through shared session-event presentation.

Implementation slices:

1. Gateway contract:
   Add shared browser session state types with stream state, ownership, view
   mode, latest capture resource link, and status metadata. Keep
   `GuiInteractiveUseSnapshot` as a compatibility alias or adapter shape.

2. Runtime projection:
   Extend `projectInteractiveUseFrameFromToolResult` so browser observations
   emit `browserSession` state in the `interactive_use_updated` frame while
   preserving the existing snapshot fields.

3. GUI state:
   Store and replay browser session state alongside the compatibility
   interactive snapshot. Render the Browser tab from browser session state and
   use the current screenshot snapshot fallback.

4. Terminal degradation:
   Ensure browser session state is visible as deterministic text/resource-link
   evidence through existing tool-result presentation, without requiring live
   media.

Test-first sequence:

1. Add failing gateway-contract frame validation tests for browser session
   state in `interactive_use_updated`.
2. Add failing runtime projection tests proving browser tool observations
   produce browser session state with stream status `unavailable`, ownership
   `agent`, view mode `snapshot`, and latest capture URI.
3. Add failing GUI session-store tests proving live and persisted browser
   session state is stored and replayed.
4. Add failing GUI Browser tab tests proving the tab renders session state,
   latest capture links, and snapshot fallback.
5. Add or extend TUI tests only if existing shared tool presentation does not
   expose browser state/resource links clearly.

Verification gates:

- `bun test packages/gateway-contracts/tests/browser-session-state.test.ts`
- `bun test packages/runtime/tests/gateway/interactive-use-frame.test.ts`
- `bun run --filter @kilnai/gui test -- tests/session-store.test.ts tests/operator-surface-tabs.test.tsx tests/ws-client.test.ts`
- `bun run --filter @kilnai/tui test -- tests/gateway-session.test.ts`
- `bun run typecheck`
- GUI browser smoke if the Browser tab UI changes materially.

Residual risks:

- This slice models stream lifecycle but does not prove a real stream
  transport.
- Ownership state initially derives from tool status and is not yet an
  auditable takeover lock.
