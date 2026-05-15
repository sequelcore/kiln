# 01 - Native Cockpit Benchmark Validation

## Status

Active. Started on 2026-05-15.

This track validates the benchmark path for the native cockpit experiment. It
continues from the completed native cockpit projection foundation, which closed
with defer/no-promotion status and remains canonical in
`docs/architecture/native-cockpit-projection.md`.

The current roadmap is contract-only. It does not execute live browser or
native rendering benchmarks, does not promote a native cockpit UI, and does not
introduce dispatch, gateway attach loops, or Rust/WASM/sidecar modules.

## Objective

Define the admission, planning, workload governance, and approval evidence
required before Kiln can run live browser/native rendering benchmarks for a
future native cockpit decision.

## Scope

- Benchmark runner admission contracts for `web-gui` and `native-cockpit`.
- Workload validation for:
  - `single-session-heavy`
  - `multi-session`
  - `multi-instance`
- Prerequisite validation for:
  - runner availability
  - renderer availability
  - approved fixtures
  - baseline evidence
- Fail-closed outcomes that keep execution, network attach, and mutation
  dispatch disabled until an explicit later slice enables them.
- Approval evidence for benchmark workload fixtures before any live runner is
  allowed.

## Non-Goals

- No live Playwright benchmark execution.
- No live Electron or native rendering benchmark execution.
- No native cockpit promotion decision.
- No gateway attach loop.
- No mutation dispatch or network dispatch.
- No Rust, WASM, sidecar, or projection-kernel implementation.

## Implementation Plan

1. Complete shared runner-admission contracts and tests.
2. Complete benchmark-runner orchestration planning contracts.
3. Add benchmark workload fixture governance and approval evidence.
4. Start live runner execution slices only after admission and workload
   governance are fully validated and explicitly approved.

## Slice 1 - Runner Admission Contracts

Status: complete on 2026-05-15.

Delivered:

- Typed runner-admission contract in `@kilnai/gateway-contracts`.
- Tests proving admission only when prerequisites and workload thresholds pass.
- Fail-closed surface/runner pairing validation so `web-gui` cannot request
  native rendering and `native-cockpit` cannot request browser rendering.
- Blocking behavior for missing native runner or renderer prerequisites.
- Blocking behavior for workloads below threshold.
- Invariants preserving `execution: not-started`,
  `mutationDispatch: disabled`, and `networkAttach: not-started`.

Result: contract-only admission and workload validation. No browser or native
benchmark execution exists in this slice.

## Slice 2 - Orchestration Planning Contracts

Status: complete on 2026-05-15.

Delivered:

- Typed orchestration planning contract in `@kilnai/gateway-contracts` through
  `createOperatorCockpitBenchmarkRunnerOrchestrationPlan`.
- Tests requiring both web GUI browser-rendering admission and native cockpit
  native-rendering admission before a plan can become `planned`.
- Fail-closed orchestration blocking when either admission is blocked, workload
  kinds differ, or fixture summaries differ.
- Invariants preserving `execution: not-started`,
  `mutationDispatch: disabled`, `networkAttach: not-started`, and
  `recommendation/evidence: not-promoted`.

Result: orchestration planning only. No Playwright runner, Electron runner,
gateway attach loop, mutation dispatch, or promotion evidence exists in this
slice.

## Slice 3 - Workload Fixture Governance

Status: next.

Deliver:

- Fixture approval contract for benchmark workloads.
- Evidence fields for fixture source, fixture version, workload kind, event
  counts, session counts, invocation counts, environment, and approver.
- Fail-closed planning behavior when fixture approval evidence is missing,
  stale, mismatched, or below threshold.
- Tests covering approved and rejected fixture governance paths.
- Documentation updates in `docs/architecture/native-cockpit-projection.md`,
  `docs/architecture/benchmark-validation.md`, and this roadmap if the stable
  contract changes.

## Promotion Gate

Live benchmark execution remains blocked until all are true:

- runner admission contracts pass for both `web-gui` and `native-cockpit`
- orchestration planning reaches `planned`
- workload fixture governance is approved
- execution, network attach, and dispatch boundaries are explicitly updated by
  a later approved slice or ADR
- tests, typecheck, build, and review evidence pass for the enabling slice

Native cockpit promotion remains blocked until measured browser/native
rendering evidence exists and the architecture documents are updated with the
decision outcome.
