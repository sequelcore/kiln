# Benchmark Validation

Benchmark validation is Kiln's contract for turning internal capability into
reproducible external evidence. It is not a leaderboard integration layer and
not a marketing report generator.

Kiln is a governed control plane, so every benchmark run must state which Kiln
surface is being measured, which authority profile was active, which
provider/model or route policy was used, which tool catalog was admitted, and
which evidence artifacts prove the result.

## Doctrine

External benchmarks are accepted only after internal baselines are stable. A
public result that cannot be reproduced from a frozen Kiln profile, versioned
dataset, config hash, scorer set, and artifact links is not product evidence.

Benchmark adapters are projections over Kiln runtime contracts. They must not
introduce private prompt paths, private tool schemas, or benchmark-only
authority shortcuts. If an adapter cannot express a benchmark through Kiln's
normal tool, route, context, memory, and managed invocation contracts, the
benchmark is not admissible for public reporting yet.

## Benchmark-Facing Profiles

Kiln defines benchmark-facing profiles in `@kilnai/core`. They are frozen
measurement surfaces, not operator personalization profiles:

| Profile | Surface | Purpose | External candidates |
| --- | --- | --- | --- |
| `kiln-tool-agent` | `tool-calling` | Structured tool/function-call correctness under Kiln authority. | BFCL, tau-style workflows |
| `kiln-managed-child-agent` | `managed-child` | Governed child invocation, route selection, handoff quality, and evidence preservation. | tau-style workflows, AgentDojo |
| `kiln-managed-coding-agent` | `managed-coding` | Bounded coding with approved authority, tests, rollback evidence, and replayable handoff. | Terminal-Bench, SWE-bench-style tracks |
| `kiln-safety-agent` | `safety` | Prompt-injection resistance, policy preservation, and utility. | AgentDojo |

Each profile declares:

- stable id and version
- measured surface
- authority profile
- required scorers
- minimum pass^k threshold and k
- reproducibility requirements
- candidate external benchmark tracks

The runtime may expose operator-specific agents such as `architect`, `coder`,
or `reviewer`, but benchmark-facing profiles remain separate so public results
do not depend on a user's personal roster.

## Internal Baseline Gate

A profile is internally baseline-ready only when a `BenchmarkBaselineResult`
exists for the exact profile id and version and includes:

- `k` greater than or equal to the profile minimum
- `passAtK` greater than or equal to the profile threshold
- every required scorer
- at least one result artifact URI
- a config hash
- a dataset version

Missing evidence blocks readiness. This is intentionally stricter than ordinary
development evals because public benchmark claims must survive replay and audit.

Internal baseline execution uses `BenchmarkBaselineRunner` plus the normal Kiln
runtime session path. The runner owns pass^k, scorer application, and artifact
emission; the CLI/runtime adapter owns provider routing, context projection,
tool metadata capture, and config hashing. Internal baseline scorers are
structural evidence checks, not hidden LLM judges: they score only Kiln-observed
evidence such as tool calls, route identity, handoff output, policy violations,
latency, and cost.

## External Track Gate

External tracks are candidates until an adapter exists. Candidate tracks still
require the relevant internal profile surfaces to be baseline-ready.

Current canonical tracks:

| Track | Purpose | Gate |
| --- | --- | --- |
| `bfcl` | Tool/function-calling correctness. | Adapter plus ready `tool-calling` profile. |
| `agentdojo` | Prompt-injection robustness and utility. | Adapter plus ready `safety` or managed-child profile. |
| `tau` | Tool-agent-user workflows and pass^k reliability. | Adapter plus ready tool/managed-child profiles. |
| `terminal-bench` | Terminal autonomy. | Frozen managed-coding terminal profile plus adapter. |
| `swe-bench` | Repository issue resolution. | Frozen managed-coding profile plus an accepted modern SWE benchmark target. |
| `webarena` | Browser interaction. | Future browser surface profile. |
| `osworld` | Desktop OS interaction. | Future OS-control surface profile. |

SWE-bench-style tracks require extra scrutiny. Public SWE benchmarks have shown
dataset aging, leakage, underspecified tasks, and flawed tests; Kiln should
prefer modern, reproducible, decontaminated tracks and must explain limitations
when reporting any SWE-style score.

## Reporting Contract

Every public benchmark report must include:

- benchmark name and version
- Kiln version and commit
- benchmark-facing profile id and version
- provider/model or route policy
- authority profile and tool catalog snapshot
- dataset version
- scorer set and thresholds
- pass^1 and pass^k when applicable
- cost and duration
- config hash
- artifact URIs for result, transcript, tool calls, managed invocation
  evidence, and diagnostics
- known limitations and failed/omitted cases

Reports must separate model capability from Kiln control-plane capability. A
route that uses a strong provider/model is not enough; the claim must say what
Kiln contributed through governance, tool authority, context admission, child
invocation, replay, and evidence.

## Bug Bounty Validation

Bug bounty participation is a validation mode only when scope ingestion,
authorization, human approval, evidence provenance, legal/disclosure review,
and operator escalation are implemented. It must not become autonomous
vulnerability hunting.

## Research Inputs

- BFCL focuses on function/tool-call correctness and multi-turn function use.
- AgentDojo evaluates indirect prompt injection against tool-using agents.
- tau-bench introduced pass^k as a reliability measure for repeated agent
  trials in tool-agent-user workflows.
- Current SWE-bench discourse shows that coding benchmarks can saturate or
  become contaminated; public coding claims need benchmark-specific caveats.
