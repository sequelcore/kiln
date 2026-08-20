# Work Governance

Work governance is Kiln's canonical contract for turning operator intent into
bounded, delegated, verified work. It is not prompt engineering. Prompt text is
only one input to the control plane.

When the operator requests tracked execution or policy requires it, Kiln uses a
governed lifecycle:

1. intent intake
2. surface map
3. risk hypothesis
4. specification or PRD clarification when needed
5. work decomposition
6. route and agent selection
7. delegated execution
8. verification gates
9. adversarial or specialist review
10. evidence summary and residual-risk closeout

Direct execution is the baseline. The lifecycle adds coordination only when a
configured trigger or concrete expected-value source requires it.

## Execution Identity And Surface Projection

The canonical session ledger remains append-only. User surfaces must not render
that ledger as one visual row per lifecycle event. They derive a live workflow
projection keyed by `goalRunId`, `workItemId`, execution `attemptId`, and tool
`toolCallId` so repeated snapshots update one semantic container.

Tool lifecycle events may carry a discriminated `executionScope`. A goal scope
contains `goalRunId`; a work-item scope also contains `workItemId` and may carry
`attemptId` and `managedInvocationId`. Runtime propagates this identity through
direct provider calls, managed invocations, canonical events, persistence, and
gateway frames. Surfaces may associate a tool with governed work only from this
explicit scope or an explicit managed-invocation/attempt relation. Temporal
proximity is not attribution evidence.

Execution tools own scope transitions. A ready or explicitly paused
`work_item.execution.start` result emits a typed `enter` transition; a started
attempt enriches that scope with its attempt and managed-invocation identity.
Runtime applies the transition before publishing the tool result and preserves
the active scope across subsequent provider tool rounds. A successful
`work_item.execution.finish` emits `exit` after its own result is attributed.
`work_item.complete` is reserved for standalone items and rejects goal-owned
work. Failed validation does not change scope.
This control metadata is canonical runtime input, not a rendering hint.

A managed invocation identifier is a reference, not proof. Before a
managed-delegation attempt can start, the work-governance boundary resolves the
identifier through the active runtime invocation service and verifies the
parent session, goal, work item, terminal success, and substantive result
handoff. Unknown, failed, incomplete, or scope-mismatched invocations are
rejected. Model-supplied strings never establish execution provenance.

Goal evidence is distinct from work-item evidence. Each declared goal
requirement is satisfied by a structured `goal.evidence.record` entry that
links a summary, optional resources, and contributing work items to the
requirement id. After every work item and required evidence entry is complete,
`goal.complete` performs the terminal validation and records the closeout.
Work-item evidence with a coincidentally matching label does not silently
satisfy a goal-level requirement.

GUI, TUI, CLI, replay, and future surfaces consume the shared workflow
projection contract. A surface may choose a card, sidebar tree, or textual
layout, but the semantics are invariant:

- a goal and each work item have one stable identity;
- lifecycle updates replace the latest projected snapshot rather than append a
  duplicate presentation;
- explicitly scoped tools appear under their owning work;
- unscoped tools remain independent and auditable;
- the raw append-only event ledger remains available outside the conversation
  projection.

## Doctrine

Kiln's default posture is direct execution. An agent should coordinate only
when a configured trigger applies or the topology has a concrete source of
expected value: independent parallel work, specialization, bounded context
isolation, independent evidence, or an authority or security boundary. Task
size, file count, and the availability of orchestration are not sufficient.

The operator should not need magic prompts such as asking whether the model is
"100% confident." Kiln should turn that intent into explicit work evidence:
surface mapping, loophole/risk hypotheses, tests or proof obligations, minimal
fixes, verification, cleanup, and residual-risk reporting.

Model self-review is useful but weak evidence. Stronger evidence comes from:

- executable tests
- typecheck and build results
- browser QA for user-interface changes
- managed-agent specialist review as a source of findings, not proof
- security, DDD, and architecture boundary review
- deterministic verifier feedback when a formal-methods workflow applies
- replayable session and artifact evidence

## Topology Selection

Operators may require orchestration for selected triggers such as:

- architecture or bounded-context impact
- security, credentials, permissions, sandboxing, or data-flow impact
- UI/UX behavior or browser-facing surfaces
- runtime, session, memory, tool, or provider-routing changes
- managed-agent, route, model, or evidence-plane changes
- global or project configuration changes
- cross-surface behavior
- long-running work
- verification-heavy work
- formal-proof candidates

Absent an explicit trigger, direct execution remains the baseline. The agent
still decomposes concerns when they vary independently, scopes work, and runs
verification proportionate to the affected surface. Coordination should state
its expected value before it is introduced.

An independent LLM review produces hypotheses and objections. Completion must
use deterministic or externally grounded verification whenever an oracle
exists.

## Configuration Contract

Global and project config may declare:

```yaml
workGovernance:
  defaultPosture: direct
  requireDelegationFor: []
  requiredEvidence: []
```

Global config establishes operator/team defaults. Project `.kiln/kiln.yaml`
may narrow posture or extend triggers and evidence expectations for the
repository. File-count and coarse risk thresholds are deliberately not policy:
they do not identify entanglement, authority, parallelism, or verification
needs.

The resolved policy is projected as required instruction context in CLI, GUI,
TUI, and benchmark sessions. Repo shims also include the resolved policy so
standalone native harness usage sees the same posture. Projection is not the
authority boundary; managed invocations, tools, approvals, and verification
gates still enforce the actual authority.
Because repo shims are generated from resolved global and project Kiln config,
this projection rule is not local to one repository. Any project that enables
work governance receives the same cross-harness authority posture after it
syncs repo shims with a Kiln version that includes this contract.

## Bounded Work Authority

[`bounded-work-authority.md`](bounded-work-authority.md) is the canonical
contract owned by this Work Governance boundary. It is a contract extension,
not a second workflow or task database:

- Core owns the canonical bounded-work revision, policy value types, scope
  envelope, limits, tripwires, candidate/evidence relations, and typed
  transition vocabulary. Runtime owns admission, reservation/accounting,
  recovery, and terminal truth. CLI, GUI, TUI, SDK, MCP, replay, and native
  adapters project or report that state and cannot widen it.
- Each revision is an immutable canonical serialization with a content digest,
  schema/policy revision, and explicit `supersedes` relation. A semantic change
  creates a new revision; stale revision or CAS generations are denied. Route,
  provider, harness, and session changes do not reset cumulative authority.
- Semantic scope, hard ceilings, configurable tripwires, and diagnostics are
  different dimensions. Scope governs permitted effects and non-goals; Runtime
  may deny hard ceilings; tripwires may request review or a pause but do not
  classify overengineering by fixed LOC; diagnostics never grant authority or
  prove completion. Unknown usage is unknown, not zero.
- The project-scoped Runtime identified by `projectRuntimeId` is the reservation
  and settlement authority for bounded work. Reservation is atomic and
  idempotent; settlement is consumed, released, or explicitly unknown/pending.
  This work authority is separate from managed economic commitments (#34) and
  normal session-turn provider budgeting (#35).
- Producer evidence binds the target/baseline, exact candidate bytes or diff
  digest, bounded-work revision, verification observations, and correction
  lineage. It reports facts only. Core's separate Assurance evaluation applies
  the mapping already fixed in the adopted contract revision to exact
  Runtime-resolved Git-blob subject digests. The terminal acceptance decision
  then binds that evaluation and its evidence basis to the adopting authority.
  An invocation result or model claim is not candidate proof; changed candidate
  bytes invalidate earlier evidence.
- Continuation and stop decisions map to the existing goal/work/attempt
  lifecycle and `SessionTurnOutcome` values. Scope revision, exhausted ceiling,
  missing capability, unresolved review, verification failure, and timeout
  remain blocked/paused/failed according to existing closeout rules; they do
  not become successful completion or a new terminal enum.

The current Runtime implementation deliberately fails closed at capability
edges. A hard tool-call or active-duration ceiling is not admitted when that
metric is unavailable; unavailable is never initialized as observed zero.
Managed writes require both an explicitly declared effect contained by the
contract and the intersection of contract roots with route write authority.
An isolated managed worktree is persisted as the attempt's candidate-capture
root, so closeout cannot silently inspect the parent checkout instead. Nested
managed delegation from a bounded child is denied until descendant accounting
authority and depth can be propagated non-forgeably. Finishing the last work
item enters `paused:bounded-work-acceptance`. The completed attempt persists its
candidate evidence and Assurance evaluation; only a current accepted decision
whose candidate and evaluation are both that completed attempt's records can
complete the goal.

Capability evidence is tiered as authoritative, partial, advisory, or
unsupported. The tiers describe enforceability and evidence for one operation;
they are not native-harness feature-parity labels. The [harness capability
contract](../surfaces/harness-integration-capabilities.md) owns the cross-harness
matrix and explicit no-parity claims.

## Cross-Harness Authority Degradation

Repo shims and native harness instructions may require orchestration, delegated
review, or subagent execution. Those requirements are valid workflow policy,
but they are not proof that the active harness can actually perform the
required action in the current turn.

Kiln therefore treats harness capability as an admitted runtime fact. When a
required delegation, approval, write, review, memory, or tool route is not
available, the parent must not simulate compliance with prose, create transient
project memory files, or pretend a native subagent ran. It must choose one of
these governed outcomes:

- use an admitted Kiln managed invocation route that satisfies the required
  profile, authority, tools, and evidence contract;
- continue locally only when the work item can still satisfy the configured
  evidence gates through available local verification;
- record an explicit pause requirement that names the missing capability,
  required authority, and operator action needed to proceed.

This rule applies equally when Kiln is the active surface and when Kiln policy
is projected into Claude Code, Codex, OpenCode, or another native harness.
Native harness agents, slash commands, hooks, permission modes, and config
files are projection or adapter mechanisms. They do not replace the canonical
work item, managed invocation, approval, authority, or closeout contracts.

If a projected instruction requires a delegated review but no admitted route is
available, the correct closeout is a blocked work item or residual-risk note,
not an invented review. If the operator explicitly authorizes a native harness
subagent outside Kiln's managed invocation service, the result is external
evidence until it is attached to the session through the same work-item evidence
plane as any other artifact.

The same resolved policy is exposed through CLI-owned builtin tools in runtime
surfaces:

- `work_governance.assess`
  Returns a direct-versus-orchestrate recommendation, matched triggers, reasons,
  and the evidence expected before closeout.
- `work_profile.list`
  Lists canonical workflow profiles, recommended agents, default authority, and
  verification gates.
- `work_item.update`
  Creates or updates a governed work item in the current session.
  The manual tool boundary requires a stable caller-owned `id` on the first
  call and every later update. That same identity owns classification
  provenance, execution attempts, evidence, and closeout; temporary ids such as
  `pending` are invalid.
  It cannot set `status=in_progress`; active execution is owned only by
  `work_item.execution.start` so attempts, route evidence, and pause reasons
  stay replayable.
- `work_item.list`
  Lists current work items and their evidence status.
- `work_item.complete`
  Attempts closeout and fails closed when required evidence or residual-risk
  reporting is missing.
- `work_item.execution.start` / `work_item.execution.finish`
  Records goal-bound execution attempts. Finish fails closed into a blocked
  work-item state when expected evidence or residual-risk closeout is missing.
- `submit_plan`
  Submits a structured governed plan artifact (objective, risk/workflow profile,
  work items, evidence gates, and spec/clarification linkage) during plan-mode
  turns.
  The submission path also emits a consistency analysis report; critical
  findings fail closed before approval.
  Plan approval is hash-bound: revisions with the same plan id recompute the
  content hash and supersede stale approvals rather than duplicating the plan.

Parent agents should use these tools when the task may be broad, risky,
cross-surface, provider/runtime-related, UI-related, or verification-heavy.
They are shared runtime tools, not GUI-only behavior.

An `orchestrate` or `delegate` recommendation is a control-plane obligation,
not a status label. After `work_governance.assess` recommends orchestration or
delegation, the same turn must materialize governed work through a durable
artifact such as `submit_specification`, `submit_plan`, `goal.create`,
`work_item.update`, `work_item.execution.start`, or `managed_agent.invoke`.
Pure scouting, search, file reads, or a "next I will..." status message are not
closeout evidence. Runtime records that turn as failed so GUI, TUI, CLI, SDK,
and replay consumers do not show unmaterialized orchestration as completed work.
Materialization is still not closeout. If the latest governed work-item snapshot
has unresolved `pauseRequirements`, the objective is blocked. Until the
canonical turn outcome enum gains a first-class `blocked` value, runtime must
project that turn as `failed` and keep the blocking reason in the work-item
evidence instead of reporting a completed turn.
The same fail-closed rule applies when a governed turn creates or updates an
open work item but never records a durable closeout artifact. A pending,
in-progress, or blocked item must be followed in the same turn by an explicit
plan, execution finish, completion, or formal pause evidence. Execution start
is materialization, not closeout: if it leaves the work item `in_progress`, the
turn remains blocked and is projected as `failed` until a later
`work_item.execution.finish` records terminal evidence for goal-bound work;
`work_item.complete` records terminal evidence only for standalone work.
Read-only scouting and managed-child research can satisfy evidence requirements
only after they are attached to that governed closeout path; they do not make an
open work item a completed turn by themselves. This projection is derived from
the canonical runtime event ledger, provider tool-execution summaries,
surface-captured tool completions from live GUI/TUI streams, and persisted
`gui-command`/`tui-command` transcript tool completions, so direct-provider,
GUI, TUI, CLI, SDK, and replay surfaces cannot disagree about the same open
governed work.

Runtime also projects this rule into every execute-mode provider call as
procedural governed context. The model is instructed not to end after research,
inspection, planning prose, or a successful read-only scout when the work item is
still open. It must continue on the same work item until it starts executable
work, finishes execution, completes the item, submits a structured terminal
plan, or records a concrete pause requirement that explains the block.

Intermediate execution phases are explicit recovery contracts. If
`work_item.execution.start` pauses for managed delegation and the child route
fails before producing the phase, the parent may complete the phase locally only
by recording the phase evidence with `work_item.update` on the same work item.
The runtime pause envelope must expose that next tool, work item id, evidence
names, and the follow-up `work_item.execution.start` call so GUI, TUI, CLI, SDK,
and replay consumers see the same recoverable state instead of a vague
read-only or sandbox failure. Text that merely resembles the `work_item.update`
input is not evidence and must not be treated as recovery. Because
`work_item.update` requires a summary even on update, the recovery envelope must
include a complete `workItemUpdateInputTemplate` rather than only an evidence
name. The template is not evidence; placeholder source URLs, artifact URIs, or
summaries must be replaced with real qualifying evidence before calling
`work_item.update`.
The successful state transition is runtime-owned. A successful intermediate
`managed_agent.invoke` must return one structured verification result for every
phase evidence label, using that exact label as `requirementId`. Runtime records
passed labels as `providedEvidence`, records genuinely unexecuted labels as
`skippedVerificationGates`, requires residual risk for every skip, and requests
the next phase on the same work item. The parent never transports phase evidence
or invocation ids on the happy path. Failed, inconclusive, missing, or
unapproved results remain explicit recovery contracts and fail closed.

Each runtime provider call carries an `effectiveTurnAuthority` snapshot in its
per-call tool config. The snapshot is projected from the final admitted tool
allowlist and tool-authority map, so operator displays summarize the same
authority that provider execution receives.

Operator surfaces may request turn authority, but runtime validates and admits
the effective authority. Invalid requested-authority values fail before
admission. In execute mode, `read_only` and `audited` requests narrow the
provider tool surface before invocation; `auto` preserves the current admitted
surface. An explicit `destructive` request on a supported direct-provider
surface admits destructive capabilities without per-action approval; it is a
high-authority operator decision and must never be inferred from prompt prose or
used as an unattended substitute for `audited`. Done-frame authority status is
projected from the same per-call config used for the turn, not from a freshly
derived default.

Authority modes are not natural-language approval prompts. A surface may render
an approval action only after runtime emits `approval_requested` with an
`approvalId`. If a turn is limited to `read_only` or `fail_closed`, the assistant
must report the missing authority or tool route instead of telling the operator
to approve text that has no runtime approval target. This rule applies equally
to GUI, TUI, CLI, and WebSocket gateway consumers.

## Work Items

Workflow automation represents decomposed work with explicit fields instead of
prose-only plans:

- id
- summary
- workflow profile
- trigger classification
- risk level
- affected surface
- assigned agent profile
- provider/model route
- authority profile
- expected evidence
- verification gates
- dependencies
- pause requirements
- execution attempts
- residual risk
- lifecycle status

This lets GUI, TUI, CLI, SDK, and MCP consumers render different views of the
same work contract without each surface inventing its own planning model.

Work item state is part of the session evidence plane:

- `work_item.update` and standalone `work_item.complete` return typed tool metadata.
- `work_item.execution.start` and `work_item.execution.finish` record
  execution attempts instead of relying on transient model memory.
- Goal-bound execution metadata carries the latest goal snapshot so terminal
  transitions project consistently across direct and orchestrated surfaces.
- The runtime ledger projects that metadata into canonical
  `work_item_updated`, `work_item_execution_started`, and
  `work_item_execution_finished` session events.
- The session resource plane exposes the current snapshot at
  `kiln://session/work-items` and individual items at
  `kiln://session/work-items/{id}`, including execution attempts, pause
  requirements, evidence, and residual-risk state.
- GUI and TUI render work items from canonical events and shared operator
  presentation contracts.
- Persisted transcripts replay the work-item lifecycle without requiring
  provider-native state or prose parsing.

This is durable within the canonical session model. Kiln must not create a
parallel task database, GUI-only task state, or prose-only checklist as the
source of truth. Future long-running workflow queues may index these same
session events, but they must not replace them.

## Goal Runs and Evidence Closeout

Goal runs are the governed execution container. Their source is explicit and
discriminated:

- `approved_plan` records the canonical plan id and optional approved content
  hash; these goals are created only through plan approval and materialization.
- `operator_direct` records the canonical operator turn id; attached runtime
  surfaces supply it and `goal.create` does not accept model-declared plan
  provenance.

Every goal also records its authority envelope, route policy, required evidence,
and linked work item ids. That binding makes the run reconstructable from session
evidence instead of relying on assistant text or surface-local UI state.
The goal authority envelope is a ceiling for every generated managed request.
Work-item profiles and route repair may narrow that ceiling but never widen it.
A read-only goal therefore remains read-only even when an exact configured
route supports only write-capable profiles; that route is incompatible and
runtime must select a uniquely compatible read-only route or fail closed.
Governed-scope admission rechecks the effective managed profile and requested
authority for direct `managed_agent.invoke` calls, so bypassing the generated
request cannot escape the same goal ceiling.

Goal route policy has one owner at a time. `managedAgentProfile` means the
agent profile owns child route selection through its configured route hints.
`preferredRouteId` means the caller owns the exact route. `goal.create` rejects
requests that combine both fields because that duplicates authority and can
produce cross-surface contradictions such as a scout profile being invoked with
a non-scout route. The one exception is redundant input: when every linked work
item already owns the same exact route and agent profile, `goal.create`
canonicalizes the goal route policy back to `workflowProfile` only, leaving the
route on the work item where execution authority belongs. Work items may still
carry their own explicit route when the route is part of that item contract;
goal-level preferred routes are not copied into profile-owned child requests.

`materializeApprovedPlanWorkItems` deterministically converts approved plan
work items into governed work items. The materialized items keep their source
plan relationship, goal id, route hints, expected evidence, verification gates,
dependencies, pause requirements, and residual-risk requirements. Runtime emits
`work_items.materialized`, and surfaces read the resulting state from
`kiln://session/work-items`.

Execution attempts are part of the same evidence plane:

- `work_item.execution.start` records the attempt, route, authority context,
  and managed invocation linkage when delegated execution is used.
- Managed-delegation attempts fail closed until the attempt is linked to a
  recorded `managed_agent.invoke` id.
- Managed-delegation child failures before attempt linkage keep the work item
  paused and mark the canonical parent turn failed; surfaces must not project
  that state as completed local work.
- `work_item.execution.finish` records facts-only producer evidence, the
  candidate-bound Assurance evaluation, verification gate results, skipped
  checks, and residual risk.
- A verified single-child `managed_delegation` attempt owns its direct result
  handoff on the attempt. It does not synthesize or require a
  `managedOrchestration` merge policy; that policy belongs only to explicit
  multi-child orchestration/adoption workflows.
- Failed verification gates block completion until a later attempt records a
  passing result.
- A skipped expected label accounts for that closeout expectation without
  claiming that evidence was produced. The same label must never appear in
  `providedEvidence`, and any skipped gate requires a residual-risk note before
  closeout can proceed.

Provided evidence and governed skips share one canonical accounting rule across
phase selection, recovery, completion, and replay. `providedEvidence` means the
artifact or proof exists. `skippedVerificationGates` and gate results with
`status = skipped` mean the obligation was explicitly not executed. A passing
custom gate is not silently promoted into provided evidence unless the work
item records that evidence label separately.

Goal closeout checks required goal evidence across materialized work items.
When the work item and attempt are complete but goal evidence is still missing,
`work_item.execution.finish` succeeds with
`work_completed_goal_closeout_pending`, exits the work-item execution scope,
and names `goal.evidence.record` followed by `goal.complete`. Missing goal
evidence is a subsequent closeout obligation, not a retroactive failure of the
completed attempt. Terminal goal transitions set `currentPhase` to the terminal
status so canonical state cannot remain `paused:*` after completion.
After a goal reaches `completed`, `failed`, or `cancelled`, its work items are
immutable through the generic update tool. Goal-bound completion and
cancellation also remain owned by the execution lifecycle rather than
`work_item.update`. This prevents a late recovery payload from reopening or
rewriting terminal governed state.
Missing evidence, failed gates, or skipped checks without residual risk are
projected as actionable closeout state through session events, resources, and
operator surfaces. If no manual summary is supplied, runtime generates a
deterministic final summary from the recorded goal and work-item evidence.

## Workflow Profiles

Kiln ships canonical workflow profiles for common work shapes:

| Profile | Use |
| --- | --- |
| `small-fix` | A bounded correction with local verification. |
| `bug-diagnosis` | Surface map, hypothesis, failing proof, minimal fix, verification loop. |
| `architecture-review` | Read-only boundary, dependency, or architecture inspection without implementation work. |
| `architecture-change` | Bounded-context, contract, or long-term design impact. |
| `ui-change` | Operator-facing or browser-facing behavior requiring visual-reference research before planning and browser QA before closeout. |
| `managed-agent-change` | Managed invocation, provider route, evidence, replay, or child handoff changes. |
| `config-change` | Global, project, harness projection, setup, or sync behavior. |
| `verification-heavy` | Work where correctness depends on strong checks instead of confidence language. |
| `formal-proof-candidate` | Small high-value logic with crisp invariants and deterministic verifier feedback. |

Profiles do not replace operator config. They are neutral control-plane
defaults that combine triggers, recommended agent profiles, default authority,
required evidence, and verification gates. Project and user configuration can
still decide which agents and routes satisfy those roles.

## Managed Agents

Managed child invocations are the execution substrate for delegated work. A
child should receive a bounded work item and return:

- substantive result handoff
- route, provider, model, profile, and authority identity
- evidence produced
- checks run
- files read or changed when applicable
- open questions or residual risk

When a parent delegates a work item, `managed_agent.invoke` should carry the
handoff contract fields:

- `workItemId`
- `roleIntent`
- `executionPhase`
- `expectedEvidence`
- `requiredToolNames`
- `requiredResultFields`
- `doneCriteria`
- `residualRiskRequired`

These fields are admitted as part of the managed invocation request and emitted
in canonical session events and tool metadata. They are not authority by
themselves; authority still comes from the managed invocation profile and route.
They are also not identifiers by assertion: Runtime verifies `goalRunId`,
`workItemId`, their ownership relationship, parent-session ownership, terminal
state, and any supplied active attempt before a direct `managed_agent.invoke`
can start. A missing goal returns `goal_not_found` with `goal.create` as the
recovery tool; Kiln never runs a child under fabricated governed scope.

The child closes its delegated work through the canonical
`structured-execution-result-v1` contract. Direct-provider routes submit that
contract through the runtime-internal `managed_agent.submit_handoff` tool;
harness adapters validate their corresponding structured transport at the
adapter boundary. Parent-facing surfaces receive the same validated result DTO
and replay links regardless of transport.
`requiredResultFields` accepts canonical DTO fields only:
`summary`, `resourceUris`, `evidence`, `verificationResults`, `uncertainty`,
`limitations`, `warnings`, `approvalRequirements`, and `residualRisks`.
Transport-era aliases are invalid input rather than compatibility behavior.

Model-facing work-governance results are bounded projections. They retain
status, evidence/gate state, the latest attempt summary, and canonical
`kiln://session/goals/{id}` or `kiln://session/work-items/{id}` pointers while
omitting nested structured handoff bodies. The canonical stores, session events,
and managed-invocation result resources retain the replayable detail.

The parent remains accountable for integration and closeout. A child completion
is not the same as task completion unless the required evidence gates are
satisfied.

Parallel governed work uses typed managed orchestration requests instead of
surface-local worker loops. Fan-out, decomposition, review swarm, route
comparison, and background job modes carry child requests, expected evidence,
isolation policy, merge or adoption policy, and admission limits. Admission
checks child count, route health, budget availability, workspace isolation, and
task risk before any child starts. CLI fan-out commands are adapters over this
contract; they do not own a separate worker lifecycle.

The cross-surface execution entrypoint is `managed_agent.orchestrate`. It
accepts the bounded work graph produced by governance, not prose instructions
to spawn agents. Every work item names a stable id, bounded role intent, task,
dependencies, and either an admitted `agentProfile` or explicit `routeId`.
Core selects the topology and preserves those contracts. Runtime validates each
profile and route, schedules dependency-ready work, passes successful bounded
handoffs and resource URIs downstream, and records terminal evidence. A failed
dependency blocks its dependents. The current coordination policy serializes
dependency-bearing and high-risk graphs; it does not claim a distributed DAG
scheduler. Parallel high-risk admission fails closed. Independent review also
fails closed unless at least two distinct provider/model identities are
admitted.

For broad work items, `work_item.execution.start` scopes each generated
managed invocation to the next missing evidence phase instead of asking one
child to produce the entire work item in a single timeout window. Intermediate
phases return `executionPhase.completionTool = "work_item.update"` and must be
recorded as provided evidence on the same pending work item before requesting
the next phase. Only the final phase returns
`executionPhase.completionTool = "work_item.execution.finish"`. Completion of
that child phase returns a verified invocation id to
`work_item.execution.start`; the start transition then creates the execution
attempt and links the substantive handoff. No attempt id exists before that
transition. An attached runtime surface with the finish capability then closes
the persisted attempt with `work_item.execution.finish`; a surface without that
capability exposes a pause instead of claiming completion. This keeps delegated
work small, replayable, and cross-surface observable without predictive
lifecycle identifiers.
The final phase also receives `verificationRequirementIds`: its evidence labels
plus every still-unaccounted work-item verification gate. It must return exactly
one structured passed or skipped result per id, so final handoff validation and
work-item closeout cannot disagree about hidden gates.
Evidence phases that depend on external UI or frontend references also carry
`requiredToolNames` and implied route capabilities. Runtime validates those
tools and the required `network` capability against the selected managed route
before the child starts. A route that cannot run the phase tools, or that has
those tools without network authority when network is required, fails closed as
unavailable instead of timing out inside a child that cannot gather the required
evidence.
For UI work, `visual-reference-research` is separate from `browser-qa`.
Reference research happens before planning. It should use running-product UI
captures when those exist, but it must not block on screenshots that a
reference repository does not publish. In that case, code-backed frontend
implementation evidence is valid when it records source URLs, relevant
frontend file paths, component/layout/navigation patterns, density, typography,
panels, status areas, and reusable design principles. Browser QA happens after
implementation and proves the changed Kiln surface renders and behaves
correctly. Repository chrome, README text, file lists, stars, forks, or code
navigation screenshots are source-discovery evidence only; raw file listings
alone do not satisfy frontend-reference research without actual implementation
analysis.
When an implementation work item uses a write route, visual-reference research
must use a separate read-only frontend-reference phase route. Store that explicit
mapping in the work item `phaseRoutes`, for example
`visual-reference-research: opencode-go-qwen3-6-plus-readonly` for frontend
reference synthesis. The selected route must actually expose the phase
`requiredToolNames` such as `web_search`, `web_fetch`, and `web_extract`; a
read-only route synthesized from generic routing without web/source tools is not
a valid frontend-reference route. The
implementation phase then returns to the work item's write route after
`work_item.update` records the frontend-reference evidence. A UI work item assigned to
`foundation-apply-approved-writes` fails fast if it still expects
`visual-reference-research` and omits `phaseRoutes.visual-reference-research`.
The failure returns a structured `nextTool: work_item.update` recovery payload
with the required `phaseRoutes.visual-reference-research` patch shape. The
parent must retry the tool call; assistant text that merely contains the JSON
does not create governed state. This prevents a parent from doing local browser
research outside the governed managed phase and then continuing without
recording evidence.
Managed-delegation work items do not start until the execution attempt is linked
to a recorded managed invocation id. If that id is missing,
`work_item.execution.start` pauses with an actionable `managed_agent.invoke`
request internally. Attached runtime surfaces hydrate and execute that request
before returning to the parent. For every validated intermediate phase, runtime
records the structured evidence disposition and selects the next phase. For the
final phase, runtime links the recorded invocation id to a new attempt and
closes that attempt with the validated handoff. Each phase receives a distinct
invocation id. The parent must not spawn a second child, copy invocation ids, or
add a guessed profile. Runtime surfaces may attach a
profile only when a single configured agent profile explicitly owns the same
route id.
Each generated phase carries `taskAffinity` in addition to required tools.
Route selection uses configured `taskSuitability` only after capability
filtering and only when it produces one unique winner. Ambiguous ties fail
closed instead of becoming provider-order fallback.
Canonical artifact content URIs recorded by earlier phase verification results
are included in later phase resources. This reuses bounded evidence without
copying whole transcripts or depending on provider-native conversation state.
The generated managed invocation request treats the work item route and
authority profile as governed state, not as model-owned hints. Caller-supplied
`managedProfile` or `requestedAuthority` values may narrow a route only when
they do not contradict the selected work item. A routed write work item keeps
its configured write profile and is not downgraded to a read-only profile by a
turn-level hint, except for explicit intermediate read-only phase routes such
as `visual-reference-research`.
If browser/web/source tools are used while a governed work item still expects
`visual-reference-research`, the turn remains failed until a real
`work_item.update` records that evidence on the same work item. Submitting a
plan or prose summary does not clear the frontend-reference obligation.

Managed invocation failures are blocking evidence. A `managed_agent.invoke`
result with status `failed`, `denied`, `timed-out`, or `cancelled`, whether it
was called directly by the parent or through `work_item.execution.start`, makes
the parent turn outcome `failed`.
When the child fails before `work_item.execution.start` has persisted an
attempt, recovery uses `work_item.update` to record a pending `capability` pause
requirement. It must never emit `work_item.execution.fail` or an attempt id for
an attempt that does not exist.
For intermediate phases, the blocking result may include
`managedInvocationRecovery.nextTool = work_item.update`. That recovery is
resolved only by a later successful `work_item.update` on the same work item
that accounts for every required phase evidence label as produced evidence or
as an explicit skipped verification with residual risk.
Recording the recovery in assistant text, submitting a plan, or continuing with
local read-only inspection without the update keeps the turn failed.
Successful intermediate child completion is consumed internally by attached
runtime surfaces. `managedInvocationPhaseCompletion` is an internal validated
transition, not an instruction for the parent. Surfaces that intentionally omit
work-governance mutation tools expose the transition as a capability pause;
they cannot silently claim progress. The parent must never paste an update
payload, `providedEvidence`, or `verificationGateResults` into assistant text as
a substitute for runtime state.
Surfaces must not project a completed turn when required managed-agent evidence
failed or never materialized.
The same rule applies when the latest work-governance tool result is an
unresolved error or pause: the parent turn outcome is failed until a later
governance result records successful recovery or closeout.
Persisted session metadata separates lifecycle from turn outcome:
`sessionLedger.currentPhase` describes the session lifecycle, while
`lastTurnOutcome` describes the latest governed turn result. A GUI command
session may therefore have `sessionLedger.currentPhase = "completed"` because
the host process exited cleanly, and `lastTurnOutcome = "failed"` because the
latest governed turn left blocking evidence.
Runtime derives that outcome from every trusted tool-evidence plane rather than
selecting the first nonempty projection. A canonical `goal.complete` may
reconcile an earlier, incomplete work-governance projection only when every
observed goal is terminal and the terminal plane itself has no open governance
state. An unresolved managed-invocation failure remains blocking across planes;
goal closeout cannot hide it.

## Formal Verification Candidates

Formal verification is not a universal requirement. It is appropriate for
small, high-value logic surfaces with crisp invariants: pure domain logic,
state machines, authorization rules, financial calculations, protocol
transitions, scheduling constraints, and concurrency models.

When a task is classified as `formal-proof-candidate`, Kiln should consider a
verifier-backed workflow such as Dafny, TLA+, Alloy, Lean, property tests, or
another deterministic checker. The proof is only as good as the specification,
so spec review remains part of the gate.

## Research Basis

The current market and research direction supports this contract:

- OpenAI Agents SDK documents manager-style orchestration, handoffs,
  guardrails, and tracing as first-class concepts.
- Anthropic Claude Code guidance recommends plan mode for uncertain,
  multi-file, unfamiliar, or higher-risk work, and direct action for tiny
  clear tasks.
- Claude Code and OpenCode both expose subagent concepts, but community usage
  reports show that deciding when to delegate and how to preserve context and
  evidence remains operationally hard.
- Recent multi-agent orchestration papers emphasize plan-execute-verify-replan,
  human oversight, dependency visualization, and objective verifier feedback.
- Verifier-in-the-loop projects such as `lemmafit` demonstrate the strongest
  form of this pattern: model output is corrected by deterministic proof or
  verification feedback, not by confidence language.

Kiln's contribution is to make these patterns provider-neutral, cross-surface,
auditable, and configurable through the control plane.

## Invariants

- Do not encode workflow discipline only as prompt text.
- Do not let GUI, TUI, CLI, SDK, or native harness shims invent different
  orchestration rules.
- Do not treat child completion as task completion without evidence.
- Do not treat self-confidence as proof.
- Do not require delegation for trivial low-risk local work.
- Do not bypass managed invocation authority when delegating.
- Do not hide residual risk at closeout.
