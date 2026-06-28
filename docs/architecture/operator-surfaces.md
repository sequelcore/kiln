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
- goal-run lifecycle, current phase, required evidence, missing evidence, and
  closeout summary state
- governed work-item lifecycle, expected evidence, provided evidence,
  verification gates, and residual-risk closeout status
- session replay data with stable IDs
- execution-mode transitions and planning submissions
- managed child invocation capability snapshots: admitted route id and health,
  provider/model proof, adapter/execution mode, authority profile,
  resource-plane availability, and child identity

Raw payloads are audit evidence. Normal operator surfaces must prefer shared
presentation projections and reserve raw objects for inspector/debug views.
For managed child invocations, normal surfaces render selected
`ManagedAgentCapabilitySnapshot` fields as detail rows and keep the full
snapshot for inspector/replay. They must not infer current provider health or
model capability from live config when explaining a completed child run.
Gateway contracts export the serializable operator-facing snapshot shape, and
SDK consumers should use that shape instead of parsing ad hoc payload fields.

Rich result display uses the shared presentation-intent contract. Agents and
tools may propose a semantic intent such as a comparison table, risk matrix,
timeline, resource bundle, diagnostic report, or summary. Kiln validates that
intent in `@kilnai/gateway-contracts` before any surface renders it. GUI may use
native compact components; TUI, CLI, SDK/widget, IDE, and remote surfaces must
receive the same validated data and may degrade through the shared deterministic
text formatter. No surface may accept arbitrary provider-authored HTML, CSS,
JavaScript, JSX, SVG, or component names as presentation input.

Governed work items use the same operator contract. GUI may dedicate a Work
surface to current items; TUI may show a compact sidebar projection; CLI and SDK
consumers may read the event stream or `kiln://session/work-items`. Goal runs
use the same rule through canonical goal lifecycle events and
`kiln://session/goals`. None of these surfaces may treat a local checklist,
visual row, terminal sidebar line, or progress badge as authoritative.
Authority remains in tool metadata, canonical session events, and resource-plane
snapshots.

Operator identity display follows the same rule. Agent, sub-agent, operator,
assistant, provider, tool, and system identities must be projected from
canonical gateway-contract data before any surface renders them. Rich surfaces
may render deterministic visual avatars from the shared identity seed; terminal
surfaces may degrade to deterministic initials or text labels. Avatar libraries,
colors, and glyphs are presentation choices only. They must not create new
agent IDs, profile names, routing semantics, or authority boundaries.

## GUI

The GUI is the rich web operator surface. It is web-first and gateway-backed by
design.

This is not a temporary mistake to replace with a monolithic desktop runtime.
It preserves:

- one runtime contract
- fast local iteration
- browser accessibility
- straightforward remote deployment later
- a path for first-class native surfaces without changing core/runtime semantics

The GUI may start a local Operator Gateway for local coding/dev sessions. When
operating deployable YAML apps, it must attach to the App Gateway instead of
starting a second app runtime.

The GUI is a projection surface. It must not import core/runtime implementation
code directly, speak to providers directly, or duplicate control-plane logic.

## CLI and TUI

CLI and TUI remain durable terminal operator surfaces.

The CLI is the automation and scripting surface. The TUI is the interactive
terminal supervision surface for users who need SSH, worktree, low-bandwidth,
or keyboard-first workflows.

Terminal surfaces must preserve:

- scriptable entrypoints
- clear logs
- headless execution
- provider selection
- explicit session continuation and handoff
- test/build automation
- the same canonical session and operator event contracts as GUI

The TUI may evolve when there is real terminal-facing demand, but it must not
define private runtime architecture or private operator semantics.

## IDE Surfaces

An IDE extension is a high-priority future operator surface because code review,
navigation, inline diffs, and file context naturally live in the editor.

An IDE extension must be a client of Kiln gateway and/or MCP contracts. It must
not become a separate runtime, own session state, or bypass tool authority.

## Native Operator Surface

Native desktop work is a surface decision, not a runtime decision. Kiln now has
an initial first-class native package at `packages/native` / `@kilnai/native`.

The accepted v1 stack is:

- Electron main process for native window lifecycle, process isolation, and the
  embedded-browser host adapter.
- React 19 and Vite renderer for consistency with the web GUI implementation
  stack.
- `@kilnai/gateway-contracts` as the shared capability, session-projection,
  theme, and presentation contract source.
- Gateway HTTP/WebSocket contracts for all runtime interaction.

The native surface must not import `@kilnai/core` or `@kilnai/runtime`
implementation modules. It may consume `@kilnai/gateway-contracts` and future
operator HTTP/WS clients only. The Electron renderer starts with Node
integration disabled, context isolation enabled, sandbox enabled, web security
enabled, denied popup windows, and navigation restricted to local
file/dev-server origins until a governed runtime policy exists. Any preload
bridge must be narrow, typed, surface-specific, and limited to native shell
operations that cannot be represented as renderer-local state.

The v1 implementation advertises native capability slots for gateway attach,
session projection, theme projection, native window lifecycle, surface
performance telemetry, and embedded browser hosting. Embedded browser hosting
uses Electron `WebContentsView` and the `electron-webcontents` transport label.
`@kilnai/native` now includes the first product embedded-browser operator
surface: the renderer reserves and resizes a browser region, the main process
owns the `WebContentsView`, and the renderer sends typed operator intents
through a narrow preload bridge.

The embedded browser host must keep all remote or task content isolated from the
Electron renderer and main process. Host content runs with Node integration
disabled, context isolation enabled, sandbox enabled, web security enabled, no
host preload bridge, denied popup windows, denied permission prompts, blocked
downloads, ephemeral partition state, and fail-closed navigation against a
runtime-supplied allowlist. DevTools/CDP control belongs to the host adapter and
must project audited evidence through gateway-shaped browser session data.

The embedded browser operator surface follows the takeover contract used by
browser foundations. Opening the surface creates a gateway-shaped browser
session projection with `surfaceMode: "embedded-browser"` and
`transport: "electron-webcontents"`. Takeover transfers ownership from agent to
operator and runtime browser dispatch fails closed while the operator owns the
surface. Operator pointer, wheel, text, and key intents are admitted only while
ownership is `operator`, and text evidence is stored as sanitized summaries.
Release returns ownership to `agent`; runtime resume is admitted only after
release and must be proven by a fresh host observation/evidence projection.

The native surface is justified when product evidence shows a real need for
native capabilities that the web GUI cannot provide cleanly, including:

- native window lifecycle
- tray or background operation
- native notifications
- packaged install and update flow
- multi-window desktop review
- embedded browser hosting
- local high-density projection
- OS credential integration
- enterprise device-management expectations

The native surface consumes the same gateway/operator contracts as GUI, TUI,
CLI, SDK, and widget. It must not introduce in-process imports from
runtime/core, a second session model, or a desktop-only execution policy.

`@kilnai/native` is the repository package and desktop shell boundary. Product
distribution will eventually package that surface as OS-native artifacts, but
installer format, code signing, update transport, release channels, crash/log
collection, user-data migration, rollback, and uninstall behavior are not part
of the current surface foundation. Those decisions require a dedicated
packaging and distribution roadmap once the native surface is functionally
ready to ship outside developer workspaces.

Performance is a v1 design concern. Native projections must render canonical
bounded data, preserve `instanceId`/`sessionId`/`turnId`/`eventId` identity, use
resource links for large artifacts, and expose initial telemetry for first
paint, frame handling, projection update time, memory usage, and dropped
frames. Rust, WASM, or sidecar acceleration may be added only for measured
projection/replay hot paths and must never own authority, scheduling, provider
routing, memory, config, replay truth, or policy.

## Startup And Operator Performance

Startup performance is cross-surface operator evidence, not a GUI-only Vite
metric. CLI, GUI, TUI, local Operator Gateway, App Gateway attach mode, runtime
session startup, config/setup diagnostics, provider/model discovery, managed
agent route catalog setup, and first usable interaction must be measured as
separate phases before optimization.

Normal startup must stay quiet and must not pay profiling overhead. Profiling
belongs behind explicit diagnostic commands or flags that emit structured,
secret-free evidence: commit SHA, OS, runtime versions, cache state, command
line, browser/window launch state, and phase timings. Local paths should be
redacted or bounded to the workspace identity unless the operator explicitly
requests raw diagnostic detail.

Provider/model discovery and managed-agent route refreshes remain runtime-owned
background work after the relevant operator transport is listening. Cached or
stale startup projections may improve diagnostics, but they must not become
execution admission evidence until fresh runtime discovery succeeds.
Startup-path discovery adapters must not run synchronous child processes or
blocking network probes from the gateway event loop. External CLI probes belong
behind async process boundaries with bounded timeouts and diagnostic statuses,
so operator transports can become usable while deeper provider evidence is
still being refreshed.

Native operator surface projection is contract-only until the active native operator surface
benchmark-validation roadmap proves value with benchmark fixtures. Stable
target, precondition, benchmark, and Rust-boundary rules live in
`native-operator-surface.md`.

Completion standard: the native surface can be removed without changing
core/runtime semantics.

Electron remains rejected as the general web GUI substrate. It may be accepted
for a first-class native operator surface when a native-only capability, such as
embedded Chromium browser hosting, justifies the desktop stack and still
preserves runtime ownership.

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
same thing as the managed invocation substrate. Managed child execution is
runtime-owned and projects to surfaces through canonical session events,
managed invocation records, gateway cockpit view state, and resource URIs.

GUI, TUI, CLI, native, IDE, and remote surfaces may render active children,
attention state, status, cancellation, join/replay, transcript links, handoff
links, adoption state, and diagnostics. They must not implement GUI-only child
state, wrapper-specific lifecycle semantics, or provider-owned session
namespaces. Mutating controls such as cancel and join go through the shared
gateway/runtime control path and append canonical evidence before surfaces
claim success.

## Invariants

- One control-plane runtime; many operator surfaces.
- Surfaces are clients of contracts, not owners of runtime semantics.
- Gateway/operator contracts are the boundary for GUI/native/TUI/CLI control.
- MCP is the external tool/host boundary, not the GUI-to-gateway protocol.
- In chat surfaces, session selection makes the selected transcript the visible
  continuation target; fresh/new session actions are the explicit boundary for
  new work.
- Roadmaps sequence work; stable operator-surface doctrine lives here.
