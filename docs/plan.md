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
- GUI already has work-item and session-store projections that can become the
  future web baseline, but no dedicated GUI high-density benchmark exists yet.
- Read-only prototype work is blocked until baseline benchmarks and
  gateway-mediated cancellation target semantics are available.
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

## Verification

- Passed `bun run --cwd packages/native test`.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-surface-capability`.
- Passed `bun run --cwd packages/native typecheck`.
- Passed `bun run --cwd packages/native build`.
- Passed `bun run typecheck`.
- Passed `bun run test`.
- Passed `bun run build`.
- Passed `git diff --check`.
