# 01 - Native Operator Surface

Status: Active native operator surface benchmark-validation track
Execution: Queued - Slice 3 workload fixture governance is bounded and ready after higher-priority release work.
Started: 2026-05-15

This track owns the native operator surface. It continues from the completed
native projection foundation, which closed with defer/no-promotion status and
remains canonical in
`docs/architecture/native-operator-surface.md`.

Near-term startup latency doctrine is canonicalized in
`docs/architecture/provider-model-discovery.md`, `docs/architecture/managed-agents.md`,
`docs/guides/gui.md`, and `docs/guides/tui.md`.

This roadmap is about the native operator surface only. Rust optimization is a
separate implementation track owned by `00`. Benchmark validation is one
phase of this native surface roadmap, not the whole roadmap.

## Objective

Build the native operator surface in governed phases. The current phase defines
the contract evidence required before Kiln may run live browser/native
rendering benchmarks or promote any native surface behavior.

## Goals

- Prove browser and native benchmark admission through shared contracts before
  live execution.
- Preserve fail-closed native surface behavior until measured evidence exists.
- Keep native UI, dispatch, network attach, and Rust optimization behind their
  own approved slices or ADRs.
- Promote only behavior that preserves cross-surface operator semantics.

## Sequel Standards

- No live native or browser benchmark execution before admission contracts and
  approved workload fixtures exist.
- No native UI, dispatch, network attach, or gateway attach loop without an
  approved slice or ADR.
- No Rust/WASM/sidecar promotion inside the native surface roadmap.
- No promotion without tests, typecheck, benchmark evidence, and review.

## Scope

- Native operator surface phase gates, from contract-only evidence to later UI,
  attach-loop, and dispatch slices.
- Runner admission contracts for equivalent `web-gui` and `native-cockpit`
  benchmark paths. `native-cockpit` is the existing contract surface id; it is
  not the roadmap name.
- Orchestration planning contracts that require both sides to be admitted
  before execution can be planned.
- Workload fixture governance for:
  - `single-session-heavy`
  - `multi-session`
  - `multi-instance`
- Approval evidence for fixture source, version, workload kind, event counts,
  session counts, invocation counts, environment, and approver.
- Fail-closed invariants preserving:
  - `execution: not-started`
  - `mutationDispatch: disabled`
  - `networkAttach: not-started`
  - recommendation/evidence not promoted until measured evidence exists

## Non-Goals

- No startup-latency fixes. See the provider discovery and operator-surface
  guide docs listed above.
- No Bun/Rust boundary definition, Rust readiness, or Rust kernel promotion.
  See `00-rust-module-optimization.md`.
- No live Playwright benchmark execution.
- No live Electron/native rendering benchmark execution.
- No native operator UI in the current benchmark-validation phase.
- No local or remote gateway attach loop.
- No resource-opening, cancellation, mutation, or network dispatch.
- No native surface promotion decision.

## Completed Slices

### Slice 1 - Runner Admission Contracts

Completed on 2026-05-15.

Delivered:

- Typed admission contract in `@kilnai/gateway-contracts`.
- Surface/runner pairing validation:
  - `web-gui` admits only browser-rendering runners.
  - `native-cockpit` admits only native-rendering runners.
- Prerequisite validation for runner availability, renderer availability,
  approved fixture, and baseline evidence.
- Workload threshold validation.
- Fail-closed invariants preserving not-started execution and disabled dispatch.

### Slice 2 - Orchestration Planning Contracts

Completed on 2026-05-15.

Delivered:

- Typed orchestration plan contract through
  `createOperatorCockpitBenchmarkRunnerOrchestrationPlan`.
- Planning only when both web and native admissions are admitted.
- Blocking when either admission is blocked, workload kinds differ, or fixture
  summaries differ.
- Fail-closed invariants preserving not-started execution, disabled dispatch,
  no network attach, and no promotion.

## Current Phase - Benchmark Validation

Benchmark validation is the active phase because the native surface must prove
it can be compared against the web GUI with equivalent contracts before live UI
or attach work starts.

## Next Slice

### Slice 3 - Workload Fixture Governance

Status: Queued after the public-release queue; bounded and ready for explicit reprioritization.

Deliver:

- Fixture approval contract for benchmark workloads.
- Evidence fields for fixture source, fixture version, workload kind, event
  counts, session counts, invocation counts, environment, and approver.
- Staleness and mismatch checks for fixture approval evidence.
- Fail-closed planning behavior when approval evidence is missing, stale,
  mismatched, or below threshold.
- Tests covering approved and rejected fixture governance paths.
- Documentation updates only if stable architecture contracts change.

Expected files:

- `packages/gateway-contracts/src/operator-cockpit-benchmark.ts`
- `packages/gateway-contracts/tests/operator-cockpit-benchmark.test.ts`
- `docs/architecture/native-operator-surface.md`, only if the stable contract
  changes
- `docs/architecture/benchmark-validation.md`, only if the stable contract
  changes
- this roadmap

## Promotion Gates

Live benchmark execution remains blocked until all are true:

- runner admission passes for both `web-gui` and `native-cockpit`
- orchestration planning reaches `planned`
- workload fixture governance is approved
- execution, network attach, and dispatch boundaries are explicitly approved by
  a later roadmap slice or ADR
- tests, typecheck, build, and review evidence pass for the enabling slice

Native surface promotion remains blocked until measured browser/native
rendering evidence exists and the architecture documents are updated with the
decision outcome.

Rust/WASM/sidecar optimization is not part of this roadmap. Native operator surface
benchmark validation may produce workload and projection evidence that a later
Rust slice can reuse, but Rust implementation and transport selection belong to
`00-rust-module-optimization.md` or a dedicated approved Rust optimization
roadmap/ADR.

## Research Basis

- Native projection foundation evidence is canonical in
  `docs/architecture/native-operator-surface.md`.
- Startup and provider readiness evidence is canonical in
  `docs/architecture/provider-model-discovery.md`,
  `docs/architecture/managed-agents.md`, `docs/guides/gui.md`, and
  `docs/guides/tui.md`.
- Any future native benchmark claim must be backed by equivalent browser and
  native runner admission, approved workload fixtures, and reproducible
  benchmark evidence.

## Completion Criteria

This roadmap closes when the native operator surface can be compared,
validated, and promoted through explicit contracts, measured evidence, and
cross-surface documentation; or when the remaining active behavior is promoted
into architecture or a narrower successor roadmap.

## Verification

For Slice 3:

```bash
bun run --cwd packages/gateway-contracts test -- tests/operator-cockpit-benchmark.test.ts
bun run --cwd packages/gateway-contracts typecheck
```

Before any later live-runner slice:

```bash
bun run typecheck
bun run --filter @kilnai/gateway-contracts test
```
