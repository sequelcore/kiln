# Biological Mechanisms

## Purpose

This document records the biological and neural mechanisms that materially
informed the Kiln architecture and separates them from weaker or mostly
metaphorical analogies.

Its purpose is taxonomy and boundary-setting. It should complement
`02-cybernetic-foundations.md`, not compete with it.

## Nervous System

Useful for:

- fast-path versus slow-path routing
- gating before deliberation
- salience-triggered mode changes
- local reflex-like control loops for cheap urgent corrections
- winner-take-most action selection under explicit inhibition

Limit:

- biological reflexes are evolved and hardwired
- Kiln gating is configured policy

## Attention And Salience

Useful for:

- context selection under budget pressure
- switching between cheap default processing and more expensive deliberation
- explicit inhibition of low-value or distracting context
- treating context as a competitive working set rather than a transcript dump
- separating bottom-up novelty signals from top-down task goals

Limit:

- model attention weights are not the same thing as biological attention
- Kiln must implement salience through explicit policy, ranking, and pruning

## Layered Memory

Useful for:

- layered retention policy
- separation of working, episodic, semantic, and procedural roles
- decay and forgetting policy
- cue-based recall

Limit:

- Kiln memory is explicit storage, not reconstructive neural recall

## Reconsolidation

Useful for:

- explicit mutation of recalled memory
- revision lineage
- confidence and provenance-aware updates
- same-topic or same-latent-cause checks before mutation

Limit:

- Kiln reconsolidation is transactional and rule-based, not biological plasticity

## Immune System

Useful for:

- layered defense
- fast detection plus slower analysis
- danger-signal taxonomy
- threat memory
- anti-autoimmunity thinking

Limit:

- policy-based safety is not biochemical self/non-self discrimination

## Homeostasis And Allostasis

Useful for:

- operational modes
- setpoints
- load accumulation
- predictive regulation

Limit:

- Kiln setpoints are configured engineering choices, not evolved physiology

## Swarm And Stigmergy

Useful for:

- threshold-based allocation
- shared state coordination
- decay
- inhibition
- specialization pressure
- shared task traces
- quorum and latch behavior for stable collective transition

Limit:

- Kiln agents are not low-cognition insects
- coordination is partly explicit and policy-shaped

## Active Shared Medium

Useful for:

- retention
- permeability
- damping
- decay
- signal modulation
- hot-path reinforcement
- controlled dispersal or reset behavior

Limit:

- current Kiln does not yet implement a true distributed substrate

The strongest software value here is not fungal branding. It is the idea that
shared state can act as an active computational surface whose retention, decay,
and permeability shape coordination behavior.

## Quorum Sensing And Biofilm

Useful for:

- signal aggregation
- threshold-triggered phase transition
- hysteresis and latch behavior
- matrix-like shared medium effects
- controlled dispersal when the current state becomes maladaptive

Limit:

- software signals are semantic and policy-driven, not physical diffusion
- engineering requires explicit auditability and bounded cost, unlike
  biological survival dynamics

## Morphogenesis And Differentiation

Useful for:

- bounded-context compartmentalization
- role differentiation
- inhibition between competing roles
- progressive specialization under clear boundary rules
- local rules that produce stable large-scale structure

Limit:

- software differentiation is reversible and policy-driven

## Guidance

Use these mechanism families only when they yield:

- software abstractions
- control rules
- memory policy
- coordination rules
- explicit invariants
- explicit failure modes

Use them in identity, naming, and aesthetic framing only when the resulting
language remains grounded in explicit contracts and does not imply literal
biological embodiment.

## Consolidated Reading

Use this document for mechanism taxonomy.

Use:

- `05-memory-systems.md` for memory-specific research
- `06-safety-defense.md` for immune-style defense
- `07-regulation-and-adaptation.md` for homeostasis and allostasis
- `08-context-governance.md` for attention, inhibition, and shared-medium
  context selection
- `09-tool-execution-and-trust.md` for tool gating and trust boundaries
- `10-coordination-intelligence.md` for the deep coordination lineage
