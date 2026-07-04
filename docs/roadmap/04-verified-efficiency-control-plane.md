# 04 - Verified Efficiency Control Plane

Status: Active architecture program; Slice 0 and Slice 1 complete; Slice 2
requires restart after failed GUI implementation attempt

Progress: Slice 1 closed on 2026-07-01 in commit `f1f4baef`
(`feat(runtime): record lifecycle attribution ledger`). Slice 0 live baseline
work started on 2026-07-02 and exposed provider-tool compatibility, route-error
classification, and subscription-economic evidence blockers. The
provider-neutral benchmark-integrity prerequisites closed on 2026-07-02 in
commits `d0d9ecf9`, `41d28e5f`, `e74eb1b3`, and `bd2c0480`. An authorized
post-repair pilot then proved the token-pressure repair on four live routes,
and an authorized `k=5` comparison promoted only the bounded local routing
decision for `kiln-tool-agent`: Codex GPT-5.5 remains primary and Kimi K2.7
Code remains an eligible fallback/specialist route. Slice 2 was attempted
through Kiln GUI on 2026-07-03, but the attempt was reverted before commit
because it violated the stable-prefix contract and left incomplete workflow
evidence. Slices 2 through 12 are not started.

## Objective

Make verified engineering value the regulated output of Kiln's control plane.
Kiln should allocate context, models, reasoning effort, tools, memory,
delegation, and verification so that each admitted unit of cost contributes to
a correct, authorized, evidence-backed outcome.

The program optimizes verified outcomes per token, dollar, second, and agent
turn. It does not optimize token count in isolation.

## Goals

- Attribute cost and tokens to lifecycle sources before optimizing behavior.
- Reduce waste through measured, reversible, and evidence-backed actuators.
- Preserve authority, evidence, replay, and verification semantics across
  providers, harnesses, and operator surfaces.
- Promote efficiency policy only through reproducible benchmarks, holdouts,
  rollback paths, and residual-risk evidence.

## Scope

- Provider-neutral lifecycle ledger, efficiency controller, and policy evidence.
- Context admission, reduction, retrieval, caching, routing, delegation,
  verification, memory, and output-allocation decisions.
- Cross-surface projections for measured, estimated, cached, and avoided cost.
- Benchmark and promotion gates for verified engineering value.

## Sequel Standards

- No optimization before instrumentation.
- No duplicate context-policy, routing, memory, or verification owner.
- No silent lossy reduction.
- No benchmark-only prompt path or compatibility shim.
- No policy promotion without tests, typecheck, benchmark evidence, rollback,
  and review.

## Governing Thesis

Efficiency is a control problem, not a prompt-compression feature.

Kiln observes execution pressure and outcome quality, compares them with
declared budgets and verification criteria, applies bounded control actions,
and records enough evidence to evaluate and reverse each policy decision.

The biocybernetic mapping is explicit:

- sensors measure token flow, cost, latency, cache behavior, task state,
  authority, evidence fidelity, and verification outcomes;
- controllers allocate budgets and choose bounded efficiency actions;
- actuators admit, defer, retrieve, compact, cache-align, route, delegate, or
  escalate work;
- feedback compares predicted utility with verified outcomes;
- adaptation promotes only policies that improve a reproducible Pareto
  frontier without violating hard invariants.

Biological inspiration may guide regulation, attention, memory, inhibition,
and adaptation. Explicit software contracts remain authoritative.

## Problem Statement

Kiln already contains context governance, token and cost accounting, budget
admission, model routing, continuity artifacts, managed-agent execution, and
evaluation primitives. These mechanisms currently regulate separate stages.
They do not yet form one end-to-end efficiency loop with common attribution,
utility, policy, and promotion evidence.

The immediate measured failure is a successful research turn that consumed
565,377 input tokens, 7,646 output tokens, and 433,152 cache-read tokens. That
case is now the first named benchmark workload inside this roadmap. It is not
the program boundary and does not create a separate research-only budgeting
owner.

## Outcomes

This roadmap is successful when Kiln can:

1. Attribute model-facing tokens and cost to their lifecycle source.
2. Explain why each context block, tool schema, artifact, and worker result was
   admitted, deferred, compacted, or retrieved.
3. Compare efficiency policies on verified quality, cost, latency, risk,
   evidence fidelity, and replay divergence.
4. Apply lossless or reversible reductions before considering lossy ones.
5. Route models, reasoning effort, and delegation by task phase and measured
   utility rather than static provider preference alone.
6. Preserve equivalent governance and evidence semantics across direct
   providers, harness adapters, CLI, GUI, TUI, SDK, and gateway execution.
7. Promote policy changes only after reproducible benchmark and holdout
   evidence.

## Non-Goals

- Minimize tokens regardless of task outcome.
- Add a universal compressor in front of every provider request.
- Replace provider-native caching or compaction with a parallel imitation.
- Treat model reasoning traces as authoritative verification evidence.
- Introduce benchmark-only execution paths or prompt variants.
- Move authority, safety, or verification policy into model instructions.
- Preserve obsolete context or routing behavior behind compatibility shims.
- Add a second context-policy owner beside `ContextGovernor`.
- Add a research-only budgeting engine beside this efficiency control plane.
- Build online learning before stable telemetry and deterministic baselines
  exist.

## Architectural Decisions

### D1. Verified utility is the optimization target

Token reduction is accepted only when verified task success and hard
invariants are preserved. A cheaper unverified result does not dominate a
verified result.

### D2. Context admission remains owned by ContextGovernor

Efficiency policy may provide budgets, scores, and permitted transformations.
It must not assemble model context independently. All admitted and deferred
context remains visible in the canonical context audit.

### D3. Raw evidence and model-facing projections are separate

Canonical artifacts remain available outside the active context window.
Compacted projections reference immutable source identities and hashes.
Reversible projections include an explicit retrieval handle and model-visible
omission disclosure.

### D4. Reduction modes are explicit

Every transformation is classified as:

- `lossless`: representation changes without semantic omission;
- `reversible`: information is omitted from active context but the exact
  source remains retrievable;
- `lossy-derived`: a marked derivative that never replaces canonical evidence.

Silent lossy replacement is forbidden.

### D5. Authority cannot be compressed or inferred

Permission, approval, tenancy, trust, and action-effect contracts are stable
control data. Summaries, retrieved content, memories, workers, and caches
cannot widen authority.

### D6. Replay is evidence replay, not deterministic model reproduction

Kiln guarantees replayable inputs, policy decisions, tool events, artifacts,
authority decisions, provider identity, usage, and outputs. Provider
nondeterminism is recorded as replay divergence rather than hidden behind a
claim of byte-identical re-execution.

### D7. Instrumentation precedes optimization

No behavior-changing efficiency policy is promoted before Kiln can attribute
its cost and verify its outcome against a reproducible baseline.

### D8. Learning is advisory until promotion evidence exists

Learned admission, routing, or adaptation may produce policy candidates. A
candidate cannot mutate production policy directly. Promotion requires a
versioned policy, fixed holdout, rollback path, and evidence of improvement.

## Hard Invariants

- No promoted policy reduces verified success outside the declared confidence
  and non-inferiority bounds.
- No derived artifact grants authority or changes an approval requirement.
- Every actionable factual claim can resolve to canonical evidence.
- Every lossy transformation is labeled and excluded from canonical evidence.
- Every reversible transformation exposes its omission and retrieval path.
- Safety-critical and authority-critical context is never silently truncated.
- Cache entries are partitioned by tenant, workspace, policy identity, route,
  and authority scope where those dimensions affect admissibility.
- Cross-surface and cross-harness paths emit comparable efficiency evidence.
- Policy promotion is versioned, auditable, reversible, and fail-closed.
- Optimization code does not introduce duplicate context, routing, memory,
  or verification owners.

## Control Model

The long-term controller consumes:

- task class, phase, complexity, and verification requirements;
- provider, model, context-window, pricing, and cache capabilities;
- context candidates and their authority, provenance, recency, relevance,
  estimated cost, and retrieval cost;
- current and projected token, dollar, latency, and turn budgets;
- tool and worker execution state;
- historical outcomes from compatible benchmark and production cohorts.

It produces bounded decisions:

- context budget allocation;
- admission, inhibition, deferred retrieval, or explicit overflow;
- allowed transformation mode per artifact type;
- provider, model, and reasoning-effort route candidates;
- direct execution, fresh-context delegation, or shared-artifact handoff;
- verification depth and escalation threshold;
- stop, continue, compact, retrieve, retry, or request operator input.

The controller does not execute tools, mint authority, store canonical memory,
or mark work verified. Those responsibilities remain with their existing
owners.

## Measurement Contract

The canonical ledger must attribute usage at request, turn, phase, worker,
tool, and artifact boundaries. The contract should include:

- session, turn, work-item, worker, and parent lineage;
- task class, phase, policy version, route, provider, model, and reasoning
  effort;
- lifecycle source: control instructions, procedural context, memory,
  knowledge, coordination, transcript, tool schema, tool output, repository
  evidence, web evidence, verification, or final output;
- raw, admitted, deferred, cached, cache-written, generated, and estimated
  reasoning tokens where the provider exposes them;
- bytes, wall time, provider cost, tool latency, and retry count;
- artifact identity, source hash, authority scope, trust zone, transformation
  mode, ratio, retrieval handle, and retrieval use;
- context admission reason and audit identity;
- verification criteria, result, evidence references, and residual risk;
- replay divergence and provider capability limitations.

Provider-reported usage remains the source of truth for billed tokens. Kiln
estimates are labeled and used for preflight allocation or providers that do
not expose complete usage.

## Utility And Promotion Policy

Kiln evaluates a vector, not one blended vanity score:

- verified task success;
- evidence fidelity and citation correctness;
- authority and safety violations;
- uncached input, cached input, output, and reasoning tokens;
- total cost and wall-clock latency;
- tool calls, retries, turns, and delegated workers;
- replay completeness and divergence;
- operator intervention and unresolved residual risk.

Pareto comparison is the default. Hard invariants gate eligibility before any
weighted utility is considered. Weighted utility may rank eligible policies
inside one declared task class, but it must not hide a regression in a gated
dimension.

## Delivery Slices

Each slice is independently reviewable and must close with tests, typecheck,
benchmark evidence, and a residual-risk statement. Later slices may refine
contracts but must not create parallel legacy paths.

## Progress Status

| Slice | Status | Progress | Next Action |
| --- | --- | --- | --- |
| Slice 0 - Baseline And Reproduction | Complete | The authorized 2026-07-02 `kiln-tool-agent` work established the pre-repair pressure source, repaired provider-neutral benchmark prerequisites, validated the post-repair `k=1` baseline across four live routes, and ran a viable-route `k=5` comparison for Codex GPT-5.5 and Kimi K2.7 Code. The old 419,972-940,391 input-token pressure was primarily a Kiln request-shaping/tool-projection problem. The remaining GPT-5.5 versus Kimi difference is model and harness behavior under the same Kiln control plane. | Start Slice 2 stable prefix and cache topology before making broader savings or public benchmark claims. |
| Slice 1 - Lifecycle Attribution Ledger | Complete | Closed on 2026-07-01 in commit `f1f4baef`. Lifecycle attribution contracts, runtime events, operator/resource projections, managed-route descriptors, and fixture reconciliation are in place. | Promote stable doctrine when later slices prove the broader control loop. |
| Slice 2 - Stable Prefix And Cache Topology | Next | Not started. A 2026-07-03 Kiln GUI implementation attempt was reverted before commit. See the failed-attempt audit below. | Restart from TDD with real stable-prefix semantics and integrate with existing provider-request evidence instead of adding prompt-visible cache metadata. |
| Slice 3 - Progressive Context And Tool Loading | Planned | Not started. | Start after stable-prefix evidence exists. |
| Slice 4 - Typed Lossless Reduction | Planned | Not started. | Start after progressive-loading measurements identify high-volume structured artifacts. |
| Slice 5 - Reversible Context Projection | Planned | Not started. | Start after typed reductions have preservation contracts. |
| Slice 6 - Context Utility Allocation | Planned | Not started. | Start after lossless and reversible projection data exists. |
| Slice 7 - Phase-Aware Route And Effort Control | Planned | Not started. | Start after context utility evidence defines task-class tradeoffs. |
| Slice 8 - Delegation And Handoff Efficiency | Planned | Not started. | Start after route and context costs are attributable. |
| Slice 9 - Output And Verification Allocation | Planned | Not started. | Start after verification cost is independently attributable. |
| Slice 10 - Memory Efficiency And Reconsolidation | Planned | Not started. | Start after memory injection and recall costs are visible in the ledger. |
| Slice 11 - Controlled Adaptation | Planned | Not started. | Start only after stable production evidence and holdouts exist. |
| Slice 12 - Surface Parity And Public Evidence | Planned | Not started. | Start as contracts stabilize; public claims remain last. |

### Slice 0 - Baseline And Reproduction

Status: Complete on 2026-07-02.

Goal: establish the current token and quality baseline before changing
behavior.

Work:

- reproduce or replace the 2026-06-29 research-turn workload with a stable
  fixture;
- select representative coding, tool-use, memory, managed-agent, and research
  tasks;
- capture provider usage, cost, latency, tool counts, verification results,
  and existing context audits;
- define stable fixtures, seeds where supported, and provider limitations;
- publish a benchmark manifest and baseline report without marketing claims.

Prerequisite repair work closed in `docs/plan.md`. It repaired reversible
provider tool identities, canonical route-failure evidence, honest
subscription economics, and typed reproducible benchmark artifacts before
further live samples are admitted. These are normal execution-path
corrections, not benchmark-only adapters.

Closed prerequisite commits:

- `d0d9ecf9 fix(core): preserve canonical tool identities across providers`
- `41d28e5f fix(routing): classify provider route failures`
- `e74eb1b3 feat(cost): expose comparable execution cost evidence`
- `bd2c0480 feat(benchmark): emit reproducible baseline evidence`

Token-pressure diagnostic evidence before the tool-projection repair:

- the operator explicitly authorized live network, credential, quota, and
  possible subscription-inference use on 2026-07-02;
- four sequential `k=1` runs used the normal `kiln benchmark run-internal`
  path with profile `kiln-tool-agent`;
- Codex GPT-5.5 recorded 424,726 input tokens, 1,281 output tokens, and
  94,489 ms;
- Kimi K2.7 Code recorded 419,972 input tokens, 2,481 output tokens, and
  114,256 ms;
- GLM 5.2 recorded 940,391 input tokens, 3,267 output tokens, and 108,503 ms;
- DeepSeek V4 Pro recorded 859,793 input tokens, 6,778 output tokens, and
  166,363 ms;
- every route recorded `passAtK = 0.5`; the search-contract item passed while
  `tool-read-file` tool-call accuracy remained partial;
- every route reported subscription economics with zero per-call metered
  amount and `comparable = false`; this is honest evidence, not proof of zero
  economic cost;
- local typed artifacts are retained under `.kiln/benchmarks/` as
  `post-repair-gpt-5.5-k1.json`, `post-repair-kimi-k2.7-code-k1.json`,
  `post-repair-glm-5.2-k1.json`, and
  `post-repair-deepseek-v4-pro-k1.json`;
- the artifacts remain operator-local and ignored by Git.

That evidence identified two separate causes:

- the extreme 419,972-940,391 input-token pressure was primarily Kiln's
  responsibility because benchmark sessions advertised too much tool surface
  and resent large stable request regions across tool rounds;
- route-to-route differences after the repair are primarily model and harness
  behavior under the same Kiln control plane: how often a model calls tools,
  how much supporting exploration it performs, and when it stops.

Post-repair `k=1` validation evidence:

| Route | passAtK | Input tokens | Prior input | Delta | Requests | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Codex GPT-5.5 | 1.0 | 37,354 | 424,726 | -91.2% | 9 | Passed bounded pilot. |
| Kimi K2.7 Code | 1.0 | 76,496 | 419,972 | -81.8% | 17 | Passed bounded pilot. |
| GLM 5.2 | 0.5 | 19,023 | 940,391 | -98.0% | 5 | Failed readiness on search latency. |
| DeepSeek V4 Pro | 0.5 | 71,366 | 859,793 | -91.7% | 15 | Failed search tool trajectory. |

The post-repair pilot proved the bounded token-pressure repair: all four
routes used the authority-admitted deferred tool surface and a reduced request
envelope. GLM 5.2 and DeepSeek V4 Pro were not promoted for this profile
because quality gates matter before token savings.

Viable-route `k=5` comparison evidence:

| Route | passAtK | Input tokens | Output tokens | Requests | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Codex GPT-5.5 | 1.0 | 192,637 | 6,702 | 48 | 374,166 ms |
| Kimi K2.7 Code | 1.0 | 388,909 | 12,851 | 67 | 470,523 ms |

Both routes qualify as internal baselines for `kiln-tool-agent`. Codex GPT-5.5
remains the primary route for this profile because it matched Kimi's verified
quality while using materially less input, output, request, and latency budget.
Kimi remains an eligible fallback or specialist route. This is a bounded local
routing decision, not a public leaderboard or broad model-capability claim.

Reasoning-effort limitation: the operator's global config declares a normalized
reasoning policy, but these benchmark runs did not explicitly fix, vary, or
record resolved reasoning effort. The evidence therefore compares provider
routes under the current execution path, not effort levels. Any future
effort-sensitive promotion must include resolved effort, support/omission
evidence, and effort policy identity in the benchmark config hash.
For the current workstation budget, `high` is the maximum default effort;
`xhigh` is reserved for explicit opt-in experiments or rare critical reviews
after token, latency, and quota impact are measured.

Exit gate:

- the same workload can be rerun through supported execution surfaces;
- token totals reconcile with provider usage or document the discrepancy;
- verified outcome and evidence completeness are scored independently of cost;
- any live pilot is explicitly authorized because it may use network,
  credentials, quota, or paid inference;
- local route promotion is bounded to the measured profile and does not become
  a public marketing claim.

### Slice 1 - Lifecycle Attribution Ledger

Status: Complete on 2026-07-01 in commit `f1f4baef`.

Goal: make every material token source attributable without changing routing
or context behavior.

Work:

- define provider-neutral ledger contracts in `@kilnai/core`;
- emit normalized usage and lifecycle events from runtime execution;
- preserve raw provider usage and label estimates;
- project read-only summaries through existing resource and operator surfaces;
- add fixture-based reconciliation and replay tests.

Exit gate:

- baseline tasks produce complete lifecycle attribution;
- ledger emission does not alter provider requests or task outcomes;
- direct-provider and harness routes disclose equivalent evidence or explicit
  capability gaps.

Closure evidence:

- Core lifecycle ledger contracts reconcile provider totals, preserve raw
  usage, retain unknown remainders, and replay deterministically from canonical
  evidence.
- Runtime appends lifecycle attribution after provider execution using admitted
  context-audit evidence and bounded final-output evidence; deferred context is
  auditable but not counted as provider input.
- Message-pipeline tests prove lifecycle attribution is absent from the
  provider request path and does not change the completed task outcome.
- Managed invocation descriptors declare token classes, semantic source
  granularity, and evidence basis so direct, CLI harness, and remote harness
  routes expose equivalent evidence or explicit capability gaps.
- Fixture benchmark
  `packages/core/evals/benchmark/kiln-lifecycle-attribution-v1.jsonl` proves
  deterministic reconciliation, replay, unknown attribution, cache token-class
  handling, and no fabricated source precision. Runtime/gateway and
  managed-route tests prove request/outcome neutrality and declared route-gap
  behavior.

### Slice 2 - Stable Prefix And Cache Topology

Status: Next; not started. A failed GUI implementation attempt on 2026-07-03
was reverted before commit.

Goal: reduce repeated prefill cost without changing admitted information.

Work:

- identify stable and volatile request regions per provider adapter;
- version and hash stable policy, instruction, skill, and tool-schema blocks;
- move volatile identifiers and turn-local context outside reusable prefixes;
- model cache invalidation as a route cost;
- measure hit rate, cached-token ratio, cost, and latency before and after.

Exit gate:

- byte-stable eligible prefixes are proven by fixtures;
- cache gains do not change authority, tool availability, or outputs beyond
  expected provider nondeterminism;
- tenant and authority partition tests prevent invalid cache reuse.

Failed-attempt audit, 2026-07-03:

- The Kiln GUI session correctly started with `work_governance.assess`, which
  recommended orchestration because the task was multi-file, runtime-related,
  and verification-heavy.
- The session then used `read`, `resource_read`, `grep`, `tree`, `git`, `glob`,
  and `read_many` to scout the roadmap and affected core/runtime surfaces.
- Governance setup was attempted through `work_item.update`, `goal.create`,
  and `work_item.execution.start`. The first `work_item.update` failed because
  its work-classification provenance source id did not match the created work
  item. The session recovered from that input error but continued with a noisy
  control-flow path.
- `work_item.execution.start` initially paused because `managedInvocationId`
  was required for managed delegation. The session later proceeded without
  clear managed-child implementation evidence, so the effective workflow became
  direct execution despite the orchestration recommendation.
- Two `write` tool calls failed with `Irreversible workspace mutation requires
  confirmation`, but subsequent `patch` calls successfully mutated the
  workspace. That mismatch is authority-surface drift and must not be treated
  as a valid implementation path for governed work.
- The attempted implementation created a parallel stable-prefix contract that
  filtered all segments marked stable instead of requiring a leading contiguous
  stable prefix. That would permit unsafe reuse when stable content appears
  after volatile turn-local content.
- The attempted implementation used a local 32-bit FNV-style hash while
  existing request evidence uses `sha256:*` hashes. Slice 2 must use canonical
  evidence-grade hashing and must not create a weaker parallel identity scheme.
- Runtime prompt assembly was changed to inject cache topology into the model
  system prompt. That increases prompt bytes and changes model-visible content,
  contradicting the goal of reducing repeated prefill without changing admitted
  information.
- Test execution was noisy and environment-confused: `bunx`, `cmd /c`, and
  `bun` failed in the monitor shell before the session fell back to `npm exec`
  and workspace npm scripts. Future GUI execution must select the correct
  command surface up front.
- Verification polling was excessive: the session used many `monitor_read`
  calls, started a final core-test monitor, and ended without an assistant
  closeout, commit, work-item completion, or clean evidence summary because the
  model token budget was exhausted.
- All code and test changes from this failed attempt were reverted. The only
  retained artifact is this audit so the next Slice 2 attempt does not reuse
  the invalid design or the invalid workflow evidence.

Restart requirements:

- Start with failing tests for a true leading stable prefix: once a volatile
  segment appears, later content cannot be part of the reusable prefix for that
  request.
- Reuse or extend existing provider-request evidence and `sha256:*` hashing
  rather than adding a parallel cache-identity scheme.
- Do not put cache topology into the model-visible prompt. Cache evidence must
  be telemetry/control-plane evidence unless a later slice explicitly proves a
  model-visible disclosure requirement.
- Treat mismatched `write` denial plus `patch` success as an authority bug or
  pause condition for governed GUI work, not as permission to continue silently.
- Close the slice only after focused tests, typecheck, build, review evidence,
  roadmap evidence, commit, and clean worktree status are all present.

### Slice 3 - Progressive Context And Tool Loading

Status: Planned; not started.

Goal: stop admitting procedural context and tool schemas before they are
needed.

Work:

- admit skill metadata and tool catalog entries before full definitions;
- load exact skill instructions and schemas only after governed selection;
- preserve startup and offline behavior through cached indexes;
- record selection reason, bytes, tokens, and cache effects;
- keep `ContextGovernor` as the sole model-context admission owner.

Exit gate:

- task success is non-inferior to eager loading;
- irrelevant skill and tool-schema tokens decline on representative tasks;
- selected capabilities remain inspectable and replayable.

### Slice 4 - Typed Lossless Reduction

Status: Planned; not started.

Goal: remove representational waste from structured artifacts without losing
information required by the task or verifier.

Work:

- define typed reducers for high-volume search, tree, table, JSON, test, log,
  and repository outputs;
- preserve exit status, severity, skipped tests, warnings, identifiers, source
  locations, and omission counts;
- reject a reduction when the artifact type or preservation contract is
  unknown;
- keep raw artifacts in the canonical resource plane;
- run adversarial fixtures against rare but critical signals.

Exit gate:

- exact preservation contracts pass for every supported reducer;
- no reducer relies on unbounded regex heuristics as its semantic contract;
- unknown or malformed input fails open to the canonical artifact, not to a
  silently incomplete projection.

### Slice 5 - Reversible Context Projection

Status: Planned; not started.

Goal: reduce active context while preserving exact evidence on demand.

Work:

- add immutable artifact references and retrieval handles;
- expose explicit model-visible omission disclosures;
- permit `ContextGovernor` to choose full, reduced, or reversible projections;
- record retrieval opportunities, attempted retrievals, and missed-absence
  failures;
- verify citations and sensitive actions against canonical artifacts.

Exit gate:

- exact original content is retrievable from every reversible projection;
- artifact expiry cannot invalidate active verification evidence;
- benchmarks include hidden-critical-item and absent-evidence probes;
- the model cannot mistake a projection for complete canonical evidence.

### Slice 6 - Context Utility Allocation

Status: Planned; not started.

Goal: improve context admission beyond whole-block greedy scoring while
preserving deterministic policy and auditability.

Work:

- establish semantic relevance as the baseline;
- add authority, verification value, recency, novelty, retrieval cost,
  redundancy, and task-phase signals;
- compare whole-block, segmented, and retrieval-on-demand allocation;
- resolve required-context overflow through declared policy rather than silent
  budget violation;
- test ordering and position effects per supported model family.

Exit gate:

- candidate policies beat or match the baseline on verified outcomes at lower
  cost for at least one declared task class;
- no learned or model-judged score can override required authority or safety
  context;
- deferred and rejected candidates remain auditable.

### Slice 7 - Phase-Aware Route And Effort Control

Status: Planned; not started.

Goal: spend model capability where it changes verified outcomes.

Work:

- replace lexical complexity alone with measured task, phase, uncertainty,
  tool, and verification signals;
- evaluate model cascades and reasoning-effort controls behind provider
  capability adapters;
- make benchmark runs able to fix or sweep normalized reasoning effort, record
  the resolved effort or omission reason, and include that evidence in
  reproducibility hashes;
- treat `xhigh` as a budget-gated experimental tier until it proves
  non-inferior value per token against `high` for a declared task class;
- include cache invalidation, retry risk, and verifier cost in route decisions;
- require escalation paths for uncertain or failed cheap routes;
- keep static deterministic routing as the rollback policy.

Exit gate:

- route policies publish per-task-class Pareto evidence;
- unsupported provider controls fail closed or use documented defaults;
- lower-cost routes cannot mark work verified without the same verification
  contract as higher-cost routes.

### Slice 8 - Delegation And Handoff Efficiency

Status: Planned; not started.

Goal: choose direct execution, fresh-context delegation, and shared-artifact
handoffs according to task shape and measured coordination cost.

Work:

- measure parent prompt, child bootstrap, duplicated reads, handoff, review,
  and synthesis cost separately;
- keep parent context thin without lending ambient authority;
- pass canonical artifacts and admitted context, not raw transcript by
  default;
- compare breadth-oriented research with tightly coupled code changes;
- preserve managed-agent identity, route, authority, lifecycle, terminal
  result, and replay evidence.

Exit gate:

- delegation defaults are justified per task class;
- child execution never widens parent authority;
- failed or incomplete handoffs retain enough evidence for deterministic
  recovery or operator escalation.

### Slice 9 - Output And Verification Allocation

Status: Planned; not started.

Goal: reduce generated tokens and verification expense without hiding status
or weakening proof.

Work:

- separate output verbosity from reasoning effort;
- prefer structured result contracts for machine-consumed handoffs;
- use deterministic verification before model judges where possible;
- allocate review depth by action effect, uncertainty, and blast radius;
- keep verification state outside model prose.

Exit gate:

- concise outputs preserve required operator decisions, evidence, and residual
  risk;
- verification cost is attributed independently;
- no output-shaping policy suppresses failures, warnings, citations, or
  approval requirements.

### Slice 10 - Memory Efficiency And Reconsolidation

Status: Planned; not started.

Goal: reduce transcript replay and repeated discovery through governed memory,
not indiscriminate persistence.

Work:

- measure write, recall, injection, and stale-memory cost by memory layer;
- filter writes by durability, provenance, confidence, contradiction, and
  future task value;
- separate recall eligibility from context-injection eligibility;
- evaluate consolidation, expiration, correction, and forgetting offline;
- prevent untrusted derivatives from becoming authoritative memory.

Exit gate:

- memory improves verified continuity at lower replay cost;
- stale, contradictory, or poisoned records are detected by fixtures;
- reconsolidation is reversible and does not erase canonical evidence.

### Slice 11 - Controlled Adaptation

Status: Planned; not started.

Goal: allow Kiln to improve efficiency policy without silent drift.

Work:

- generate versioned policy candidates from ledger evidence;
- evaluate candidates in replay, shadow, and fixed holdout cohorts;
- require minimum sample size and declared confidence bounds;
- expose promotion, rollback, and freeze controls;
- monitor distribution shift, rare-task regressions, and cache interactions.

Exit gate:

- no candidate self-promotes;
- rollback restores the prior deterministic policy without data migration;
- holdout evidence shows improvement without hard-invariant regression.

### Slice 12 - Surface Parity And Public Evidence

Status: Planned; not started.

Goal: make efficiency behavior inspectable and comparable without turning the
operator UI into a policy owner.

Work:

- project canonical ledger and policy evidence to CLI, GUI, TUI, SDK, gateway,
  and managed-agent resources;
- show measured, estimated, cached, and avoided tokens distinctly;
- report quality and verification beside savings;
- publish benchmark methodology, fixtures, limitations, and reproducible
  reports before making performance claims;
- define the evidence threshold for any future public harness-comparison
  roadmap covering Codex CLI, Claude Code, OpenCode, Gentle AI, Headroom, or
  other agent harnesses;
- promote stable contracts into architecture and guides.

Exit gate:

- surfaces agree on canonical totals and policy identity;
- operators can trace a saving to its action and verification result;
- public claims reproduce from committed fixtures and disclose vendor or
  provider dependencies.
- any marketing-facing benchmark program is opened only after this slice can
  supply reproducible artifacts, methodology, failed cases, and limitations.

## Benchmark Program

The benchmark portfolio must cover:

- software changes with executable tests and diff review;
- structured tool use and schema selection;
- long logs, failed tests, warnings, and rare critical signals;
- repository exploration and repeated file access;
- research with citations and recoverable source evidence;
- long-session continuity and correction of stale memory;
- managed-agent delegation, timeout, retry, and handoff;
- prompt injection, memory poisoning, authority escalation, and cache
  partitioning;
- exact reproduction of identifiers, numbers, stack traces, SQL, and config;
- short tasks where optimization overhead should be bypassed.

External benchmarks may supplement this portfolio, but internal fixtures must
exercise Kiln's authority, evidence, replay, and cross-surface contracts.

### Initial Research-Turn Workload

The first high-pressure workload is the 2026-06-29 GUI research turn with
`codex-oauth/gpt-5.5`. The turn completed correctly, produced visible
citations, accurate tool events, and a clean `completed` outcome, but consumed:

- 565,377 input tokens;
- 7,646 output tokens;
- 433,152 cache-read tokens.

This workload must be reproduced or replaced with an equivalent committed
research-heavy fixture before research-specific savings are claimed. Its
budgeting work belongs to this roadmap and uses this roadmap's lifecycle
attribution, context admission, reduction, retrieval, cache, and promotion
contracts.

Research-turn evidence budgeting must preserve:

- exact source URLs in user-facing answers when web tools inform the result;
- citations, tool metadata, transcript events, and session evidence;
- accurate tool counts in continuity artifacts and session summaries;
- cross-surface semantics for GUI, CLI, TUI, SDK, gateway, and managed-agent
  invocations;
- research-only behavior that does not accidentally materialize governed work
  items.

The implementation path is:

1. Reproduce or replace the original research workload with a stable fixture.
2. Attribute research-turn tokens by lifecycle source:
   - projected session and context artifacts;
   - prior transcript replay;
   - web search and extraction outputs;
   - repository inspection outputs;
   - tool summaries;
   - model-facing procedural instructions;
   - memory and continuity artifacts;
   - verification evidence;
   - final output.
3. Define the canonical research evidence budget and compaction boundary.
4. Add cross-surface projections for measured, estimated, cached, and avoided
   research-token volume.
5. Promote stable doctrine into architecture and guides after verification.

Research-specific optimization must not use prompt-only quick fixes,
provider-specific hidden truncation, ungrounded summaries replacing primary
sources, or silent evidence dropping.

## Research Basis

This roadmap is grounded in the 2026-06-29 research-turn token incident,
comparative harness research, Kiln's existing context governance,
provider/model discovery, managed-agent runtime, memory, and benchmark
contracts. Later slices must add reproducible benchmark evidence before making
performance or savings claims.

## Required Ablations

- no optimization versus each isolated actuator;
- eager versus progressive skill and tool loading;
- raw versus typed lossless versus reversible projection;
- semantic relevance versus multi-signal context allocation;
- stable-prefix versus current request layout;
- one model versus phase-aware routing and cascades;
- direct execution versus fresh-context delegation versus shared transcript;
- full replay versus governed memory and artifact recall;
- fixed verbosity versus output shaping;
- deterministic policy versus learned candidate under holdout.

Every ablation reports break-even workload size and preprocessing overhead.

## Promotion Gates

A slice may become production policy only when:

1. Its owning contract and boundary are documented.
2. Targeted unit and integration tests pass.
3. Repository typecheck passes.
4. Baseline and candidate run on the same fixtures and task definitions.
5. Verified outcome is non-inferior within declared bounds.
6. Authority, safety, evidence, and replay invariants pass adversarial tests.
7. Provider and harness limitations are explicit.
8. Rollback removes the candidate behavior without preserving a shadow legacy
   path.
9. Residual risks and unsupported cases are recorded.
10. Stable behavior is promoted into canonical architecture or guide docs.

## Verification

Every slice must close with targeted tests, repository typecheck, benchmark or
fixture evidence appropriate to the slice, cross-surface evidence when behavior
is projected to operators, and a reviewer-confirmed residual-risk statement.
Behavior-changing policies also require baseline/candidate comparison,
rollback proof, and hard-invariant checks before promotion.

## Rollback Strategy

Each behavior-changing actuator is guarded by a versioned policy selection,
not scattered feature flags. Rollback selects the last verified deterministic
policy and leaves ledger evidence intact. Data written by an experiment must
use forward-compatible canonical contracts or be disposable; rollback must not
require dual readers, migration shims, or permanent compatibility branches.

## Relationship To Existing Roadmaps

- The former research-turn token-budgeting roadmap has been merged into this
  roadmap. The research-turn incident is the first measured workload here, not
  a separate policy owner.
- A possible future public benchmark and harness-comparison roadmap belongs
  after Slice 12 evidence gates. Roadmap 04 owns the science: attribution,
  reproducibility, cross-surface evidence, and promotion policy. A later
  marketing-facing roadmap may package comparisons against Codex CLI, Claude
  Code, OpenCode, Gentle AI, Headroom, or other harnesses only after those
  gates are satisfied.
- `docs/architecture/harness-integration-capabilities.md` and
  `docs/architecture/managed-agents.md` supply route identity and capability
  evidence required for cross-harness comparison.
- `00-rust-module-optimization.md` governs any native acceleration of
  reducers, tokenizers, hashes, or ledger hot paths. TypeScript retains policy
  ownership.
- `02-public-release-ui-debt.md` remains responsible for truthful operator
  presentation. This roadmap supplies canonical efficiency evidence; UI
  surfaces do not invent local percentages or policy.

## Initial Execution Order

1. Slice 0: complete; baseline and reproduction evidence is available for
   starting Slice 2 without broader pre-optimization sampling.
2. Slice 1: complete.
3. Slice 2: stable prefix and cache topology.
4. Slice 3: progressive context and tool loading.
5. Slice 4: typed lossless reduction.
6. Slice 5: reversible context projection.
7. Slice 6: context utility allocation.
8. Slices 7 through 10 based on measured dominant cost and risk.
9. Slice 11 only after stable production evidence exists.
10. Slice 12 as contracts stabilize, with public claims last.

The order is deliberate: measure first, take quality-neutral savings next,
introduce reversible reduction before lossy policy, and learn only after the
system can detect its own regressions.

## Open Decisions Requiring Evidence

- The canonical name and package boundary of the efficiency controller.
- Resolved by Slice 1: lifecycle attribution is recorded as canonical session
  ledger evidence plus pure core replay/reconciliation helpers, not as a
  parallel event store or provider-adapter side channel.
- The token estimation strategy used before provider admission.
- Artifact retention rules for reversible projections and active verification.
- The first supported typed reducers and their preservation contracts.
- Task-class-specific non-inferiority margins and confidence requirements.
- Provider-specific cache topology without leaking policy into adapters.
- The boundary between deterministic allocation and model-assisted scoring.
- When delegation overhead becomes beneficial for each task class.
- Which external benchmarks remain representative of Kiln's governed work.

These decisions must be resolved through the preceding slices. They are not
license to add parallel abstractions before evidence exists.

## Completion Criteria

This roadmap is complete when Kiln has one provider-neutral efficiency control
loop, one attributable ledger, one context-policy owner, explicit actuator
contracts, verified cross-surface evidence, and reproducible policy-promotion
gates; when stable doctrine has moved into `docs/architecture/` and operator
guidance into `docs/guides/`; and when superseded experimental code and policy
paths have been removed rather than retained as legacy behavior.
