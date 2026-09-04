# Identity

## Executive Thesis

Kiln is a governed agent runtime and operator workspace for bounded AI work.
Architecturally, it is a domain-agnostic, biocybernetic control plane that
governs the lifecycle of autonomous agent sessions.

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

- A first-party governed agent runtime that can execute bounded model-and-tool
  loops without requiring an external coding harness.
- An operator workspace for starting, supervising, inspecting, approving, and
  completing governed work.
- A biocybernetic regulatory control plane for autonomous AI agents.
- A multi-tenant gateway that owns session lifecycle, context governance, tool
  execution gates, safety enforcement, memory scoping, and cost regulation.
- A domain-agnostic engine whose domain behavior is declared in configuration
  and instantiated at runtime.

Codex, Claude Code, OpenCode, and other external harnesses are optional
execution adapters. They are not Kiln's product center or canonical state
owners.

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

Two execution variants may exist inside the gateway process, but they are
routes through one product and control plane, not separate identities:

- **provider-adapter runtime:** first-party direct-provider execution;
  `RuntimeSessionOrchestrator` owns the bounded model-and-tool loop
- **subprocess runtime:** invocation of an external harness; the harness owns
  its private agent loop while Kiln governs the admitted invocation boundary

Both share the same control responsibilities:

- safety pipeline
- context governance
- memory system
- cost and budget tracking
- event emission

Kiln therefore owns the governed work loop in both variants. It owns the inner
agent loop only during first-party Runtime execution. It does not claim control
over hidden provider calls, tools, retries, subagents, or scheduling inside an
external harness.

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
| `governed work loop` | The wider lifecycle of admission, authority, routing, execution, evidence, review, recovery, and completion owned by Kiln. |
| `Kiln agent loop` | The Runtime-owned model-and-tool loop used for first-party execution. |
| `direct-provider route` | A first-party route from Kiln Runtime to an admitted provider and Kiln-owned tools. |
| `external harness` | A coding or agent product, such as Codex, Claude Code, or OpenCode, that retains its own internal loop. |
| `harness adapter` | The bounded integration through which Kiln invokes or exposes governed capabilities to an external harness. |
| `Operator Workspace` | Kiln's primary human surface for governed work. |

## Identity Rules

- Control terms define contracts and review criteria.
- Biological and neural terms may name or explain mechanisms when they map to
  explicit control-plane behavior.
- Kiln may use biocybernetic, neurotech, and cyberpunk language for product and
  brand expression when that language remains grounded in the architecture.
- Define Kiln by its first-party Runtime, Operator Workspace, and control-plane
  responsibilities before optional harness integrations.
- Keep biological and neural language tied to explicit mechanisms.
- Keep downstream product surfaces subordinate to the shared runtime contract.
- Do not describe external harnesses as Kiln's runtime or imply control over
  their private agent loops.

## Visual Identity

Kiln's visual identity is restrained biocybernetic instrumentation: dark glass,
phosphor signal light, explicit control materials, and dense operator-console
rhythm. The interface should feel like a governed laboratory terminal, not a
decorative CRT simulation or generic editor skin.

The canonical expression is Phosphor:

- green-black glass for the governed operating envelope
- separately authored chrome, surface, overlay, sidebar, toolbar, message,
  code, and terminal materials
- phosphor green for focus, execution, and primary operator action
- muted plum controls and magenta update signals that keep the palette from
  collapsing into undifferentiated green
- compact typography, hairline dividers, and persistent semantic status cues

Vesper is the high-clarity alternate dark expression. Sequel is the warm-black,
ivory, and sand company expression. Automata is the parchment-and-ink light
expression. They are deliberately different working environments, not
luminance tweaks of one neutral palette. All four are
complete semantic projections of one operator-theme contract. Normal text,
muted text, placeholders, controls, actions, surface-specific text, and status
indicators must satisfy executable contrast and sRGB-gamut gates; visual
identity does not override legibility or renderer consistency.

Operational motion is a state signal, not decoration. A compact living orb may
identify active cognitive or execution phase when it is paired with visible
status text. A restrained boundary pulse may communicate an active turn; it
stays monochrome during work and can shift briefly toward ember on completion.
Approval waits pause rather than simulate progress. These signals must honor
reduced-motion preferences and must never replace textual status, focus, or
durable event evidence.

The canonical brand mark is `docs/assets/logo.svg`; use it for product identity
in README files, operator shell headers, operator navigation, and other
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
