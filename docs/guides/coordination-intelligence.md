# Coordination Guide

This guide describes coordination in Kiln using the new canonical frame.

Kiln does not treat coordination as metaphor-first folklore or a literal
biological system. Coordination is a regulated control problem: allocate work,
bound execution chains, track ownership, preserve shared state, and recover
cleanly when parallel work drifts or fails.

For doctrine, start with:

- [Coordination](../architecture/coordination.md)
- [Flows](../architecture/flows.md)
- [Control Model](../architecture/control-model.md)

## What Coordination Means in Kiln

Coordination answers four questions:

1. Should this work stay local, parallelize, defer, or escalate?
2. Who owns the work right now?
3. What shared state is visible to other participants?
4. How is the chain stopped, reconciled, or recovered?

The canonical ownership is:

- `DemandAllocator` decides allocation posture
- `ChainGovernor` bounds multi-step execution
- `TaskRegistry` tracks lifecycle and ownership
- `CoordinationStore` carries shared state, claims, signals, and handoff material

## Coordination Principles

### Shared state over folklore

Coordination should be inspectable from state, not inferred from prompt history.

### Explicit ownership

Every active task should have a known lifecycle state and owner.

### Bounded parallelism

Parallel work is permitted only when demand, budget, and safety posture justify it.

### Recovery matters

Coordination is incomplete if failure leaves orphaned ownership, stale claims, or
invisible partial work.

## Operational Model

At a high level, coordination follows this shape:

1. Work enters through admission control.
2. `DemandAllocator` determines whether the work should remain singular or split.
3. `TaskRegistry` creates and tracks the resulting task records.
4. `CoordinationStore` carries the minimum shared state needed for collaboration.
5. `ChainGovernor` prevents uncontrolled handoff or chain growth.
6. Completion, failure, release, or reconciliation closes the loop.

## Biological Research, Properly Scoped

Biological research still informs the design as mechanism lineage, but it does
not replace inspectable control surfaces.

Useful mechanism families:

- swarm and stigmergic coordination help justify shared-state coordination
- neural gating helps explain bounded chain continuation
- immune-style response helps explain containment and fail-closed reactions

What is no longer canonical:

- treating these mechanisms as a literal-organism claim
- presenting specific named primitives as the permanent architecture
- implying that emergent behavior should replace inspectable control surfaces

See:

- [Biological Mechanisms](../research/03-biological-mechanisms.md)
- [Cybernetic Foundations](../research/02-cybernetic-foundations.md)

## Transitional Status

Older coordination-specific mechanism names should be interpreted as
exploratory or historical unless they are explicitly mapped into the current
coordination architecture.
