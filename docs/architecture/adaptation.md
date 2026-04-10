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
