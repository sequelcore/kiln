# 02 - Native Operator Surface Foundation

Status: deferred design prerequisite.

## Objective

Establish Kiln's first-class native operator surface before building native-only
capabilities such as the embedded browser.

This roadmap is not a desktop packaging shortcut. It defines a long-term surface
boundary: one governed runtime, shared operator contracts, and multiple
first-class surfaces that can project the same session, authority, evidence,
and replay truth.

The first native surface must be designed for performance, observability, and
cross-surface parity from version 1. That means stable contracts, bounded
projections, event batching, resource-link rendering, and measurement hooks are
part of the foundation, not late cleanup.

## Canonical Placement

This roadmap runs after the completed browser operator foundations documented in
`docs/architecture/developer-tools.md` and `docs/guides/tool-use.md`, and before
the embedded browser host capability in
`03-embedded-browser-host-capability.md`.

```text
completed browser operator foundations and snapshot monitor
  ->
02      native operator surface foundation
  ->
03      embedded browser host capability
  ->
04      embedded browser operator surface
  ->
05      native cockpit and projection performance
```

## Research Basis

External product references support a split between governed runtime truth,
native/desktop operator surfaces, and browser-specific capability adapters:

- OpenAI Codex app:
  https://developers.openai.com/codex/app/
- OpenAI Codex in-app browser:
  https://developers.openai.com/codex/app/browser
- OpenAI Codex Chrome extension:
  https://developers.openai.com/codex/app/chrome-extension
- Claude Code desktop:
  https://code.claude.com/docs/en/desktop
- Claude Code Chrome extension:
  https://code.claude.com/docs/en/chrome
- Electron process model:
  https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron security:
  https://www.electronjs.org/docs/latest/tutorial/security
- Tauri architecture and webview runtime versions:
  https://v2.tauri.app/concept/architecture/
  and
  https://v2.tauri.app/reference/webview-versions/

The research conclusion is:

- Native must be a first-class operator surface, not a wrapper around the web
  GUI.
- The surface must consume gateway/operator contracts and must not import
  runtime implementation state.
- Browser hosting is the first native-only capability, not the whole native
  strategy.
- Authenticated external browser state should remain explicit and separable
  from the task-scoped embedded browser capability.

## Stack Decision For Version 1

The native surface v1 should use:

- Electron main process for native window lifecycle, process isolation, and
  browser-host capability ownership.
- React 19 + Vite renderer for operator UI implementation consistency with the
  existing web GUI stack.
- `@kilnai/gateway-contracts` as the only frame, projection, theme, workspace,
  browser-session, and presentation-intent contract source.
- Gateway HTTP/WebSocket contracts for all runtime interaction.
- No direct imports from `@kilnai/runtime` or `@kilnai/core` implementation
  modules.

Electron is selected for v1 because the first accepted native-only capability is
embedded Chromium browser hosting. Tauri remains a useful reference for desktop
security and OS integration, but system-webview variation makes it a weaker
first substrate for governed browser hosting.

## Proposed Package Boundary

Initial package shape:

```text
packages/native
  Electron app shell and native operator surface

packages/gateway-contracts
  shared surface contracts consumed by GUI, native, TUI, CLI, SDK, widget

packages/runtime
  App Gateway, Operator Gateway, session truth, browser authority, evidence

packages/gui
  default web operator surface
```

The native package may share extracted presentational primitives only after they
become substrate-neutral. It must not import `packages/gui/src/app-shell.tsx` as
a wrapped web app.

## Boundary Rules

- Runtime owns session identity, authority, policy, provider routing, tool
  execution, browser ownership, audit, evidence, replay, and config truth.
- Gateway contracts are the only runtime boundary for native.
- Native owns native window lifecycle, local focus, menu/tray affordances,
  surface layout, keyboard routing, and native capability adapters.
- Native may host browser views, but browser session authority remains
  runtime-owned.
- Native may cache display state, but not runtime truth.
- Native must be removable without changing runtime semantics.
- No surface may create a private session, memory, provider, config, scheduler,
  approval, or replay model.

## Version 1 Performance Foundation

Native surface v1 must be performance-aware before feature work starts:

- Render from canonical projections, not raw unbounded event streams.
- Normalize client state by `instanceId`, `sessionId`, `turnId`, `eventId`, and
  resource URI.
- Batch high-frequency frames and coalesce display updates at the surface
  boundary.
- Virtualize long transcripts, event timelines, invocation trees, file lists,
  resource lists, and browser evidence galleries.
- Treat screenshots, recordings, traces, diffs, and large tool outputs as
  resource links loaded on demand.
- Define render-budget telemetry for event ingestion, projection update time,
  first paint, interaction latency, memory usage, and dropped frames.
- Keep browser live frames separate from durable replay evidence.
- Keep projection code substrate-neutral where it should be reusable by GUI and
  native.

This is the "proper from the start" requirement. It does not require immediate
Rust. It requires that the surface contract and projection architecture are
ready for a bounded Rust/WASM/sidecar projection kernel if measurements or
approved workloads justify one.

## Required Decision Output

This roadmap closes only when it produces:

- accepted native surface stack
- package boundary
- gateway/runtime boundary
- shared projection strategy
- native security baseline
- first-version performance budget
- browser-capability extension point
- deletion/rollback plan
- ADR-006 amendment or replacement for the native surface stack decision

## Proof Requirements

The foundation proof must demonstrate:

- native window opens as a Kiln operator surface
- native connects to an existing Operator Gateway or App Gateway
- native renders session identity, authority state, provider route, theme, and
  at least one session event projection from `@kilnai/gateway-contracts`
- native can reconnect without mutating runtime state
- native can be closed without orphaning runtime resources
- no provider credentials, memory files, or config truth are read directly by
  the native process
- performance telemetry exists for initial render, frame handling, and event
  projection
- native exposes a capability slot for embedded browser hosting without
  implementing the browser capability in this slice

## Non-Goals

- Do not build the embedded browser host in this slice.
- Do not build the high-density native cockpit in this slice.
- Do not replace the web GUI.
- Do not wrap the web GUI as the native product.
- Do not create a second runtime.
- Do not add Rust governance logic.
- Do not implement private config, provider, memory, scheduler, or policy
  behavior.

## Verification Gates

- ADR/research update accepted before implementation.
- Contract tests cover native capability negotiation and unsupported-capability
  behavior.
- Typecheck covers `packages/gateway-contracts`, `packages/runtime`, and the
  native package.
- Native smoke test proves gateway attach and clean shutdown.
- Security review confirms remote content and native privileged APIs are not
  exposed through renderer code.
- Performance smoke test records initial budget metrics, even if the first
  numbers are baseline-only.
