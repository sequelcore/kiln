# 04 - Verified Efficiency Control Plane

Status: Complete on 2026-07-14.
Execution: Complete - all twelve slices are implemented, documented, and
verified by focused and repository-wide executable gates.

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
evidence. Slice 2 restarted on 2026-07-04 from TDD and closed with stable
prefix topology evidence, cache partition evidence, benchmark readiness,
cache-gain comparison evidence, and rollback/non-inferiority promotion gates.
Slice 3 started on 2026-07-04 and resumed on 2026-07-14 after Roadmap 06
live-verified Codex App submit, status, bounded result, cancellation, and
canonical lifecycle replay through Kiln's admitted OpenCode Go route. Slice 3
then closed with path-free metadata-first skill projection evidence and a
five-task eager-versus-progressive comparison that preserved 1.0 task success
while reducing total model-facing, irrelevant-skill, and irrelevant-tool-schema
tokens. Optional entitlement harnesses such as Claude Code remain conditional
while no admitted route exists. Slices 4 and 5 closed on 2026-07-14 with typed
lossless reducers, protected canonical evidence, disclosed reversible context,
and canonical evidence gates. Slice 6 then closed with deterministic
multi-signal allocation, segmentation, retrieval-on-demand, explicit overflow,
position profiles, and a five-task non-inferiority promotion gate. Slices 7
through 11 then closed the route/effort, delegation, output/verification,
memory, and controlled-adaptation loops. Slice 12 closed with one Core-owned
`verified-efficiency-evidence-v1` projection across every surface and a
content-verified publication gate. The committed reference bundle intentionally
makes no performance claim and reproduces as `internal-evidence-only`.

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
| Slice 0 - Baseline And Reproduction | Complete | The authorized 2026-07-02 `kiln-tool-agent` work established the pre-repair pressure source, repaired provider-neutral benchmark prerequisites, validated the post-repair `k=1` baseline across four live routes, and ran a viable-route `k=5` comparison for Codex GPT-5.5 and Kimi K2.7 Code. The old 419,972-940,391 input-token pressure was primarily a Kiln request-shaping/tool-projection problem. The remaining GPT-5.5 versus Kimi difference is model and harness behavior under the same Kiln control plane. | Closed; Slice 2 is now complete. |
| Slice 1 - Lifecycle Attribution Ledger | Complete | Closed on 2026-07-01 in commit `f1f4baef`. Lifecycle attribution contracts, runtime events, operator/resource projections, managed-route descriptors, and fixture reconciliation are in place. | Promote stable doctrine when later slices prove the broader control loop. |
| Slice 2 - Stable Prefix And Cache Topology | Complete | Closed on 2026-07-04 from TDD. Runtime provider-request evidence records leading stable-prefix topology, region hashes, stable-prefix bytes, stable-prefix region count, volatile-region bytes, and cache partition hashes for tenant, route, policy, and authority scope without changing provider request construction or model-visible prompts. Benchmark readiness requires `cache-topology` scorer and artifact evidence for `kiln-tool-agent`, including baseline/candidate cache-gain comparison evidence. Cache-policy promotion has a rollback and non-inferiority gate. | Start Slice 3 progressive context and tool loading. |
| Slice 3 - Progressive Context And Tool Loading | Complete | Closed on 2026-07-14. Runtime surfaces share one progressive tool projection helper with explicit authority profiles, next-round materialization, and replayable request evidence. Skill discovery is metadata-first; exact selected bodies emit path-free byte, token, reason, and cache-source evidence. A five-task normal-path comparison preserved eager success at 1.0 and reduced total model-facing, irrelevant-skill, and irrelevant-tool-schema tokens. | Closed; keep either authority profile unchanged until a future promoted comparison supports narrowing it. |
| Slice 4 - Typed Lossless Reduction | Complete | Closed on 2026-07-14. Search, tree, table, JSON, test, log, and repository artifacts use a versioned columnar encoding with exact restore and source/projection hash verification. Adversarial fixtures preserve rare critical signals, exit status, warnings, IDs, locations, skipped/failed tests, severities, and conflicts. Unknown, malformed, small, or tampered inputs fail open to canonical evidence or fail closed at restore. | Closed; add new artifact kinds only with an exact preservation contract and adversarial fixture. |
| Slice 5 - Reversible Context Projection | Complete | Closed on 2026-07-14. Canonical typed artifacts use verification-protected resource retention; `ContextGovernor` chooses full, lossless, or disclosed reversible options while required evidence stays full. Retrieval and absence attempts are audited, file-store reopen preserves evidence, and citation/sensitive-action gates resolve canonical source hashes. | Closed; retain bounded protected-capacity failure as the explicit residual risk. |
| Slice 6 - Context Utility Allocation | Complete | Closed on 2026-07-14. `DefaultContextGovernor` owns whole-block, segmented, and retrieval-on-demand modes; `context-utility-v1` records semantic, authority, verification, recency, novelty, retrieval-cost, redundancy, and task-phase evidence. Required context bypasses ranking, overflow is declared, and balanced/edge-biased ordering is deterministic. A five-task task-class promotion gate requires non-inferior verified success and lower tokens. Full Core passed 3,523 tests. | Closed; whole-block remains the deterministic rollback policy. |
| Slice 7 - Phase-Aware Route And Effort Control | Complete | Closed on 2026-07-14. Runtime route inputs now carry normalized task, phase, uncertainty, tool, verification, retry, cache, verifier, and budget evidence. `PhaseAwareModelRouter` implements the existing route port with static rollback; fixed/sweep effort benchmarks use capability-backed resolution and reproducibility hashes. Pareto and `high`/`xhigh` promotion gates require five paired tasks. | Closed; do not promote a candidate or `xhigh` without its evaluator evidence. |
| Slice 8 - Delegation And Handoff Efficiency | Complete | Closed on 2026-07-14. The candidate selector is advisory to existing work governance and managed invocation. Runtime records six coordination stages with honest unknowns, worker identity, and evidence URIs; canonical artifact handoff is explicit and orchestration results retain route, authority, context, replay, and coordination evidence. | Closed; static work governance remains rollback until five-task task-class evidence promotes a candidate. |
| Slice 9 - Output And Verification Allocation | Complete | Closed on 2026-07-14. Canonical structured results preserve control state at every verbosity; effect-aware verification is deterministic-first, managed result fields fail closed, and verifier usage is stored and projected independently from final-output generation. | Closed; promotion remains benchmark-gated by five paired tasks with known verification economics. |
| Slice 10 - Memory Efficiency And Reconsolidation | Complete | Closed on 2026-07-14. Durable write candidates fail closed on weak provenance, confidence, value, contradiction, trust, or canonical evidence; recall and injection are separate; Gateway memory remains record-aware through `ContextGovernor`; usage is layer-attributed; and reconsolidation revisions preserve content and provenance. | Closed; static writes remain rollback and candidate promotion requires five paired tasks with known economics. |
| Slice 11 - Controlled Adaptation | Complete | Closed on 2026-07-14. ContextGovernor allocation is the first typed actuator family; candidates bind its owning promotion report, replayed lifecycle evidence, precommitted replay/shadow/holdout cohorts, conservative confidence, distribution/rare/cache gates, verification artifacts, and exact configuration rollback. Durable controls reuse operator-approved canonical config mutation. | Closed; monitoring remains advisory and cannot self-freeze or self-promote. |
| Slice 12 - Surface Parity And Public Evidence | Complete | Closed on 2026-07-14. Core projects one reconciled evidence view; Gateway validates and formats it; Runtime maps it; CLI, GUI, TUI, SDK, and managed resources retain the same totals, policy identity, outcome, action, saving, and verification evidence. Content-hashed methodology, fixture, limitations, report, and exact reproduction identity now gate public claims. | Closed; the reference bundle remains internal-only and no public performance claim is authorized. |

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

Status: Complete on 2026-07-04. A failed GUI implementation attempt on
2026-07-03 was reverted before commit. The restart began on 2026-07-04 with
focused TDD for leading stable-prefix evidence.

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

Restart evidence, 2026-07-04:

- Runtime provider-request telemetry now computes a true leading stable prefix:
  after the first volatile request region, later regions are excluded from the
  reusable prefix evidence for that request.
- Evidence uses `sha256:*` hashes and records stable-prefix bytes,
  stable-prefix region count, volatile-region bytes, and per-region
  source/stability/hash metadata.
- Cache partition evidence now hashes tenant, route, policy, and authority
  dimensions separately and records one combined partition hash. Raw tenant ids
  and authority envelope contents are not exposed in provider-request evidence.
- Benchmark readiness now treats cache topology as first-class evidence for
  `kiln-tool-agent`: the profile requires a `cache-topology` scorer and a
  `cache-topology` evidence artifact. The scorer validates stable-prefix
  fields, region ordering, partition dimensions, invalid-reuse probes, and
  measured baseline/candidate cache-gain comparison evidence.
- `BenchmarkBaselineRunner` now emits a `cache-topology` evidence artifact
  from result metadata. The artifact carries provider request topology,
  invalid-reuse probes, and cache-gain comparisons beside the existing usage,
  route, cost, transcript, tool-call, and diagnostic artifacts.
- Cache policy promotion now has an explicit pure eval gate:
  `evaluateCachePolicyPromotion` requires rollback to the baseline policy,
  distinct candidate policy identity, matching dataset/items, unchanged output,
  unchanged authority evidence, unchanged tool trajectory, non-inferior
  non-cache scorer results, and positive cached-input-token delta.
- Region evidence omits serialized prompt, message, and tool-schema content;
  cache topology remains telemetry/control-plane evidence rather than
  model-visible prompt content.
- Focused TDD evidence:
  `bun test packages/runtime/tests/session/runtime-session-orchestrator-cache.test.ts`
  passed with 10 tests and 49 assertions after partition evidence was added.
- Verification evidence: `bun run --filter @kilnai/runtime typecheck`,
  `bun run typecheck`, `bun run build`, `bun run --filter @kilnai/runtime test`,
  `bun run --filter @kilnai/core test`,
  `bun run --filter @kilnai/core test -- tests/eval/experiment-comparator.test.ts`,
  `bun run --filter @kilnai/core test -- tests/eval/benchmark-runner.test.ts`,
  `bun run --filter @kilnai/core test -- tests/eval/benchmark-baseline.test.ts tests/eval/benchmark-scorers.test.ts`,
  `bun run --filter @kilnai/cli test -- tests/application/benchmark-session-executor.test.ts tests/commands/benchmark.test.ts`,
  and `git diff --check` passed. The runtime suite passed 185 files and 2484
  tests, the core suite passed 272 files and 3449 tests, the focused
  experiment-comparator tests passed 9 tests, and the focused CLI benchmark
  tests passed 14 tests.
- This evidence establishes and verifies the promotion boundary for Slice 2.
  Cache gains remain evidence-gated by rollback and non-inferiority checks;
  no prompt-visible cache instructions, provider-specific hidden truncation,
  or legacy compatibility path was introduced.

Research basis for this restart:

- OpenAI prompt caching, Anthropic prompt caching, and Gemini context caching
  all optimize repeated input by reusing stable cached context rather than
  changing the admitted task information.
- SGLang RadixAttention and vLLM automatic prefix-caching documentation model
  the same inference principle at the serving layer: reuse KV cache for shared
  prefixes and compute only the suffix.
- The implementation therefore records prefix topology and hashes first. It
  does not introduce prompt-visible cache instructions, lossy summaries,
  provider-specific hidden truncation, or a second context owner.

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

Status: Complete on 2026-07-14 after Roadmap 06 verified the cross-harness Kiln
tool and managed-agent exposure boundary for Codex App, OpenCode Go, and Kiln.
Optional entitlement harnesses do not block progress without an admitted route.

Goal: stop admitting procedural context and tool schemas before they are
needed.

Work:

- centralize runtime progressive tool projection so provider-facing requests
  receive an admitted control-plane subset instead of every runtime tool schema;
- admit skill metadata and tool catalog entries before full definitions;
- load exact skill instructions and schemas only after governed selection;
- preserve startup and offline behavior through cached indexes;
- record selection reason, bytes, tokens, and cache effects;
- keep `ContextGovernor` as the sole model-context admission owner.

Initial evidence on 2026-07-04:

- `withProgressiveRuntimeToolProjection` now owns explicit `read-only` and
  `execute` progressive profiles for CLI run, TUI, GUI, and benchmark sessions.
- The old benchmark-local always-on list was removed so benchmark sessions use
  the shared read-only profile without admitting shell, write, config mutation,
  work-item mutation, or goal creation tools.
- Focused policy and command-level coverage proves `tool_catalog_search`,
  authority-appropriate tools, and existing configured tools remain
  provider-facing while `browser_session_start` is deferred from definitions
  but remains present in the canonical registry and bridge.
- Core projection tests prove surface-owned config mutation tools remain in the
  canonical registry but are absent from read-only provider-facing definitions
  unless the selected profile explicitly admits them.
- Removing implicit `kiln_config.*` admission from Core's deferred projection is
  an intentional authority-contract change: consumers must explicitly name
  configuration capabilities in their admitted surface instead of inheriting
  them from projection mode.
- External basis: ToolLLM/API-Bank/Gorilla/Toolformer separate tool discovery
  or retrieval from execution; Anthropic Tool Search and cloned Claude Code,
  Codex, and OpenCode harnesses defer full schemas behind searchable catalogs.

Next-round materialization evidence on 2026-07-04:

- `tool_catalog_search` now emits structured `materializableToolName` metadata
  only for exact, schema-including, non-stale, single-result catalog matches.
- Runtime admission is a pure fail-closed decision: materialization requires a
  canonical definition, the current turn allowlist, and non-duplication.
- Runtime orchestration keeps executable authority separate from provider-facing
  schemas: newly materialized tools are appended only to later provider rounds.
- Same-response calls to tools absent from the current projected schema return
  deterministic error `tool_result` parts and execution summaries without
  invoking the executor.
- Attached runtime and CLI surfaces now carry initial definitions separately
  from materializable definitions and capabilities, while the executable
  registry remains canonical.
- Direct-provider CLI sessions now pass an explicit materializable authority
  allowlist in `auto` and explicit authority modes so catalog discovery can see
  authorized hidden tools without exposing their schemas in the first round.
- Runtime-attached tools such as operator UI, plan, and managed-agent controls
  remain visible when their surface admits them, but they are not eligible for
  catalog-metadata materialization because they are not canonical Core catalog
  entries.
- Verification covered focused Core/Runtime/CLI suites, full Runtime, workspace
  `bun run test`, `bun run typecheck`, `bun run build`, and `git diff --check`.
- Provider request evidence now includes replayable progressive tool projection
  evidence per round: projected tool names/count/hash, materializable catalog
  names/count/hash, materialized additions, and sanitized catalog-search
  materialization decisions linked to the source tool call. The evidence avoids
  serialized schemas and descriptions, and materializable names are scoped to
  the current turn allowlist so unauthorized hidden tools are not leaked through
  replay telemetry.

Closure evidence on 2026-07-14:

- `SkillRegistry` retains metadata-only indexes at discovery and materializes
  only exact selected instructions; cache-versus-filesystem provenance is
  observable without exposing a source path.
- Task selection emits `progressive-skill-projection-v1` evidence with catalog,
  selected, deferred, metadata, context, avoided-source, reason, and estimated
  token fields plus a stable selection hash.
- An adversarial large unselected body remains absent from model-facing context
  while its avoided bytes remain attributable through filesystem metadata.
- `progressive-loading-promotion-v1` pairs eager and progressive observations,
  requires at least five tasks, blocks on success regression or missing
  selection/replay evidence, and requires total plus irrelevant skill/schema
  token decline.
- The five-case normal-path CLI comparison covered file reading, repository
  search, metadata inspection, structured query, and web research. Both eager
  and progressive policies achieved 1.0 deterministic capability success;
  all three required token deltas were negative.
- Focused Core and CLI suites and both package typechecks passed. The residual
  risk is model-dependent discovery behavior for future narrower initial
  authority profiles, so neither current profile was narrowed by this slice.

Exit gate:

- task success is non-inferior to eager loading;
- irrelevant skill and tool-schema tokens decline on representative tasks;
- selected capabilities remain inspectable and replayable.

### Slice 4 - Typed Lossless Reduction

Status: Complete on 2026-07-14.

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

Closure evidence:

- `kiln-columnar-json-v1` has an exact decoder and source/projection hashes.
- Seven typed artifact families pass adversarial round-trip fixtures with zero
  omissions and smaller projected byte size for high-volume inputs.
- Unknown fields and invalid enums are malformed rather than ignored; unknown,
  malformed, or non-beneficial inputs retain the canonical artifact.
- Projection hash tampering fails before restore.

### Slice 5 - Reversible Context Projection

Status: Complete on 2026-07-14.

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

Closure evidence:

- The artifact resource plane supports bounded `verification` retention that
  session churn cannot evict and file-store reopen preserves.
- `ReversibleContextProjectionService` creates full, lossless, and reversible
  options; `DefaultContextGovernor` is the only chooser and never reduces a
  required candidate.
- Reversible content explicitly reports omission, record count, canonical hash,
  and retrieval handle and excludes hidden critical fixture content.
- Retrieval audits record opportunities, attempts, successes, and absent
  evidence failures. Exact critical content remains retrievable after retention
  churn, while absent handles never fabricate evidence.
- Citation and sensitive-action verification succeeds only when canonical
  evidence is available and its source hash matches.

### Slice 6 - Context Utility Allocation

Status: Complete on 2026-07-14.

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

Closure evidence:

- `context-utility-v1` retains every normalized signal, phase match, and total
  score in the existing governor audit; invalid ranges fail at the boundary.
- Hard-required candidates remain admitted regardless of score. Required
  overflow uses declared `admit-and-report` or fail-closed `reject` policy.
- Whole-block, segmented, and retrieval-on-demand allocation run through the
  same `DefaultContextGovernor`; representative fixtures show lower candidate
  tokens while preserving the required verification content.
- Balanced and edge-biased position profiles have deterministic order tests and
  are normalized capabilities rather than provider-name heuristics.
- `context-allocation-promotion-v1` requires at least five paired tasks and
  blocks task-class success regression, required-context violations, missing
  audits, or absent token improvement.
- Focused suites, Core typecheck/build, and the full Core suite passed: 277 test
  files and 3,475 tests.

### Slice 7 - Phase-Aware Route And Effort Control

Status: Complete on 2026-07-14.

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

Closure evidence:

- `PhaseAwareModelRouter` implements the existing `ModelRouter` port. It
  consumes declared task class, phase, uncertainty, tool need, verification
  need, budget, route health, capability, retry, cache invalidation, and
  verifier cost evidence. Missing required signals or an eligible verified
  route fails closed.
- Healthy routes outrank otherwise-equivalent degraded routes; unknown and
  cooldown health are excluded. Every candidate preserves the declared
  verification contract, and uncertain or failed cheap routes retain ordered
  escalation candidates.
- `static-configured-order-v1` is the explicit rollback policy and is exposed
  through the same route port rather than a second routing owner.
- Normalized reasoning effort records a resolved value or omission reason.
  Explicit unsupported or unknown capabilities fail closed in the benchmark
  executor. Production `xhigh` requires promotion evidence; benchmark `xhigh`
  requires explicit experimental enablement, budget, and estimated effort cost.
- `kiln benchmark run-internal` supports fixed effort or a comma-separated
  effort sweep on one explicit provider/model route. Each member receives a
  distinct config hash and route artifact containing exact resolution evidence.
- `phase-aware-route-promotion-v1` publishes per-task-class verified-success,
  cost, token, latency, contract, and Pareto evidence for at least five paired
  tasks. `reasoning-effort-promotion-v1` independently blocks `xhigh` on
  success regression, value-per-token regression, budget breach, or missing
  effort evidence.
- Focused Core, Runtime, and CLI suites passed together with their package
  typechecks/builds. Static routing remains the production rollback until a
  fixed holdout supplies promotion evidence.

### Slice 8 - Delegation And Handoff Efficiency

Status: Complete on 2026-07-14.

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

Closure evidence:

- `delegation-efficiency-candidate-v1` is advisory to the existing work
  governance decision and managed-invocation execution boundary. It compares
  direct, fresh-context, and shared-artifact strategies from declared breadth,
  coupling, isolation, uncertainty, and the configured direct-execution
  envelope.
- Delegation is ineligible when child authority widens parent authority, route
  identity is incomplete, the verification contract changes, or lifecycle,
  replay, or recovery evidence is missing. `work-governance-static-v1` remains
  the rollback policy.
- Shared-artifact candidates accept only canonical
  `kiln://artifacts/<namespace>/<id>/content` references. Work governance emits
  `contextMode=resources` only with explicitly supplied canonical artifacts;
  otherwise it emits fresh isolated context. Raw transcript resources do not
  qualify as shared-artifact evidence.
- Runtime managed invocation attaches `managed-agent-coordination-usage-v1` to
  the canonical child record and session terminal evidence. Parent prompt,
  child bootstrap, duplicated reads, handoff, review, and synthesis are
  separate components with worker identity, tokens, cost, latency, turns,
  quality, and evidence URIs. Unobservable values remain `unknown`, never zero;
  prompt bodies and credentials are not retained.
- Known coordination tokens project into the lifecycle ledger as worker-scoped
  `coordination` allocations. Every component declares its provider token
  class: parent/bootstrap/read/review reconcile against input and
  handoff/synthesis reconcile against output. The numeric parent-prompt and
  bounded-handoff payloads are mutually exclusive; provider-total
  reconciliation still fails closed on overflow.
- Fan-out result evidence retains invocation, route, provider/model, authority
  profile, context mode, replay URIs, and coordination usage instead of only
  lifecycle and resource pointers.
- `delegation-efficiency-promotion-v1` requires at least five paired tasks,
  non-inferior verified success and verification contracts, no authority
  widening, substantive terminal handoff, recovery evidence, known economics,
  and lower coordination tokens or cost for a declared task class.
- Focused Core, Runtime, and CLI suites and package typechecks/builds passed.

### Slice 9 - Output And Verification Allocation

Status: Complete; closed on 2026-07-14.

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

Closure evidence:

- `structured-execution-result-v1` keeps lifecycle status, operator decisions,
  evidence, citations, warnings, failures, approval requirements, residual
  risks, limitations, uncertainty, and typed verification results outside
  model prose. Concise projection removes only optional detail and decision
  rationale; it cannot rewrite a blocked or failed result as completed.
- Output verbosity is a managed handoff field with `concise`, `standard`, and
  `detailed` values. It is independent of provider reasoning effort. Runtime
  projects visible output from the validated canonical result and retains the
  same control fields at every verbosity.
- Required managed result fields are validated against canonical structured
  state. Runtime accepts strict `structured-execution-result-v1` JSON from the
  child replay resource, validates it in Core, and rejects missing checks,
  uncertainty, limitations, evidence, or required residual risk.
- `verification-allocation-v1` consumes the canonical resolved action-effect
  envelope plus normalized uncertainty and blast radius. Deterministic checks
  precede semantic model judges; unknown, irreversible, external, high-
  uncertainty, and broad-impact work fails toward deep review.
- `verification-usage-v1` records verifier method, result, provider token
  class, token/cost/latency quality, and evidence URIs. Unknown metrics stay
  unknown. Managed work-item attempts retain this report, and known verifier
  tokens project to lifecycle source `verification`, never `final_output`.
- Runtime preserves adapter-supplied verifier reports and derives honest native
  reports from structured results: deterministic checks use zero estimated
  provider spend, while unmeasured model-judge or human-review economics remain
  `unknown`. Final-phase templates retain both `structuredResult` and
  `verificationUsage`; unsuccessful status, pending approval, or non-passing
  required verification cannot be promoted as child-completed work.
- `output-verification-promotion-v1` requires at least five paired tasks,
  preserved control fields and verification contracts, non-inferior verified
  success, complete evidence, known verification cost, fewer output tokens,
  and lower verifier cost.
- Focused Core, Runtime, and CLI suites and their package typechecks/builds
  passed.

### Slice 10 - Memory Efficiency And Reconsolidation

Status: Complete on 2026-07-14.

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

Completion evidence:

- Core owns `memory-write-admission-v1`, `memory-efficiency-usage-v1`,
  `memory-offline-lifecycle-v1`, and `memory-efficiency-promotion-v1`; the
  static memory write path is the explicit rollback policy.
- Explicit durable writes are admitted, deferred, or rejected at
  `MemoryMutationService` after authority validation. Semantic and procedural
  candidates require topic, confidence, future value, trusted origin, resolved
  contradiction state, and canonical artifact or memory-node evidence.
- Recall integrity and injection eligibility are distinct contracts. Poisoned,
  untrusted, contradictory, superseded, expired, or evidence-less records stay
  inspectable but cannot become context.
- Tenant conversation recall no longer prejoins private text or duplicates
  context budgeting. Email, Instagram, Messenger, and WhatsApp routes pass
  record-aware candidates into the canonical Runtime projection, where
  `DefaultContextGovernor` remains the final admission owner.
- Actual admitted memory blocks project to lifecycle source `memory:<layer>`
  with canonical memory-node evidence. Database write/search economics remain
  in the memory usage report and unknown cost or latency remains unknown.
- Reconsolidation revisions now retain version content, provenance, sequence,
  and parent identity. Corrections can reconstruct the prior version;
  contradictions and supersessions retain the original record and relation.
- Focused verification passed: all 15 Core memory files (115 tests), seven
  affected Runtime gateway/session files (151 tests), Core build, and Core and
  Runtime typechecks.

### Slice 11 - Controlled Adaptation

Status: Complete on 2026-07-14.

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

Completion evidence:

- `policy-adaptation-candidate-v1` accepts only the real ContextGovernor
  allocation-mode actuator and exact-binds an eligible owning
  `context-allocation-promotion-v1` comparison.
- Candidate generation replays and reconciles lifecycle attribution, commits
  disjoint replay, shadow, and holdout fixture/config hashes before generation,
  and references canonical verification-retained artifacts.
- Replay input identity, recorded divergence, shadow non-visibility and
  side-effect suppression, required rare-task samples, derived distribution
  shift, cache partition isolation, invalid-reuse probes, conservative paired
  confidence bounds, and fixed-holdout token/cost improvement fail closed.
- Post-promotion monitoring is pure `stable | freeze-recommended` evidence and
  has no mutation authority.
- Core controls use optimistic revisions, exact `{policyId,
  configurationHash}` selections, and operator approval evidence. Freeze blocks
  promotion but not exact rollback; rollback cannot require data migration.
- Durable promotion, freeze, unfreeze, and rollback reuse the canonical config
  proposal, operator approval, stale-content check, and apply boundary through
  `context_governance.adapt`. `DefaultContextGovernor` remains the actuator.
- Config apply revalidates both lexical and physical project containment, so a
  symlink or junction cannot redirect an approved canonical write outside the
  project root.
- Runtime provider-request cache partitions include the approved context policy
  identity, preventing cross-policy reuse.
- Focused verification passed: five Core adaptation tests, 98 Runtime context
  and cache tests, six CLI proposal/apply tests, and Core, Runtime, and CLI
  typechecks/builds.

### Slice 12 - Surface Parity And Public Evidence

Status: Complete on 2026-07-14.

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

Closure evidence:

- Core owns `verified-efficiency-evidence-v1` over replayed, reconciled
  lifecycle evidence. Provider totals, measured, estimated, cached,
  cache-written, unknown, and avoided volumes are explicit. Avoided volume is
  outside provider totals and requires a typed paired comparison, a linked
  action, a passing verification result, and canonical comparison evidence.
- Gateway owns the strict wire schema and shared formatter. Runtime is the sole
  Core-to-Gateway mapper. Canonical lifecycle events carry the exact view;
  invalid or absent historical projections render as unavailable rather than
  being recomputed locally.
- CLI human and JSON output, GUI inspector state, TUI canonical activity, SDK
  exports, and managed-agent detail all preserve the same DTO. Managed detail
  retains raw usage and coordination usage and reports the efficiency view as
  unavailable when tokens or USD cost are unknown.
- `verified-efficiency-publication-manifest-v1` verifies repository-relative
  methodology, fixture, limitations, and JSON report content by SHA-256 and
  binds exact commit, harness, route/provider, model/policy, effort, SDK/API,
  authority, tool catalog, configuration, environment, dataset, seeds,
  confidence, failures, omissions, commands, limitations, and dependencies.
  The report repeats that full execution identity and each pair binds its task
  definition, identical arm inputs, and arm-specific execution envelopes by
  SHA-256. The report additionally binds the exact rendered benchmark-baseline
  array by canonical SHA-256; fixture reconciliation and report generation
  verify every binding before a public claim remains allowed.
- Public claims require content-derived paired identical inputs, at least five repetitions,
  distinct evidence categories, zero hard-invariant failures, and non-inferior
  quality and verification. Cost claims additionally require comparable
  metered economics. Internal benchmark readiness alone never authorizes a
  public claim.
- Gateway memory relation writes and integrity reads are same-scope. Indexed,
  complete incoming-relation evidence cannot be altered by a foreign tenant.
- The reference bundle under `docs/benchmarks/verified-efficiency-v1/` is
  deterministic, synthetic, content-verified, and explicitly makes no
  performance or harness-comparison claim.
- Repository verification passed the full Gateway Contracts, Core, Runtime,
  SDK, Widget, TUI, Native, and GUI suites plus all CLI source, application,
  config, command, wrapper, native-harness, MCP, skill, and UI test partitions.
  Repository-wide TypeScript project references and every package production
  build also passed.

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

## Completed Execution Order

1. Slice 0: complete; baseline and reproduction evidence is available for
   starting Slice 2 without broader pre-optimization sampling.
2. Slice 1: complete.
3. Slice 2: complete.
4. Slice 3: complete after Roadmap 06 cross-harness control-plane verification.
5. Slice 4: complete; typed lossless reduction.
6. Slice 5: complete; reversible context projection.
7. Slice 6: complete; context utility allocation.
8. Slices 7 through 10: complete; route/effort, delegation,
   output/verification, and memory controls.
9. Slice 11: complete; controlled adaptation remains operator-approved and
   benchmark-gated.
10. Slice 12: complete; canonical surface evidence and public-claim gating were
    delivered last.

The order is deliberate: measure first, take quality-neutral savings next,
introduce reversible reduction before lossy policy, and learn only after the
system can detect its own regressions.

## Resolved Decisions

- Lifecycle attribution is canonical session-ledger evidence with pure Core
  replay/reconciliation and `verified-efficiency-evidence-v1` projection. It is
  not a parallel event store or provider-adapter side channel.
- Provider-reported token classes remain measured; runtime/adapter estimates
  are labeled estimated; unavailable evidence remains unknown. Cost-only
  provider evidence is retained as zero-token unknown attribution instead of
  being discarded or converted into invented tokens.
- Reversible canonical artifacts use verification retention. Protected
  capacity exhaustion fails closed.
- Search, tree, table, JSON, test, log, and repository artifacts are the first
  supported typed lossless reducers, each with exact restoration and adversarial
  preservation tests.
- Promotion policies declare their task class, paired minimum sample,
  non-inferiority conditions, hard invariants, rollback identity, and evidence
  hashes. No common weighted score can hide a gated regression.
- Cache topology is provider-neutral request evidence. Tenant, route, policy,
  and authority partition hashes remain outside provider adapters.
- Deterministic required-context, authority, eligibility, budget, and
  verification gates run before any advisory scoring. Model-assisted scoring
  cannot override those gates.
- Delegation is eligible only when its task-class comparison covers coordination
  overhead and preserves authority, verification, replay, recovery, and bounded
  handoff evidence.
- External benchmarks may supplement the internal governed portfolio. They do
  not authorize a public claim without the Slice 12 publication manifest and
  content-verifiable artifacts.

## Completion Criteria

This roadmap is complete when Kiln has one provider-neutral efficiency control
loop, one attributable ledger, one context-policy owner, explicit actuator
contracts, verified cross-surface evidence, and reproducible policy-promotion
gates; when stable doctrine has moved into `docs/architecture/` and operator
guidance into `docs/guides/`; and when superseded experimental code and policy
paths have been removed rather than retained as legacy behavior.

These criteria were satisfied on 2026-07-14. The deterministic reference
bundle proves the evidence and publication contracts only; live provider or
external-harness performance claims remain outside this roadmap until their own
content-verified manifests pass the same gate.
