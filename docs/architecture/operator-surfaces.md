# Operator Surfaces

## Purpose

Kiln has one governed runtime and multiple human operator surfaces. This
document is the canonical architecture for how humans supervise, review, and
control Kiln work across GUI, CLI, TUI, IDE, remote, and future desktop shells.

Runtime surface taxonomy is defined in `runtime-surfaces.md`. This document
defines the human-facing operating model that those surfaces must follow.

## Canonical Position

Kiln is runtime/headless first. Human interfaces are replaceable projections of
the same control plane.

Serious AI coding products are converging on shared session/tool/runtime
substrates with multiple operator surfaces:

- terminal and CLI for automation, SSH, worktrees, and power-user control
- IDE/editor surfaces for navigation, inline diffs, and code review
- local web or desktop surfaces for monitoring, approvals, session management,
  and multi-agent supervision
- remote or cloud surfaces for long-running and parallel work
- lightweight review surfaces for approvals and progress checks

Kiln follows that architecture: one governed runtime, multiple operator
surfaces.

## Surface Ownership

No operator surface owns control-plane semantics.

If behavior affects session identity, tool authority, provider routing, cost,
memory, replay, audit, execution mode, approvals, diffs, or safety policy, it
belongs in core/runtime and is projected through stable contracts.

Allowed surface-owned state is limited to presentation and interaction state:

- selected panel, open popover, expanded row, focused item, and layout state
- local draft text before submission
- local keyboard and command palette state
- visual preferences such as theme and density

Disallowed surface-owned state includes:

- provider-agnostic session identity
- provider-native thread ownership
- tool authority or permission decisions
- approval lifecycle state
- changed-file or diff facts
- cost/token accounting
- memory admission or graph semantics
- execution-mode semantics
- replay and audit source of truth

## Operator Evidence Model

Operator surfaces show governed evidence, not inferred folklore.

The runtime/session layer emits canonical events for the work that occurred.
Gateway contracts project those events to human surfaces. GUI, TUI, CLI, IDE,
SDK, widget, and future remote surfaces consume the projection instead of
parsing provider output or inventing local state.

Required operator evidence includes:

- tool call start and completion
- bounded tool input/output presentation
- approvals requested, approved, rejected, and linked to their originating turn
- changed files and diffs when available
- provider, model, billing, token, and cost attribution per turn
- errors, retries, fallbacks, and continuity decisions
- session replay data with stable IDs
- execution-mode transitions and planning submissions

Raw payloads are audit evidence. Normal operator surfaces must prefer shared
presentation projections and reserve raw objects for inspector/debug views.

Rich result display uses the shared presentation-intent contract. Agents and
tools may propose a semantic intent such as a comparison table, risk matrix,
timeline, resource bundle, diagnostic report, or summary. Kiln validates that
intent in `@kilnai/gateway-contracts` before any surface renders it. GUI may use
native compact components; TUI, CLI, SDK/widget, IDE, and remote surfaces must
receive the same validated data and may degrade through the shared deterministic
text formatter. No surface may accept arbitrary provider-authored HTML, CSS,
JavaScript, JSX, SVG, or component names as presentation input.

## Local GUI

The local GUI is the first rich operator surface. It is web-first and
gateway-backed by design.

This is not a temporary mistake to replace with a monolithic desktop runtime.
It preserves:

- one runtime contract
- fast local iteration
- browser accessibility
- straightforward remote deployment later
- a thin path to Tauri without changing core/runtime semantics

The GUI may start a local Operator Gateway for local coding/dev sessions. When
operating deployable YAML apps, it must attach to the App Gateway instead of
starting a second app runtime.

The GUI is a projection surface. It must not import core/runtime implementation
code directly, speak to providers directly, or duplicate control-plane logic.

## CLI and TUI

CLI and TUI remain durable terminal operator surfaces.

The CLI is the automation and scripting surface. The TUI is a frozen
maintenance surface, but it still represents a valid terminal operator mode for
users who need SSH, worktree, and keyboard-first workflows.

Terminal surfaces must preserve:

- scriptable entrypoints
- clear logs
- headless execution
- provider selection
- session resume and handoff
- test/build automation
- the same canonical session and operator event contracts as GUI

The TUI must not define future runtime architecture or private operator
semantics.

## IDE Surfaces

An IDE extension is a high-priority future operator surface because code review,
navigation, inline diffs, and file context naturally live in the editor.

An IDE extension must be a client of Kiln gateway and/or MCP contracts. It must
not become a separate runtime, own session state, or bypass tool authority.

## Desktop Wrapper

Native desktop packaging is a wrapper decision, not a runtime decision.

Tauri may become appropriate when product evidence shows a real need for:

- native window lifecycle
- tray or background operation
- native notifications
- packaged install and update flow
- multi-window desktop review
- OS credential integration
- enterprise device-management expectations

If accepted, Tauri must wrap the existing GUI and gateway contract. It must not
introduce in-process GUI imports from runtime/core, a second session model, or a
desktop-only execution policy.

Completion standard: the desktop wrapper can be removed without changing
core/runtime semantics.

Electron remains rejected unless future evidence materially changes the product
category. Kiln is a governed control plane, not an editor fork.

## Remote GUI

The web-first gateway model makes remote GUI possible, but local GUI routes are
not safe to expose directly to the internet.

A remote or cloud GUI requires:

- HTTPS/TLS
- authentication for HTTP routes and WebSocket
- session and user isolation
- origin and CSRF protection
- provider credential isolation
- rate limits and abuse protection
- remote-safe tool authority profiles
- audit logs and replay
- explicit deployer warnings for shell and filesystem tools

Remote GUI must reuse the same gateway/operator contract. It must not introduce
a separate cloud runtime unless a future ADR explicitly accepts that tradeoff.

## Agent Invocation Boundary

Agent profile selection, worker fan-out, and provider/model routing are not the
same thing as a managed invokable-agent substrate.

Future first-class agent invocation needs canonical definitions, lifecycle
events, delegated-task records, child-session or child-turn relationships,
queue/progress/error/cancel semantics, and explicit policy inheritance. Those
facts must live in core/runtime and session events, then project to GUI, TUI,
IDE, and remote surfaces.

Agent invocation must not be implemented as GUI-only state, wrapper-specific
behavior, or a provider-owned session namespace.

## Invariants

- One control-plane runtime; many operator surfaces.
- Surfaces are clients of contracts, not owners of runtime semantics.
- Gateway/operator contracts are the boundary for GUI/TUI/CLI control.
- MCP is the external tool/host boundary, not the GUI-to-gateway protocol.
- Session selection means active continuation unless a surface explicitly
  implements a read-only preview mode.
- Roadmaps sequence work; stable operator-surface doctrine lives here.
