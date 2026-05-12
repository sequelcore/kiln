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
- `work_item.list`
  Lists current work items and their evidence status.
- `work_item.complete`
  Attempts closeout and fails closed when required evidence or residual-risk
  reporting is missing.
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

- `work_item.update` and `work_item.complete` return typed tool metadata.
- `work_item.execution.start` and `work_item.execution.finish` record
  execution attempts instead of relying on transient model memory.
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

## Workflow Profiles

Kiln ships canonical workflow profiles for common work shapes:

| Profile | Use |
| --- | --- |
| `small-fix` | Local, low-risk work inside the direct-execution envelope. |
| `bug-diagnosis` | Surface map, hypothesis, failing proof, minimal fix, verification loop. |
| `architecture-change` | Bounded-context, contract, or long-term design impact. |
| `ui-change` | Operator-facing or browser-facing behavior requiring browser QA. |
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
- `expectedEvidence`
- `requiredResultFields`
- `doneCriteria`
- `residualRiskRequired`

These fields are admitted as part of the managed invocation request and emitted
in canonical session events and tool metadata. They are not authority by
themselves; authority still comes from the managed invocation profile and route.

The parent remains accountable for integration and closeout. A child completion
is not the same as task completion unless the required evidence gates are
satisfied.
Managed-delegation work items do not start until the execution attempt is linked
to a recorded managed invocation id. If that id is missing,
`work_item.execution.start` pauses with an actionable `managed_agent.invoke`
request; after the child returns, the parent resumes the same work item with
the recorded invocation id.

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
