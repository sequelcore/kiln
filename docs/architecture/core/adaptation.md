# Adaptation

## Purpose

Adaptation adjusts operating behavior based on observed outcomes while keeping
the system stable, auditable, and bounded.

## Operational Modes

The target architecture should make operational modes explicit:

- `NORMAL`
- `SUPERVISED`
- `DEGRADED`
- `LOCKED`
- `RECOVERING`

Modes should control:

- tool access
- approval requirements
- model tier
- safety sensitivity
- rate-limit multipliers

## Allostatic Load

Allostatic load is the composite pressure signal that drives mode regulation.

It should integrate:

- consecutive errors
- budget pressure
- safety event rate
- circuit-breaker state

## Predictive Regulation

Adaptation must not remain purely reactive.

Predictive regulation should include:

- reserving budget before expensive work
- pre-emptive context compression
- pre-emptive downgrade or restriction
- raising supervision before repeated failure

This is the practical allostatic component the architecture needs.

## Allocation Adaptation

Allocation adaptation should remain bounded:

- EMA-based threshold changes
- floor and ceiling bounds
- hysteresis
- reset path
- oscillation detection

## Controlled Policy Candidates

The implemented adaptation boundary is evidence governance around an existing
owner, not a second optimizer. The first typed family is ContextGovernor
allocation mode (`whole-block`, `segmented`, or `retrieval-on-demand`). Its
owning `context-allocation-promotion-v1` report must already be eligible before
controlled adaptation can add replay, shadow, fixed-holdout, confidence,
distribution, cache-isolation, rare-task, approval, and rollback gates.

`policy-adaptation-candidate-v1` commits replay, shadow, and holdout fixture
hashes before evaluation; validates lifecycle ledgers by canonical replay;
binds exact base and candidate configuration hashes; and references
verification-retained artifacts. Replay must record divergence, shadow output
must remain non-user-visible with external side effects suppressed, and fixed
holdout evidence must improve tokens without verified-success or hard-invariant
regression. Conservative paired confidence bounds prevent a small perfect
sample from being treated as exact evidence.

Candidates never self-promote. Durable selection changes use the existing
canonical config proposal, operator approval, stale-file check, and apply
workflow. The stored selection carries revision, exact active configuration
hash, freeze state, and exact rollback selection. `DefaultContextGovernor`
remains the actuator. Runtime request cache partitions include the approved
context policy identity, preventing cross-policy reuse.

The apply boundary validates both lexical and physical containment beneath the
project root. Existing symlinks or junctions therefore cannot redirect an
approved canonical configuration write outside the project.

Post-promotion monitoring returns `stable` or `freeze-recommended`; it cannot
mutate state. Freeze, unfreeze, promotion, and rollback remain separate
operator-approved controls. Rollback restores the prior policy ID and exact
configuration hash without data migration.

## Specialization

Specialization may be useful, but it must remain:

- visible
- bounded
- reversible
- subject to fairness and drift review

## Invariants

- no unbounded adaptation
- no silent mode changes
- no threshold movement without evidence
- every adaptive parameter has bounds and hysteresis
- reset remains available
- candidate generation, evaluation, and monitoring are advisory
- only the canonical proposal/approval/apply boundary changes durable policy
- exact configuration identity, not a mutable policy label, is the rollback unit
