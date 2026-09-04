# Core concepts

Kiln is a governed agent runtime and operator workspace for bounded AI work.
Its control plane sits between an operator's intent and the systems that
perform the work, then applies policy before, during, and after execution.

This page introduces the vocabulary used throughout the documentation. The
linked architecture pages define the exact contracts.

## The control loop

Kiln repeatedly performs a simple loop:

1. Observe the request and current state.
2. Compare them with goals, policy, capacity, and safety constraints.
3. Admit, reject, defer, or narrow the work.
4. Select an allowed execution target and context.
5. Observe the result and record evidence.
6. Recover or adapt when the result differs from the intended state.

The architecture calls this a *biocybernetic* control plane. *Cybernetic*
describes the feedback-and-regulation contracts above. *Biological* describes
some of the research lineage behind mechanisms such as layered safety,
attention, memory revision, and coordination. The term is an architectural
frame, not a claim that Kiln is an organism.

## First-party and external execution

Kiln supports two execution relationships:

- In first-party execution, Kiln Runtime owns the bounded model-and-tool agent
  loop and invokes an admitted provider with Kiln-owned tools.
- In external-harness execution, Kiln admits and supervises a bounded
  invocation of Codex, Claude Code, OpenCode, or another supported harness. The
  harness owns its internal loop; Kiln owns the surrounding work lifecycle and
  decides which returned evidence is sufficient.

Both relationships consume the same canonical authority, routing, work,
evidence, recovery, and completion contracts. External-harness support is
optional: Kiln's first-party execution path works without another harness
installed.

## Admission

Work does not execute merely because it arrived. Kiln can admit, reject,
defer, or downgrade it according to policy and current operating conditions.

See [Core subsystems](architecture/core/subsystems.md).

## Governed context

Context is a bounded resource, not an automatic replay of every available
message or file. Kiln exposes enough evidence for the task while enforcing
budget, relevance, provenance, and authority boundaries.

See [Context governance](architecture/context/context-governance.md).

## Execution targets

An execution target is the stable choice exposed to an operator or agent. A
direct target identifies a provider, model, and account policy; a harness
target identifies a native or remote runtime. Managed agents pair that target
with a reusable authority profile. Runtime derives and records a route only
after admission; that durable route evidence is not another configuration ID.

See [Model routing](guides/config/model-routing.md) and
[global configuration](guides/config/global-config.md).

## Coordination

Multi-agent work is an explicit lifecycle. Kiln assigns bounded work, tracks
dependencies and leases, records outcomes, and requires evidence for
completion. A child agent does not inherit unrestricted parent authority.

See [Coordination](architecture/coordination/coordination.md),
[work governance](architecture/core/work-governance.md), and
[Agent Tasks and Agent Runs](architecture/coordination/agent-tasks.md).

## Safety and authority

Safety decisions can block or constrain execution even when another subsystem
would prefer progress. Credentials, tools, external effects, and managed-child
permissions cross explicit authority boundaries and fail closed when required
evidence is missing.

See [Safety](architecture/safety/safety.md) and
[credential governance](architecture/safety/credential-governance.md).

## Memory

Operational state and episodic records have different lifecycles. Kiln records
provenance and revisions so that memory can
be admitted, corrected, expired, or rejected without treating every prior
statement as permanent truth.

See [Memory](architecture/context/memory.md) and
[adaptation](architecture/core/adaptation.md).

## Operating modes and recovery

Kiln can change behavior when it is degraded, locked, recovering, or under
high load. Mode changes are explicit state transitions with bounded behavior,
not informal suggestions to an agent.

See the [control model](architecture/core/control-model.md) and
[canonical flows](architecture/core/flows.md).

## How to use the biological research

Biological analogies are useful when they lead to a testable mechanism:

- nervous-system regulation can inform fast and slow gates;
- immune-system regulation can inform layered safety;
- reconsolidation can inform revision-aware memory;
- stigmergic and swarm mechanisms can inform coordination substrates.

They must not replace explicit ownership, state, interfaces, or failure
behavior. See [Biological mechanisms](research/foundations/biological-mechanisms.md)
and [Cybernetic foundations](research/foundations/cybernetic-foundations.md).
