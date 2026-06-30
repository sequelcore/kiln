# Roadmap 08 Slice 0 Plan

## Objective

Establish a reproducible baseline for roadmap 08 before behavior changes. Slice
0 captures current benchmark and session evidence, records attribution gaps, and
adds only the baseline artifact or test coverage needed to make future slices
measurable.

## Non-Goals

- No production behavior changes outside baseline artifacts or tests.
- No work item materialization.
- No provider routing changes.
- No context projection or governor redesign.
- No token accounting model changes beyond documenting existing fields and gaps.

## Evidence Inputs

- `CLAUDE.md:66-74` requires orchestration and evidence gates.
- `docs/roadmap/08-verified-efficiency-control-plane.md:226-245` defines Slice
  0 baseline/reproduction and exit gate.
- `docs/roadmap/06-research-turn-token-budgeting.md:17-20` records the
  2026-06-29 research turn usage: `565377` input, `7646` output, and `433152`
  cache-read tokens.
- `docs/roadmap/06-research-turn-token-budgeting.md:52-68` requires
  reproduction, source attribution, regression tests, URLs, tool counts,
  metadata, and no work item materialization.
- `docs/architecture/benchmark-validation.md:47-54` defines `run-internal` as
  the canonical internal baseline command.
- `docs/architecture/benchmark-validation.md:84-103` defines baseline readiness
  evidence.
- `docs/guides/eval-benchmarking.md:162-171` describes the `run-internal`
  normal session path.

## Surface Map

- `packages/cli/src/application/benchmark-session-executor.ts:64` creates the
  benchmark item executor used by internal baseline runs.
- `packages/cli/src/application/benchmark-session-executor.ts:184` routes items
  through `runSession` with a non-human output sink.
- `packages/cli/src/application/benchmark-session-executor.ts:208` returns
  `output`, `durationMs`, `costUsd`, `inputTokens`, `outputTokens`, route
  identity, session success, tool calls, and exact artifacts.
- `packages/core/src/eval/benchmark-runner.ts:40` owns baseline execution and
  pass^k consistency through `BenchmarkBaselineRunner`.
- `packages/core/src/eval/benchmark-runner.ts:72` writes a benchmark baseline
  artifact and `packages/core/src/eval/benchmark-runner.ts:97` returns the
  `BenchmarkBaselineResult`.
- `packages/core/src/eval/benchmark-baseline.ts:35` defines
  `BenchmarkBaselineResult`; it currently has readiness metadata but no
  source-level usage attribution.
- `packages/cli/src/commands/benchmark.ts:179` implements
  `benchmark run-internal`; `packages/cli/src/commands/benchmark.ts:220` writes
  the baseline JSON and `packages/cli/src/commands/benchmark.ts:226` prints the
  command status JSON.
- `packages/cli/src/wrapper/session-manager.ts:177` stores per-turn
  `inputTokens`, `outputTokens`, `cacheReadTokens`, and `costUsd`;
  `packages/cli/src/wrapper/session-manager.ts:372` records updates.
- `packages/core/src/context/governor.ts:123` builds context audit entries and
  `packages/core/src/context/governor.ts:199` projects admitted/deferred
  context with audit trail.
- `packages/runtime/src/session/support/artifacts/context-artifact-summary.ts:457`
  writes runtime continuity outcomes with token and tool-count evidence.

## Atomic Slices

### 0.1 Baseline Surface Confirmation

Files:

- `packages/cli/src/application/benchmark-session-executor.ts`
- `packages/core/src/eval/benchmark-runner.ts`
- `packages/core/src/eval/benchmark-baseline.ts`
- `packages/cli/src/commands/benchmark.ts`
- `packages/cli/src/wrapper/session-manager.ts`
- `packages/core/src/context/governor.ts`
- `packages/runtime/src/session/support/artifacts/context-artifact-summary.ts`

Work:

- Confirm where current session execution exposes duration, cost, token totals,
  route identity, session success, tool calls, exact artifacts, and context
  audits.
- Confirm the current baseline artifact shape.
- Record the missing usage-attribution gap without inventing fields.

Exit:

- The baseline surface map above remains accurate after implementation.

### 0.2 Reproduction Baseline Artifact

Files:

- `packages/core/src/eval/benchmark-baseline.ts`
- `packages/core/src/eval/benchmark-runner.ts`
- `packages/cli/src/commands/benchmark.ts`

Work:

- Keep `run-internal` as the canonical baseline path.
- Preserve the existing baseline JSON shape unless a test proves existing
  session evidence is being dropped.
- Do not add source-level token attribution in Slice 0.

Tests:

- `packages/cli/tests/commands/benchmark.test.ts`

Exit:

- `run-internal` still emits one status document and writes the full baseline
  artifact.

### 0.3 Session Envelope Regression Coverage

Files:

- `packages/cli/tests/application/benchmark-session-executor.test.ts`

Work:

- Preserve non-human output sink assertions.
- Preserve failure and timeout metadata assertions.
- Add regression assertions only for currently emitted metadata, tool calls, and
  exact artifact references if coverage is missing.

Tests:

- `packages/cli/tests/application/benchmark-session-executor.test.ts`

Exit:

- Tests prove the benchmark session envelope preserves current evidence without
  creating work items.

### 0.4 Usage Attribution Gap Record

Files:

- `docs/plan.md`
- `packages/core/src/eval/benchmark-baseline.ts`

Work:

- Document that `BenchmarkBaselineResult` currently lacks source-level usage
  attribution.
- Preserve the 2026-06-29 research-turn measurements as the first known
  workload: `565377` input, `7646` output, `433152` cache-read.
- Defer lifecycle attribution fields to roadmap 08 Slice 1.

Exit:

- Future implementation can target the gap without guessing or duplicating
  context, routing, or benchmark owners.

## Verification Gates

Run in order:

1. Focused CLI tests:

   ```bash
   bun test packages/cli/tests/application/benchmark-session-executor.test.ts packages/cli/tests/commands/benchmark.test.ts
   ```

2. Core eval tests:

   ```bash
   bun run --filter @kilnai/core test
   ```

3. Repository typecheck:

   ```bash
   tsc -b packages/gateway-contracts packages/core packages/runtime packages/sdk packages/cli packages/tui packages/native && tsc -p packages/widget/tsconfig.json --noEmit && tsc -p packages/studio/tsconfig.json --noEmit && tsc -p packages/gui/tsconfig.json --noEmit
   ```

4. Canonical baseline command with an explicit profile and output:

   ```bash
   bun run --filter @kilnai/cli kiln benchmark run-internal --profile kiln-tool-agent --output ./.kiln/benchmarks/slice-0-baseline.json
   ```

5. Evidence review:

- Baseline artifact exists.
- Status output exists.
- Artifact uses the canonical baseline contract.
- Tool counts, metadata, and exact artifacts are preserved where currently
  emitted.
- No work items are materialized.
- Missing source-level usage attribution is recorded as a Slice 0 gap.

## Risks

- Baseline artifacts may not currently expose cache-read tokens even though
  `SessionManager` stores them per turn.
- Runtime continuity artifacts expose input/output tokens and tool counts, but
  may not align directly with benchmark baseline artifacts.
- Adding attribution in Slice 0 would exceed scope; Slice 0 should preserve
  existing data and document gaps.
- `run-internal` must remain the canonical baseline path to avoid divergent
  reproduction evidence.
