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

## Background And Parallel Execution

Reliability in a long-running agent comes from the machinery around the loop,
not the loop itself. Analysis of production coding agents attributes it to
compaction, extensibility, subagent delegation, worktree isolation, and
append-oriented session storage. SWE-agent established the agent-computer
interface as its own design surface, and SWE-Effi evaluates software agents
under explicit resource constraints rather than accuracy alone — which is why
Kiln treats concurrency, budget, and cancellation as part of correctness.

Distributed-systems practice supplies the failure model. Tail latency dominates
user-visible behavior once work fans out, and retry strategy must use timeouts,
bounded attempts, and backoff with jitter or it converts a slow dependency into
a self-inflicted outage.

- [SWE-agent](https://arxiv.org/abs/2405.15793),
  [SWE-Effi](https://arxiv.org/abs/2509.09853),
  [agent loop machinery](https://arxiv.org/abs/2604.14228)
- [The Tail at Scale](https://research.google/pubs/the-tail-at-scale/),
  [AWS: timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)

## Delegation Is Not A Correctness Guarantee

Delegation buys reviewability, and it is paid for. Software delegation contracts
report improved reviewability and evidence at additional token and time cost,
which is why Kiln keeps contracts bounded rather than treating a handoff as
proof of quality. Agentless separately shows that a simple localize–repair–
validate workflow competes with heavier orchestration, supporting selective
delegation over mandatory fan-out.

Routing conclusions do not generalize from one benchmark. OmniCode broadens
evaluation beyond Python bug repair and cautions specifically against reading a
single benchmark as universal routing proof — a caution that applies to Kiln's
own route evidence as much as to published leaderboards.

- [Software Delegation Contracts](https://arxiv.org/abs/2606.17099),
  [Agentless](https://arxiv.org/abs/2407.01489)
- [OmniCode](https://arxiv.org/abs/2602.02262)

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
and rollback evidence. The routing evidence is recorded above under
[delegation is not a correctness guarantee](#delegation-is-not-a-correctness-guarantee).
