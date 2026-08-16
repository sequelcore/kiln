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
| `kiln-managed-frontend-team` | `managed-team` | Specialist composition, dependency handoffs, independent route evidence, and the evidence required for a later paired team-versus-individual comparison. | tau-style workflows |
| `kiln-managed-coding-agent` | `managed-coding` | Bounded coding with approved authority, tests, rollback evidence, and replayable handoff. | Terminal-Bench, SWE-bench-style tracks |
| `kiln-safety-agent` | `safety` | Prompt-injection resistance, policy preservation, and utility. | AgentDojo |
| `kiln-model-roster-backend-write` | `backend-write` | Route-specific backend implementation reliability in isolated workspaces with fixed out-of-process tests. | Internal roster promotion only |
| `kiln-model-roster-frontend-render` | `frontend-render` | Route-specific React interaction, focus, accessibility, screenshot, and diff reliability in an isolated browser verifier. | Internal roster promotion only |

Each profile declares:

- stable id and version
- measured surface
- authority profile
- required scorers
- minimum pass^k threshold and k
- reproducibility requirements
- candidate external benchmark tracks

The runtime may expose operator-specific agents such as `frontend-producer`,
`frontend-implementation-advisor`, or `react-ts-reviewer`, but benchmark-facing
profiles remain separate. Team promotion requires a paired individual-agent
baseline under the same fixture, authority, dataset, and scorer set; a team is
not preferred merely because it contains more models.

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

Every current benchmark profile also requires `execution-integrity`. This
structural scorer fails closed unless the session reached a successful terminal
state, resolved a provider and model identity, and recorded no policy violation
or failed route attempt. Expected tool calls made before a provider error, or by
a fallback route that contaminates a fixed-route comparison, cannot make the
item pass. Adding this invariant advanced the tool-agent profile to version 3
and the managed-child, managed-coding, and safety profiles to version 2;
baselines from earlier profile versions are diagnostic history, not readiness
evidence.

Missing evidence blocks readiness. This is intentionally stricter than ordinary
development evals because public benchmark claims must survive replay and audit.

Internal baseline execution uses `BenchmarkBaselineRunner` plus the normal Kiln
runtime session path. The runner owns pass^k, scorer application, and typed
artifact emission; the CLI/runtime adapter owns provider routing, context
projection, tool metadata capture, and config hashing. Internal baseline scorers are
structural evidence checks, not hidden LLM judges: they score only Kiln-observed
evidence such as tool calls, route identity, handoff output, policy violations,
latency, and cost.

### Write-route promotion protocol

The two model-roster write profiles use protocol version 2. Version 1 datasets
and fixtures are removed rather than treated as comparable history. Promotion
requires eight distinct cases and five valid trials per case. A valid trial is a
completed provider execution whose fixed verifier can judge the candidate; an
infrastructure or route failure is retained as an invalid trial and is not
converted into a semantic model failure. The runner retries only cases that
still lack valid coverage, up to two invalid retries per required trial.

`passRate` is pass^1 over valid trials. `passAtK` is pass^k: the fraction of
cases whose five valid trials all pass. Both carry Wilson 95% intervals.
Promotion requires `passRate >= 0.80`, `passAtK >= 0.75`, complete valid-trial
coverage, and `invalidTrialRate <= 0.10`. Correctness verification, diff
integrity, and execution integrity are admission scorers. Tool trajectory,
latency, and cost remain diagnostics and cannot veto an otherwise correct
candidate or rescue an incorrect one.

Write benchmarks require an explicit configured execution-route id. The
benchmark dispatcher uses the same canonical route admission, account lease,
credential binding, dispatch fence, and settlement path as operator runs.
Provider/model flags that could name one route while executing another are not
accepted. A newly claimed operator-session capacity generation recovers stale
pre-dispatch capacity before admitting new work; post-dispatch unknown outcomes
remain retained for reconciliation.

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

## Bounded-Work Authority Benchmark

The contract under test is
[`bounded-work-authority.md`](../core/bounded-work-authority.md). The
[bounded-work research record](../../research/41-bounded-work-authority-2026.md)
defines the Slice 0 methodology for testing scope fidelity and overengineering
control, which remains research because the experiment has not been run. This is
a future paired experiment, not a current default or efficiency claim.

The control and bounded-authority arms must freeze the same task definitions,
repository/project snapshot, target and acceptance tests, provider/model,
reasoning setting, route policy, harness and adapter commits, authority profile,
tool catalog, context/memory inputs, configuration hash, scorer versions, and
operator intervention protocol. The bounded arm additionally records the
immutable contract digest, scope envelope, ceiling policy, tripwire policy, and
candidate lineage. Randomize arm/item order where practical, use repeated runs,
and report the full distribution plus failed and omitted cases under the same
pass^k gate as other profiles.

Quality and safety are primary outcomes. Each item records behavioral
correctness, target verification, semantic in-scope/out-of-scope effects,
non-goals touched, review findings, escaped defects, residual risk, and human
intervention. Operational evidence records input/output/cache token classes,
unknown classes, duration, tool calls, attempts, child count/concurrency/depth,
review and correction rounds, gross/accepted/discarded/superseded churn, and
typed stop/settlement state. Unknown usage remains unknown; it is not imputed
as zero or treated as comparable provider spend.

Overengineering is scored against the declared semantic scope and acceptance
contract. Changed files, lines, and diff size are structural observations or
tripwires, not a fixed risk classifier. Deterministic structural scorers are
primary. Expert adjudication or a calibrated secondary LLM judge may assess
semantic overengineering only with its rubric, agreement, and limitations
reported; a hidden judge cannot establish the result.

The report must bind every pair to exact target/candidate identities, contract
revision, evidence artifacts, and configuration. A result may describe an
effect under this fixture and route. It must not generalize to model quality,
provider economics, or native-harness parity without a separately admitted
design. Subscription prices, unavailable usage, synthetic fixture results,
provider self-reports, and unverified clone claims are unsupported efficiency
evidence.

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
