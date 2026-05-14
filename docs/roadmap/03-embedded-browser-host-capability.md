# 03 - Embedded Browser Host Capability

Status: blocked on `02-native-operator-surface-foundation.md`.

## Objective

Choose and prove the native browser-host capability that lets Kiln embed a real
browser view inside the native operator surface.

This roadmap is narrower than the native surface foundation and narrower than
the high-density cockpit. It proves one native capability: governed embedded
browser hosting.

## Canonical Placement

```text
02      native operator surface foundation
  ->
03      embedded browser host capability
  ->
04      embedded browser operator surface
  ->
05      native cockpit and projection performance
```

The selected host capability becomes an adapter behind the same runtime-owned
browser session contract used by the web GUI, CLI, TUI, SDK, and widget.

## Candidate Hosts

Research references for this decision:

- Electron `WebContentsView`: https://www.electronjs.org/docs/latest/api/web-contents-view
- Electron `BrowserView` deprecation notice: https://www.electronjs.org/docs/latest/api/browser-view
- Electron `webContents.debugger`: https://www.electronjs.org/docs/latest/api/debugger
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Tauri `WebviewWindow`: https://tauri.app/reference/javascript/api/namespacewebviewwindow/
- Tauri webview runtime versions: https://v2.tauri.app/reference/webview-versions/
- Chromium Embedded Framework: https://chromiumembedded.github.io/cef/

### Electron WebContentsView

Primary candidate for the first proof.

Reasons:

- `WebContentsView` is Electron's current embedded browser view primitive.
- `BrowserView` is deprecated and must not be used for new work.
- Electron exposes `webContents` and `webContents.debugger`, giving Kiln a
  browser view and a Chrome DevTools Protocol control path in the same host.
- Chromium behavior is consistent across Windows, macOS, and Linux.
- The native surface foundation already selects Electron for the v1 native
  process model.

Risks:

- ADR-006 rejected Electron for the web GUI substrate. This roadmap must amend
  that decision only for the native operator surface and browser-host
  capability, not for runtime ownership.
- Remote content must never receive Node or privileged Electron APIs.
- Packaging and update burden is accepted only if the native surface remains a
  first-class product surface, not a wrapper.

### Tauri Webview

Secondary candidate.

Reasons:

- Strong desktop security model and OS integration story.
- Useful reference for permissions, capabilities, and small desktop packaging.

Risks:

- Tauri uses WebView2 on Windows and WebKit on macOS/Linux, so browser behavior
  and automation/control are less uniform than Chromium.
- A first-class CDP-style control path is not as direct as Electron
  `webContents.debugger`.
- Better fit for packaging than for the first governed embedded-browser proof.

### Chromium Embedded Framework

Reserved alternative if Electron fails the proof.

Reasons:

- Purpose-built Chromium embedding.
- Deep control over browser process and rendering lifecycle.

Risks:

- Higher C++/native maintenance burden.
- Larger packaging and build-system cost.
- Too heavy for the first TypeScript-first native surface unless Electron
  cannot satisfy security or control requirements.

### External Playwright Browser

Useful baseline, not the target.

Reasons:

- Already implemented and governed.
- Good for CI, headless work, and manual validation through a separate visible
  window.

Risks:

- Not an in-app browser.
- Does not satisfy the native embedded capability.

### Screenshot Or Screencast Stream

Rejected as the primary host.

Reasons:

- Snapshot polling is observability.
- CDP screencast is a frame stream.
- Neither is a real embedded browser where the operator directly interacts with
  the browser view inside Kiln.

## Required Decision Output

The decision must produce:

- chosen host substrate
- host package boundary
- runtime adapter boundary
- security baseline
- control protocol
- evidence model
- deletion plan
- ADR update or replacement for the Electron/Tauri part of ADR-006

## Boundary Rules

- Runtime owns browser session identity, authority, ownership, audit, replay,
  policy, provider routing, and tool execution.
- Native browser host owns browser process/view lifecycle only as an adapter.
- Native surface owns layout reservation, focus, resize, and presentation state.
- The host must communicate through explicit gateway/runtime contracts.
- No browser host may import provider credentials or resolve policy locally.
- No browser host may introduce a second session model.

## Security Requirements

- Remote pages run with Node integration disabled.
- Context isolation remains enabled.
- Browser sandbox remains enabled where the host supports it.
- No broad preload API is exposed to arbitrary remote content.
- Navigation is policy-gated by runtime domain/environment policy.
- Downloads, popups, permissions, file chooser access, clipboard, and external
  protocol opens fail closed until explicitly designed.
- DevTools/CDP access is owned by the browser host adapter and audited through
  runtime events.
- Cookies and persistent profile state are ephemeral by default unless a later
  governed profile policy explicitly accepts persistence.

## Proof Requirements

The proof must demonstrate:

- a real browser view embedded in the Kiln native surface
- navigation to an allowed local deterministic URL
- direct operator click/type/scroll inside the embedded browser view
- runtime observation of URL/title/viewport state
- runtime-side action dispatch through the selected host control channel
- takeover/release blocking still enforced by runtime
- persisted evidence that names the host transport, for example
  `electron-webcontents`
- clean shutdown and browser process cleanup

## Non-Goals

- Do not build the full embedded browser operator product surface.
- Do not implement high-density multi-session cockpit UI.
- Do not replace the web GUI.
- Do not build an editor.
- Do not move runtime state into the native host.
- Do not treat screenshot polling or screencast as completion.

## Verification Gates

- ADR/research update accepted before implementation.
- Prototype proves the host with a local deterministic page before Google or any
  hostile public site.
- Unit tests cover host capability negotiation and failure states.
- Integration test proves gateway/runtime event projection.
- Manual proof records exact host transport in durable session evidence.
- Security review blocks any broad preload or remote Node exposure.
