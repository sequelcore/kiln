# Coordination Intelligence: Research Synthesis

## Status

This document records mechanism lineage and the architectural conclusions
adopted by Kiln. It does not define executable configuration and does not claim
that exploratory biological metaphors are implemented components.

## Evidence Synthesis

Research on response thresholds, stigmergy, winner-take-all selection, global
workspace models, neural damping, heterogeneous agent teams, learned
conductors, and task-graph execution supports five durable conclusions:

1. coordination signals must be explicit and capacity-bounded;
2. independent work can benefit from parallelism, while dependency-heavy work
   accumulates coordination errors and should be serialized;
3. a separate critic is valuable only when its evidence is independent and
   attributable;
4. heterogeneous routes can be useful, but provider/model rankings require
   eval evidence and must not be hardcoded into architecture;
5. adaptive selection requires hysteresis, rollback, and outcome evidence;
   unverified online self-modification is not production policy.

## Adopted Mapping

Kiln implements these conclusions through:

- a pure Core topology decision (`decideManagedAgentCoordination`);
- typed work graphs and managed-orchestration requests;
- runtime-owned admission, bounded concurrency, lifecycle, and recovery;
- parent integration over bounded child handoffs;
- shared presentation intent and canonical session evidence across surfaces.

The current production topologies are direct, sequential, centralized, and
independent review. Advisor, scout, worker, verifier, and integrator are roles
within those topologies, not additional schedulers.

## Deliberate Non-Adoptions

Kiln does not currently deploy:

- adaptive per-agent response thresholds;
- an energy-based handoff chain;
- an in-memory parallel task registry separate from governed work items;
- an RL-trained conductor;
- automatic production mutation of routing or model policy.

Those earlier prototypes were disconnected from the managed runtime and have
been removed. Future adaptation must promote through reproducible benchmark
evidence and the canonical policy-adaptation controls.

## Cybernetic Interpretation

- Sensors: governance recommendation, graph shape, risk, route health, budget,
  workspace, and runtime capacity.
- Comparator: deterministic topology policy.
- Actuator: managed-orchestration lifecycle.
- Feedback: typed child terminal evidence, coordination usage, replay, and
  verification outcomes.
- Damping: serialization for dependencies and high risk, concurrency bounds,
  cancellation, and fail-closed admission.

This preserves Kiln's cybernetic thesis while keeping the implementation
inspectable and falsifiable.

## Next Research Gate

Trajectory-aware escalation and learned routing remain candidates, not current
capabilities. Promotion requires task-class cohorts, a static baseline,
verified-success non-regression, known coordination cost, bounded authority,
and rollback evidence. See
[Managed Invocation Routing 2026](../21-managed-invocation-routing-2026.md).
