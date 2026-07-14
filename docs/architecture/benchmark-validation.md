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

## Eval Output Contract

Benchmark and eval harnesses must consume explicit machine-output contracts
instead of parsing human operator output. Kiln separates the assistant answer,
operator telemetry, diagnostics, and resource evidence at the CLI boundary.

`kiln run` supports three output modes:

| Mode | stdout contract | Use case |
| --- | --- | --- |
| `human` | Human-readable operator stream with answer, telemetry, and session summary. | Interactive operator use. |
| `answer` | Final assistant content only. | Exact-format harnesses that grade raw stdout. |
| `json` | One `kiln.run.output.v1` envelope with separate answer, telemetry, diagnostics, and resources fields. | Harnesses that need both a graded answer and audit evidence. |

The default `human` mode is intentionally not an eval artifact. Harnesses must
not strip or regex human output to create a graded answer stream. They must use
`--output answer` for raw-answer grading or `--output json` and grade only the
`answer` field.

Non-human run-output modes are single-answer contracts. They are rejected for
interactive plan mode and parallel-worker mode because those flows produce
operator orchestration output, not one assistant answer.

`kiln benchmark run-internal` is the canonical internal baseline command. It
does not shell out to `kiln run`; it executes dataset items through the normal
Kiln runtime session path and benchmark runner. The command writes one
benchmark JSON status document to stdout and writes the full baseline artifact
to `--output`. Per-item assistant deltas, tool notices, provider fallback
notices, and diagnostics are routed away from command stdout so benchmark
consumers can treat stdout as command status and the baseline artifact as the
scored evidence record.

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
- typed evidence artifacts for result, transcript, tool calls, diagnostics,
  usage, route, and cost
- a config hash
- a dataset version

Missing evidence blocks readiness. This is intentionally stricter than ordinary
development evals because public benchmark claims must survive replay and audit.

Internal baseline execution uses `BenchmarkBaselineRunner` plus the normal Kiln
runtime session path. The runner owns pass^k, scorer application, and typed
artifact emission; the CLI/runtime adapter owns provider routing, context
projection, tool metadata capture, and config hashing. Internal baseline scorers are
structural evidence checks, not hidden LLM judges: they score only Kiln-observed
evidence such as tool calls, route identity, handoff output, policy violations,
latency, and cost.

The baseline artifact set is intentionally typed. `artifactUris` remains the
flat URI list for report tables, while `evidenceArtifacts` preserves the
artifact kind for replay and readiness checks:

| Kind | Required evidence |
| --- | --- |
| `result` | Full baseline result, pass^k consistency, scorer output, config hash, dataset version, and manifest of supporting artifacts. |
| `transcript` | Per-run and per-item assistant outputs used by scorers. |
| `tool-calls` | Kiln-observed tool calls and managed invocation evidence. |
| `diagnostics` | Policy violations, route failures, and benchmark/session diagnostics. |
| `usage` | Duration and token usage by run and item. |
| `route` | Provider/model identity and route evidence when observable. |
| `cost` | Charged cost and comparable/non-comparable economic evidence. |

A baseline missing any required evidence kind is blocked. A subscription route
may report zero charged cost, but it is not comparable metered-cost evidence
unless the cost evidence explicitly classifies it as comparable.

The BFCL adapter is a projection adapter. It converts supported BFCL rows into
Kiln `DatasetItem` records with `expectedToolCalls` metadata. Unsupported row
formats are reported explicitly; the adapter must not infer benchmark truth from
opaque call-code strings when a structured expected call is unavailable.

The AgentDojo adapter follows the same projection rule. It maps user-task
utility calls to `expectedToolCalls` and injection-task goals to
`forbiddenToolCalls`. Safety evidence is based on Kiln-observed tool calls and
policy violations, not on provider self-reporting.

The tau adapter projects structured tool-agent-user workflow rows into Kiln
dataset items. It keeps policy, user turns, available tools, expected
trajectory, and expected outcome as data for pass^k baseline runs. It does not
claim full tau/tau2 parity until a simulator-backed environment adapter exists.

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

## Coding Benchmark Decision

Kiln does not accept a SWE-bench-style public coding result by default. Coding
benchmarks are admissible only when the target benchmark satisfies all of these
conditions:

- task set is versioned, reproducible, and decontamination-aware
- expected behavior is verified by tests that Kiln can replay
- benchmark harness can run through normal Kiln managed-coding authority
- filesystem writes, diffs, tests, rollback evidence, and transcripts are
  captured as artifacts
- report separates provider/model coding capability from Kiln governance,
  context admission, write authority, and replay evidence

Until those conditions are met, `swe-bench`, `terminal-bench`, `webarena`, and
`osworld` remain blocked profile tracks. They are research candidates, not
public readiness claims.

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

`generateBenchmarkPublicReport()` is the canonical report renderer. It consumes
`BenchmarkBaselineResult` records, computes readiness, and renders markdown with
profile, dataset, pass^k, scorer, artifact, external-track, issue, and
limitation sections.

Internal profile readiness is not publication readiness. Every generated
benchmark report also carries the `verified-efficiency-publication-manifest-v1`
gate. Missing or invalid publication evidence blocks public claims even when a
profile or external adapter is internally ready. The gate resolves and hashes
repository-contained methodology, fixture, limitation, and report files and
requires exact runtime identity, paired design, confidence, failed and omitted
cases, commands, dependencies, quality, verification, and economic
comparability. Claim-bearing artifacts must match the same bytes in the
declared Git tree. The strict paired report copies the complete execution
identity and binds every pair to task-definition, baseline/candidate input, and
arm-specific execution-envelope hashes. It also binds the complete baseline
array rendered by `generateBenchmarkPublicReport` using canonical JSON and
SHA-256. Those fields are cross-checked against the fixture; paired-input
identity, non-inferiority, category reconciliation, improvement, hard
invariants, and the supported lower bound are derived from report content. A
valid manifest beside unrelated baseline data is downgraded to `blocked`, and
the gated claim text is printed in the report. Structurally malformed or
syntactically invalid manifest JSON produces a blocked report with explicit
issues instead of escaping the publication boundary.
`--publication-manifest` supplies this evidence to `kiln benchmark report`;
`--repository-root` identifies the root for artifact and Git-tree resolution
when the command is not run from the repository root.

The reference bundle under `docs/benchmarks/verified-efficiency-v1/` makes no
performance claim. Its expected result is `internal-evidence-only`, which
proves the gate and disclosure contract without presenting synthetic values as
provider, model, or harness performance.

## Research Inputs

- BFCL focuses on function/tool-call correctness and multi-turn function use.
- AgentDojo evaluates indirect prompt injection against tool-using agents.
- tau-bench introduced pass^k as a reliability measure for repeated agent
  trials in tool-agent-user workflows.
- Current SWE-bench discourse shows that coding benchmarks can saturate or
  become contaminated; public coding claims need benchmark-specific caveats.
