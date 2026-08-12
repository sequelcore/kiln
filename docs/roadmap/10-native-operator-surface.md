# 10 - Native Operator Surface

Status: Queued benchmark-admission track
Execution: Queued - begin only after release truth and control-plane integration are stable.
Started: 2026-05-15

## Objective

Build the native operator surface in governed phases. The current phase
defines and validates the evidence required before Kiln admits live native
operator surface benchmarks, attach loops, dispatch, or promotion.

This track continues from the completed native projection foundation, which
closed with defer/no-promotion status and remains canonical in
`docs/architecture/surfaces/native-operator-surface.md`. Near-term startup latency
doctrine is canonicalized in `docs/architecture/provider-model-discovery.md`,
`docs/architecture/coordination/managed-agents.md`, `docs/guides/gui/gui.md`, and
`docs/guides/tui.md`. Rust optimization is a separate implementation track
owned by Roadmap 09; benchmark validation is one phase of this native surface
roadmap, not the whole roadmap.

## Goals

- Prove browser and native benchmark admission through shared contracts
  before live execution.
- Preserve fail-closed native surface behavior until measured evidence
  exists.
- Keep native UI, dispatch, network attach, and Rust optimization behind
  their own approved slices or ADRs.
- Promote only behavior that preserves cross-surface operator semantics.

## Ownership

This track owns native-surface benchmark admission and later native presentation
slices. It does not own GUI release debt, Model Gateway lifecycle, cross-harness
integration, or Rust optimization.

## Scope

- Native operator surface phase gates, from contract-only evidence to later
  UI, attach-loop, and dispatch slices.
- Equivalent `web-gui` and `native-cockpit` benchmark admission (`native-cockpit`
  is the existing contract surface id, not the roadmap name).
- Orchestration planning contracts that require both sides to be admitted
  before execution can be planned.
- Approved workload fixtures for `single-session-heavy`, `multi-session`, and
  `multi-instance` work.
- Explicit evidence for fixture source/version, workload kind, event counts,
  session counts, invocation counts, environment, and approver.
- Fail-closed invariants preserving `execution: not-started`,
  `mutationDispatch: disabled`, `networkAttach: not-started`, and
  recommendation/evidence not promoted until measured evidence exists.
- Later native execution, attach, dispatch, and promotion only through
  separately admitted slices.

## Non-Goals

- No startup-latency work — see the provider discovery and operator-surface
  guide docs listed above.
- No live Playwright or native rendering benchmark in the current slice.
- No native UI, network attach, mutation, cancellation, or dispatch yet.
- No Rust/WASM/sidecar implementation or Bun/Rust boundary definition;
  Roadmap 09 owns that guardrail.
- No native promotion before measured browser/native parity evidence.

## Completed Foundation

Runner admission and orchestration planning contracts are complete. They validate
surface/runner pairing, prerequisites, workload thresholds, equivalent fixtures,
and fail-closed `not-started`/disabled states.

## Ordered Slices

### Slice 0 - Workload Fixture Governance

Status: Queued; next admissible native work.

Define approval evidence, staleness, mismatch, threshold, and rejection behavior
for benchmark fixtures. Add focused Gateway-contract tests. Do not execute
benchmarks.

Deliver: a fixture approval contract for benchmark workloads; evidence fields
for fixture source, fixture version, workload kind, event counts, session
counts, invocation counts, environment, and approver; staleness and mismatch
checks for fixture approval evidence; fail-closed planning behavior when
approval evidence is missing, stale, mismatched, or below threshold; tests
covering approved and rejected fixture governance paths; documentation
updates only if stable architecture contracts change.

Expected files: `packages/gateway-contracts/src/operator-cockpit-benchmark.ts`,
`packages/gateway-contracts/tests/operator-cockpit-benchmark.test.ts`, and
`docs/architecture/surfaces/native-operator-surface.md` /
`docs/architecture/benchmark-validation.md` only if the stable contract
changes.

### Slice 1 - Execution Admission

Status: Blocked on Slice 0 and explicit ADR.

Define process, renderer, environment, isolation, resource, cancellation, and
result evidence required to start equivalent browser/native benchmark runs.

### Slice 2 - Measured Comparison

Status: Blocked on Slice 1.

Run approved equivalent workloads and report latency, memory, event density,
operator behavior, failures, and residual risk without changing production
defaults.

### Slice 3 - Promotion Decision

Status: Blocked on measured evidence.

Promote, narrow, or reject native behavior explicitly. Any required Rust/native
helper must enter through Roadmap 09 and a module-specific ADR.

## Promotion Gates

Live benchmark execution remains blocked until all are true:

- Both runners are admitted against the same approved fixture (`web-gui` and
  `native-cockpit`).
- Orchestration planning reaches `planned`.
- Workload fixture governance is approved.
- Execution, attach, and dispatch have explicit contracts and authority,
  approved by a later roadmap slice or ADR.
- Measurements are reproducible and disclose environment and limitations.
- Cross-surface semantics remain canonical and equivalent.
- Tests, typecheck, build, benchmark evidence, and review pass for the
  enabling slice.

Native surface promotion remains blocked until measured browser/native
rendering evidence exists and the architecture documents are updated with the
decision outcome. Rust/WASM/sidecar optimization is not part of this roadmap:
benchmark validation may produce workload and projection evidence that a
later Rust slice can reuse, but Rust implementation and transport selection
belong to Roadmap 09 or a dedicated approved Rust optimization roadmap/ADR.

## Research Basis

- Native projection foundation evidence is canonical in
  `docs/architecture/surfaces/native-operator-surface.md`.
- Startup and provider readiness evidence is canonical in
  `docs/architecture/provider-model-discovery.md`,
  `docs/architecture/coordination/managed-agents.md`, `docs/guides/gui/gui.md`, and
  `docs/guides/tui.md`.
- Any future native benchmark claim must be backed by equivalent browser and
  native runner admission, approved workload fixtures, and reproducible
  benchmark evidence.

## Verification

Focused Gateway-contract tests for the current slice; workspace typecheck
before later live work; approved benchmark harnesses only after admission;
`git diff --check`.

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

## Completion Criteria

The native surface is promoted, narrowed, or rejected from explicit contracts
and measured evidence. It remains the last roadmap priority until earlier
product and control-plane foundations are stable. This roadmap closes when the
native operator surface can be compared, validated, and promoted through
explicit contracts, measured evidence, and cross-surface documentation; or
when the remaining active behavior is promoted into architecture or a
narrower successor roadmap.
