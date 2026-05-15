# ADR-002: Operator Surface Gateway Architecture

## Status

Accepted

## Context

Kiln has one governed runtime and several operator surfaces: GUI, native, TUI,
CLI, IDE integrations, remote GUI, SDK/widget consumers, and MCP-facing hosts.
Those surfaces have different ergonomics, but they must supervise the same
session, authority, memory, approval, tool, replay, and provider-routing model.

A surface-specific gateway decision would misstate ownership: it would make
runtime authority look like a TUI concern, a GUI concern, or a native concern
depending on which surface was implemented first. The accepted decision is
cross-surface.

## Decision

Kiln uses Operator Gateway contracts as the local human-operator boundary for
coding/dev sessions. Operator surfaces render and control runtime state through
shared HTTP/WebSocket contracts and typed operator events. They do not own
control-plane semantics.

The architecture has these rules:

- Operator Gateway bridges such as `startGuiGateway()` and `startTuiGateway()`
  are surface adapters over the same runtime/session contract.
- GUI, native, TUI, CLI, IDE, SDK/widget, and remote operator surfaces consume
  shared gateway contracts and presentation projections.
- Core/runtime owns session identity, provider routing, context governance,
  memory admission, tool authority, approvals, cost evidence, managed-agent
  invocation, replay, and safety policy.
- A surface may own rendering, keyboard/mouse interaction, local drafts,
  layout, panel state, and visual preferences.
- A surface must not introduce private runtime semantics, private approval
  lifecycle, private memory graph rules, private session identity, or direct
  provider/tool execution paths.

## Surface Adapters

Surface-specific adapters are allowed when the transport or interaction model
requires them:

- GUI uses HTTP/WebSocket routes and rich browser presentation.
- Native uses the same gateway/operator contracts plus a narrow native shell
  bridge for desktop-only capabilities.
- TUI uses WebSocket frames and terminal presentation for SSH, keyboard-first,
  and low-bandwidth workflows.
- CLI uses process commands, attach flows, and scriptable output.
- IDE and remote surfaces must attach to the same contracts when they are
  introduced.

Adapter-specific protocol fields are valid only when they describe
presentation or transport. They must not change runtime ownership.

## Boundaries

- Operator Gateway is a local human-operator bridge, not the deployable App
  Gateway that owns YAML app runtime.
- App Gateway remains the app-control-plane owner for deployed apps.
- MCP is the external tool/host boundary, not the GUI/TUI/native operator
  protocol.
- Direct provider paths are explicit development or debugging paths. Governed
  operator execution flows through runtime-owned session and authority
  contracts.

## Consequences

New surfaces can be added without reimplementing runtime policy. Existing
surfaces can diverge in UX while preserving the same evidence model. The cost
is strict contract discipline: surface convenience cannot bypass runtime
authority or invent local truth.

## Verification

Professional acceptance for this ADR requires tests that cover:

- GUI and TUI gateway startup through shared runtime contracts
- session event streaming with stable session and turn identity
- provider/model selection as next-turn routing state
- approval and managed-agent event presentation through shared contracts
- no direct provider/runtime authority path from renderer components
- no surface-local session, approval, memory, cost, or file-change truth

Canonical architecture references:

- `docs/architecture/operator-surfaces.md`
- `docs/architecture/runtime-surfaces.md`
