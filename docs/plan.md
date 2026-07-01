# Roadmap 08 Slice 1.2 Plan

## Objective

Emit normalized lifecycle attribution from runtime cost events without changing
provider requests, routing, context admission, benchmark schemas, or task
outcomes.

## Non-Goals

- No fine-grained source allocation beyond explicit `unknown` records.
- No provider adapter changes.
- No benchmark baseline schema changes.
- No context governor or admission policy changes.
- No UI-owned efficiency calculations.

## Evidence Inputs

- `docs/roadmap/08-verified-efficiency-control-plane.md:247` requires Slice 1
  lifecycle attribution ledger work.
- `docs/roadmap/08-verified-efficiency-control-plane.md:255` requires runtime
  emission of normalized usage and lifecycle events.
- `packages/core/src/events/session-lifecycle-attribution.ts` owns the
  provider-neutral lifecycle attribution contracts and pure projection helper.
- `packages/runtime/src/session/runtime-session-event-ledger.ts` is the
  runtime boundary that translates runtime `cost_update` events into canonical
  session events.
- `packages/cli/src/wrapper/session-store.ts` validates persisted canonical
  transcript event kinds.
- `packages/gateway-contracts/src/frames.ts` defines operator-visible session
  event kinds for GUI/TUI gateway frames.

## Surface Map

- `packages/core/src/events/session-event.ts`
  - Add a canonical `lifecycle_attribution_recorded` event carrying the
    attribution ledger and summary.
- `packages/runtime/src/session/runtime-session-event-ledger.ts`
  - Emit the lifecycle attribution event immediately after `cost_updated`,
    parented to the source cost event.
- `packages/cli/src/wrapper/session-store.ts`
  - Preserve the new event through transcript persistence validation.
- `packages/gateway-contracts/src/frames.ts`
  - Admit the new event kind across operator session event frames.
- `packages/gateway-contracts/src/operator-event-presentation.ts`
  - Present the lifecycle attribution summary without exposing raw ledger JSON
    inline.

## Atomic Implementation

### 1.2.1 Failing Runtime Test

File:

- `packages/runtime/tests/session/runtime-session-lifecycle-attribution-events.test.ts`

Work:

- Prove a runtime `cost_update` produces both `cost_updated` and
  `lifecycle_attribution_recorded`.
- Prove the attribution event is parented to the cost event.
- Prove provider usage is represented as explicit lifecycle records and
  summarized without changing provider token totals.

### 1.2.2 Canonical Event Contract

Files:

- `packages/core/src/events/session-event.ts`
- `packages/core/src/events/index.ts`

Work:

- Add `lifecycle_attribution_recorded` to the canonical event kind union and
  event map.
- Export the canonical event type.

### 1.2.3 Runtime Emission

File:

- `packages/runtime/src/session/runtime-session-event-ledger.ts`

Work:

- Build the existing `cost_updated` event as the authoritative provider usage
  source.
- Project it through `projectCostUpdatedEventToLifecycleLedger`.
- Emit `lifecycle_attribution_recorded` with `parentEventId` set to the source
  cost event.

### 1.2.4 Surface Preservation

Files:

- `packages/cli/src/wrapper/session-store.ts`
- `packages/gateway-contracts/src/frames.ts`
- `packages/gateway-contracts/src/operator-event-presentation.ts`
- `packages/gateway-contracts/tests/operator-event-presentation.test.ts`
- `packages/runtime/tests/gateway/message-pipeline.test.ts`

Work:

- Admit the event in transcript persistence and gateway frame contracts.
- Present attribution as activity-panel evidence, not conversation prose.
- Update runtime event-order tests to assert the new evidence explicitly.

## Verification Gates

Run in order:

```bash
bun run --filter @kilnai/core test tests/events/session-lifecycle-attribution.test.ts
bun run --filter @kilnai/runtime test tests/session/runtime-session-lifecycle-attribution-events.test.ts tests/gateway/message-pipeline.test.ts
bun run --filter @kilnai/gateway-contracts test tests/operator-event-presentation.test.ts tests/operator-cockpit-projection.test.ts
node_modules\.bin\tsc.exe -b packages/gateway-contracts packages/tools packages/core packages/runtime packages/sdk packages/cli packages/tui packages/native
node_modules\.bin\tsc.exe -p packages/widget/tsconfig.json --noEmit
node_modules\.bin\tsc.exe -p packages/studio/tsconfig.json --noEmit
node_modules\.bin\tsc.exe -p packages/gui/tsconfig.json --noEmit
node_modules\.bin\tsc.exe -p scripts/tsconfig.json --noEmit
```

## Known External Test Gap

`bun run --filter @kilnai/cli test tests/commands/tui-session-persistence.test.ts`
currently fails in the managed-invocation test harness before lifecycle
attribution assertions run:

- `TypeError: Cannot read properties of undefined (reading 'invocationService')`
- failing helper: `withManagedInvocationService` in
  `packages/cli/tests/commands/tui-session-persistence.test.ts:193`

This slice still updates CLI transcript allowlisting so the new event is not
silently dropped. The unrelated managed-invocation harness failure must be
handled separately before using that suite as a lifecycle gate.

## Risks

- Current runtime allocation is intentionally `unknown`; later slices must add
  source allocations from context, tool, worker, artifact, and verification
  boundaries.
- Gateway/operator surfaces must remain projections of canonical ledger data,
  not independent efficiency calculators.
- Event allowlists are manually maintained and can drift when future canonical
  events are added.
