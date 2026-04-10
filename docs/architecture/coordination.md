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
- treat distributed substrate as an architecture concern even before full
  infrastructure distribution

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
- stale coordination state must expire by policy
- no hidden second coordination model should grow outside these primitives
