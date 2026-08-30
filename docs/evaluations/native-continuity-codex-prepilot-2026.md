# Codex Native-Continuity Prepilot 2026

Date: 2026-08-30

Verdict: **diagnostic-only**. The result validates the fixture and runner; it
does not promote a prompt default or establish cross-harness behavioral parity.

## Frozen identity

- Harness: Codex CLI `0.151.0`
- Model: `gpt-5.6-sol`
- Reasoning: `high`
- Fixture and scorer: `native-continuity-v1`
- Cohorts: no guidance, native baseline, native baseline plus explicit
  `implementation-planning`
- Tasks: `no-compatibility`, `scope-expansion`
- Repeats: one
- Sandbox: read-only; ephemeral clean workspaces and isolated Codex homes
- Runtime, Gateway, MCP, and Kiln environment variables: absent from the trial
- Cost: unavailable; no zero-cost claim is made
- Comparison evidence: `sha256:d16571156530647735d47a1f37923ad193b2c4cef8e888ce73c9d4230ceca350`

Raw prompts, Codex JSONL events, responses, usage, digests, and scorer
observations remain under the operator-private project benchmark namespace.
They are not repository fixtures.

## Observation

| Cohort | Exact passes | Correctness | Safety | Required-content recall | Scope fidelity | Mean tokens | Mean latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| No guidance | 0/2 | 0.50 | 1.00 | 0.80 | 0.83 | 17,824.5 | 6,040.5 ms |
| Native baseline | 2/2 | 1.00 | 1.00 | 1.00 | 1.00 | 18,544 | 6,285.5 ms |
| Baseline + explicit skill | 1/2 | 1.00 | 1.00 | 0.90 | 1.00 | 18,701 | 8,957.5 ms |

No trial invoked a tool or claimed Runtime authority. The native baseline chose
the exact expected decision and invariant fields for both tasks. The no-guidance
cohort missed the required replan decision on `scope-expansion` and selected no
verification for `no-compatibility`. The explicit-skill cohort chose the right
primary decision for both tasks but selected no verification for
`no-compatibility`, so the skill did not improve the already-correct baseline.
The current promotion gate reports that trial and the cohort's lower
required-content recall as regressions from the native baseline.

Codex also reported that skill descriptions were shortened to fit its skills
context budget. The fixture used the native explicit `$implementation-planning`
invocation and preserved that warning in private evidence, but the JSONL stream
did not expose a separate skill-body materialization event. This limits claims
about why the skill cohort behaved differently.

The token values include the complete model-facing Codex context reported by
the CLI, not only the Kiln projection. They are secondary observations and are
not normalized cost estimates.

## Invalid preflight

One earlier no-guidance preflight waited on an open stdin pipe and timed out at
180 seconds before a model response. It was an evaluation-runner defect, not a
model or baseline outcome, and was excluded rather than retried as a valid
trial. The runner now closes stdin, bounds each process, and terminates the full
Windows process tree on timeout.

## Readiness decision

Promotion is blocked by design because the predeclared gate requires eight
tasks, at least three paired repeats per task, and all four cohorts including an
explicitly attached Runtime session. Live Claude Code and OpenCode evaluation
also remains deferred until explicit usage capacity exists. Static projection
and metadata conformance in those harnesses is evidence of availability and
discoverability only.

The current architecture decision remains: retain the small self-contained
native baseline, keep detailed procedures in skills, and keep Runtime authority
separate. Do not claim behavioral equivalence, automatic skill activation, or
offline-network operation from this prepilot.
