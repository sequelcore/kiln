# Roadmap 08 Slice 1.1 Plan

## Objective

Add provider-neutral lifecycle attribution contracts in `@kilnai/core` so usage
can be attributed by lifecycle source without changing runtime behavior,
provider routing, context admission, or benchmark artifact schemas yet.

## Non-Goals

- No runtime session emission changes.
- No provider adapter changes.
- No benchmark artifact schema changes.
- No token estimation policy changes.
- No learned or behavior-changing efficiency policy.

## Evidence Inputs

- `docs/roadmap/08-verified-efficiency-control-plane.md:247` defines Slice 1
  as lifecycle attribution ledger work.
- `docs/roadmap/08-verified-efficiency-control-plane.md:180` requires
  attribution at request, turn, phase, worker, tool, and artifact boundaries.
- `docs/roadmap/08-verified-efficiency-control-plane.md:186` names lifecycle
  sources such as control instructions, procedural context, memory, tool schema,
  tool output, repository evidence, web evidence, verification, and final
  output.
- `packages/core/src/events/session-event.ts:95` already defines canonical
  provider token usage fields, including cache-read and cache-write tokens.
- `packages/core/src/events/session-event.ts:382` defines canonical
  `cost_updated` events with provider identity, usage, and cost.
- `packages/core/src/cost/cost-tracker.ts:104` treats provider-reported usage
  as the basis for cache-aware cost computation.
- `packages/core/src/eval/benchmark-baseline.ts:35` keeps baseline readiness
  metadata separate from detailed evidence artifacts.

## Surface Map

- `packages/core/src/events/session-event.ts` owns canonical session event
  contracts and is the correct source for provider usage projection.
- `packages/core/src/events/index.ts` exports event contracts to the rest of
  the monorepo and should expose the new attribution vocabulary.
- `packages/core/src/cost/cost-tracker.ts` remains the owner of cost
  calculation; attribution must not duplicate pricing policy.
- `packages/core/src/eval/benchmark-runner.ts` and
  `packages/core/src/eval/benchmark-baseline.ts` will consume attribution in a
  later integration slice, but this slice does not change them.

## Atomic Implementation

### 1.1.1 Failing Core Tests

File:

- `packages/core/tests/events/session-lifecycle-attribution.test.ts`

Work:

- Prove `CanonicalCostUpdatedEvent` can project into lifecycle attribution
  records while preserving session, turn, sequence, provider, model, request id,
  usage, and cost.
- Prove `input`, `output`, `cache_read`, and `cache_write` are distinct token
  classes.
- Prove absent source allocation produces explicit `unknown` records.
- Prove under-allocation produces an `unknown` remainder.
- Prove over-allocation fails fast.

### 1.1.2 Core Contracts And Pure Projection

File:

- `packages/core/src/events/session-lifecycle-attribution.ts`

Work:

- Add `SessionLifecycleSourceKind`.
- Add `SessionLifecycleTokenClass`.
- Add source allocations and ledger record types.
- Add `projectCostUpdatedEventToLifecycleLedger`.
- Add `summarizeLifecycleAttributionLedger`.

### 1.1.3 Exports

File:

- `packages/core/src/events/index.ts`

Work:

- Re-export the new contracts and helpers.

## Verification Gates

Run in order:

```bash
bun run --filter @kilnai/core test tests/events/session-lifecycle-attribution.test.ts
bun run --filter @kilnai/core test
bun run --filter @kilnai/core typecheck
node_modules\.bin\tsc.exe -b packages/gateway-contracts packages/tools packages/core packages/runtime packages/sdk packages/cli packages/tui packages/native
```

## Risks

- Lifecycle source names must stay aligned with roadmap 08.
- `cost_updated` is only the first projection source; future tool, context, and
  benchmark events must not be forced through this helper.
- Tool cache hits are not provider cache-read tokens.
- Unknown attribution must mean "not yet attributed", not zero usage.
