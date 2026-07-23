# 09 - Native Operator Surface

Status: Queued benchmark-admission track
Execution: Queued - begin only after release truth and control-plane integration are stable.
Started: 2026-05-15

## Objective

Define and validate the evidence required before Kiln admits live native operator
surface benchmarks, attach loops, dispatch, or promotion.

## Ownership

This track owns native-surface benchmark admission and later native presentation
slices. It does not own GUI release debt, Model Gateway lifecycle, cross-harness
integration, or Rust optimization.

## Scope

- Equivalent `web-gui` and `native-cockpit` benchmark admission.
- Approved workload fixtures for single-session-heavy, multi-session, and multi-instance work.
- Explicit evidence for fixture source/version, workload counts, environment, and approver.
- Later native execution, attach, dispatch, and promotion only through separately admitted slices.

## Non-Goals

- No startup-latency work.
- No live Playwright or native rendering benchmark in the current slice.
- No native UI, network attach, mutation, cancellation, or dispatch yet.
- No Rust/WASM/sidecar implementation; Roadmap 08 owns that guardrail.
- No native promotion before measured browser/native parity evidence.

## Completed Foundation

Runner admission and orchestration planning contracts are complete. They validate
surface/runner pairing, prerequisites, workload thresholds, equivalent fixtures,
and fail-closed `not-started`/disabled states.

## Ordered Slices

### Slice 0 - Workload Fixture Governance

Status: Queued; next admissible native work.

Define approval evidence, staleness, mismatch, threshold, and rejection behavior
for benchmark fixtures. Add focused Gateway-contract tests. Do not execute benchmarks.

### Slice 1 - Execution Admission

Status: Blocked on Slice 0 and explicit ADR.

Define process, renderer, environment, isolation, resource, cancellation, and
result evidence required to start equivalent browser/native benchmark runs.

### Slice 2 - Measured Comparison

Status: Blocked on Slice 1.

Run approved equivalent workloads and report latency, memory, event density,
operator behavior, failures, and residual risk without changing production defaults.

### Slice 3 - Promotion Decision

Status: Blocked on measured evidence.

Promote, narrow, or reject native behavior explicitly. Any required Rust/native
helper must enter through Roadmap 08 and a module-specific ADR.

## Promotion Gates

- Both runners are admitted against the same approved fixture.
- Execution, attach, and dispatch have explicit contracts and authority.
- Measurements are reproducible and disclose environment and limitations.
- Cross-surface semantics remain canonical and equivalent.
- Tests, typecheck, build, benchmark evidence, and review pass.

## Verification

Focused Gateway-contract tests for the current slice; workspace typecheck before
later live work; approved benchmark harnesses only after admission; `git diff --check`.

## Completion Criteria

The native surface is promoted, narrowed, or rejected from explicit contracts and
measured evidence. It remains the last roadmap priority until earlier product and
control-plane foundations are stable.
