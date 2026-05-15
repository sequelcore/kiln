# Invariants

## Core Doctrine

Kiln is a biocybernetic control plane for autonomous agent sessions.

Every architectural decision should support one or more of these functions:

- sense
- control
- actuate

Biological and neural mechanisms inform the design, but they do not replace
explicit control-plane definitions.

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
10. Plan approval is hash-bound and does not execute work by itself.
11. Goal runs and governed work items are canonical session evidence, not
    surface-local checklist state.
12. Work-item execution attempts require explicit start and finish records;
    delegated attempts require managed invocation linkage.
13. Completion claims require recorded evidence, verification-gate results, and
    residual-risk closeout when checks are skipped.
14. Native harness shims and workflow snapshots are projections from canonical
    state, not sources of doctrine or authority.
15. No biological or neural term becomes an implementation contract without an
    explicit control-plane definition.

## Naming Rules

Preferred names:

- `IngressGovernor`
- `ContextGovernor`
- `DemandAllocator`
- `ChainGovernor`
- `TaskRegistry`
- `CoordinationStore`

Allowed naming guidance:

- bio-derived and neuro-derived names are allowed when the owning contract is
  explicit
- evocative names may describe mechanism lineage, but they do not define
  behavior on their own

Names to remove from active doctrine:

- `Router`
- `ContextFormatter`
- `ThresholdAllocator`
- `CascadeController`
- `TaskChannel`
- `SwarmStore`

## What Is Not Kiln

- Kiln is not a model provider.
- Kiln is not a code generator.
- Kiln is not a communication platform.
- Kiln is not a workflow engine in its primary definition.
- Kiln is not a literal biological organism.

## Doctrine Placement

- This directory is the canonical architecture structure.
- New doctrine belongs here first, then guides can reference it for usage.
- Roadmaps sequence active work; they do not define stable architecture.
