# Current-State Mapping

## Purpose

This document maps the research-derived model onto Kiln as it exists today.

It is the bridge between research synthesis and architecture refactor work.

## Memory

Current Kiln already has real layered memory components:

- session state
- mutable memory
- knowledge retrieval
- audit traces

Main gap:

- no single coherent memory doctrine owner in implementation or docs
- reconsolidation doctrine is still weaker than the research suggests on
  confidence, provenance, and same-topic mutation rules

## Context Governance

Current Kiln already has:

- context projection
- budget logic
- compaction logic
- context filtering rules

Main gap:

- ownership is fragmented
- `ContextGovernor` is still an intended architecture shape, not a cleanly
  realized one
- the active shared medium behavior of context, memory, and coordination is not
  yet modeled explicitly enough

## Safety

Current Kiln already has:

- fast scanning
- slower analysis
- policy rails
- dangerous command review
- indirect injection scanning

Main gap:

- the doctrine and implementation need clearer layer defaults and threat-memory
  formalization

## Coordination

Current Kiln already has:

- threshold-based allocation
- task registry behavior
- chain control
- shared coordination state

Main gap:

- decay, inhibition, quorum behavior, and shared-medium design are still
  incomplete or under-specified
- old terminology still obscures the actual coordination model

## Tool Execution

Current Kiln already has:

- tool registry
- authorization
- retry and timeout behavior
- sandboxing
- command safety checks

Main gap:

- clearer doctrinal separation between tool policy, tool routing, and execution
  behavior

## Regulation And Adaptation

Current Kiln already has:

- budget control
- circuit-breaking behavior
- adaptation primitives

Main gap:

- operational modes are not formalized strongly enough
- allostatic load is not yet a first-class unified metric
- predictive regulation is under-defined

## Phase Latching And Dispersal

The research suggests that Kiln should eventually make two additional ideas
more explicit:

- phase latching or quorum-style commit, so the system can shift from one
  operating state to another without thrashing
- controlled dispersal or reset behavior, so the system can deliberately reduce
  coupling, clear stale state, or re-route when the current path becomes
  maladaptive

These ideas are only partially visible today.

## Overall Assessment

Kiln already contains many of the right primitives.

The biggest problem is not absence of all capability. It is fragmentation,
naming drift, uneven doctrine, and inconsistent ownership across the system.

That is why the current phase is documentation and architecture refactor before
deeper implementation refactor.
