# 04 - Embedded Browser Operator Surface

Status: blocked on `03-native-browser-host-decision.md`.

## Objective

Build the real in-app browser operator surface after the native browser host is
chosen and proven.

This is the product capability users expect when they say "live browser inside
Kiln": a browser view embedded in the operator app, not a polling screenshot,
not a CDP screencast canvas, and not an external Chromium window.

## Dependencies

- `02-browser-operator-foundations-and-snapshot-monitor.md`
  Browser operator contracts, ownership, brokered input, snapshot monitor, and
  evidence baseline.
- `03-native-browser-host-decision.md`
  Native browser host decision, prototype, security baseline, and ADR update.
- `docs/architecture/operator-surfaces.md`
  Surface ownership and runtime ownership invariants.
- `docs/adr/ADR-006-gui-stack-and-binding-contract.md`
  Must be amended if Electron or another native host becomes accepted for this
  focused browser-host role.

## Required Experience

The operator can:

- open a browser task from the GUI/native operator surface
- see the browser as a real embedded view inside Kiln
- take ownership
- click, type, scroll, drag, use modifier keys, and release ownership
- see clear ownership state and target/session identity
- observe agent actions resume after release
- inspect durable artifacts and session evidence after the run

The agent/runtime can:

- navigate and observe through the same runtime-owned browser session
- fail closed while ownership is `operator`
- resume after release with fresh observation evidence
- record host transport, ownership transitions, input summaries, and browser
  observations

## Architecture Shape

```text
GUI / native operator shell
  -> reserves browser region and sends layout/focus intent
  -> gateway/operator contract
  -> runtime browser session authority
  -> browser host adapter
  -> native embedded browser view
```

The browser view is not a React component that renders page pixels. It is a
native browser child view owned by the selected host.

## Surface Semantics

Use these labels consistently:

- `Snapshot monitor`
  Artifact-backed periodic observation. Not live.
- `Frame stream`
  CDP screencast or future remote frame stream. Useful fallback, not embedded
  browser.
- `Embedded browser`
  Real browser view inside the app.
- `External browser`
  Visible Playwright/Chromium window outside Kiln.

The UI must never call snapshot polling "live browser."

## Implementation Slices

### Slice 1 - Capability Negotiation

Runtime and GUI expose the active browser surface capability:

- `snapshot-monitor`
- `frame-stream`
- `external-browser`
- `embedded-browser`

The selected transport is persisted in session evidence.

### Slice 2 - Embedded Browser Region

The operator surface reserves and resizes the native browser region while
keeping all runtime truth in the gateway/runtime layer.

### Slice 3 - Ownership And Direct Input

Takeover/release controls map to runtime ownership. Direct browser input is
accepted only while ownership is `operator`.

### Slice 4 - Runtime Observation And Agent Control

Runtime can observe URL/title/state and dispatch agent browser actions through
the selected host adapter after ownership returns to `agent`.

### Slice 5 - Evidence And Replay

Persist:

- host transport
- browser session id
- URL/title transitions
- ownership transitions
- operator input summaries
- fresh release observation
- artifact links

Replay surfaces degrade to artifact/resource links and explicit transport
status. Replay does not need to reconstruct the live embedded browser.

### Slice 6 - Live Proof

Committed proof must include:

- deterministic local page
- public page with normal navigation
- takeover block while operator owns session
- release and agent resume
- durable evidence showing `embedded-browser`
- cleanup with no orphan browser host process

## Non-Goals

- No remote browser cloud adapter.
- No WebRTC implementation.
- No high-density native cockpit.
- No editor integration.
- No private native runtime.
- No direct GUI imports from core/runtime implementation code.

## Verification Gates

- Contract tests for capability negotiation and evidence.
- Runtime tests for ownership and host-adapter failure behavior.
- GUI/native tests for layout reservation and state projection.
- E2E proof with real embedded host.
- Security review for remote content isolation.
- Documentation updated so snapshot monitor, frame stream, external browser,
  and embedded browser are not conflated.
