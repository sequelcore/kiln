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
