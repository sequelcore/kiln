# 06 - Native Cockpit Benchmark Validation

## Status

Active. Started on 2026-05-15.

This roadmap starts the dedicated Phase 3 validation track after Roadmap 05
closed with defer/no-promotion status on 2026-05-15. Roadmap 05 remains the
completed contract/projection foundation; Roadmap 06 owns runner admission and
workload validation before any live benchmark execution.

## Scope

- Phase 3 benchmark runner admission contracts for `web-gui` and
  `native-cockpit`.
- Explicit workload-kind validation for:
  - `single-session-heavy`
  - `multi-session`
  - `multi-instance`
- Explicit prerequisite validation for:
  - runner availability
  - renderer availability
  - approved fixtures
  - baseline evidence presence
- Fail-closed admission outcomes that keep execution and dispatch disabled
  until later slices explicitly start benchmark runners.

## Non-Goals

- No live Playwright benchmark execution.
- No live Electron/native rendering execution.
- No promotion decision.
- No gateway attach loop.
- No mutation dispatch or network dispatch.
- No Rust/WASM/sidecar implementation.

## Implementation Order

1. Slice 1: add shared Phase 3 runner-admission contract and tests.
2. Slice 2: add benchmark-runner orchestration planning contracts.
3. Slice 3: add benchmark workload fixture governance and approval evidence.
4. Slice 4+: start live runner execution slices only after admission and
   workload governance are fully validated.

## Slice 1 Status (Phase 3 Slice 1)

Complete on 2026-05-15:

- Added typed runner-admission contract in `@kilnai/gateway-contracts`.
- Added tests that prove admission only when prerequisites and workload
  thresholds pass.
- Added fail-closed surface/runner admission pairing validation
  (`surface-runner-mismatch`) so `web-gui` cannot request native rendering and
  `native-cockpit` cannot request browser rendering.
- Added tests that block native rendering when runner/renderer prerequisites
  are missing.
- Added tests that block workloads below threshold.
- Kept execution `not-started`, `mutationDispatch: disabled`, and
  `networkAttach: not-started`.

This slice is contract-only admission and workload validation. It does not run
browser or native benchmarks and does not provide measured rendering evidence.
