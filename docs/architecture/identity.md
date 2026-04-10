# Identity

## Executive Thesis

Kiln is a domain-agnostic AI control plane that governs the lifecycle of
autonomous agent sessions.

It is not best described as an orchestration engine, a model router, or a tool
executor. Those are capabilities inside the system. The canonical framing is a
cybernetic control system that maintains a bounded operational envelope around
agents that act through providers, tools, channels, and tenant policy.

The useful result of the biological research is not that Kiln is an organism.
It is that Kiln benefits from mechanisms such as feedback loops, threshold
gating, layered inhibition, adaptive regulation, memory policy, and failure
containment. The control-plane framing is primary. Biological analogies are
secondary explanatory tools.

## What Kiln Is

- A regulatory control plane for autonomous AI agents.
- A multi-tenant gateway that owns session lifecycle, context governance, tool
  execution gates, safety enforcement, memory scoping, and cost regulation.
- A domain-agnostic engine whose domain behavior is declared in configuration
  and instantiated at runtime.

## What Kiln Is Not

- Not an LLM provider.
- Not a code generator.
- Not a workflow engine as its primary definition.
- Not a monolithic agent.
- Not an organism.
- Not a meta-orchestrator as canonical identity.

## Core Purpose

Kiln maintains an operational envelope around autonomous agent sessions that is:

- safe
- budgeted
- observable
- continuable
- multi-tenant

## Primary Operating Model

Kiln operates as a control plane that senses state, compares it to configured
setpoints, and applies corrections through controlled actuators.

Two runtime modes may exist inside the gateway process, but they are runtime
variants, not separate identities:

- Mode A: agent subprocess execution
- Mode B: direct API session execution

Both share the same control responsibilities:

- safety pipeline
- context governance
- memory system
- cost and budget tracking
- event emission

## Core Architectural Promises

1. Engine primitives remain free of external infrastructure dependencies.
2. Bounded contexts communicate through explicit interfaces and barrel exports.
3. Safety remains fail-closed unless a layer has an explicit exception.
4. Context is budgeted, not best-effort.
5. Memory has explicit retention and deletion policy.
6. Observability is part of control, not a secondary concern.
7. Biological metaphor is never an implementation contract.

## Canonical Terminology

| Term | Definition |
|------|------------|
| `control plane` | The system that observes state and applies corrections. |
| `actuator` | A system that can modify external state. |
| `sensor` | A system that observes state and emits evidence. |
| `setpoint` | A configured threshold or desired bound. |
| `error` | Deviation from the configured setpoint. |
| `correction` | The response to deviation: deny, retry, fallback, degrade, escalate. |
| `operational envelope` | The bounded region of safe, budgeted, acceptable operation. |
| `operational mode` | The current system mode that controls tool access, approvals, and behavior. |
| `active shared medium` | Shared state that influences coordination through retention, damping, permeability, and decay. |

## Identity Rules

- Use control terms over metaphor terms.
- Do not describe Kiln primarily as a meta-orchestrator.
- Do not describe Kiln primarily as a biological system.
- Do not define Kiln by downstream product surfaces.
