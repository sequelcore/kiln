# Core Concepts

This document defines Kiln's current conceptual vocabulary at a high level.
Detailed doctrine lives in the modular architecture docs.

## Primary Frame

Kiln is a biocybernetic control plane for governed AI work.

That means the system is organized around regulation:

- sensing state
- comparing state against goals, policy, and constraints
- selecting bounded actions
- measuring outcomes
- correcting drift

This is the canonical frame. Kiln's operational contracts are cybernetic, while
its mechanism lineage is biological and neural. Older descriptions based on
orchestration-first language are subordinate to that hierarchy.

## Core Questions

Kiln exists to answer five questions repeatedly and safely:

1. Should this work enter the system?
2. What context is sufficient for it?
3. What execution pattern is allowed?
4. What actions are safe to permit?
5. How should the system recover or adapt afterward?

## Canonical Concepts

### Admission

Work does not simply arrive and execute. It is admitted, rejected, deferred, or
downgraded according to policy and current operating conditions.

Primary subsystem:

- [IngressGovernor](architecture/subsystems.md)

### Context

Context is a governed resource, not a raw transcript replay. The system should
expose enough context to act effectively without flooding the working set or
piercing safety boundaries.

Primary subsystem:

- [ContextGovernor](architecture/context-governance.md)

### Coordination

Coordination is explicit and stateful. Workers coordinate through regulated
allocation, tracked tasks, and shared substrate, not by folklore multi-agent
magic.

Primary subsystems:

- [DemandAllocator](architecture/coordination.md)
- [ChainGovernor](architecture/coordination.md)
- [TaskRegistry](architecture/coordination.md)
- [CoordinationStore](architecture/coordination.md)

### Safety

Safety is a kernel concern. It must be able to block or constrain execution
even when every other subsystem would prefer progress.

Primary subsystem:

- [SafetyKernel](architecture/safety.md)

### Memory

Memory is layered. Operational state, episodic records, and durable semantic
knowledge are not the same thing and should not be stored or mutated the same
way.

Primary docs:

- [Memory](architecture/memory.md)
- [Adaptation](architecture/adaptation.md)

### Modes

Kiln's behavior changes by operating mode. A healthy system should not behave
the same way when degraded, locked, or recovering.

Primary docs:

- [Control Model](architecture/control-model.md)
- [Flows](architecture/flows.md)

## Biological Mechanisms

Biological research remains useful as both mechanism lineage and disciplined
identity support, not as a substitute for explicit contracts.

Use it this way:

- nervous-system analogies help explain fast and slow gating
- immune-system analogies help explain layered safety
- reconsolidation helps explain revision-aware memory mutation
- stigmergic and swarm mechanisms help explain coordination substrate design

Do not use it this way:

- not as permission to create organism-like abstractions without control logic
- not as a literal-organism claim
- not as a substitute for explicit subsystem ownership

See:

- [Biological Mechanisms](research/biological-mechanisms.md)
- [Cybernetic Foundations](research/cybernetic-foundations.md)

## Transitional Note

Some older guides still reference primitives, composites, or orchestration-first
language. Those materials should be treated as historical residue unless they
are explicitly aligned with the modular architecture docs.
