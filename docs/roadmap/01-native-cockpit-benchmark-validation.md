# 01 - Native Cockpit Benchmark Validation

## Status

Active. Started on 2026-05-15.

This track validates the benchmark path for the future native cockpit decision.
It continues from the completed native cockpit projection foundation, which
closed with defer/no-promotion status and remains canonical in
`docs/architecture/native-cockpit-projection.md`.

Roadmap `00.0.1` owns near-term startup latency. Roadmap `00.0.2` owns the
Bun/Rust responsibility boundary. This roadmap depends on those boundaries but
does not implement startup fixes, Rust, WASM, sidecars, native UI, gateway
attach loops, or dispatch.

## Objective

Define the contract evidence required before Kiln may run live browser/native
rendering benchmarks for native cockpit promotion.

## Scope

- Runner admission contracts for equivalent `web-gui` and `native-cockpit`
  benchmark paths.
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

- No startup-latency fixes. See `00.0.1`.
- No Bun/Rust boundary definition or Rust candidate promotion. See `00.0.2`.
- No Rust, WASM, sidecar, or projection-kernel implementation.
- No live Playwright benchmark execution.
- No live Electron/native rendering benchmark execution.
- No native cockpit UI.
- No local or remote gateway attach loop.
- No resource-opening, cancellation, mutation, or network dispatch.
- No native cockpit promotion decision.

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

## Next Slice

### Slice 3 - Workload Fixture Governance

Status: next.

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
- `docs/architecture/native-cockpit-projection.md`, only if the stable contract
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

Native cockpit promotion remains blocked until measured browser/native
rendering evidence exists and the architecture documents are updated with the
decision outcome.

Rust/WASM/sidecar promotion remains blocked by this roadmap. Any future native
kernel work must satisfy `00.0.2` and require a later approved implementation
slice or ADR.

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
