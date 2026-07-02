# 04 - Verified Efficiency Control Plane

Status: Active architecture program; Slice 0 in progress, Slice 1 complete

Progress: Slice 1 closed on 2026-07-01 in commit `f1f4baef`
(`feat(runtime): record lifecycle attribution ledger`). Slice 0 live baseline
work started on 2026-07-02 and exposed provider-tool compatibility, route-error
classification, and subscription-economic evidence blockers. The
provider-neutral benchmark-integrity prerequisites closed on 2026-07-02 in
commits `d0d9ecf9`, `41d28e5f`, `e74eb1b3`, and `bd2c0480`. Slices 2 through
12 are not started.

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
| Slice 0 - Baseline And Reproduction | In progress | A bounded live tool-agent pilot ran on 2026-07-02. Successful routes exposed 421k-521k cumulative input-token pressure; Kimi rejected canonical dotted tool names; DeepSeek routes returned upstream 400 errors; Qwen returned transient 503; subscription economics were not comparable. Provider-neutral tool identity, route-failure classification, comparable cost evidence, and typed benchmark evidence are now implemented. | Run a bounded post-repair pilot with explicit operator authorization before any `k=5` comparison or routing promotion. |
| Slice 1 - Lifecycle Attribution Ledger | Complete | Closed on 2026-07-01 in commit `f1f4baef`. Lifecycle attribution contracts, runtime events, operator/resource projections, managed-route descriptors, and fixture reconciliation are in place. | Promote stable doctrine when later slices prove the broader control loop. |
| Slice 2 - Stable Prefix And Cache Topology | Next | Not started. | Prove byte-stable reusable request regions without changing admitted information. |
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

Status: In progress since 2026-07-02.

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

Exit gate:

- the same workload can be rerun through supported execution surfaces;
- token totals reconcile with provider usage or document the discrepancy;
- verified outcome and evidence completeness are scored independently of cost.
- any post-repair live pilot is explicitly authorized because it may use
  network, credentials, quota, or paid inference.

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

Status: Next; not started.

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
- promote stable contracts into architecture and guides.

Exit gate:

- surfaces agree on canonical totals and policy identity;
- operators can trace a saving to its action and verification result;
- public claims reproduce from committed fixtures and disclose vendor or
  provider dependencies.

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

1. Slice 0: conditional baseline and reproduction if Slice 2 needs broader
   pre-optimization evidence.
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
