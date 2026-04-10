# Invariants

## Core Doctrine

Kiln is a cybernetic control plane for autonomous agent sessions.

Every architectural decision should support one or more of these functions:

- sense
- control
- actuate

Biological mechanisms may inform the design, but they do not define the code or
the canonical identity.

## Architectural Invariants

1. Safety is fail-closed unless a specific layer is explicitly documented as an
   exception.
2. Every correction has a feedback path.
3. Context is budgeted.
4. Memory has explicit retention policy.
5. Engine primitives remain infrastructure-free.
6. Bounded contexts communicate through explicit interfaces only.
7. Every adaptive parameter has bounds and hysteresis.
8. Operational modes are explicit state machines.
9. The EventBus is part of the sensor fabric.
10. No biological metaphor is an implementation contract.

## Naming Rules

Preferred names:

- `IngressGovernor`
- `ContextGovernor`
- `DemandAllocator`
- `ChainGovernor`
- `TaskRegistry`
- `CoordinationStore`

Names to remove from active doctrine:

- `Router`
- `ContextFormatter`
- `ThresholdAllocator`
- `CascadeController`
- `TaskChannel`
- `SwarmStore`
- `meta-orchestrator`

## What Is Not Kiln

- Kiln is not a model provider.
- Kiln is not a code generator.
- Kiln is not a communication platform.
- Kiln is not a workflow engine in its primary definition.
- Kiln is not a biological organism.

## Temporary Extraction Rule

During the architecture extraction:

- this directory becomes the target canonical structure
- `docs/architecture.md` remains temporary only
- no new doctrine should be authored in guides or research docs
