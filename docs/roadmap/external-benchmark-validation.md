# External Benchmark Validation

## Status

Deferred.

This milestone begins only after the remaining architectural and product work
reaches a stable stop point. Kiln should not enter public benchmark comparison
while its core runtime, coordination substrate, and operator surfaces are still
shifting materially.

## Objective

Validate Kiln against major external agent benchmarks once the system can be
packaged and judged as a stable surface rather than a moving internal refactor.

## Why This Is Deferred

- benchmark results are meaningful only when the evaluated surface is stable
- Kiln is a control plane, so each benchmark run must state clearly what Kiln
  is being benchmarked as
- benchmark harness work should not compete with unfinished architecture work
- public benchmark scores should follow internal evaluation maturity, not
  replace it

## Required Results

- internal eval baselines are stable across pass^k, tool-calling accuracy, and
  adversarial safety runs
- one or more benchmark-facing Kiln profiles are frozen and reproducible
- benchmark adapters and harnesses are versioned, documented, and auditable
- published benchmark results explain the tested surface and limitations

## Candidate Benchmark Track

- `tau3` / `tau2-bench` for governed tool-agent-user workflows
- `BFCL` for tool/function-calling correctness
- `AgentDojo` for prompt-injection and adversarial safety
- `Terminal-Bench` for terminal autonomy only after Kiln exposes a stable
  benchmarkable terminal-agent profile
- `SWE-bench`, `WebArena`, or `OSWorld` only for the specific Kiln surfaces
  that actually target those environments

## ADR Trigger

This milestone does not require an ADR yet.

Create an ADR only when Kiln is ready to decide one or more of these
permanently:

- which benchmarks are canonical for public evaluation
- what benchmark results count as release or publication gates
- which Kiln runtime profiles are official benchmark surfaces
