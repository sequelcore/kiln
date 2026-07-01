# Roadmap 08 Slice 1.3 Plan

## Objective

Preserve canonical lifecycle attribution evidence across GUI and TUI operator
surfaces without changing provider requests, routing, context admission,
billing totals, benchmark schemas, or task outcomes.

## Non-Goals

- No new lifecycle allocation semantics.
- No provider adapter changes.
- No benchmark baseline schema changes.
- No context governor or admission policy changes.
- No UI-owned efficiency calculations or cost accumulation.

## Evidence Inputs

- Commit `094c9877` introduced canonical
  `lifecycle_attribution_recorded` emission and shared operator presentation.
- `packages/gui/src/lib/ws-client.ts` independently validates inbound canonical
  event kinds and currently omits lifecycle attribution.
- `packages/gui/src/lib/session-store.ts` owns GUI activity timeline projection
  and must not treat attribution evidence as another billing update.
- `packages/tui/src/gateway-session.ts` owns canonical event projection into
  terminal activities.

## Surface Map

- `packages/gui/src/lib/ws-client.ts`
  - Admit the canonical event through GUI websocket validation.
- `packages/gui/src/lib/session-store.ts`
  - Append shared lifecycle attribution presentation to live and replayed
    activity timelines.
- `packages/runtime/src/gateway/live-lifecycle-attribution.ts`
  - Project live cost event identity through the canonical lifecycle ledger
    and summary functions.
- `packages/runtime/src/gateway/gui-gateway.ts`
  - Emit parented lifecycle attribution immediately after each live GUI cost
    event.
- `packages/runtime/src/gateway/tui-gateway.ts`
  - Emit parented lifecycle attribution immediately after each live TUI cost
    event.
- `packages/tui/src/gateway-session.ts`
  - Map lifecycle attribution to a canonical terminal activity with session and
    turn identity preserved.

## Atomic Implementation

### 1.3.1 Failing Surface Tests

Files:

- `packages/gui/tests/ws-client.test.ts`
- `packages/gui/tests/session-store.test.ts`
- `packages/tui/tests/gateway-session.test.ts`

Work:

- Prove GUI websocket validation accepts the canonical event.
- Prove GUI records shared presentation details without exposing raw ledger
  records or incrementing cost/token totals.
- Prove TUI emits activity evidence with canonical session event identity.

### 1.3.2 GUI Preservation

Files:

- `packages/gui/src/lib/ws-client.ts`
- `packages/gui/src/lib/session-store.ts`

Work:

- Add the event kind to the inbound schema.
- Reuse `presentOperatorEventPayload`; do not duplicate formatting logic.
- Append an activity timeline entry without calling the cost accumulator.

### 1.3.3 TUI Preservation

File:

- `packages/tui/src/gateway-session.ts`

Work:

- Reuse `presentOperatorSessionEvent`.
- Emit activity-panel evidence with compact presentation text, surfaces, and
  the original canonical event.

### 1.3.4 Live Gateway Attribution

Files:

- `packages/runtime/src/gateway/live-lifecycle-attribution.ts`
- `packages/runtime/src/gateway/gui-gateway.ts`
- `packages/runtime/src/gateway/tui-gateway.ts`
- `packages/runtime/tests/gateway/live-lifecycle-attribution.test.ts`
- `packages/runtime/tests/gateway/gui-gateway.test.ts`
- `packages/runtime/tests/gateway/tui-gateway-clear.test.ts`

Work:

- Reuse canonical cost-to-ledger projection and lifecycle summary functions.
- Preserve the live cost event as the attribution parent and ledger source.
- Emit paired websocket frames in deterministic sequence on both gateways.

## Verification Gates

Run in order:

```bash
bun run --filter @kilnai/gui test tests/ws-client.test.ts tests/session-store.test.ts tests/timeline-visibility.test.ts
bun run --filter @kilnai/tui test tests/gateway-session.test.ts
bun run --filter @kilnai/gateway-contracts test tests/operator-event-presentation.test.ts
bun run --filter @kilnai/runtime test tests/gateway/live-lifecycle-attribution.test.ts
bun run --filter @kilnai/runtime test tests/gateway/gui-gateway.test.ts
bun run --filter @kilnai/runtime test tests/gateway/tui-gateway-clear.test.ts
node_modules\.bin\tsc.exe -b packages/gateway-contracts packages/tools packages/core packages/runtime packages/sdk packages/cli packages/tui packages/native
node_modules\.bin\tsc.exe -p packages/gui/tsconfig.json --noEmit
```

## Risks

- GUI's local event-kind schema can drift from canonical gateway contracts.
- Lifecycle attribution must remain evidence only; counting it as another
  `cost_update` would double session totals.
- GUI and TUI must reuse shared presentation contracts so summaries do not
  diverge across surfaces.
- Live and persisted event paths must preserve the same attribution parentage
  and totals without duplicating billing state.
