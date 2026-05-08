# 01 - External Benchmark Validation

## Status

Active.

This milestone begins with internal reproducibility gates. Kiln should not
enter public benchmark comparison until its benchmark-facing profiles have
stable internal baselines and the external adapter for the selected benchmark
is versioned, auditable, and faithful to normal Kiln runtime contracts.

## Objective

Validate Kiln against major external agent benchmarks once the system can be
packaged and judged as a stable surface rather than a moving internal refactor.

This milestone also covers real-world external validation tracks where Kiln can
prove its control-plane doctrine against independently scoped, authorized
research programs. Bug bounty participation is a candidate validation mode when
it is treated as governed research, not autonomous vulnerability hunting.

## Why This Is Deferred

- benchmark results are meaningful only when the evaluated surface is stable
- Kiln is a control plane, so each benchmark run must state clearly what Kiln
  is being benchmarked as
- benchmark harness work should not compete with unfinished architecture work
- public benchmark scores should follow internal evaluation maturity, not
  replace it

## Required Results

- internal eval baselines are stable across pass^k, tool-calling accuracy,
  handoff quality, route selection, cost, latency, and adversarial safety runs
- benchmark-facing Kiln profiles are frozen and reproducible
- benchmark adapters and harnesses are versioned, documented, and auditable
- published benchmark results explain the tested surface and limitations
- bug bounty participation runs through scope ingestion, fail-closed policy
  enforcement, human approval gates, evidence provenance, and disclosure review

## Completed

- 2026-05-08: added canonical benchmark-facing profile definitions and
  readiness evaluation in `@kilnai/core`. `KILN_BENCHMARK_PROFILES` freezes
  `kiln-tool-agent`, `kiln-managed-child-agent`, `kiln-managed-coding-agent`,
  and `kiln-safety-agent` as versioned measurement surfaces.
- 2026-05-08: added `evaluateBenchmarkReadiness()` to block public readiness
  unless the exact profile version has pass^k, required scorers, result
  artifact URIs, config hash, and dataset version evidence.
- 2026-05-08: moved stable doctrine into
  `docs/architecture/benchmark-validation.md` and operator usage into
  `docs/guides/eval.md`.
- 2026-05-08: added `kiln benchmark profiles`, `kiln benchmark tracks`, and
  `kiln benchmark readiness --baseline <path>` as the read-only CLI surface
  for benchmark-facing profile and readiness inspection.
- 2026-05-08: added internal seed datasets under
  `packages/core/evals/benchmark/` for the four benchmark-facing profiles.
  These datasets are parse-validated fixtures for baseline generation, not
  public benchmark submissions.
- 2026-05-08: added `BenchmarkBaselineRunner`, the canonical core runner that
  executes pass^k over a versioned dataset, applies supplied scorers, stores
  full consistency evidence in the artifact resource plane, and emits
  `BenchmarkBaselineResult`.
- 2026-05-08: added `kiln benchmark run-internal`, structural benchmark
  scorers, and a CLI/runtime adapter that executes benchmark items through
  normal Kiln runtime sessions while capturing tool, route, cost, latency, and
  policy evidence.

## Remaining Slices

1. Implement the first external adapter. Recommended order:
   - BFCL first for tool/function-call correctness.
   - AgentDojo second for indirect prompt-injection safety.
   - tau-style workflows third for pass^k tool-agent-user reliability.
2. Add public report generation from stored benchmark artifacts.
3. Decide whether any coding benchmark track is acceptable. SWE-bench-style
   tracks need extra scrutiny because current public SWE benchmarks have known
   saturation, leakage, and test-quality concerns.

## Candidate Benchmark Track

- `tau3` / `tau2-bench` for governed tool-agent-user workflows
- `BFCL` for tool/function-calling correctness
- `AgentDojo` for prompt-injection and adversarial safety
- `Terminal-Bench` for terminal autonomy only after Kiln exposes a stable
  benchmarkable terminal-agent profile
- `SWE-bench`, `WebArena`, or `OSWorld` only for the specific Kiln surfaces
  that actually target those environments

## Candidate Real-World Validation Track

- OpenAI Security Bug Bounty for governed vulnerability research workflows
- OpenAI Safety Bug Bounty for safety and abuse-risk triage under explicit scope
- specialized invitation-only programs, such as model-specific bio safety
  bounties, only after human approval, legal review, scope ingestion, and
  disclosure controls are implemented

## Funding Consideration

Bug bounty rewards may help finance Kiln development, but they must remain a
secondary outcome. The primary validation value is proving that Kiln can enforce
authorization, scope, evidence discipline, escalation, and disclosure hygiene in
high-ambiguity external research settings.

## ADR Trigger

This milestone does not require an ADR yet.

Create an ADR only when Kiln is ready to decide one or more of these
permanently:

- which benchmarks are canonical for public evaluation
- what benchmark results count as release or publication gates
- which Kiln runtime profiles are official benchmark surfaces
