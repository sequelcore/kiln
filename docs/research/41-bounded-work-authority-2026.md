# Bounded Work Authority (2026-08-12)

Research cutoff: **2026-08-12**. This is the Slice 0 research and contract
ratification for [issue #19](https://github.com/sequelcore/kiln/issues/19).
It records the evidence available at the cutoff and the boundaries accepted for
later implementation. It does not authorize implementation, choose defaults,
or make an efficiency or provider-parity claim.

## Purpose

Issue #19 asks Kiln to make bounded work a real authority boundary rather than
an instruction-only expectation. The useful boundary is deliberately small:
Core owns the versioned work contract and policy; Runtime owns admission,
reservation, accounting, transitions, and terminal truth; surfaces project that
state and report capability evidence. This document records the contract
without creating a second workflow, task database, route owner, or evidence
ledger.

The contract addresses four different questions that must not be conflated:

1. Is this effect inside the semantic scope of the work?
2. Which resource or state ceilings may Runtime deny or stop?
3. Which configurable signals should cause a review or pause?
4. What observations are merely diagnostic because they do not establish
   authority or completion?

## Evidence Classification

The labels below are used throughout this document.

| Label | Meaning | Use in this decision |
| --- | --- | --- |
| **Measured fact** | Directly observed in the repository, a pinned source, or a reproducible run record. | May establish the current baseline or an existing owner. |
| **Incident or reported study** | A dated issue report, incident, paper, or external result that has not been reproduced by this Slice 0. | A risk or hypothesis input, not a Kiln performance claim. |
| **Practitioner claim** | A claim made by a reference project or community implementation under its own methodology. | Comparative design evidence only; no parity or causality is inferred. |
| **Inference / ratified boundary** | A design conclusion drawn from the evidence and repository ownership. | Canonical contract for later implementation, explicitly marked as a decision. |

## Current Repository Baseline (Measured Facts)

The following owners exist before this research:

| Existing owner | Observed responsibility | Consequence for #19 |
| --- | --- | --- |
| [`work-governance.md`](../architecture/core/work-governance.md) | Canonical lifecycle, policy, work-item evidence, closeout, and cross-surface authority doctrine. | Remains the Work Governance owner. #19 extends its bounded-work contract; it does not create a new owner. |
| [`GoalRun`](../../packages/core/src/work-governance/goal-run.ts) | Goal identity, authority envelope, route policy, evidence requirements, lifecycle, and terminal status. | Scope and terminal decisions attach to the existing goal/work lifecycle. |
| [`WorkItem`](../../packages/core/src/work-governance/work-item.ts) | Bounded unit identity, risk/profile, route, authority, expected/provided evidence, gates, attempts, pauses, residual risk, and status. | New contract fields must be part of this existing Core model or an explicitly named value type; no parallel task record. |
| [`GoalExecution`](../../packages/core/src/work-governance/goal-execution.ts) | Ready, paused, and complete decisions plus attempt start/finish/fail transitions. | Typed continuation and stop reasons map to existing transitions rather than a new lifecycle. |
| [`governed-turn-outcome.ts`](../../packages/runtime/src/session/governed-turn-outcome.ts) | Derives `completed`, `failed`, `cancelled`, or `paused` from canonical evidence, closeout, pauses, and work state. | A bounded-work stop must preserve these existing `SessionTurnOutcome` values. |
| [`project-runtime-registry.ts`](../../packages/runtime/src/operator-runtime/project-runtime-registry.ts) | One isolated Runtime binding per canonical `projectRuntimeId`; same-project sessions reuse it. | Project-scoped reservation and settlement authority belongs in the existing Runtime boundary. |
| [`managed-account-lease-authority.ts`](../../packages/runtime/src/managed-account-leases/managed-account-lease-authority.ts) | Existing transactional/CAS patterns for managed economic commitments, fencing, settlement-pending, replay, and owner generation. | A mechanism reference for atomic state transitions, not a reason to merge work limits with the managed economic ledger. |
| [`session-turn-budget-authority.ts`](../../packages/runtime/src/session/session-turn-budget-authority.ts) | Session-wide local pre-turn token observation; unknown usage stops the turn, with no reservation or settlement ledger. | [Issue #35](https://github.com/sequelcore/kiln/issues/35) remains separate from managed route economics. |
| [`harness-integration-capabilities.md`](../architecture/surfaces/harness-integration-capabilities.md) | Harness/provider capability evidence, projection boundaries, and project Runtime sharing. | Capability evidence is explicit; native projection is not authority. |
| [`benchmark-validation.md`](../architecture/quality/benchmark-validation.md) | Frozen benchmark identity, structural evidence, pass^k, publication gates, and limitations. | The bounded-work benchmark uses this evidence contract. |

These are measured repository facts, not a claim that the current code already
enforces the full contract below. The current Core model has mutable
non-terminal updates and an optional `planHash`; it does not yet provide an
immutable content-digested bounded-work revision, a candidate binding, or a
project-scoped work-limit reservation ledger. Those are Slice 0 decisions for
later implementation.

## Related Issues and Ownership Boundaries

The related issues are intentionally separated:

| Issue | Evidence and boundary |
| --- | --- |
| [#19](https://github.com/sequelcore/kiln/issues/19) | Bounded-work semantic scope, hard ceilings, tripwires, candidate/evidence binding, typed stop/continuation, and cross-surface authority. |
| [#34](https://github.com/sequelcore/kiln/issues/34) | Agent Task cross-provider economic selection, account commitment, dispatch fencing, and settlement. #19 may use the same Runtime authority style but does not own monetary/provider-account state. |
| [#35](https://github.com/sequelcore/kiln/issues/35) | Normal session pre-turn token observation. One local session-wide limit uses persisted input plus output tokens and stops on unknown usage. |
| [#53](https://github.com/sequelcore/kiln/issues/53) | General conditional work contracts and the five-axis separation of intent, capability/identity, process/phase, evidence, and assurance/acceptance. #19 must not collapse those axes into one token. |
| [#58](https://github.com/sequelcore/kiln/issues/58) | Runtime verification-loop experiment. The reported H1/H2/H3 result is a research input; #19 does not adopt all H3 components or claim the result as a Kiln effect. |
| [#9](https://github.com/sequelcore/kiln/issues/9) | Visual-work and acceptance contracts. #19 consumes required evidence through the existing work-governance plane and does not re-own visual acceptance. |

The existing Work Governance owner therefore has this division of labor:

- **Core** defines the serializable bounded-work contract, revision digest,
  scope/limit/tripwire value types, candidate/evidence relationships, and
  policy-level transition vocabulary.
- **Runtime** binds a revision to a project Runtime, performs admission and
  compare-and-swap (CAS) reservations/settlement, accounts observed usage,
  applies transitions, and owns terminal truth.
- **CLI, GUI, TUI, SDK, MCP, replay, native adapters, and direct/native
  provider routes** remain surfaces or adapters. They may narrow a request and
  report evidence; they may not widen scope, reset a ceiling, invent evidence,
  or become a second policy owner.

## External and Comparative Evidence

### Issue and primary-source evidence

- [Issue #19](https://github.com/sequelcore/kiln/issues/19) is the design
  request and its stated gaps. Its proposed fields and benchmark requirements
  are requirements to investigate, not measurements.
- [Issue #35](https://github.com/sequelcore/kiln/issues/35) identifies the
  current session-turn budget path: provider-keyed local-day accounting,
  synthetic zero for routes without a ceiling, and no atomic reservation or
  settlement. That report is consistent with the repository code inspected at
  this cutoff; it does not establish provider quota, billing, or spend.
- [Issue #53](https://github.com/sequelcore/kiln/issues/53) is explicitly a
  research and audit proposal. Its five-axis separation is adopted as a
  boundary constraint, not as a new schema in this slice.
- [Issue #58](https://github.com/sequelcore/kiln/issues/58) reports a fixed
  3-model × 3-harness × 100-task comparison with two runs per cell. Its H1,
  H2, and H3 figures are **reported-study evidence**, not independently
  replicated here. The reported H3 bundle combines multiple mechanisms, so it
  cannot identify output validation, drift checks, retry, compression, or
  rollback as the cause of a gain.
- [The harness-integrity paper](https://arxiv.org/abs/2605.23950) is a position
  paper whose abstract argues that harness design can materially affect agent
  outcomes. It supports measuring the control plane, not a numerical Kiln
  effect.
- [The execution-surface study](https://arxiv.org/abs/2607.10569) reports a
  controlled three-arm comparison with tied pass rates and cost differences
  under its own setup. It is relevant to separating model, harness, and
  execution-surface effects; it is not a Kiln parity or superiority result.

### Ponytail (practitioner claim)

The pinned reference is [Ponytail at
`2ed6c52`](https://github.com/dietrichgebert/ponytail/tree/2ed6c52c9d7e5e56942508591085fd45dea277d3).
Its [benchmark description](https://github.com/dietrichgebert/ponytail/blob/2ed6c52c9d7e5e56942508591085fd45dea277d3/benchmarks/README.md)
and [agentic benchmark notes](https://github.com/dietrichgebert/ponytail/blob/2ed6c52c9d7e5e56942508591085fd45dea277d3/benchmarks/agentic/README.md)
describe a three-arm, three-model, five-task benchmark with ten runs per cell,
using medians, source LOC/file counts, API token/cost/latency data, and a
separate safety check. Its README reports a real-session comparison of 12
feature tasks, Haiku 4.5, and n=4, with headline reductions in LOC, tokens,
cost, and time.

Those are Ponytail's **practitioner claims**, not measured Kiln facts. The same
README says older isolated single-shot results overstated the reduction and
that GPT-5.5 can reverse the result. The skill itself is a prompt ladder
(YAGNI, standard library/native APIs, minimum dependency surface), not a
Runtime authority. Its runner also records that live verification was omitted
from the agentic comparison after earlier flailing inflated cost and time.
Therefore Kiln adopts neither the numbers nor LOC as a risk authority.

### Gentle AI (comparative implementation evidence)

The pinned reference is [Gentle AI at
`a440e791`](https://github.com/Gentleman-Programming/gentle-ai/tree/a440e791c342b69ca79f7759e697fc88c1272ca5).
Its [organic RDD architecture](https://github.com/Gentleman-Programming/gentle-ai/blob/a440e791c342b69ca79f7759e697fc88c1272ca5/docs/architecture/organic-rdd.md)
and [review fixture](https://github.com/Gentleman-Programming/gentle-ai/blob/a440e791c342b69ca79f7759e697fc88c1272ca5/contracts/review-integration/v1/fixtures/start-v2.fixture.json)
show useful mechanisms: freeze an exact candidate, bind review to a digest,
keep corrections in a new lineage, make one bounded correction, preserve
receipts, and fail closed when a switch or capability is unknown.

These are comparative implementation observations. They do not prove that
Gentle AI's product model, terminology, review tiers, or routing behavior is
correct for Kiln. Kiln does not copy the implementation, claim feature parity,
or treat its receipts as Kiln evidence until an admitted adapter supplies the
required source and identity fields.

## Ratified Slice 0 Contract

The following are **inference / ratified boundaries** grounded in the owners and
evidence above. They are the contract to implement and review later; they are
not an implementation in this slice.

### 1. One owner and one lifecycle

Existing Work Governance remains the owner. A bounded-work revision is attached
to the existing `GoalRun`/`WorkItem`/attempt lifecycle. There is no second task
database, event ledger, route policy, completion authority, or replay store.
Core defines the types and policy; Runtime is the enforcing authority; surfaces
project canonical state. Child agents cannot lend authority, budget, or
acceptance to a parent or sibling.

### 2. Immutable, content-digested revisions

A bounded-work revision is an immutable canonical serialization containing at
least the semantic scope, ceilings, tripwires, required evidence, authority
envelope, and source relation. Core computes a content digest (SHA-256 or the
repository's canonical digest primitive) over that serialization and records
the schema/policy revision alongside it.

Any semantic change creates a successor revision with a new digest and an
explicit `supersedes` relation. A stale revision or stale CAS generation is
denied; it is not silently merged. A route, provider, harness, session, or
surface change never rewrites the revision or resets cumulative limits.
Existing optional `planHash` relations are not sufficient evidence of this
contract. No compatibility or dual-writer path is admitted for an unused old
shape.

### 3. Scope, ceilings, tripwires, and diagnostics are separate

| Dimension | Authority | Examples | Required behavior |
| --- | --- | --- | --- |
| **Semantic scope** | Contract authority | Objective and acceptance, permitted effects/surfaces, allowed roots/packages, non-goals, refactor/migration authority, dependencies/infra constraints, approved identities, baseline/spec/candidate attachment. | An effect outside scope requires a typed scope revision. It must not be disguised as a budget failure or approved by a size heuristic. |
| **Hard ceiling** | Runtime denial/stop authority | Total attempts, child count/concurrency/depth, review/correction rounds, tool calls, active duration, and observable usage classes when explicitly bounded. | The ceiling is cumulative across the revision lineage and all admitted routes. Exhaustion prevents another attempt or dispatch until a new revision/authority decision exists. Unknown usage is unknown, never zero. |
| **Tripwire** | Policy signal, not an intrinsic authority | Changed files/lines, candidate or correction size, gross/discarded churn, elapsed time/tokens/child count when not a hard ceiling, or a semantic drift signal. | A tripwire can require a review, operator decision, pause, or narrower successor according to policy. It cannot classify overengineering by fixed LOC or silently widen authority. |
| **Diagnostic** | Observation only | Missing usage class, missing route proof, stale capability, provider mismatch, unknown settlement, or an adapter limitation. | The observation is visible and source-attributed. It grants no authority and proves no completion. If it is a prerequisite, policy fails closed with a typed capability/authority pause. |

Changed files and lines are useful evidence and may be tripwires, but they are
not a risk classifier. Semantic overengineering requires the work contract,
review evidence, and the accepted candidate; a fixed size threshold cannot
decide it.

### 4. Project-scoped Runtime reservation and settlement

The reservation authority is the existing project-scoped Runtime selected by
`projectRuntimeId`. Sessions attached to the same canonical project share this
authority; different projects remain isolated. Core supplies value types and
ports. Runtime performs an atomic reservation before an attempt or dispatch,
records the revision/goal/work/attempt identity and generation, and settles the
reservation as consumed, released, or explicitly unknown/pending.

The operation must be idempotent for replay and must use CAS or an equivalent
transaction so concurrent sessions cannot both spend the same ceiling. A stale
revision, generation, candidate identity, or owner lease is denied. Unknown
usage or settlement remains unknown/pending and blocks a claim that the ceiling
was safely released. Recovery must preserve the prior attempt and reservation
history.

This is a project-scoped **work authority**. It is not the managed economic
ledger owned by #34 and it is not the normal session-turn provider budget owned
by #35. Shared implementation mechanisms are acceptable only where semantics
are identical; sharing a mutable policy or ledger merely to reduce file count
is not.

### 5. Candidate and evidence binding

Acceptance evidence binds all of the following:

- target/baseline identity and the exact candidate snapshot or diff digest;
- bounded-work revision digest and supersession lineage;
- requirement-to-effect traceability and permitted scope;
- verification, review, correction, and recovery artifacts;
- final receipt with route, authority, capability, and unresolved-risk state.

An invocation result, model statement, or approval of prose is not candidate
proof. A changed candidate invalidates evidence that was bound to earlier bytes.
Failed and superseded candidates remain replayable evidence; they are not
silently overwritten or relabeled as the final candidate. A correction creates
a new attempt/candidate/evidence relation and is subject to the remaining
review and correction ceiling.

### 6. Typed stop and continuation mapped to existing lifecycle

The following mapping preserves existing Core and Runtime lifecycle values. It
is a mapping contract, not a new `SessionTurnOutcome` enum.

| Bounded-work decision | Existing state/evidence transition | Surface result |
| --- | --- | --- |
| Continue to the next admitted phase/tool | Keep the work item non-terminal; Runtime emits the canonical next transition and preserves the same revision/attempt scope. | `SessionContinuityDecision=continue`. |
| Acceptance complete | Record required evidence and closeout; complete the work item, then the goal when all goal requirements are satisfied. | `SessionTurnOutcome=completed`. |
| Scope revision required | Block the current work item with an operator-input/authority pause; create a successor revision only after an explicit decision. | Current unresolved pause follows the existing failed/blocked closeout rule; no silent widening. |
| Hard ceiling exhausted | Preserve the attempt and deny another reservation/dispatch under that revision. | Blocked work item with typed authority/budget evidence; current turn is not reported as completed. |
| Tripwire requires review or decision | Keep the work item blocked or paused with the required review/approval evidence. | Unresolved required evidence follows the existing failed/blocked closeout rule. |
| Required capability unavailable or unknown | Record a capability pause naming the missing proof and permitted alternate route, if any. | No simulated compliance; unresolved capability follows the existing failed/blocked closeout rule. |
| Verification fails or is inconclusive | Mark the attempt failed or blocked with verifier evidence; a retry is a new admitted attempt. | `SessionTurnOutcome=failed` until a later admitted attempt closes the evidence. |
| Cancellation | Cancel the attempt and propagate cancellation through the existing goal/work lifecycle and settlement path. | `SessionTurnOutcome=cancelled` when the turn is cancelled. |
| Timeout | Preserve a timed-out attempt, settle or mark its reservation pending/unknown, and block until recovery is admitted. | `SessionTurnOutcome=failed` or the existing cancellation result, never success by timeout. |

The current runtime maps a tool-round budget stop to `paused`; that existing
mapping is retained. This contract does not invent a new terminal status to
make a bounded-work outcome look successful.

### 7. Capability evidence has four authority tiers

Capability tiers describe how much trustworthy enforcement and evidence exists
for a particular operation. They are not feature-parity labels and are kept
separate from the existing `native-supported`, `adapter-supported`, and
`unsupported` integration statuses.

| Tier | Meaning | Admission consequence |
| --- | --- | --- |
| **Authoritative** | The attached Kiln Runtime can enforce the relevant contract, observe the result, and produce canonical evidence and terminal truth. | May satisfy the contract when all other gates pass. |
| **Partial** | Some dimensions are enforceable or evidenced, while one or more required dimensions are missing or lossy. | May be admitted only for a narrower contract; otherwise record a capability pause. |
| **Advisory** | The mechanism supplies a signal or recommendation but cannot enforce or prove the bounded-work decision. | Never satisfies an authority or completion gate alone. |
| **Unsupported** | No trustworthy action or observation exists for the requested operation. | Fail closed or use an explicitly admitted alternate; never infer support from model/provider identity. |

At the Slice 0 level, project Runtime/Core authority is authoritative for
Runtime-governed policy and state when attached. Native Codex, OpenCode, and
Claude processes are at most partial for process-scoped injection, permission,
or plan artifacts, and can be advisory or unsupported for dimensions their
adapter cannot prove. A direct provider route is authoritative only through
the attached Kiln Runtime; native availability does not establish direct-route
authority.

## Benchmark Methodology

No default or efficiency claim is accepted by this research. A later bounded-
work benchmark must use the existing [benchmark validation
contract](../architecture/quality/benchmark-validation.md) and a paired design.

### Paired design

Compare a control arm with the bounded-work-authority arm while freezing:

- task definitions, repository/project snapshot, target and acceptance tests;
- provider/model, reasoning setting, route policy, harness and adapter commits;
- authority profile, tool catalog, context/memory inputs, and configuration
  hash;
- contract revision, scope envelope, ceiling policy, tripwire policy, scorer
  versions, and operator intervention protocol.

Randomize item and arm order where practical. Use repeated runs and the existing
pass^k reporting gate; report the full distribution and failed/omitted cases,
not only the best run or a single median.

### Measurements

Quality and safety are primary. Record, per task and arm:

- behavioral correctness and target verification;
- semantic in-scope/out-of-scope effects and non-goals touched;
- review findings, escaped defects, residual risk, and required intervention;
- input/output/cache token classes, with each unavailable class recorded as
  `unknown`;
- wall-clock duration, tool calls, attempts, child count/concurrency/depth,
  review and correction rounds;
- gross, accepted, discarded, and superseded candidate churn;
- stop/continuation reason, settlement state, and all omitted or failed runs.

Overengineering is a semantic review question against the declared scope and
acceptance contract. LOC, changed-file count, and diff size are structural
observations or tripwires, not the outcome. Deterministic structural scorers
are primary. Expert adjudication or a calibrated secondary LLM judge may score
semantic overengineering only with disclosed rubric, agreement, and limits; a
hidden judge cannot be the primary authority.

### Reporting and unsupported inference

The report must bind each result to exact candidate bytes, target identity,
revision digest, evidence artifacts, and configuration. Provider subscription
cost, unknown token classes, synthetic fixtures, and unverified self-reports are
not comparable efficiency evidence. A result may say that a bounded contract
changed observed behavior under this fixture; it may not generalize to model
quality, provider economics, or native-harness parity without a separately
admitted design and evidence.

## Implementation Evidence and Unsupported Claims

The implementation accompanying this record adds immutable contract revisions,
SQLite CAS reservation/accounting, exact Git/artifact/external-state candidate
capture, candidate-bound evidence and acceptance, managed write-scope/effect
narrowing, and operator projection. Deterministic tests include replay,
route-independent cumulative accounting, real two-process final-slot
contention, candidate capture, stale-revision denial, unavailable-metric
fail-closed behavior, and candidate-bound closeout. This is implementation
evidence, not an efficiency benchmark.

This record does **not** claim:

- that bounded-work authority improves cost, speed, token use, quality, or
  safety;
- that Ponytail's reductions, Gentle AI's receipts, or the #58 H3 result
  transfer to Kiln;
- that Codex, OpenCode, Claude, direct providers, native adapters, or Kiln
  surfaces have feature or authority parity;
- that route availability proves usage visibility, approval proves sandboxing,
  candidate completion proves acceptance, or an unknown value is zero;
- that fixed LOC/file/line thresholds detect overengineering;
- that #19 replaces #34, #35, #53, #58, or #9;
- that a public benchmark result, product-wide default ceiling, or native
  harness authority parity has been established.

Residual risks remain for provider usage normalization, authoritative
tool-call/active-duration metering, descendant managed delegation, capability
evidence drift, and a calibrated semantic overengineering rubric. Hard limits
for unavailable meters pause rather than guessing; nested delegation pauses
rather than resetting; semantic judgments remain advisory until benchmarked.

## Sources

Repository sources are linked from the baseline table and the canonical
architecture/research indexes. Primary and comparative sources used at this
cutoff are:

- [Issue #19](https://github.com/sequelcore/kiln/issues/19), [#35](https://github.com/sequelcore/kiln/issues/35), [#53](https://github.com/sequelcore/kiln/issues/53), and [#58](https://github.com/sequelcore/kiln/issues/58).
- [Ponytail pinned clone](https://github.com/dietrichgebert/ponytail/tree/2ed6c52c9d7e5e56942508591085fd45dea277d3), including its [benchmark methodology](https://github.com/dietrichgebert/ponytail/blob/2ed6c52c9d7e5e56942508591085fd45dea277d3/benchmarks/README.md) and [agentic runner/judge notes](https://github.com/dietrichgebert/ponytail/blob/2ed6c52c9d7e5e56942508591085fd45dea277d3/benchmarks/agentic/README.md).
- [Gentle AI pinned clone](https://github.com/Gentleman-Programming/gentle-ai/tree/a440e791c342b69ca79f7759e697fc88c1272ca5), especially [organic RDD](https://github.com/Gentleman-Programming/gentle-ai/blob/a440e791c342b69ca79f7759e697fc88c1272ca5/docs/architecture/organic-rdd.md) and the [review-start fixture](https://github.com/Gentleman-Programming/gentle-ai/blob/a440e791c342b69ca79f7759e697fc88c1272ca5/contracts/review-integration/v1/fixtures/start-v2.fixture.json).
- [Harness Integrity in Agentic Coding](https://arxiv.org/abs/2605.23950) and [Execution Surface Matters](https://arxiv.org/abs/2607.10569), used as dated research inputs rather than Kiln measurements.
