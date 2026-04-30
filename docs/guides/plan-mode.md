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
plus the runtime-owned `submit_plan` tool. Mutating tools such as write, edit,
patch, shell execution, dependency installation, and other implementation
surfaces are not part of the plan-mode tool set.

When the plan is ready, the assistant calls `submit_plan` with the complete
operator-facing plan. The runtime records the submission as a canonical
`plan_submitted` session event. Approval or later execution is a mode transition
and a new execution turn, not hidden work performed by the planning turn.

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
