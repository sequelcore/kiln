# Native Cockpit Projection Contract Plan

Status: active.

## Objective

Start `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`
without prematurely building a cockpit UI, scheduler, Rust module, network
attach loop, cancellation dispatch, or packaging track. Deliver Phase 0/1
contract foundations and the first Phase 2 read-only projection substrates over
canonical gateway events.

## Scout Summary

- Roadmap 05 is a validation track, not a commitment to replace `@kilnai/gui`.
- The owning package for contract-only native cockpit work is `@kilnai/native`.
- Existing canonical event sources already include goal, work-item,
  managed-invocation, provider, authority, cost, and tool-call evidence in
  runtime/core/gateway contracts.
- GUI already has work-item and session-store projections. The current baseline
  now measures the shared operator-event presentation path; a browser-rendering
  benchmark remains future work.
- Shared GUI projection baselines, gateway-mediated cancellation target
  semantics, shared read-only cockpit projections, and the native wrapper over
  that projection now exist; browser-rendering benchmarks, gateway attach loops,
  native UI, Rust acceleration, and cancellation dispatch remain out of scope
  for the next read-only prototype step.
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

### Slice 5 - Shared Read-Only Cockpit Projection

Files:

- `packages/gateway-contracts/src/operator-cockpit-projection.ts`
- `packages/gateway-contracts/src/index.ts`
- `packages/gateway-contracts/tests/operator-cockpit-projection.test.ts`
- `packages/gateway-contracts/README.md`
- `docs/architecture/native-cockpit-projection.md`
- `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`
- `docs/roadmap/README.md`
- `docs/changelog.md`
- `docs/plan.md`

Deliverables:

- Define `projectOperatorCockpitReadOnlyView` as a surface-neutral projection
  over canonical `OperatorSessionEvent` records.
- Preserve explicit attach targets for local, remote, simulated remote, team,
  cloud, and CI instances.
- Emit read-only instance, session, timeline, managed-invocation, tool-call,
  and cost/provider summaries.
- Fail closed when an event references an unattached instance.
- Keep gateway attach networking, native UI rendering, cancellation dispatch,
  and Rust/WASM/sidecar acceleration out of scope.

### Slice 6 - Native Read-Only Cockpit Projection Wrapper

Files:

- `packages/native/src/shared/native-cockpit-contract.ts`
- `packages/native/src/shared/native-surface.ts`
- `packages/native/tests/native-boundary.test.ts`
- `docs/architecture/native-cockpit-projection.md`
- `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`
- `docs/roadmap/README.md`
- `docs/changelog.md`
- `docs/plan.md`

Deliverables:

- Define `createNativeCockpitReadOnlyProjection` as a thin native wrapper over
  `projectOperatorCockpitReadOnlyView`.
- Add native surface metadata: `surfaceId`, `surfaceMode`,
  `runtimeBoundary: gateway-contracts`, and `mutationDispatch: disabled`.
- Reuse shared gateway projection output without copying session, timeline,
  invocation, tool, cost, provider, authority, or target derivation.
- Preserve fail-closed attach target validation from the shared contract.
- Update native capability wording without claiming a rendered cockpit.

## Verification

- Passed `bun run --cwd packages/native test`.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-surface-capability`.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-target operator-cockpit-benchmark`.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-projection`.
- Passed `bun run --filter @kilnai/gateway-contracts typecheck`.
- Passed `bun run --filter @kilnai/gateway-contracts build`.
- Passed `bun run --cwd packages/native test` after Slice 6.
- Passed `bun run --cwd packages/native typecheck`.
- Passed `bun run --cwd packages/native build`.
- Passed `bun run typecheck`.
- Passed `bun run test`.
- Passed `bun run build`.
- Passed `git diff --check`.
