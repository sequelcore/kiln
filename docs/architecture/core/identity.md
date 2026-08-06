# Identity

## Executive Thesis

Kiln is a domain-agnostic, biocybernetic AI control plane that governs the
lifecycle of autonomous agent sessions.

The canonical framing is a cybernetic control system that maintains a bounded
operational envelope around agents that act through providers, tools, channels,
and tenant policy.

Kiln is biocybernetic because its operational contracts are expressed through
cybernetic control structures while its architecture is informed by biological
and neural regulation. The research contributes a disciplined mechanism lineage
that includes feedback loops, threshold gating, layered inhibition, adaptive
regulation, memory policy, reconsolidation, salience, threat memory, and
failure containment.

## What Kiln Is

- A biocybernetic regulatory control plane for autonomous AI agents.
- A multi-tenant gateway that owns session lifecycle, context governance, tool
  execution gates, safety enforcement, memory scoping, and cost regulation.
- A domain-agnostic engine whose domain behavior is declared in configuration
  and instantiated at runtime.

In deployment docs, "gateway" means the App Gateway unless explicitly qualified:
the `startGateway(gateway.yaml)` process that loads bound `app.yaml` files and
owns app sessions, tenant state, memory, safety, channels, events, triggers, and
MCP exposure. GUI/TUI helper servers are Operator Gateways. They may use
separate local ports, but they are not separate app control planes.

## Core Purpose

Kiln maintains an operational envelope around autonomous agent sessions that is:

- safe
- budgeted
- observable
- continuable
- multi-tenant

For operator work, the default control behavior is governed orchestration.
Kiln may let a parent agent execute directly when the work is trivial and
low-risk, but non-trivial work should be decomposed, delegated, verified, and
closed with evidence. This is an operating policy inside the control plane,
not a replacement for the control-plane identity.

## Primary Operating Model

Kiln operates as a control plane that senses state, compares it to configured
setpoints, and applies corrections through controlled actuators.

Two runtime variants may exist inside the gateway process, but they are runtime
variants, not separate identities:

- subprocess runtime: agent subprocess execution
- provider-adapter runtime: direct API session execution

Both share the same control responsibilities:

- safety pipeline
- context governance
- memory system
- cost and budget tracking
- event emission

For the full surface taxonomy, see [`runtime-surfaces.md`](../surfaces/runtime-surfaces.md).

## Core Architectural Promises

1. Engine primitives remain free of external infrastructure dependencies.
2. Bounded contexts communicate through explicit interfaces and barrel exports.
3. Safety remains fail-closed unless a layer has an explicit exception.
4. Context is budgeted, not best-effort.
5. Memory has explicit retention and deletion policy.
6. Observability is part of control, not a secondary concern.
7. Biological and neural terminology may label mechanisms, but contracts remain
   explicit and testable.

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

- Control terms define contracts and review criteria.
- Biological and neural terms may name or explain mechanisms when they map to
  explicit control-plane behavior.
- Kiln may use biocybernetic, neurotech, and cyberpunk language for product and
  brand expression when that language remains grounded in the architecture.
- Define Kiln by control-plane responsibilities before product surfaces.
- Keep biological and neural language tied to explicit mechanisms.
- Keep downstream product surfaces subordinate to the shared runtime contract.

## Visual Identity

Kiln's visual identity is restrained biocybernetic cyberpunk: dark control
surfaces, layered graphite structure, precise signal color, and controlled
ember accents. The interface should feel like an operational control plane, not
a decorative sci-fi skin.

The canonical dark expression is Kiln Obsidian:

- near-black backgrounds for the governed operating envelope
- graphite layers for panels, elevated surfaces, and bounded work zones
- ember accents for Kiln brand heat, liveness, and controlled energy
- cyan primary color for technical action, routing, links, and system affordance
- compact typography, hairline dividers, and dense operator-console rhythm

Kiln Graphite preserves the same hierarchy at a lifted dark luminance, while
Kiln Paper is the light polarity rather than a separately styled product.
All three are semantic projections of one operator-theme contract. Normal
text, muted text, controls, actions, and status surfaces must satisfy the
contract's executable contrast and sRGB-gamut gates; visual identity does not
override legibility or renderer consistency.

The canonical brand mark is `docs/assets/logo.svg`; use it for product identity
in README files, operator shell headers, internal studio navigation, and other
Kiln-owned surfaces. Use `docs/assets/logo.png` only when a raster image is
required by a renderer or preview system. `docs/assets/mascot.png` is secondary
marketing art and should not replace the logo in operator surfaces.

Terminal surfaces should render a compact textual wordmark rather than trying
to display bitmap or SVG assets. Embeddable customer-facing surfaces should make
logo display configurable so Kiln branding does not override tenant branding.

Visual metaphor must follow the same rule as architectural metaphor: it is
valid only when it clarifies control behavior. Avoid generic editor themes,
purple AI gradients, decorative cyberpunk neon, glitch effects, biological
ornament, or organism/fungal imagery unless a specific product surface has a
governed mechanism that the visual treatment helps explain.
