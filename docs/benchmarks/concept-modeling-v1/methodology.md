# Concept Modeling v1 Methodology

This is a bounded internal skill-value study for admitting the neutral
`concept-modeling` built-in. It is not a public benchmark, leaderboard result,
or universal model-quality claim.

## Paired fixture

The source fixture is
[`kiln-concept-modeling-v1.json`](../../../packages/core/evals/benchmark/kiln-concept-modeling-v1.json),
with task definitions in
[`tasks.json`](../../../packages/core/evals/fixtures/concept-modeling-v1/tasks.json).
It contains six synthetic tasks: four positive concept-modeling cases and two
negative controls where the existing model is already coherent or the change
is purely mechanical.

Each task has a baseline arm and a skill arm. Both arms use the same
`gpt-5.6-luna` model at high reasoning effort, `codex-exec@0.151.0` harness,
output schema, task input, and authority. The skill arm uses a stable
application wrapper plus the candidate `SKILL.md`; the baseline uses a neutral
no-tool wrapper. Distinct persisted Codex thread ids, fixture version, skill
digest, and candidate-set digest are recorded for each observation.

Value-cohort routing is disabled: these runs measure skill value with a fixed
candidate arm, not automatic skill selection. A separate native routing cohort
uses the task-specific `routingPrompt` with native discovery enabled. It is
recorded in `routing-adjudications.json` and tests whether concept modeling is
selected when warranted; one positive value scenario deliberately routes
directly because its existing type and tests already own the meaning.

## Scoring and observed result

Every task declares four required signals. `qualityScore` is the fraction of
signals satisfied, and `passed` requires all four. Routing correctness and
authority-boundary failures are recorded separately from quality. Model-facing
tokens, latency, and reported cost are diagnostics.

In this fixture, the baseline arm passed 5/6 tasks and the skill arm passed
6/6. The observed mean quality scores were 0.9167 and 1.0000 respectively
(delta 1/12). Mean model-facing tokens increased by 813.5 and mean latency
decreased by 573.5 ms in the skill arm, using the recorded rounded run values.
Reported cost was zero because the route was subscription-included; that is
not metered-cost evidence.

These observations support the recorded internal admission decision under the
current skill-value gate. They do not establish performance outside this
fixture, model, harness, routing cohort, or run set. The separate routing
cohort is not an independent replication.
