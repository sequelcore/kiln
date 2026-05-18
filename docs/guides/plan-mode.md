# Planning Mode

Planning mode exists to separate diagnosis and design from execution.

In Kiln's current architecture, planning is not a product identity or a special
brand feature. It is a governed operating pattern used when the system should
pause action, gather enough state, and produce a decision-complete execution
path before any mutating work begins.

For doctrine, start with:

- [Flows](../architecture/flows.md)
- [Control Model](../architecture/control-model.md)
- [Context Governance](../architecture/context-governance.md)

## Purpose

Planning mode is appropriate when:

- the task is ambiguous
- the blast radius is high
- multiple bounded contexts may be affected
- execution would be expensive to undo
- the system lacks sufficient context to act safely

## Behavioral Rule

Planning mode should not mutate the world. Its function is to improve admission,
context sufficiency, and execution design before action.

In gateway-backed consumers, planning is represented by the shared
`executionMode` contract:

- `executionMode: "plan"` marks a turn as planning-only.
- `executionMode: "execute"` marks a turn as normal execution.
- Mode transitions use the `execution_mode_transition` outbound frame and the
  `execution_mode_transitioned` acknowledgement.

Consumers may keep local UI state such as a pressed Plan button or a PLAN badge,
but that state is only a projection of the shared execution mode. New
operator-facing contracts must not introduce a separate `planMode` wire field.

## Tool Boundaries

Plan mode exposes only tools whose capability metadata is explicitly read-only,
plus the runtime-owned planning workflow tools:

- `submit_specification`
- `record_clarification`
- `submit_plan`

Mutating tools such as write, edit, patch, shell execution, dependency
installation, and other implementation surfaces are not part of the plan-mode
tool set.

## Structured Intake

Planning now requires structured specification intake before plan acceptance.

`submit_specification` captures a canonical specification artifact with:

- objective and non-goals
- success criteria and actors
- data lifecycle
- UX edge cases
- security/privacy posture
- external dependencies
- completion signals
- constitution/instruction-profile snapshot

`record_clarification` records clarification answers with question, answer,
affected section, and rationale. For known specification sections, the answer is
also merged back into the canonical specification and validation is recomputed.
Ambiguous scalar fields such as objective, data lifecycle, and security/privacy
are replaced by the clarified answer. List sections such as non-goals, success
criteria, actors, external dependencies, and completion signals append
deduplicated clarified items. Conflicting clarification answers for the same
question+section are rejected, and repeated identical answers are idempotent.

Runtime validation classifies ambiguity and missing required sections as
blocking issues. `submit_plan` fails closed while blocking specification issues
remain unresolved, then admits planning only after clarifications or a revised
specification resolve every required field.

## Structured Plan Contract

`submit_plan` now accepts a typed governed artifact instead of free-form
plan text. The contract includes:

- objective and non-goals
- operator decisions required and assumptions
- affected surfaces and risk classification
- work governance recommendation (posture + workflow profile + rationale)
- proposed work items
- expected evidence and verification gates
- managed-agent delegation candidates
- approval boundaries
- rollback notes and residual risks
- source specification id and clarification record ids
- constitution snapshot

High-control plans (for example high/critical risk or architecture-class
workflow profiles) require additional fields such as operator decisions,
approval boundaries, rollback notes, and residual risks. Missing required
fields fail validation.

Successful submissions persist the full structured artifact across the tool
result metadata, `kiln://session/plans` resources, and canonical
`plan_submitted` session events. Those projections include each
`proposedWorkItems` entry, not just a count, so replay does not depend on
provider-native state.

The user-facing `submit_plan` output is a deterministic structured fallback
rendered from the same artifact. CLI, TUI, GUI, SDK, and remote-operator
surfaces can therefore render the objective, source specification, governance
fields, proposed work items, evidence, verification gates, approval
boundaries, rollback, and residual risks from one canonical plan contract.

## Analysis Gate

After plan validation, runtime runs a plan/spec consistency analysis report.

The analyzer emits durable findings with stable ids and severity levels:

- `critical`
- `high`
- `medium`
- `low`

Current finding categories include duplication, ambiguity,
underspecification, constitution conflict, coverage gaps, task/order
inconsistency, terminology drift, and evidence mismatch.

Findings have a lifecycle status: `open`, `blocked`, `closed`, or
`superseded`. Critical findings are marked `blocked`; plan submission returns a
blocked analysis result, and approval/execution transition fails closed until a
later analysis report resolves those blocking findings. Approval also fails
closed when the selected plan has no analysis report.

Canonical `plan_analysis_reported` events include replayable finding details,
not only finding ids, so analysis reports can be recovered from the session
stream without provider-native state.

Specification and clarification state is projected through canonical resources:

- `kiln://session/specifications`
- `kiln://session/specifications/{id}`
- `kiln://session/clarifications`
- `kiln://session/clarifications/{specificationId}`

The runtime records these changes as canonical session events:

- `specification_submitted`
- `clarification_recorded`
- `plan_submitted`
- `plan_analysis_reported`

Analysis state is projected as read-only resources:

- `kiln://session/analysis-reports`
- `kiln://session/analysis-reports/{id}`
- `kiln://session/analysis-findings`
- `kiln://session/analysis-findings/{id}`

Approval or later execution is a mode transition and a new execution turn, not
hidden work performed by the planning turn.

## Approval Transition

Every submitted plan has a deterministic content hash. Approval records bind to
that hash, not only to a plan id. Revising a plan with the same `planId`
recomputes the hash and supersedes any stale approval instead of creating a
duplicate plan.

Gateway-backed GUI and TUI surfaces approve execution through
`execution_mode_transition` with `toMode: "execute"` and optional `planId`.
Runtime validates the selected or latest plan, records `plan_approved` with
`planId`, `approvalId`, and `planHash`, then acknowledges with
`execution_mode_transitioned`. A local UI toggle is not approval.

Plan turns also project explicit effective authority. Runtime derives the
per-call `effectiveTurnAuthority` snapshot from the final plan-mode allowlist
and tool-authority map, so the provider only sees read-only and planning tools
and operator surfaces summarize that same admitted authority.

Requested authority cannot widen plan mode. Plan turns are recorded as
`planning` and admit only the narrowed read-only/planning tool surface.
`destructive` is not an operator-requestable turn authority until the authority
elevation approval flow exists. Execute turns may request `read_only` or
`audited` authority; those requests narrow the provider tool surface before
invocation, and malformed authority values fail instead of falling back to full
authority.

Approval UI appears only for runtime approval events. If an assistant reports
that it is blocked by read-only or fail-closed authority, switch to an admitted
execute-mode authority or route the work through an approval-capable workflow;
there is no approval button unless the session contains `approval_requested`.

## Goal Execution After Approval

Approval does not execute the plan by itself. It authorizes a later execute
turn to bind the approved plan to a goal run, using the approved plan id and
content hash as the contract.

When execution begins, runtime materializes approved plan work items into
canonical work items. Materialized items preserve the source plan id, approved
plan hash, source work item id, goal id, route hints, expected evidence,
verification gates, dependencies, pause requirements, and residual-risk
requirements. Surfaces must render these canonical work items instead of
inventing local checklist state.

Execution attempts are explicit. `work_item.execution.start` records the start
of a governed attempt, including route and authority context. Delegated work
links the attempt to `managed_agent.invoke`; if the managed invocation id is
missing, runtime pauses the work item instead of pretending the delegation is
traceable. `work_item.execution.finish` records evidence, verification-gate
results, skipped checks, and residual risk.

Closeout is evidence-gated. Missing required goal evidence, failed verification
gates, or skipped verification without residual-risk notes block completion and
project actionable missing-evidence state. If no manual final summary is
provided, runtime generates a deterministic closeout summary from the evidence
already recorded in the goal and work-item lifecycle.

The canonical event and resource surface for this lifecycle is:

- `goal.created`, `goal.updated`, `goal.completed`, `goal.failed`, and
  `goal.cancelled`
- `work_items.materialized`
- `work_item_execution_started` and `work_item_execution_finished`
- `kiln://session/goals`
- `kiln://session/work-items`

## Expected Outcome

A useful planning pass should produce:

- a precise objective
- explicit scope boundaries
- key assumptions
- execution order
- verification criteria
- identified risks or blockers

If those are not produced, the planning pass failed.

## Relationship to the Control Plane

Planning mode is one expression of the broader control logic:

- admission slows down because ambiguity is high
- context gathering is prioritized
- execution is withheld until the plan is decision-complete
- safety posture remains conservative

## Transitional Note

Older versions of this document described a specific cross-backend best-of-three
planning workflow. That kind of implementation detail should remain secondary to
the architectural purpose: planning exists to reduce uncertainty before
execution, not to define Kiln's identity.
