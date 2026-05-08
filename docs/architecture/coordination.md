# Coordination

## Purpose

Coordination governs how Kiln allocates work, shares state, limits duplication,
and manages distributed agent activity.

The goal is concrete coordination, not metaphor-heavy orchestration language.

## Core Mechanisms

- `DemandAllocator`
- `TaskRegistry`
- `ChainGovernor`
- `CoordinationStore`
- team composition and role activation

## Research Synthesis

The research most strongly supports:

- response-threshold allocation
- stigmergic coordination
- reinforcement and decay
- inhibition
- latch and commit behavior
- active shared medium effects

These should remain visible in the architecture instead of being flattened into
generic “orchestration.”

## Current State

- threshold-based allocation exists
- chain control exists
- task publication and claim lifecycle exists
- shared coordination state exists
- team composition exists
- coordination state can enter admitted-turn model context only as governed
  `coordination` candidates

## Current Gaps

- stale signals do not decay enough
- failed allocation does not inhibit strongly enough
- shared-state naming and scoping are inconsistent
- distributed substrate is not mature
- quorum-style commit and controlled dispersal are not explicit enough in the
  doctrine

## Target Direction

- rename primitives for clarity
- add decay and negative signals
- add inhibition rules
- formalize shared-medium behavior
- expose coordination telemetry
- make work-governance classification the upstream signal for whether a parent
  agent should execute directly, decompose work, or delegate to managed
  children
- treat distributed substrate as an architecture concern even before full
  infrastructure distribution

## Context Admission Boundary

Coordination storage is not prompt assembly. Coordination primitives may record
cross-agent memory, handoff state, claims, broadcasts, and swarm state. When
that information is useful for a model turn, runtime supplies it as
coordination context candidates and the `ContextGovernor` decides what is
admitted or deferred.

Provider output is normalized before projection. Malformed records and
provider exceptions fail closed for model context and are recorded through
sanitized runtime-local audit metadata.

## Active Shared Medium

The shared medium is not just storage. It should be treated as a computational
surface with:

- retention
- permeability
- damping
- decay
- conflict handling
- diffusion scope

This is a present architectural concern, not only a future distributed-systems
feature.

## Invariants

- coordination decisions must remain observable
- task ownership and claim semantics must be explicit
- orchestration preference must come from the resolved work-governance policy,
  not from surface-local prompt wording
- stale coordination state must expire by policy
- no hidden second coordination model should grow outside these primitives
- coordination state must not bypass context governance when entering a model
  prompt
