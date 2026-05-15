# Native Cockpit Projection Contract Plan

Status: complete on 2026-05-15 (defer/no-promotion closeout).

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

### Slice 11 - Read-Only Focus/Filter/Replay View State

Files:

- `packages/gateway-contracts/src/operator-cockpit-view-state.ts`
- `packages/gateway-contracts/src/operator-cockpit-projection.ts`
- `packages/gateway-contracts/src/operator-cockpit-target.ts`
- `packages/gateway-contracts/src/index.ts`
- `packages/gateway-contracts/tests/operator-cockpit-view-state.test.ts`
- `packages/gateway-contracts/tests/operator-cockpit-projection.test.ts`
- `packages/native/src/shared/native-cockpit-contract.ts`
- `packages/native/tests/native-boundary.test.ts`
- `docs/architecture/native-cockpit-projection.md`
- `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`
- `docs/roadmap/README.md`
- `docs/changelog.md`
- `docs/plan.md`
- `packages/gateway-contracts/README.md`

Deliverables:

- Define `createOperatorCockpitReadOnlyViewState` over
  `OperatorCockpitReadOnlyProjection` without duplicating projection
  construction.
- Validate focus, filter, and replay targets against shared projection data and
  fail closed when targets do not resolve.
- Preserve `managedInvocationId` and `toolCallId` on projected timeline targets
  so filters remain target-derived instead of summary-derived.
- Require enclosing instance/session target scope for session, invocation, and
  tool filters, and suppress replay resolution when filter state is invalid.
- Keep the contract read-only with explicit metadata:
  `mode: read-only`, `dispatch: not-dispatched`, and
  `mutationDispatch: disabled`.
- Add `createNativeCockpitReadOnlyViewState` as a thin wrapper preserving
  `runtimeBoundary: gateway-contracts` and fail-closed semantics.

### Slice 12 - Read-Only View-State Benchmark Baseline

Files:

- `packages/gateway-contracts/src/operator-cockpit-benchmark.ts`
- `packages/gateway-contracts/src/index.ts`
- `packages/gateway-contracts/tests/operator-cockpit-benchmark.test.ts`
- `packages/native/src/shared/native-cockpit-contract.ts`
- `packages/native/tests/native-boundary.test.ts`
- `docs/architecture/native-cockpit-projection.md`
- `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`
- `docs/roadmap/README.md`
- `docs/changelog.md`
- `docs/plan.md`
- `packages/gateway-contracts/README.md`

Deliverables:

- Define `measureOperatorCockpitReadOnlyViewStateBaseline` over the existing
  shared read-only projection and view-state helpers.
- Build projection first, then measure only
  `createOperatorCockpitReadOnlyViewState` with `performance.now`.
- Record fixture summary, measured timestamp, duration, focus/timeline/replay
  resolution state, replay cursor neighbors, and projection workload counts.
- Preserve fail-closed behavior for invalid view-state targets without throwing
  unless projection/attach validation fails.
- Add `createNativeCockpitReadOnlyViewStateBaseline` as a thin metadata wrapper
  with `runtimeBoundary: gateway-contracts` and `mutationDispatch: disabled`.
- Keep scope contract-only: no browser or native rendering benchmark, no
  network attach loop, no dispatch, and no Rust/WASM/sidecar claim.

### Slice 13 - Benchmark Evidence Report And Promotion Gate

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

- Define `createOperatorCockpitBenchmarkEvidenceReport` in shared gateway
  contracts as an evidence gate over existing benchmark outputs.
- Keep this slice contract-only: no UI, network attach loop, mutation dispatch,
  cancellation dispatch, or Rust/WASM/sidecar implementation.
- Prevent TypeScript projection and read-only view-state baselines from being
  interpreted as browser rendering, native rendering, or Rust proof.
- Emit explicit gate outputs for status, recommendation, implemented evidence,
  missing evidence, promotion eligibility, and Rust-candidate eligibility.
- Default shared-baseline-only reports to rendering benchmark follow-up with
  promotion blocked until rendering plus target-clarity, interaction-latency,
  memory, and native-advantage evidence exists.

### Slice 14 - Typed Phase 3 Evidence Contracts

Files:

- `packages/gateway-contracts/src/operator-cockpit-benchmark.ts`
- `packages/gateway-contracts/tests/operator-cockpit-benchmark.test.ts`
- `packages/gateway-contracts/src/index.ts`
- `packages/gateway-contracts/README.md`
- `docs/architecture/native-cockpit-projection.md`
- `docs/changelog.md`
- `docs/plan.md`
- `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`
- `docs/roadmap/README.md`

Deliverables:

- Replace coarse boolean Phase 3 placeholders with typed evidence contracts for
  browser rendering, native rendering, target clarity, interaction latency, and
  memory reports.
- Keep this slice contract-only: no benchmark runner, no live attach loop, no
  dispatch/cancellation implementation, and no Rust/WASM/sidecar execution
  path.
- Tighten gate behavior: promotion still requires shared baselines, measured
  browser/native rendering, native advantage confirmation, and measured plus
  complete target-clarity/interaction-latency/memory reports.
- Keep Rust candidacy/promotion evidence-gated: request flags alone cannot
  allow Rust candidacy or promotion without both bottleneck evidence and Rust
  hot-path proof.

### Slice 15 - Docs-Only Contract/Projection Closeout

Files:

- `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`
- `docs/architecture/native-cockpit-projection.md`
- `docs/roadmap/README.md`
- `docs/changelog.md`
- `docs/plan.md`

Deliverables:

- Mark the current contract/projection phase as closeable after typed Phase 3
  evidence contracts without promoting the full native cockpit experiment.
- State explicitly that Phase 3+ remains future work blocked on real benchmark
  runners and measured browser/native rendering evidence.
- State explicitly that no live benchmark runner, live attach loop, dispatch
  path, or Rust/WASM/sidecar module exists.
- Keep wording canonical, non-duplicative, and aligned with current implemented
  scope.

Verification checklist:

- Confirm only docs files changed and no code files changed.
- Confirm roadmap and architecture docs both state contract/projection closeout
  only, not full experiment promotion.
- Confirm Phase 3+ blockers and non-implemented live runner/dispatch/Rust scope
  are explicit in roadmap, architecture, README, and changelog text.
- Confirm unrelated dirty files `.kiln/kiln.yaml` and
  `packages/gui/tests/memory-lattice-panel.test.tsx` remain untouched.

### Slice 16 - Phase 5 Decision Closeout

Files:

- `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`
- `docs/roadmap/README.md`
- `docs/architecture/native-cockpit-projection.md`
- `docs/changelog.md`
- `docs/plan.md`

Deliverables:

- Mark Roadmap 05 complete on 2026-05-15 with explicit defer/no-promotion
  decision.
- Keep the typed contract/projection foundation and Phase 3 evidence contracts
  canonical, while explicitly preserving that measured browser/native rendering
  evidence does not exist yet.
- Move Roadmap 05 out of active roadmap status and record completion/defer
  outcome in roadmap index and architecture status.
- Require a new dedicated benchmark-runner/native-cockpit validation roadmap or
  ADR before any live Phase 3 benchmark runner, native cockpit UI, dispatch
  path, gateway attach loop, or Rust/WASM/sidecar module starts.

Verification checklist:

- Confirm only approved docs files changed.
- Confirm Roadmap 05 no longer reads as actively waiting for Phase 3 execution
  inside the same roadmap.
- Confirm README and architecture docs both reflect complete/deferred status.
- Confirm changelog records Slice 16 Phase 5 decision closeout on 2026-05-15.
- Confirm `.kiln/kiln.yaml` and
  `packages/gui/tests/memory-lattice-panel.test.tsx` remain untouched.

### Slice 17 - Phase 3 Slice 1 Admission Track Start

Files:

- `docs/roadmap/06-native-cockpit-benchmark-validation.md`
- `docs/roadmap/README.md`
- `packages/gateway-contracts/src/operator-cockpit-benchmark.ts`
- `packages/gateway-contracts/src/index.ts`
- `packages/gateway-contracts/tests/operator-cockpit-benchmark.test.ts`
- `packages/gateway-contracts/README.md`
- `docs/architecture/native-cockpit-projection.md`
- `docs/changelog.md`
- `docs/plan.md`

Deliverables:

- Start dedicated Roadmap 06 on 2026-05-15 after Roadmap 05 completion.
- Add Phase 3 runner-admission contract for web/native rendering tracks with
  explicit workload validation and prerequisite gates.
- Keep scope admission-only: no benchmark runner execution, no dispatch, no
  gateway attach loop, and no promotion decision.

Verification checklist:

- Confirm Roadmap 06 is the active Phase 3 validation track and Roadmap 05
  remains completed/deferred.
- Confirm runner admission blocks missing prerequisites, failed workload
  thresholds, impossible single-session summaries, and mismatched
  surface/runner pairs.
- Confirm runner admission blocks internally contradictory fixture summaries,
  including active managed session counts greater than total sessions.
- Confirm admitted plans still keep `execution: not-started`,
  `mutationDispatch: disabled`, and `networkAttach: not-started`.
- Confirm no Playwright/Electron runner execution, gateway attach loop,
  dispatch path, or Rust/WASM/sidecar module was added.

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
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-view-state operator-cockpit-projection operator-cockpit-target` after Slice 11.
- Passed `bun run --cwd packages/native test` after Slice 11.
- Passed `bun run --filter @kilnai/gateway-contracts typecheck` after Slice 11.
- Passed `bun run --filter @kilnai/gateway-contracts build` after Slice 11.
- Passed `bun run --cwd packages/native typecheck` after Slice 11.
- Passed `bun run --cwd packages/native build` after Slice 11.
- Passed `bun run typecheck` after Slice 11.
- Passed `bun run test` after Slice 11.
- Passed `bun run build` after Slice 11.
- Passed `git diff --check` after Slice 11.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-benchmark` after Slice 12.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-benchmark` after Slice 13.
- Passed `bun run --filter @kilnai/gateway-contracts typecheck` after Slice 13.
- Passed `bun run --filter @kilnai/gateway-contracts build` after Slice 13.
- Passed `bun run --cwd packages/native test` after Slice 13.
- Passed `bun run --cwd packages/native typecheck` after Slice 13.
- Passed `bun run --cwd packages/native build` after Slice 13.
- Passed `bun run typecheck` after Slice 13.
- Passed `bun run test` after Slice 13.
- Passed `bun run build` after Slice 13.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-benchmark` after Slice 13 review fixes.
- Passed `bun run --filter @kilnai/gateway-contracts typecheck` after Slice 13 review fixes.
- Passed `bun run --filter @kilnai/gateway-contracts build` after Slice 13 review fixes.
- Passed `bun run --cwd packages/native test` after Slice 13 review fixes.
- Passed `bun run --cwd packages/native typecheck` after Slice 13 review fixes.
- Passed `bun run --cwd packages/native build` after Slice 13 review fixes.
- Passed `bun run typecheck` after Slice 13 review fixes.
- Passed `bun run test` after Slice 13 review fixes.
- Passed `bun run build` after Slice 13 review fixes.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-benchmark` after final Slice 13 Rust-gate fix.
- Passed `bun run --filter @kilnai/gateway-contracts typecheck` after final Slice 13 Rust-gate fix.
- Passed `bun run --filter @kilnai/gateway-contracts build` after final Slice 13 Rust-gate fix.
- Passed `bun run --cwd packages/native test` after final Slice 13 Rust-gate fix.
- Passed `bun run --cwd packages/native typecheck` after final Slice 13 Rust-gate fix.
- Passed `bun run --cwd packages/native build` after final Slice 13 Rust-gate fix.
- Passed `bun run typecheck` after final Slice 13 Rust-gate fix.
- Passed `bun run test` after final Slice 13 Rust-gate fix.
- Passed `bun run build` after final Slice 13 Rust-gate fix.
- Passed `bun run --cwd packages/native test` after Slice 12.
- Passed `bun run --filter @kilnai/gateway-contracts typecheck` after Slice 12.
- Passed `bun run --filter @kilnai/gateway-contracts build` after Slice 12.
- Passed `bun run --cwd packages/native typecheck` after Slice 12.
- Passed `bun run --cwd packages/native build` after Slice 12.
- Passed `bun run typecheck` after Slice 12.
- Passed `bun run test` after Slice 12.
- Passed `bun run build` after Slice 12.
- Added and observed the expected failing test for unmeasured-but-complete
  Phase 3 governance reports before tightening the Slice 14 gate.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-benchmark` after Slice 14.
- Passed `bun run --filter @kilnai/gateway-contracts typecheck` after Slice 14.
- Passed `bun run --filter @kilnai/gateway-contracts build` after Slice 14.
- Passed `bun run --cwd packages/native test` after Slice 14.
- Passed `bun run --cwd packages/native typecheck` after Slice 14.
- Passed `bun run --cwd packages/native build` after Slice 14.
- Passed `bun run typecheck` after Slice 14.
- Passed `bun run test` after Slice 14.
- Passed `bun run build` after Slice 14.
- Passed `git diff --check` after Slice 14.
- Confirmed only docs files changed for Slice 15; unrelated dirty files remain
  unstaged and untouched.
- Passed `bun run typecheck` after Slice 15.
- Passed `bun run build` after Slice 15.
- Passed `bun run test` after Slice 15.
- Passed `git diff --check` after Slice 15.
- Rechecked roadmap wording so contract/projection closeout does not imply
  permission to start live runners or Rust modules.
- Confirmed only approved docs files changed for Slice 16; unrelated dirty
  files remain unstaged and untouched.
- Passed `bun run typecheck` after Slice 16.
- Passed `bun run build` after Slice 16.
- Passed `bun run test` after Slice 16.
- Passed `git diff --check` after Slice 16.
- Reviewer rechecked the 2026-05-15 closeout date against the governing
  session date and reported no findings.
- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-benchmark` after Slice 17.
- Passed `bun run --filter @kilnai/gateway-contracts typecheck` after Slice 17.
- Passed `bun run --filter @kilnai/gateway-contracts build` after Slice 17.
- Passed `bun run --cwd packages/native test` after Slice 17.
- Passed `bun run --cwd packages/native typecheck` after Slice 17.
- Passed `bun run --cwd packages/native build` after Slice 17.
- Passed `bun run typecheck` after Slice 17.
- Passed `bun run build` after Slice 17.
- Passed `bun run test` after Slice 17.
- Passed `git diff --check` after Slice 17.
- Re-passed `bun run --filter @kilnai/gateway-contracts test -- operator-cockpit-benchmark` after Slice 17 fixture-summary coherence fix.
- Re-passed `bun run --filter @kilnai/gateway-contracts typecheck` after Slice 17 fixture-summary coherence fix.
- Re-passed `bun run --filter @kilnai/gateway-contracts build` after Slice 17 fixture-summary coherence fix.
- Re-passed `bun run --cwd packages/native test` after Slice 17 fixture-summary coherence fix.
- Re-passed `bun run --cwd packages/native typecheck` after Slice 17 fixture-summary coherence fix.
- Re-passed `bun run --cwd packages/native build` after Slice 17 fixture-summary coherence fix.
- Re-passed `bun run typecheck` after Slice 17 fixture-summary coherence fix.
- Re-passed `bun run build` after Slice 17 fixture-summary coherence fix.
- Re-passed `bun run test` after Slice 17 fixture-summary coherence fix.
- Re-passed `git diff --check` after Slice 17 fixture-summary coherence fix.
