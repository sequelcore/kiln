# Native Cockpit Projection Contract Plan

Status: active.

## Objective

Start `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`
without prematurely building a cockpit UI, scheduler, Rust module, or
packaging track. Deliver Phase 0/1 contract foundations for precondition review,
explicit targets, benchmark fixtures, and Rust boundaries.

## Scout Summary

- Roadmap 05 is a validation track, not a commitment to replace `@kilnai/gui`.
- The owning package for contract-only native cockpit work is `@kilnai/native`.
- Existing canonical event sources already include goal, work-item,
  managed-invocation, provider, authority, cost, and tool-call evidence in
  runtime/core/gateway contracts.
- GUI already has work-item and session-store projections. The current baseline
  now measures the shared operator-event presentation path; a browser-rendering
  benchmark remains future work.
- Shared GUI projection baselines and gateway-mediated cancellation target
  semantics now exist; browser-rendering benchmarks and cancellation dispatch
  remain out of scope for the next read-only prototype step.
- Existing unrelated dirty files remain out of scope:
  `.kiln/kiln.yaml` and `packages/gui/tests/memory-lattice-panel.test.tsx`.

## Implementation Slices

### Slice 1 - Native Cockpit Contract Tests

Files:

- `packages/native/tests/native-boundary.test.ts`

Deliverables:

- Add failing tests for precondition review, explicit target/action admission,
  and benchmark fixture thresholds.

### Slice 2 - Native Cockpit Shared Contract

Files:

- `packages/native/src/shared/native-cockpit-contract.ts`
- `packages/native/src/shared/native-surface.ts`

Deliverables:

- Define `createNativeCockpitPreconditionReview`.
- Define `nativeCockpitActionAllowed`.
- Define `NATIVE_COCKPIT_BENCHMARK_FIXTURES`.
- Advertise `native-cockpit-contract` as a native capability without claiming a
  prototype.

### Slice 3 - Canonical Docs

Files:

- `docs/architecture/native-cockpit-projection.md`
- `docs/architecture/README.md`
- `docs/architecture/operator-surfaces.md`
- `docs/roadmap/README.md`
- `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`
- `docs/changelog.md`
- `docs/plan.md`

Deliverables:

- Mark roadmap 05 active in contract-only mode.
- Record the current blockers for read-only prototype work.
- Document the native cockpit target/action/benchmark/Rust boundaries.

### Slice 4 - Shared Benchmark And Target Contracts

Files:

- `packages/gateway-contracts/src/operator-cockpit-benchmark.ts`
- `packages/gateway-contracts/src/operator-cockpit-target.ts`
- `packages/gateway-contracts/src/index.ts`
- `packages/gateway-contracts/tests/operator-cockpit-benchmark.test.ts`
- `packages/gateway-contracts/tests/operator-cockpit-target.test.ts`
- `packages/native/src/shared/native-cockpit-contract.ts`
- `packages/native/tests/native-boundary.test.ts`

Deliverables:

- Define deterministic synthetic cockpit event fixtures with explicit
  instance/session/managed-invocation targets.
- Define shared GUI projection baseline measurement over the same
  operator-event presentation path GUI consumes.
- Define gateway-mediated cancellation request validation without dispatch.
- Move action target semantics to `@kilnai/gateway-contracts` and keep native as
  a consumer.

## Verification

- Passed `bun run --cwd packages/native test`.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-surface-capability`.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-target operator-cockpit-benchmark`.
- Passed `bun run --filter @kilnai/gateway-contracts typecheck`.
- Passed `bun run --filter @kilnai/gateway-contracts build`.
- Passed `bun run --cwd packages/native typecheck`.
- Passed `bun run --cwd packages/native build`.
- Passed `bun run typecheck`.
- Passed `bun run test`.
- Passed `bun run build`.
- Passed `git diff --check`.
