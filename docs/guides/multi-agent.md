# Multi-Agent and Role Routing

This guide describes multi-agent behavior in Kiln without treating "multi-agent"
as the product identity.

Kiln does not exist to maximize the number of agents in a session. It uses
multiple roles only when doing so improves control, separation of concerns, or
recovery.

For doctrine, start with:

- [Coordination](../architecture/coordination.md)
- [Work Governance](../architecture/work-governance.md)
- [Flows](../architecture/flows.md)
- [Safety](../architecture/safety.md)

## Purpose

Role routing exists to answer a bounded question:

**Which role or execution path should handle this work under current policy and state?**

This is a control-plane concern, not a theatrical agent-system concern.

## Principles

### Routing serves control

Routing should reduce ambiguity, isolate responsibilities, and improve recovery.

### Distinct roles only

If two roles do not have meaningfully different responsibilities, tools, or risk
profiles, they should not both exist.

### Stability over cleverness

Routing logic should prefer stable predictable behavior over flashy emergent
switching.

### Safety can veto routing

If a route would expose unsafe tools, context, or execution mode, it should be
blocked or downgraded.

## Canonical Placement

Multi-role routing belongs under the broader coordination and admission model:

- ingress decides whether work enters
- allocation decides whether it remains singular or is split
- role routing chooses the active handling path
- task and coordination state track ownership and handoff

## When Multiple Roles Are Justified

Use multiple roles when they create clear operational benefit, such as:

- planner versus executor separation
- reviewer versus implementer separation
- read-only versus side-effect-capable separation
- domain-specific handling with materially different tools or policy
- work-governance triggers that require orchestration before direct execution

Do not add multiple roles just to mirror an old "swarm" narrative.

## Transitional Note

Older versions of this guide described detailed tenant agent-routing pipelines,
handoff heuristics, and role-switch mechanics in isolation. Those details should
be reintroduced only when they are expressed in the canonical vocabulary of
governed routing, coordination state, and bounded execution.
