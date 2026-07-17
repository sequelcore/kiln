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

The only cross-surface execution entrypoint for a governed work graph is
`managed_agent.orchestrate`. GUI, TUI, CLI, SDK, transcript, and replay consume
the same lifecycle evidence; none owns a surface-local worker scheduler.

## When Multiple Roles Are Justified

Use multiple roles when they create clear operational benefit, such as:

- planner versus executor separation
- reviewer versus implementer separation
- read-only versus side-effect-capable separation
- domain-specific handling with materially different tools or policy
- work-governance triggers that require orchestration before direct execution

Do not add multiple roles just to mirror an old "swarm" narrative.

## Governed Team Contract

Each team member is a work item with:

- a stable `id`;
- a bounded `roleIntent` and child-local `task`;
- an admitted `agentProfile` or explicit `routeId`;
- dependency ids;
- one request-level authority profile and evidence contract.

Runtime resolves and validates every member independently. Successful producer
handoffs and resource URIs become governed inputs to their dependents. Failed
dependencies block downstream members instead of inviting a model to improvise
missing evidence. Independent review requires distinct provider/model
identities.

The parent remains the coordinator and final integrator. Child completion does
not adopt a recommendation, merge an isolated worktree, or close a governed
work item by itself.

## Frontend Team Example

The current operator profile uses three read-only specialist roles before any
write-capable implementation is admitted:

1. `frontend-producer` on Kimi K3 produces visual hierarchy, interaction
   states, accessibility expectations, and acceptance criteria.
2. `frontend-implementation-advisor` on Kimi K2.7 verifies that handoff against
   repository evidence and produces component, state, test, and integration
   guidance.
3. `react-ts-reviewer` on Codex Terra provides an independently routed React and
   TypeScript review when review is requested.

Writing remains a separate governed task through `frontend-coder` and its
approved-write route. The read-only team does not acquire write authority by
composition.

See [Coordination Guide](coordination-intelligence.md) for the exact work-graph
shape and [Operator Routing Profile](../examples/operator-routing-profile.md)
for the workstation-specific route example.
