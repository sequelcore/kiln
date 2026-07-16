# Verified Efficiency Control Plane

Kiln optimizes verified outcomes per token, cost, second, and agent turn. The
efficiency controller supplies bounded policy choices and evidence; it does not
replace the canonical owners for context, routing, artifacts, memory,
verification, or authority.

## Attribution And Cache Topology

[Lifecycle Attribution](lifecycle-attribution.md) is the canonical source for
provider-neutral token, cost, cache, worker, and semantic-source accounting.
Efficiency policies consume that reconciled ledger; they do not create a
parallel accounting owner or infer precision the provider did not report.

Runtime provider-request evidence classifies ordered request regions as stable
or volatile and computes only the leading contiguous stable prefix. Once a
volatile region appears, later regions are excluded from reusable-prefix
evidence even when their content is otherwise stable. Evidence records
`sha256:*` region hashes, stable-prefix bytes and region count, volatile bytes,
and ordered source/stability metadata without recording serialized prompts,
messages, or tool schemas.

Cache identity hashes tenant, route, policy, and authority dimensions
separately and combines them into one partition hash. Raw tenant identifiers
and authority-envelope contents are not exposed. The approved context-policy
identity participates in the partition, preventing reuse across policy or
authority boundaries.

Cache-policy promotion requires a `cache-topology` scorer and evidence
artifact, a distinct candidate identity, an exact baseline rollback, matching
datasets and items, unchanged output, authority, and tool trajectory,
non-inferior non-cache scorers, invalid-reuse probes, and a positive
cached-input-token delta. Cache topology remains telemetry and control-plane
evidence; it is never injected into model-visible instructions.

## Progressive Loading

Tool definitions use the shared runtime progressive projection contract. Skill
discovery retains metadata indexes and materializes only exact selected bodies.
`progressive-skill-projection-v1` records catalog, selected, deferred, byte,
estimated-token, selection-reason, and materialization-source evidence without
exposing local paths or unselected instructions.

`progressive-loading-promotion-v1` requires at least five paired eager and
progressive tasks. Promotion fails on task-success regression, missing
selection or replay identity, or failure to reduce total model-facing,
irrelevant-skill, and irrelevant-tool-schema tokens.

## Typed Lossless Reduction

`reduceTypedArtifact` is the only Core typed-reduction entry point. It accepts
validated search, tree, table, JSON, test, log, and repository artifacts. The
`kiln-columnar-json-v1` encoding removes repeated representation keys and has an
exact decoder. Every supported artifact preserves exit status, warnings,
identifiers, source locations, severities, skipped/failed tests, repository
status, and all values; `omittedCount` is therefore zero.

Unknown, malformed, or non-beneficial inputs remain canonical. Unrecognized
fields are malformed rather than silently discarded. Projection and source
hashes are checked during restore, and tampering fails closed. A reduction is
never a canonical-evidence replacement: it carries the raw artifact URI.

## Reversible Context Projection

`ReversibleContextProjectionService` writes the exact typed artifact to the
artifact resource plane and supplies full, lossless, and reversible options to
`DefaultContextGovernor`. The governor remains the sole model-context admission
owner and selects an option through its declared projection preference.
Required candidates always remain full; budget overflow stays explicit.

Reversible model-facing content states that canonical evidence was omitted,
includes the immutable source hash and `kiln://artifacts/.../content` retrieval
handle, reports exit/warning/omission counts, and instructs the consumer to
retrieve before asserting absence, citing exact evidence, or taking a sensitive
action. It never presents a projection as complete evidence.

Canonical context evidence uses artifact retention scope `verification`.
Verification evidence is never evicted by session-retention churn, survives
file-store reopen, and consumes bounded namespace capacity. New writes fail
closed when protected evidence exhausts that capacity.

Retrieval audits count opportunities, attempts, successes, and missed-absence
failures. Citation and sensitive-action verification resolves the canonical
artifact and compares its source hash; unavailable or mismatched evidence does
not verify.

## Context Utility Allocation

`DefaultContextGovernor` owns all context allocation modes:

- `whole-block` is the deterministic rollback baseline;
- `segmented` admits stable, explicitly identified candidate segments;
- `retrieval-on-demand` selects disclosed reversible options when available.

`context-utility-v1` scores normalized semantic relevance, authority value,
verification value, recency, novelty, retrieval cost, redundancy, and declared
task-phase match. Each component and the total are retained in the context
audit. Invalid signal ranges fail at the boundary. Required context bypasses
utility ranking and remains admitted.

Required-budget overflow is always declared as `admit-and-report` or `reject`;
the reject policy fails before model context is produced. Position behavior is
normalized as `balanced` or `edge-biased` rather than inferred from a provider
name. Edge-biased projection retains the two highest-ranked blocks at opposite
ends while preserving deterministic middle order.

`context-allocation-promotion-v1` pairs whole-block and candidate evidence for
at least five tasks. It compares verified success and tokens by declared task
class and blocks required-context violations, missing allocation audits,
quality regression, or savings claims without a non-inferior cohort.

## Phase-Aware Route And Effort Control

`PhaseAwareModelRouter` implements the canonical `ModelRouter` port; it does not
introduce another execution or routing owner. The candidate policy consumes
declared task class, phase, uncertainty, tool need, verification need, budget,
route health, model suitability, retry risk, cache invalidation cost, and
verifier cost. Unknown or cooldown health, missing tool support, verification
contract drift, ineligibility, and over-budget routes are excluded before
ranking. Ordered remaining routes are the escalation path.

`static-configured-order-v1` is selected through the same port when rollback is
active. Phase-aware production promotion requires
`phase-aware-route-promotion-v1` evidence from at least five paired tasks. The
report publishes per-task-class verified success, verification-contract
preservation, cost, token, latency, and Pareto status; a regression or missing
route evidence blocks promotion.

Reasoning effort is normalized to `minimal`, `low`, `medium`, `high`, or
`xhigh`. Resolution records the requested source and resolved value, or an
explicit omission reason. Benchmark fixed/sweep execution binds one provider
and model, verifies advertised capability before execution, records the
resolution in route artifacts, and includes the effort policy and budget in the
configuration hash. `xhigh` is experimental: benchmark use requires an explicit
enable flag and budget evidence, while production use additionally requires a
successful `reasoning-effort-promotion-v1` comparison against `high`.

## Coordination And Handoff Efficiency

`managed-agent-coordination-v1` is the canonical deterministic topology
policy. It selects direct, sequential, centralized, or independent-review
execution from governance, graph, risk, capacity, route-health, budget, and
workspace signals. Child authority must not exceed parent authority, and all
topologies retain explicit route identity, terminal lifecycle, replay, and
recovery requirements.

Shared-artifact handoff accepts only immutable artifact content URIs. Work
governance projects `contextMode=resources` when canonical resources are
explicitly supplied and otherwise projects `isolated`; a transcript URI cannot
silently become shared canonical context.

`managed-agent-coordination-usage-v1` is Runtime-owned evidence attached to the
canonical managed record and terminal session event. It reports parent prompt,
child bootstrap, duplicated reads, handoff, review, and synthesis separately.
Every stage has tokens, cost, latency, turns, evidence quality, worker identity,
resource references, and an explicit provider token class. The numeric parent
prompt and bounded handoff payloads are mutually exclusive; unobserved stages
remain unknown and raw prompts are excluded. Parent/bootstrap/read/review
tokens reconcile against provider input, while handoff/synthesis tokens
reconcile against provider output. Known coordination tokens project into the
lifecycle ledger under source `coordination`; provider-total reconciliation
prevents double counting and fails closed on overflow.

Adaptive or learned successors are not production policy. Promotion must pair
static and candidate tasks by class; unknown economics, success or verification
regression, authority widening, incomplete terminal handoff, missing recovery,
or missing coordination evidence blocks promotion.

## Output And Verification Allocation

`structured-execution-result-v1` is the canonical machine-consumed result
contract. Status, decisions, evidence, citations, warnings, failures, approval
requirements, residual risks, limitations, uncertainty, and verification
results are typed state rather than prose conventions. `concise`, `standard`,
and `detailed` projection may remove optional narrative and rationale only; it
does not alter or suppress control state. Output verbosity is carried by the
managed handoff contract and is independent of reasoning effort.

Managed children return strict structured-result JSON. Runtime validates and
attaches it to the canonical result handoff before required-field admission,
then derives visible terminal output from that state. Missing requested checks,
evidence, uncertainty, limitations, or residual risk fails closed. Work-item
closeout retains the independent verification-usage report rather than
reconstructing verification state from the summary.

Runtime preserves adapter-supplied verifier usage and derives an explicit
report for native structured results: deterministic checks carry zero estimated
provider spend, while model-judge and human-review economics remain unknown
unless the adapter reports them. A completed transport cannot close a phase
when structured status, approvals, or required verification are not successful.
Managed resources and their verification evidence are scoped to the exact
parent session; passing verification requires a resolvable admitted resource
bound to that invocation.

`verification-allocation-v1` consumes the resolved canonical action-effect
envelope, normalized uncertainty, normalized blast radius, and declared
requirements. Deterministic checks are ordered before semantic model judges.
Unknown or high-impact actions require deep review; the policy calls
`deriveAuthorityFromEffect` and does not create a second authority mapping.

`verification-usage-v1` records verifier tokens, cost, latency, evidence, and
measurement quality independently from final-output generation. Unknown is not
zero. Known verifier tokens project to lifecycle source `verification` with an
explicit provider token class. `output-verification-promotion-v1` requires five
paired tasks, preserved control fields and verification contracts,
non-inferior verified success, known economics, fewer output tokens, and lower
verification cost.

## Memory Efficiency And Reconsolidation

Memory remains owned by the Core memory bounded context. The versioned
`memory-write-admission-v1` policy filters explicit durable-write candidates by
layer, topic, provenance, confidence, bounded future-task value, contradiction
state, derivative trust, and canonical artifact or memory-node evidence. A
candidate is admitted, deferred, or rejected with reasons; untrusted
derivatives and unresolved contradictions fail closed. Internal episodic
capture and lifecycle transitions retain their existing explicit policies as
`memory-static-write-v1`, the deterministic rollback path.

Recall scoring and context injection are separate decisions. Recall keeps
inhibited records inspectable, while injection requires explicit integrity and
canonical-evidence state. Poisoned, untrusted, contradictory, superseded, or
expired records cannot become model context. Eligible records remain
record-aware `ContextCandidate`s through Gateway projection, and
`DefaultContextGovernor` remains the only final context-admission owner.

Gateway conversation exchanges use the same mutation admission boundary with
an explicit short-lived write contract. Each new exchange persists a versioned
poison assessment, original-derivative declaration, and expiry timestamp on the
memory record. `TenantConversationMemory` resolves those fields from the
repository, derives contradiction and supersession from the repository's
indexed, unbounded incoming-relation query, and checks that the canonical
record still exists before injection. Memory-record relations require matching
source/target scope at write time, and recall repeats that source-scope filter
defensively so foreign-tenant relation rows cannot change integrity state. Missing,
duplicate, malformed, poisoned, contradictory, superseded, or expired evidence
produces no context candidates; pre-contract records therefore fail closed.

`memory-efficiency-usage-v1` reports write, recall, injection, and stale-recall
tokens, cost, latency, measurement quality, and evidence by memory layer.
Database operations remain usage evidence; they are not fabricated as provider
tokens. Actual admitted memory blocks project into the lifecycle ledger under
`memory:<layer>` using canonical `kiln://memory/nodes/...` evidence.

Reconsolidation revisions preserve content, provenance, parent identity, and
sequence. Corrections are therefore reversible, and contradiction or
supersession creates related records without overwriting the canonical source.
The offline lifecycle gate covers correction, consolidation, expiration, and
forgetting. `memory-efficiency-promotion-v1` requires at least five paired
tasks with verified continuity, known economics, lower replay tokens and cost,
unchanged scope and authority, preserved evidence and revision lineage, poison
and stale-memory defenses, and reversible reconsolidation.

## Controlled Adaptation

Controlled adaptation wraps existing policy-family promotion owners; it does
not replace their success or invariant evaluators. The first live typed family
selects ContextGovernor allocation mode and exact-binds an eligible
`context-allocation-promotion-v1` comparison. Candidate generation replays
canonical lifecycle attribution, commits immutable replay, shadow, and fixed
holdout cohorts before evaluation, and stores candidate, evaluation, cohort,
and monitor evidence with verification retention.

`policy-adaptation-evaluation-v1` uses conservative paired confidence bounds,
derives distribution shift from committed cohort counts, requires declared
rare-task samples, proves shadow non-visibility and side-effect suppression,
and blocks cache partition collision or invalid reuse. The fixed holdout must
reduce model-facing tokens without higher cost or hard-invariant regression.

`context_governance.adapt` is a proposal-only configuration operation.
Promotion, freeze, unfreeze, and exact rollback become durable only after the
existing operator approval and stale-state-checked apply flow. The active
selection stores policy and configuration hashes plus an optimistic revision;
Runtime passes the selected version to `DefaultContextGovernor` and includes it
in provider-request cache partition identity. Monitoring can recommend a
freeze but cannot apply one.

## Surface Evidence And Publication Gate

`verified-efficiency-evidence-v1` is the single operator projection over a
replayed, provider-total-reconciled lifecycle ledger. Core owns its semantics.
Gateway contracts mirror the DTO with a strict runtime schema, and Runtime is
the sole mapper between them. CLI, GUI, TUI, SDK, Gateway, and managed-agent
resources format or retain that validated object; they do not calculate local
savings or policy totals.

The projection keeps provider-total tokens and cost beside mutually explicit
measured, estimated, cached, cache-written, unknown, and avoided volumes.
Avoided volume is outside provider totals. It exists only when a typed paired
baseline/candidate comparison links a declared efficiency action to a passing
verification result and canonical comparison evidence. A live turn without
that proof reports zero avoided tokens. Outcome, verification status, exact
policy owner/id/configuration hash, action evidence, saving evidence, and
resource URIs remain inspectable together.

Canonical lifecycle events carry the projection beside the ledger and summary.
Gateway presentation validates it and fails to an explicit unavailable state
instead of reconstructing historical totals. CLI human and JSON output use the
same formatter and DTO. GUI retains the full view in timeline inspector state;
TUI retains it on the canonical session event; SDK exports the schema, type,
and formatter. Managed invocation detail projects complete known usage through
the same Core contract and marks the view unavailable when token or USD cost
evidence is unknown rather than converting unknown to zero.

`verified-efficiency-publication-manifest-v1` is the public-claim gate. It
content-hashes repository-contained methodology, fixture, limitation, and
machine-readable report artifacts and exact-binds Kiln commit/version,
harness/provider/model or route policy, reasoning effort, SDK/API version,
authority and tool-catalog hashes, configuration, environment, dataset,
seeds, confidence method, failed/omitted cases, commands, limitations, and
vendor dependencies. For a public claim, every artifact must resolve to the
same bytes in the declared Git tree; absolute, UNC, escaping, symlink-escaping,
untracked, and commit-mismatched evidence is rejected. The strict
`verified-efficiency-publication-report-v1` pairs baseline and candidate
observations, copies the complete manifest execution identity, and binds each
pair to task-definition, input, and arm-specific execution-envelope hashes.
The report also binds the exact `BenchmarkBaselineResult[]` payload by canonical
SHA-256. The report is reconciled against the fixture, including those hashes.
When rendering a claim-bearing benchmark report, Core recomputes the supplied
baseline-array hash and downgrades any mismatch to `blocked`. Kiln
derives token/cost improvement, quality and verification non-inferiority, hard
invariants, paired-input identity, and the supported lower bound from report
content rather than trusting manifest booleans. Public claims additionally
require matching baseline/candidate input hashes, `k >= 5`, zero hard-invariant
failures, and a positive observation-backed lower bound. Cost claims require
comparable metered economics; subscription and unknown economics fail closed.

`generateBenchmarkPublicReport` always prints the publication gate. Without a
verified manifest it reports `blocked` and `Public claim allowed: no`, even if
an internal benchmark profile is baseline-ready. The committed reference
bundle at `docs/benchmarks/verified-efficiency-v1/` intentionally declares no
performance claim and reproduces as `internal-evidence-only`.

## Invariants

- Context admission remains owned by `ContextGovernor`.
- Artifact storage and retrieval remain owned by `ArtifactResourceStore`.
- Authority and safety-critical required context is never silently reduced.
- Lossless and reversible transformations are explicit and independently
  inspectable.
- Canonical evidence remains retrievable throughout active verification.
- Unknown, malformed, absent, expired, or tampered evidence fails closed.
- Learned or model-judged utility cannot override required context.
- Lower-cost routes cannot weaken the verification contract.
- Phase-aware and static rollback routing share the canonical model-router port.
- Unsupported explicit effort and unbudgeted experimental `xhigh` fail closed.
- Output verbosity cannot suppress status, failures, warnings, citations,
  approvals, residual risk, or verification evidence.
- Verification usage is attributed independently from final-output generation.
- Memory recall cannot imply injection, and derivative memory cannot mint
  authority or replace canonical evidence.
- No candidate self-promotes; exact approved configuration identity is required
  for promotion and rollback.
- Surfaces never infer avoided tokens or re-sum canonical efficiency evidence.
- Avoided volume never changes or subtracts from provider totals.
- A benchmark-ready profile is not a public-ready claim without the verified
  publication manifest.
