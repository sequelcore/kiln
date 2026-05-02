# 03 - External Benchmark Validation

## Status

Deferred.

This milestone begins only after the remaining architectural and product work
reaches a stable stop point. Kiln should not enter public benchmark comparison
while its core runtime, coordination substrate, and operator surfaces are still
shifting materially.

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

- internal eval baselines are stable across pass^k, tool-calling accuracy, and
  adversarial safety runs
- one or more benchmark-facing Kiln profiles are frozen and reproducible
- benchmark adapters and harnesses are versioned, documented, and auditable
- published benchmark results explain the tested surface and limitations
- bug bounty participation runs through scope ingestion, fail-closed policy
  enforcement, human approval gates, evidence provenance, and disclosure review

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
