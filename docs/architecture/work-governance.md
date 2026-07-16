# Work Governance

Work governance is Kiln's canonical contract for turning operator intent into
bounded, delegated, verified work. It is not prompt engineering. Prompt text is
only one input to the control plane.

Kiln treats non-trivial work as a governed lifecycle:

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

Direct execution is an actuator inside that lifecycle, not the default identity
of the system.

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

Kiln's default posture is orchestration. Parent agents are conductors,
integrators, and accountable closers. They may execute directly only when the
task is local, low-risk, and inside the configured direct-execution envelope.

The operator should not need magic prompts such as asking whether the model is
"100% confident." Kiln should turn that intent into explicit work evidence:
surface mapping, loophole/risk hypotheses, tests or proof obligations, minimal
fixes, verification, cleanup, and residual-risk reporting.

Model self-review is useful but weak evidence. Stronger evidence comes from:

- executable tests
- typecheck and build results
- browser QA for user-interface changes
- managed-agent specialist review
- security, DDD, and architecture boundary review
- deterministic verifier feedback when a formal-methods workflow applies
- replayable session and artifact evidence

## Orchestration Preference

Kiln should prefer orchestration when work has any of these triggers:

- architecture or bounded-context impact
- security, credentials, permissions, sandboxing, or data-flow impact
- UI/UX behavior or browser-facing surfaces
- runtime, session, memory, tool, or provider-routing changes
- managed-agent, route, model, or evidence-plane changes
- global or project configuration changes
- multi-file or cross-package edits
- cross-surface behavior
- long-running work
- verification-heavy work
- formal-proof candidates

Direct execution is allowed when all of these are true:

- the scope is clear
- the likely file count is inside `workGovernance.directExecution.maxFiles`
- the risk is no higher than `workGovernance.directExecution.maxRisk`
- the required verification is simple and local
- no configured delegation trigger applies

## Configuration Contract

Global and project config may declare:

```yaml
workGovernance:
  defaultPosture: orchestrate
  directExecution:
    maxFiles: 1
    maxRisk: low
  requireDelegationFor:
    - architecture
    - security
    - ui
    - runtime
    - provider-routing
    - managed-agents
    - config
    - multi-file
    - cross-surface
    - long-running
    - verification-heavy
    - formal-proof-candidate
  requiredEvidence:
    - surface-map
    - risk-hypothesis
    - plan
    - tests
    - typecheck
    - residual-risk
```

Global config establishes operator/team defaults. Project `.kiln/kiln.yaml`
may narrow or extend triggers and evidence expectations for the repository.

The resolved policy is projected as required instruction context in CLI, GUI,
TUI, and benchmark sessions. Repo shims also include the resolved policy so
standalone native harness usage sees the same posture. Projection is not the
authority boundary; managed invocations, tools, approvals, and verification
gates still enforce the actual authority.
Because repo shims are generated from resolved global and project Kiln config,
this projection rule is not local to one repository. Any project that enables
work governance receives the same cross-harness authority posture after it
syncs repo shims with a Kiln version that includes this contract.

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
The same state transition applies when the managed child succeeds. A successful
intermediate `managed_agent.invoke` returns a phase-completion envelope rather
than completing work governance by itself. The parent must inspect the readable
managed handoff resources when needed, call `work_item.update` with the supplied
same-work-item template after replacing placeholders with real evidence, and
then call `work_item.execution.start` again for the next phase.

Each runtime provider call carries an `effectiveTurnAuthority` snapshot in its
per-call tool config. The snapshot is projected from the final admitted tool
allowlist and tool-authority map, so operator displays summarize the same
authority that provider execution receives.

Operator surfaces may request turn authority, but runtime validates and admits
the effective authority. Invalid requested-authority values fail before
admission. In execute mode, `read_only` and `audited` requests narrow the
provider tool surface before invocation; `auto` preserves the current admitted
surface. `destructive` is not an operator-requestable turn authority until the
authority elevation approval flow exists, though effective authority displays
may still report destructive when an admitted tool surface contains
approval-required destructive tools. Done-frame authority status is projected
from the same per-call config used for the turn, not from a freshly derived
default.

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
- `work_item.execution.finish` records evidence, verification gate results,
  skipped checks, and residual risk.
- Failed verification gates block completion until a later attempt records a
  passing result.
- Skipped gates require residual-risk notes before closeout can proceed.

Goal closeout checks required goal evidence across materialized work items.
Missing evidence, failed gates, or skipped checks without residual risk are
projected as actionable closeout state through session events, resources, and
operator surfaces. If no manual summary is supplied, runtime generates a
deterministic final summary from the recorded goal and work-item evidence.

## Workflow Profiles

Kiln ships canonical workflow profiles for common work shapes:

| Profile | Use |
| --- | --- |
| `small-fix` | Local, low-risk work inside the direct-execution envelope. |
| `bug-diagnosis` | Surface map, hypothesis, failing proof, minimal fix, verification loop. |
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
to spawn agents. Core selects the topology; Runtime owns topological ordering,
route/profile admission, concurrency, lifecycle, and terminal evidence. Any
dependency edge serializes the current request because the canonical request
does not claim distributed DAG scheduling semantics. High-risk orchestration is
also serialized; parallel high-risk admission fails closed.

For broad work items, `work_item.execution.start` scopes each generated
managed invocation to the next missing evidence phase instead of asking one
child to produce the entire work item in a single timeout window. Intermediate
phases return `executionPhase.completionTool = "work_item.update"` and must be
recorded as provided evidence on the same pending work item before requesting
the next phase. Only the final phase returns
`executionPhase.completionTool = "work_item.execution.finish"` and is eligible
to link the managed invocation id to a started execution attempt and close the
item. This keeps delegated work small, replayable, and cross-surface
observable.
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
before returning to the parent. For a final phase, the runtime resumes the same
work item with the recorded invocation id. For an intermediate phase, it returns
the invocation id and child handoff with `nextTool=work_item.update`; the parent
records that evidence before requesting the next phase. The parent must not
spawn a second child or add a guessed profile. Runtime surfaces may attach a
profile only when a single configured agent profile explicitly owns the same
route id.
Each generated phase carries `taskAffinity` in addition to required tools.
Route selection uses configured `taskSuitability` only after capability
filtering and only when it produces one unique winner. Ambiguous ties fail
closed instead of becoming provider-order fallback.
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
For intermediate phases, the blocking result may include
`managedInvocationRecovery.nextTool = work_item.update`. That recovery is
resolved only by a later successful `work_item.update` on the same work item
whose `providedEvidence` contains every required phase evidence label.
Recording the recovery in assistant text, submitting a plan, or continuing with
local read-only inspection without the update keeps the turn failed.
Successful intermediate child completion follows the same rule. A
`managed_agent.invoke` result with `managedInvocationPhaseCompletion` or
`phaseCompletion` and `nextTool = work_item.update` is still unresolved until a
later successful `work_item.update` records every required phase evidence label
on the same work item. The parent must never paste the update payload,
`providedEvidence`, or `verificationGateResults` into assistant text as a
substitute for the tool call.
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
