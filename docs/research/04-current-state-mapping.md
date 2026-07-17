# Current-State Mapping

## Purpose

This document maps the research-derived model onto Kiln as it exists today.

It is the bridge between the research layer and the modular architecture docs.
Use it to understand where Kiln already aligns with the research and where the
remaining doctrine or implementation gaps still exist.

## Memory

Current Kiln now has a canonical governed-memory owner:

- `docs/architecture/memory.md` defines Memory Lattice doctrine
- `@kilnai/core` owns the memory bounded context
- `MemoryRepository` is the persistence contract
- `SqliteMemoryRepository` is the current local adapter, not the architecture
  contract
- `MemoryMutationService` owns governed mutation and event emission
- `kiln://memory/...` resources are the shared read projection
- `ContextGovernor` owns model-context admission

Research concepts that are now implemented as canonical architecture:

- explicit scopes and layers
- provenance-bearing memory records
- revisions, relations, and context-admission evidence
- lifecycle policy for decay, forgetting, compaction, promotion, salience, and
  inhibition
- recall scoring as a candidate source, not direct prompt injection
- model-facing memory authority for read and write access

Remaining pressure:

- reconsolidation policy can still become more domain-specific around
  correction, extension, contradiction, and noop decisions
- lifecycle policy defaults need operational tuning from real usage
- semantic knowledge and semantic memory still need clear operator guidance
  where their retrieval surfaces overlap

## Context Governance

Current Kiln already has:

- `ContextGovernor` as the canonical owner of admitted-turn context
- context projection and budget logic
- admission and deferral evidence
- memory, knowledge, procedural, and coordination candidates under one
  admission model

Main gap:

- the active shared medium behavior of context, memory, and coordination is not
  fully modeled as an operational feedback system
- salience, inhibition, and overflow defaults need tuning against real
  workloads

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

- deterministic topology selection from governed signals
- canonical goal and work-item dependency state
- runtime-owned bounded managed orchestration
- governed managed-invocation lifecycle and replay evidence

Main gap:

- trajectory-aware escalation and empirically promoted adaptive routing remain
  research candidates
- all future coordination work must use the managed-agent lifecycle rather
  than redefining child execution semantics

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
- approval ownership, interrupt ownership, and fake-capability prevention are
  still insufficiently explicit

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

That is why remaining work should continue to promote stable research concepts
into architecture docs before implementing new behavior.

## Reading Rule

When this document and the architecture docs overlap, the architecture docs
win. This file exists to explain alignment and gaps, not to create a parallel
source of truth.
