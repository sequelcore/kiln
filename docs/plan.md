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
  that projection/action-intent contract now exist; browser-rendering
  benchmarks, gateway attach loops, native UI, Rust acceleration, and
  cancellation dispatch remain out of scope for the next read-only prototype
  step.
- The next benchmark slice belongs in `@kilnai/gateway-contracts`: measure the
  shared read-only projection itself over explicit attach targets before any
  surface-specific rendering or Rust/WASM/sidecar candidate is considered.
- The next attach slice belongs in `@kilnai/gateway-contracts` and
  `@kilnai/native`: validate read-only local/simulated-remote gateway attach
  targets and record planned connection intent without opening sockets.
- The next projection slice belongs in `@kilnai/gateway-contracts`: surface
  target-aware resource links from canonical tool events so native/GUI/TUI/SDK
  resource affordances do not parse raw tool payloads.
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

### Slice 7 - Read-Only Cockpit Action Intents

Files:

- `packages/gateway-contracts/src/operator-cockpit-target.ts`
- `packages/gateway-contracts/src/index.ts`
- `packages/gateway-contracts/tests/operator-cockpit-target.test.ts`
- `packages/gateway-contracts/README.md`
- `packages/native/src/shared/native-cockpit-contract.ts`
- `packages/native/tests/native-boundary.test.ts`
- `docs/architecture/native-cockpit-projection.md`
- `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`
- `docs/roadmap/README.md`
- `docs/changelog.md`
- `docs/plan.md`

Deliverables:

- Define shared read-only cockpit action intents for inspect, replay,
  focus-session, filter-events, and open-resource actions.
- Preserve explicit target validation through existing cockpit action admission.
- Return `dispatch: not-dispatched`; do not perform gateway, IPC, WebSocket, or
  native process mutation.
- Reject cancellation in read-only cockpit mode.
- Add a native wrapper with `surfaceId`, `runtimeBoundary: gateway-contracts`,
  and `mutationDispatch: disabled`.

### Slice 8 - Shared Read-Only Projection Benchmark Baseline

Files:

- `packages/gateway-contracts/src/operator-cockpit-benchmark.ts`
- `packages/gateway-contracts/src/index.ts`
- `packages/gateway-contracts/tests/operator-cockpit-benchmark.test.ts`
- `packages/gateway-contracts/README.md`
- `docs/architecture/native-cockpit-projection.md`
- `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`
- `docs/roadmap/README.md`
- `docs/changelog.md`
- `docs/plan.md`

Deliverables:

- Define `measureOperatorCockpitReadOnlyProjectionBaseline` over
  `projectOperatorCockpitReadOnlyView`.
- Require explicit attach targets and preserve fail-closed projection behavior.
- Report projection-level counts for instances, sessions, timeline entries,
  managed invocations, tool summaries, total cost, provider routes, and
  first/last target summaries.
- Keep browser rendering, native UI rendering, gateway networking,
  cancellation dispatch, and Rust/WASM/sidecar acceleration out of scope.

### Slice 9 - Read-Only Gateway Attach Plan

Files:

- `packages/gateway-contracts/src/operator-cockpit-projection.ts`
- `packages/gateway-contracts/src/index.ts`
- `packages/gateway-contracts/tests/operator-cockpit-projection.test.ts`
- `packages/gateway-contracts/README.md`
- `packages/native/src/shared/native-cockpit-contract.ts`
- `packages/native/src/shared/native-surface.ts`
- `packages/native/tests/native-boundary.test.ts`
- `docs/architecture/native-cockpit-projection.md`
- `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`
- `docs/roadmap/README.md`
- `docs/changelog.md`
- `docs/plan.md`

Deliverables:

- Define `createOperatorCockpitReadOnlyAttachPlan` over explicit attach
  targets.
- Validate target kind, identity, label, duplicate targets, and HTTP(S)
  gateway URLs before a read-only cockpit target is attach-planned.
- Classify local targets as Operator Gateway, simulated remote targets as
  simulated App Gateway, and remaining remote/team/cloud/CI targets as
  App Gateway.
- Define `createNativeCockpitReadOnlyAttachPlan` as a native metadata wrapper
  with `networkAttach: not-started` and `mutationDispatch: disabled`.
- Keep live gateway networking, UI rendering, cancellation dispatch, and
  Rust/WASM/sidecar acceleration out of scope.

### Slice 10 - Target-Aware Resource-Link Projection

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

- Project shared operator-event resource links into cockpit timeline entries
  and tool summaries.
- Add `resourceLinkCount` to instance, session, and tool summaries.
- Encode `resourceUri` into each resource-link target so open-resource
  affordances can reuse shared target validation.
- Keep resource-opening dispatch, live gateway networking, UI rendering, and
  Rust/WASM/sidecar acceleration out of scope.

## Verification

- Passed `bun run --cwd packages/native test`.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-surface-capability`.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-target operator-cockpit-benchmark`.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-target` after Slice 7.
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
- Re-passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-benchmark` after Slice 8.
- Re-passed `bun run --filter @kilnai/gateway-contracts typecheck` after Slice 8.
- Re-passed `bun run --filter @kilnai/gateway-contracts build` after Slice 8.
- Re-passed `bun run --cwd packages/native test` after Slice 8.
- Re-passed `bun run --cwd packages/native typecheck` after Slice 8.
- Re-passed `bun run --cwd packages/native build` after Slice 8.
- Re-passed `bun run typecheck` after Slice 8.
- Re-passed `bun run test` after Slice 8.
- Re-passed `bun run build` after Slice 8.
- Re-passed `git diff --check` after Slice 8.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-projection` after Slice 9.
- Passed `bun run --cwd packages/native test` after Slice 9.
- Passed `bun run --filter @kilnai/gateway-contracts typecheck` after Slice 9.
- Passed `bun run --filter @kilnai/gateway-contracts build` after Slice 9.
- Passed `bun run --cwd packages/native typecheck` after Slice 9.
- Passed `bun run --cwd packages/native build` after Slice 9.
- Passed `bun run typecheck` after Slice 9.
- Passed `bun run test` after Slice 9.
- Passed `bun run build` after Slice 9.
- Passed `git diff --check` after Slice 9.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-projection` after Slice 10.
- Passed `bun run --filter @kilnai/gateway-contracts typecheck` after Slice 10.
- Passed `bun run --filter @kilnai/gateway-contracts build` after Slice 10.
- Passed `bun run --cwd packages/native test` after Slice 10.
- Passed `bun run --cwd packages/native typecheck` after Slice 10.
- Passed `bun run --cwd packages/native build` after Slice 10.
- Passed `bun run typecheck` after Slice 10.
- Passed `bun run test` after Slice 10.
- Passed `bun run build` after Slice 10.
- Passed `git diff --check` after Slice 10.
