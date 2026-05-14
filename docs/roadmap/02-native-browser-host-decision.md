# 02 - Native Browser Host Decision

Status: deferred design prerequisite.

## Objective

Decide and prove the native browser host required for a real in-app browser
operator surface.

This roadmap exists because a normal web GUI cannot host an arbitrary real
browser tab with reliable interaction, automation, and inspection. Iframes are
not sufficient because target sites can block embedding and browser
same-origin policy prevents the GUI from owning cross-origin page control.

This track is narrower than `04-native-operator-surface-experiment.md`.
Roadmap `04` remains the deferred high-density native cockpit experiment.
This file only decides the browser-host substrate needed before Kiln can claim a
real embedded browser.

## Canonical Placement

This roadmap runs after the completed browser operator foundations documented
in `docs/architecture/developer-tools.md` and `docs/guides/tool-use.md`, and
before `03-embedded-browser-operator-surface.md`.

```text
completed multimodal transport foundation
  ->
completed agent QA showcase recorder
  ->
completed browser operator foundations and snapshot monitor
  ->
02      native browser host decision
  ->
03      real embedded browser operator surface
  ->
04      high-density native operator surface experiment
```

## Candidate Hosts

Research references for this decision:

- Electron `WebContentsView`: https://www.electronjs.org/docs/latest/api/web-contents-view
- Electron `BrowserView` deprecation notice: https://www.electronjs.org/docs/latest/api/browser-view
- Tauri `WebviewWindow`: https://tauri.app/reference/javascript/api/namespacewebviewwindow/
- Tauri webview runtime versions: https://v2.tauri.app/reference/webview-versions/
- OpenAI Codex in-app browser reference: https://help.openai.com/en/articles/11369540

### Electron WebContentsView

Primary candidate for the first proof.

Reasons:

- `WebContentsView` is Electron's current embedded browser view primitive.
- `BrowserView` is deprecated and must not be used for new work.
- Electron exposes `webContents` and `webContents.debugger`, giving Kiln a
  browser view and a Chrome DevTools Protocol control path in the same host.
- Chromium behavior is consistent across Windows, macOS, and Linux.

Risks:

- ADR-006 rejected Electron for the web GUI substrate. This roadmap must amend
  that decision only for the browser-host requirement, not for the whole GUI.
- Remote content must never receive Node or privileged Electron APIs.
- Packaging and update burden is higher than the current web-first GUI.

### Tauri Webview

Secondary candidate.

Reasons:

- Tauri aligns better with the existing desktop-wrapper direction.
- Tauri can create webviews and load remote URLs.

Risks:

- Tauri uses WebView2 on Windows and WebKit on macOS/Linux, so browser behavior
  and automation/control are less uniform than Chromium.
- A first-class CDP-style control path is not as direct as Electron
  `webContents.debugger`.

### External Playwright Browser

Useful baseline, not the target.

Reasons:

- Already implemented and governed.
- Good for CI, headless work, and manual validation through a separate visible
  window.

Risks:

- Not an in-app browser.
- Does not satisfy the product target.

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
- package boundary
- runtime adapter boundary
- security baseline
- control protocol
- evidence model
- rollback/deletion plan
- ADR update or replacement for the Electron/Tauri part of ADR-006

## Boundary Rules

- Runtime owns session identity, authority, ownership, audit, replay, policy,
  provider routing, and tool execution.
- Native browser host owns browser process/view lifecycle only as an adapter.
- GUI owns layout reservation and presentation state only.
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

## Proof Requirements

The proof must demonstrate:

- a real browser view embedded in the Kiln-controlled window
- navigation to an allowed URL
- direct operator click/type/scroll inside the embedded browser view
- runtime observation of URL/title/viewport state
- runtime-side action dispatch through the selected host control channel
- takeover/release blocking still enforced by runtime
- persisted evidence that names the host transport, for example
  `electron-webcontents`
- clean shutdown and browser process cleanup

## Non-Goals

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
