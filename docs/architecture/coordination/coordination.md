# Coordination

## Purpose

Kiln coordinates governed work by selecting an execution topology, admitting
that topology against runtime capacity, and executing every child through the
managed-invocation lifecycle. Coordination is control-plane state; prompts and
operator surfaces are projections, not authorities.

## Canonical Owners

- Core owns `decideManagedAgentCoordination`, the pure deterministic policy.
- Core owns typed orchestration requests, admission, result evidence, goal
  runs, and work items.
- Runtime owns `managed_agent.orchestrate`, route/profile admission,
  concurrency, child lifecycle, cancellation, join, and terminal evidence.
- GUI, TUI, CLI, SDK, transcripts, and replay project the same runtime result.

There is no second task registry, threshold allocator, chain-energy model, or
surface-local scheduler.

## Decision Inputs

The policy consumes explicit, bounded signals:

- the work-governance recommendation;
- work-item and dependency counts;
- independent-review requirement;
- task risk;
- available managed-route count;
- runtime parallel-worker limit;
- route-health, budget, and workspace availability.

Provider names, model rankings, prose heuristics, and surface identity are not
decision inputs.

## Topologies

- `direct`: one bounded work item retained by the primary agent.
- `sequential`: dependency-bearing, capacity-constrained, or high-risk work;
  one child is active at a time.
- `centralized`: independent work items execute concurrently under one parent
  integrator, bounded by `maxParallelChildren`.
- `independent-review`: at least two isolated critics produce separately
  attributable review evidence.

The selected topology maps to the existing managed-orchestration modes:
`background-job`, `decomposition`, or `review-swarm`. Explicit duplicate
candidate and route-comparison workflows remain typed modes and use the same
runtime lifecycle.

## Runtime Execution

`managed_agent.orchestrate` accepts an explicit work graph. It rejects duplicate
ids, missing fields, unknown dependencies, and cycles. Every child carries its
own stable key, configured agent profile, resolved route, and dependency keys.
Runtime validates profile/route agreement, filters each route by the requested
access level and lifecycle capability, and executes dependency-ready
waves. An `isolated-worktree` route must carry its lease; `read-only` and
policy-backed `sandbox` routes need no worktree lease. Unisolated
`workspace-write` is never admitted. Ambiguous per-child selection fails closed.

The common lifecycle executor:

1. obtains one economic commitment for each policy-bearing child before dispatch;
2. starts at most `maxConcurrentChildren` dependency-ready children;
3. verifies the running lifecycle projection;
4. joins every started child;
5. cancels and joins already-started siblings when batch start fails;
6. passes successful dependency summaries and resource URIs into downstream
   child requests, while blocking dependents of failed children;
7. builds typed completed, partial, or failed orchestration evidence.

Normal session pre-turn token observation is not managed-child route
authority. Managed orchestration uses the same atomic economic commitment,
dispatch fence, and settlement authority as a single managed invocation.

High-risk orchestration is admissible only when serialized. Parallel high-risk
execution fails admission.

## Cross-Surface Contract

The orchestration tool returns the policy decision and typed terminal result.
Its metadata contains a `timeline` presentation intent, so every operator
surface can render the same child progression without parsing text output or
inventing local status semantics.

## Invariants

- one deterministic topology policy in Core;
- one managed child lifecycle in Runtime;
- explicit graph, authority profile, route identity, and evidence contract;
- configured agent identity and route authority are preserved per child;
- isolation follows effective authority: non-mutating decomposition and review
  may use `read-only` or policy-backed `sandbox`; duplicate-candidate fan-out
  and write-capable execution use leased `isolated-worktree` routes;
- no provider/model ranking in durable policy;
- no concurrency above the configured runtime limit;
- no dependency edge may execute concurrently under the current request
  contract;
- independent review requires distinct provider/model identities;
- no surface may create a competing coordination state machine;
- terminal and replay evidence remain attributable to child and parent.
