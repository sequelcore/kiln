# Execution Kernel

## Purpose

Runtime's Execution Kernel is the internal sequencing boundary for Kiln-owned
non-idempotent or externally consequential dispatch. It prevents retry, replay,
restart, cancellation, or adapter fallback from causing a second Kiln dispatch
for one durable attempt.

The kernel shares ordering and proof mechanics. It is not an orchestrator,
provider or harness abstraction, workload registry, universal persistence
schema, retry engine, or recovery authority. Model Gateway, operator sessions,
Agent Tasks, managed children, and capability execution retain their
own workload state and lifecycle owners.

## Canonical Vocabulary

- A **workload attempt** is one durable identity under which Runtime may try to
  cross one named dispatch-effect boundary. Attempt identities are never reused.
- An **authority admission** is the immutable, content-addressed
  `EffectiveAuthorityAdmissionBundle` that binds the configuration revisions,
  authority, tools and effect ceiling, budget, route, data policy, exact
  execution binding, and economic commitment where one exists.
- A **persisted-admission receipt** is the opaque Runtime evidence returned only
  after the authority-evidence owner has durably written and read back that
  bundle. It carries the exact `admissionId` consumed by an action fence.
- A **resource commitment** reserves capacity, money, a worktree, a sandbox, a
  port, a credential route, or another workload prerequisite. It is recoverable
  according to its owning domain and is not by itself proof that the protected
  action was dispatched.
- An **action claim** is the workload owner's canonical durable record for the
  exact attempt, intent, authority admission, and named dispatch effect.
- A **dispatch fence** is the action claim's atomic, irreversible transition
  that grants one caller permission to cross the named effect boundary. Exact
  replay returns no second permission; conflicting identity fails closed.
- A **dispatch permit** is the opaque, process-local result returned only to the
  winner of the fence transition. It cannot be reconstructed from DTOs,
  projections, resource records, or persisted prose.
- An **attended trusted-execution lease** is separate process-local authority
  for one exact operator session and invocation tree. It can authorize only the
  bound profile, tools, and effect ceiling; it is never a dispatch permit,
  persisted admission, recovery record, or provider-attestation claim.
- An **observation** records only what Runtime can prove about the dispatch:
  `known-not-dispatched`, `terminally-observed`, or `outcome-unknown`.
- **Settlement** and **reconciliation** translate an observation into the
  workload's canonical task, replay, capacity, economic, process, or resource
  state. They do not create another dispatch permit.

Resource commitment and action fencing are distinct semantics even when one
transaction or physical row implements both. A capacity or economic record is
an action claim only when its owner also binds the exact attempt, intent,
`admissionId`, effect identity, and no-second-dispatch transition. A generic
`replay` flag on resource acquisition is not action-dispatch authority.

## Required Invariant

For one durable workload attempt identity, Runtime may cross its named
Kiln-owned dispatch-effect boundary at most once. Before crossing it, Runtime
holds one immutable admitted authority and configuration snapshot and one
canonical action claim bound to that snapshot. After the action claim is
fenced, cancellation, timeout, transport failure, process loss, restart,
replay, or adapter fallback cannot authorize another dispatch for that attempt.

An outcome without authoritative terminal evidence remains unknown or in the
workload's conservative pending state until reconciliation. A later execution
requires a new explicitly admitted attempt identity. Runtime never unfences and
retries the same attempt.

This is an at-most-one Kiln dispatch-authorization invariant. It does not claim
that a provider, process, tool, remote service, or native harness received,
executed, internally retried, or completed the action exactly once. No local
transaction can be atomic with an external effect; a crash after fencing and
before terminal observation necessarily preserves uncertainty.

## Attended Trusted-Execution Boundary

The first attended trusted-execution path is limited to interactive CLI `run`
and foreground `managed_agent.invoke` on the Runtime-controlled Codex OAuth
direct route. Runtime validates the process-local lease before authority
observation or resource acquisition. It then checks the lease against every
resolved child tool and concrete effect before cache lookup or execution.
Consequential effects are checked again after asynchronous admission readback
and immediately before the durable action claim; every retry repeats the
check.

Observed expiry latches the lease terminal so clock rollback cannot reactivate
it. Completion, session close, revocation, composition revision change, or the
one-hour cap ends it. The lease travels beside canonical request and admission
values and is not serialized into either one, a recovery checkpoint, a native
projection, or legacy grant storage. Restart therefore cannot reconstruct or
resume attended authority. This proves Kiln-owned issuance and effect checks
only; it does not prove provider, sandbox, filesystem, network, or operating-
system enforcement and cannot by itself produce `current-verified`.

## Canonical Flow

```text
admit
  -> acquire recoverable resources
  -> resolve the exact secret-free execution binding
  -> persist the authority admission and obtain its receipt
  -> materialize the side-effect-free dispatch adapter
  -> complete recoverable resource commitment transitions
  -> fence the canonical action claim
  -> invoke the named dispatch port once
  -> observe
  -> settle or reconcile through workload owners
```

### 1. Admit

The workload validates current identity, authority, configuration revision,
route, data policy, budget, approvals, and effect ceiling. Core owns pure
policy and selection values; Runtime composes them through their named
authorities. A surface or adapter cannot manufacture an admitted attempt.

Runtime-attached built-in tools follow that same ownership boundary. Runtime
evaluates persisted tool authority and any input-sensitive configured
invocation admission before the action claim, then passes the exact resolved
effect and final allowing authority to Core's admitted-execution port. Core's
standalone execution port retains its own authorization for MCP and other
callers that have no Runtime admission; it is never re-entered after a Runtime
claim.

### 2. Acquire

The workload acquires capacity, economic commitments, and required resource
leases. Acquisition cannot invoke the protected action. Every acquisition
retains its own release, compensation, checkpoint, leak, and recovery rules.

Failure before the final action fence may release or retry only when the
workload owner can prove that its protected effect was not dispatched.

### 3. Resolve The Execution Binding

Runtime resolves the exact secret-free route, account, credential ID and
credential revision, data policy, and other binding evidence required by the
authority bundle. Resolution may inspect current authorities but cannot read
credential values, construct a side-effecting adapter, or cross the protected
dispatch boundary.

Selection, account rotation, and fallback finish at this stage. A later binding
change requires a new authority admission and cannot be hidden inside an
adapter.

### 4. Commit Authority Admission

After the exact secret-free route and execution binding are known, Runtime
defines and durably persists the complete `EffectiveAuthorityAdmissionBundle`
through the authority-evidence owner. That owner validates the content address,
writes the full bundle, reads it back, and returns a
persisted-admission receipt. Persisting the bundle is safe preparation: it
records what may execute but does not grant permission to dispatch.

The full bundle has one canonical evidence owner. Workload claim stores retain
at least its content-addressed `admissionId`; they do not copy selected facets
into alternate authority fields. A missing, malformed, stale, or unavailable
bundle fails closed before the action fence. The evidence owner supports
retrieval by `admissionId` for recovery and audit and retains the full bundle at
least as long as an active or retained action claim references it.

### 5. Prepare Dispatch

Runtime performs every fallible step that can be completed without crossing the
protected boundary: ephemeral credential-value resolution for the already
admitted ID and revision, side-effect-free adapter construction, payload
normalization, and final cancellation checks. The resolved value must still
match the binding in the persisted bundle. Route selection, account rotation,
authority recomposition, retry, and fallback are complete before fencing.

If credential or adapter materialization can itself produce an external effect,
consume a one-shot capability, rotate authority, or launch work, it is not
preparation. It becomes its own named dispatch boundary.

### 6. Fence Dispatch

The workload's one canonical action-claim authority atomically compares and
binds:

- durable attempt identity;
- intent fingerprint;
- owner generation or equivalent stale-writer fence;
- the persisted-admission receipt and its content-addressed `admissionId`; and
- the exact named effect identity.

The claim authority consumes the already validated receipt; it does not query
or copy the authority-evidence store inside its transaction. A new exact
transition returns one opaque dispatch permit. Exact replay returns the
existing state without a permit. Conflicting intent, admission, generation, or
effect identity fails closed.

Persisting the bundle before the claim avoids a cross-store commit protocol. A
crash after bundle persistence but before fencing is pre-dispatch. A crash after
fencing is post-fence and conservatively unknown; it cannot redispatch even if
no terminal observation exists. Each workload chooses one existing owner for
this transaction; the kernel defines no global action-claim database.

The authority bundle enters consequential execution at this transition, when
the action claim binds its `admissionId`. Bundle composition or persistence
alone is not execution authority.

### 7. Execute

The kernel consumes the dispatch permit and calls the named dispatch port once.
No awaited selection, credential rotation, adapter fallback, authority hook,
unrelated persistence, or second cancellation gate is reachable between a
successful fence and that call. Cancellation is checked before fencing; after
fencing it is an input to execution and observation, not permission to create a
replacement dispatch.

A process crash in the unavoidable fence-to-effect gap produces an unknown
outcome after restart. Live code that proves the dispatch call was not entered
may record `known-not-dispatched`, but the fenced attempt remains closed and
still cannot be retried under the same identity.

### 8. Observe, Settle, And Reconcile

The shared runner records only:

- `known-not-dispatched` when the active owner proves the dispatch port was not
  entered;
- `terminally-observed` when authoritative evidence identifies a terminal
  result; or
- `outcome-unknown` when the effect may have escaped without terminal proof.

Timeout, cancellation request acceptance, connection loss, process loss, and
ordinary transport exceptions after fencing are not terminal proof. A typed
provider rejection may be terminal when its adapter contract proves the
provider did not accept work.

Workload owners map the observation into their real comparison domains and
states. Economic charge, capacity release, response replay, task completion,
process termination, and resource cleanup remain separate settlements. One
physical transaction may settle several records when their established owner
already supports it; otherwise projections converge from the canonical claim
without becoming alternate authorities. Settlement or evidence-publication
failure preserves conservative consuming state.

## Ownership And Dependency Direction

- **Core** owns pure admission, route and candidate selection, authority
  attenuation, settlement-value validation, and provider-neutral policy. Core
  does not invoke effects or persist Runtime lifecycle.
- **Runtime Execution Kernel** owns the phase-order contract, opaque dispatch
  permit, single invocation of the named dispatch port, generic observation,
  and the requirement to call workload closeout.
- **Runtime authority evidence** owns full admission-bundle persistence,
  read-back proof, retrieval by `admissionId`, and the persisted-admission
  receipt. It does not fence or invoke effects.
- **Runtime workload owners** own acquisition, canonical action claims,
  persistence, retry or new-attempt eligibility, recovery, reconciliation,
  settlement meaning, payload retention, and cleanup.
- **Adapters** implement inward-facing dispatch and observation ports. They do
  not select fallback, widen authority, mint attempts, or settle canonical
  workload state independently.
- **Model Gateway, Agent Tasks, operator surfaces, GUI, TUI, CLI, SDK, and
  capability adapters** are clients. They do not become parallel lifecycle or
  policy authorities.

The kernel shares mechanics, not state. It defines no universal execution row,
result schema, retry counter, timeout policy, economic amount, replay payload,
resource lease, process state, provider fallback, or configuration surface.

Runtime owns model-round dispatch. Operator and managed direct-provider paths
use `RuntimeModelRoundDispatchService`; Model Gateway ingress uses
`invokeGovernedOneRound` with its durable replay row. The ingress resolves its
target and calls that kernel path, but it does not own an agent loop, tool loop,
managed-child lifecycle, or operator-session policy.

## Named Effect Boundaries

| Workload | Kiln-owned dispatch effect | Fence does not prove |
| --- | --- | --- |
| Direct or Model Gateway model round | Entry into the provider dispatch port for one exact request and binding | Provider receipt, completion, or caller-owned tool execution |
| Operator session | Entry into each independently retryable Kiln-owned provider or consequential tool dispatch | That a turn-level orchestrator handoff governs every inner effect |
| Managed direct-provider child | Entry into the managed adapter invocation; independently retryable Kiln-owned inner effects use child claims | Exactly-once child completion or hidden provider behavior |
| Native SDK or CLI harness | The SDK invocation or process launch performed by Kiln | Hidden model calls, tools, subagents, retries, or native permission enforcement |
| Remote agent task or external harness | The outbound remote-task creation or send operation performed by Kiln | Remote execution, cancellation, internal retries, or remote terminal truth |
| Capability or tool adapter | Entry into the exact consequential adapter operation | External receipt or completion without authoritative evidence |

A parent turn, task, or child claim does not cover independently retryable
Kiln-owned inner effects. Nested attempts retain parent/child attribution and
their own admitted authority. Conversely, Kiln treats a native or remote
harness as an opaque external execution domain and fences only the launch or
invocation it owns.

Resource-lease acquisition is not an action-dispatch fence. Worktree, sandbox,
artifact directory, port, environment, and credential-route leases retain their
checkpoint and reverse-order compensation semantics.

For a Kiln-owned direct provider adapter, the dispatch port represents one
outbound acceptance attempt. Automatic transport or SDK retries are disabled
unless the adapter has an admitted provider-idempotency contract that preserves
the same action claim and reports every attempt. Native or remote harnesses may
retry internally, but those retries remain explicitly outside Kiln's claim.

## Replay, Retention, And Recovery

Replay result payloads and the minimal no-redispatch claim have different
retention semantics. A completed encrypted response body may expire. Expiring
that body must not delete the tombstone or otherwise authorize the same durable
attempt or accepted idempotency identity to dispatch again.

The canonical owner retains the minimal attempt, fingerprint, `admissionId`,
effect identity, and fenced/terminal-or-unknown evidence for the entire period
in which that identity can be replayed. Retirement belongs to the canonical
parent attempt or session owner and is legal only when that complete namespace
is irreversibly retired and ingress can no longer present the accepted identity.
Response TTL, cache pressure, result-body expiry, or `maxEntries` are never
retirement evidence. Until a workload implements that parent retirement
contract, its fenced or unknown tombstone does not expire. A process-local
guard cannot prove restart-safe no-redispatch behavior and must advertise that
limitation; it is not production evidence for this invariant.

Fallback is allowed only before the final action fence. After authoritative
terminal evidence, policy may admit a new attempt with a new identity. Ambiguous
post-fence failure never triggers adapter-local retry, account rotation, hidden
provider fallback, or checkpoint resume of the same attempt.

Cancellation request acceptance is not termination proof. External work stays
unknown or workload-specific pending, and retains the resources required by its
recovery contract, until authoritative termination evidence or reconciliation
permits release.

Managed remote-harness cancellation is its own `remote-cancel` action claim.
Whether that request is acknowledged or fails, the invocation remains
`result_pending` with an unknown remote outcome and keeps its recovery-required
leases. In the live process, only the original invoke promise can reconcile a
late terminal record, exactly once and without redispatch. After process loss,
the opaque remote transport exposes no terminal-status fetch contract; Runtime
therefore restores the pending checkpoint, retains its leases, and requires
operator or external reconciliation instead of fabricating termination or
cleanup.

## Current Runtime Owners

The contract is implemented through these named workload owners. Each
entry binds the full persisted authority admission before it returns a one-use
permit. Exact replay returns no permit, and conflicting identity fails closed.

| Workload | Canonical claim and invocation owner | Workload settlement owner |
| --- | --- | --- |
| Model Gateway one-round ingress | `invokeGovernedOneRound` consumes the action permit issued by the `LocalModelGatewayStore` replay row immediately before `dispatchOneRound` | Model Gateway replay/capacity closeout; response payload retention is separate from the permanent no-redispatch tombstone |
| Operator, App Gateway, GUI, and TUI provider round | `RuntimeModelRoundDispatchService` and the operator composition's durable model-round claim store | Operator session evidence plus the configured account-capacity authority |
| Managed direct-provider child round | `RuntimeModelRoundDispatchService` with a managed-child attempt and round identity | Managed invocation lifecycle and economic coordinator; finalization is a distinct claimed round |
| Consequential builtin, integration, webhook, browser, computer, and MCP tool call | `RuntimeToolActionClaimService` with the resolved admitted tool effect | Tool result projection and the owning turn or managed invocation; an ambiguous claimed effect is not retried |
| Channel send | `dispatchChannelEgress` and the channel-egress claim store | The channel caller's delivery projection; provider ambiguity remains an unknown tombstone |
| STT, TTS, and consequential built-in multimodal processing | `dispatchRuntimeMediaAction` and the media-action claim store | The owning turn/media projection; opaque media executors and publisher injection are not supported |
| Native or remote Agent Task | `AgentTaskApplicationService` and the task's canonical action claim immediately before the external launch | Agent Task store, with native, remote, and economic outcomes kept distinct |
| Managed CLI, SDK, or remote harness invocation | Managed external-invocation action claim immediately before the one Kiln-owned launch/send | Managed invocation and economic authorities; the harness inner loop remains external evidence |

Model Gateway remains ingress and target resolution. It calls the Runtime
kernel and does not own an agent loop, tool loop, managed-child lifecycle, or
operator-session policy. Account-capacity records remain resource commitments;
they cannot issue a model, tool, media, channel, task, or harness dispatch
permit.

There is no alternate provider-backed knowledge, grounding, enrichment,
contact-memory, generative readiness-probe, A2A, conversation-event, embedded
operator shell, or direct GUI browser-control dispatch path. Those optional or
unowned effects were deleted rather than retained behind compatibility flags.
Deterministic in-process projection and summarization do not acquire dispatch
authority.

Code-only contracts have no compatibility route. Obsolete durable store schema
is rejected without mutation; a supported state migration must be designed as
an explicit data migration for a demonstrated retained local-state consumer.

## Complexity Disposition

The required invariant is one mechanically enforced dispatch authorization for
each durable attempt, with honest post-fence uncertainty.

The simpler alternative was to document the common phase order while retaining
the separate implementations. It is insufficient because current code already
permits optional authority commit, fences resource state before fallible
preparation, duplicates economic and task-store fences, and can expire replay
state into redispatch. Documentation alone cannot enforce ordering or prevent a
second permit.

The broader alternative was one Runtime-wide action-claim store and universal
lifecycle state machine. It is rejected because it duplicates established task,
replay, capacity, and economic records; forces different recovery domains into
one retention and settlement model; and exports translation and coordination
cost to every workload. A common contract plus one canonical claim owner per
workload preserves the invariant without creating a new global state owner.

Permanent concepts retained:

- one internal Runtime sequencing and dispatch-permit contract;
- one persisted-admission receipt and read-by-`admissionId` evidence contract;
- one named Runtime model-round dispatch owner;
- workload-specific model, tool, media, channel, task, and external-invocation
  action claims;
- one small generic observation vocabulary; and
- an `admissionId` and exact effect identity on every canonical claim.

Concepts removed by the convergence:

- optional or authority-less committed execution;
- generic attempt-phase wrappers that duplicate workload records;
- resource-acquisition replay used as action idempotence;
- duplicate Agent Task economic fence authority;
- post-fence retry and fallback paths;
- committed-path authority copied from mutable per-call candidate fields;
- production claims based only on process-local replay state;
- provider-backed knowledge, enrichment, grounding, and contact-memory effects
  without a canonical action owner; and
- direct embedded terminal and GUI browser-control effects without a workload
  claim owner.

No new configuration, queue, provider abstraction, retry mode, universal
database, compatibility seam, or shared recovery lifecycle is admitted.

## Verification Contract

Every migrated workload has deterministic tests at these boundaries:

- before and after resource acquisition;
- before and after authority-bundle persistence;
- immediately before and after the action fence;
- during the named dispatch call;
- after dispatch and before settlement;
- during settlement or evidence-publication failure; and
- after reopening durable state and replaying the same attempt.

The oracle counts entry into the named dispatch port and proves a count no
greater than one for each durable attempt across concurrent delivery, retry,
replay, restart, cancellation, fallback, and settlement failure. Tests also
cover configuration mutation after admission, stale owner generation,
conflicting fingerprints or admission IDs, result-payload expiry, and
cancellation/settlement races.

External-harness fixtures verify only Kiln's launch count and explicitly mark
inner-effect evidence unavailable. Provider idempotency keys may strengthen a
specific adapter but never substitute for the Runtime fence. Live validation
remains explicitly authorized evidence and does not replace deterministic
synthetic gates.

## Long-Term Invariants

- Every consequential Runtime dispatch names one exact Kiln-owned effect and
  one canonical action-claim owner.
- One workload attempt can produce at most one dispatch permit.
- Every action claim binds one persisted `EffectiveAuthorityAdmissionBundle`.
- Resource commitments and action claims remain semantically distinct.
- Pre-fence and post-fence recovery are never collapsed.
- Post-fence ambiguity cannot redispatch, release consuming authority, or
  fabricate terminal success.
- Native and remote harness claims stop at Kiln's invocation boundary.
- Workload stores, retry eligibility, recovery, settlement, payloads, and
  cleanup remain with their real owners.
- Inner Kiln-owned effects are not hidden behind an outer turn or child claim.
- Migration leaves one authoritative path and deletes the superseded path.
