# ADR-002: TUI Gateway Architecture

## Status

Accepted

## Context

Kiln has multiple operator surfaces: GUI, native, TUI, CLI, IDE integration,
remote GUI, and gateway integrations. The TUI is a first-class terminal
projection of the same runtime contract. It is neither an independent runtime
nor a lower-priority maintenance branch.

The TUI needs low-latency terminal interaction, provider/model selection,
session streaming, approvals, managed-agent tool presentation, and diagnostics.
Those capabilities must remain consistent with GUI and native surfaces.

## Decision

The TUI connects to the Operator Gateway and renders terminal state from the
shared operator contract. `startTuiGateway()` is the runtime entrypoint for the
TUI bridge. The gateway owns session orchestration, provider routing, memory
and context governance, tool authority, approvals, managed-agent invocation,
and event framing.

The TUI owns only terminal concerns:

- rendering and keyboard interaction
- local terminal layout state
- provider/model selection UI
- command composition
- gateway connection lifecycle
- display of typed operator events

The TUI must consume shared contracts from `@kilnai/gateway-contracts` and
runtime gateway frames. TUI-specific protocol extensions are allowed only when
they represent terminal presentation state and do not change runtime semantics.

Direct provider transport is permitted only as an explicit development or
debug path. It is not the canonical operator path for governed execution.

## Boundaries

- The Operator Gateway is a local human-operator bridge. It is not an App
  Gateway and not a deployable application host.
- TUI rendering must not call provider adapters, memory repositories, or tool
  execution services directly.
- `managed_agent.invoke` authority is attached by the runtime surface. The TUI
  may present it, but it does not decide child-agent admission.
- Approvals, file-change evidence, cost evidence, and safety events must remain
  gateway events before terminal presentation.

## Consequences

The TUI can evolve alongside GUI and native without duplicating runtime logic.
Terminal-specific polish stays cheap because the shared gateway contract carries
the hard execution state. The cost is a strict separation between terminal UI
state and runtime ownership.

## Verification

Professional acceptance for this ADR requires tests that cover:

- TUI connection to `startTuiGateway()`
- session event streaming through shared gateway frames
- provider/model selection projected through gateway state
- approval and managed-agent event presentation
- no TUI-only runtime authority paths

Canonical architecture reference: `docs/architecture/operator-surfaces.md`.
