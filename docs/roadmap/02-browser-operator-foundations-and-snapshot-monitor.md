# 02 - Browser Operator Foundations And Snapshot Monitor

Status: deferred foundation track; real embedded browser moved to `03` and `04`

## Objective

Define and implement the runtime and cross-surface foundations required for
browser operation:

- governed browser session identity
- browser observations and durable artifacts
- Browser tab snapshot monitoring
- explicit operator takeover and release
- brokered browser input through the gateway/runtime/provider boundary
- sanitized evidence for ownership and operator input

This track does **not** complete a real embedded in-app browser. That work is
split into:

- `03-native-browser-host-decision.md`
- `04-embedded-browser-operator-surface.md`

## Current Baseline

Kiln already has governed browser automation through `browser_*` tools and a
GUI Browser tab that displays artifact-backed screenshots from browser
observations. That tab is a snapshot monitor, not a live embedded browser.

Kiln has also started the broader interactive-use foundations:

- Browser use is configured through `interactiveUse.browserProvider` and the
  Playwright provider.
- Browser session state exists through `browser_session_updated`.
- Operator ownership exists through `browser_session_control`.
- The GUI has a Browser tab and a `Take control` action.
- Computer use is configured through `interactiveUse.allowComputer` and
  `interactiveUse.computerProvider`, with Windows and Windows UI Automation
  providers.

These foundations mean the browser operator track has real implementation
behind it. They do not mean the real embedded browser is complete.

## Runtime Browser Modes

`interactiveUse.browserEnvironment` currently selects one browser runtime mode
for the Playwright provider:

- `isolated-headless`: opens an isolated browser session without a visible
  browser window. This is the expected default for automation, CI, replay, and
  low-friction agent browsing when no human takeover surface is required.
- `isolated-headed`: opens an isolated browser session in a visible external
  browser window. This is expected for live manual validation and operator
  takeover while Kiln does not yet have a true embedded browser surface.

Opening a separate visible Chromium window in `isolated-headed` mode is
therefore normal. It proves that the browser is visible and governed, but it is
not a real in-app browser. The GUI Browser tab is still a projection surface
over runtime-owned browser state; it is not an embedded browser/WebView that
receives direct native pointer and keyboard input inside Kiln.

The desired future configuration shape is to allow multiple permitted browser
environments plus an explicit default, for example:

```yaml
interactiveUse:
  browserEnvironments:
    - isolated-headless
    - isolated-headed
  defaultBrowserEnvironment: isolated-headless
```

That model would let Kiln keep headless automation as the default while
allowing a specific browser request or live operator workflow to ask for
`isolated-headed`. The runtime must validate requested environments against the
allowed list and fail closed when a request asks for an environment that is not
permitted. Until that contract exists, `browserEnvironment` remains a single
global selection.

## Non-Ambiguous Status

As of 2026-05-13:

- **Started:** yes.
- **Computer use foundations:** yes.
- **In-app browser foundations:** yes.
- **Snapshot monitor projection:** yes.
- **Operator takeover lock:** yes.
- **Snapshot-polling browser control:** yes, as a monitor/input fallback, not
  as a real embedded live browser.
- **Local Playwright/Chromium CDP screencast transport:** yes, as a pushed
  frame-stream fallback/diagnostic transport, not as a real embedded browser.
- **Remote WebRTC or hosted live URL transport:** no.
- **Click/type/scroll from the Kiln Browser tab into the active browser
  session:** yes for click, wheel, text, and keypress while ownership is
  `operator`.
- **Typed operator input transport through the gateway/runtime/provider
  boundary:** yes.
- **Durable evidence for operator input and handoff beyond screenshots and
  ownership transitions:** yes for sanitized gateway session events.
- **Real embedded in-app browser:** no; moved to `03` and `04`.

Therefore this track should close only as the browser-operator foundation and
snapshot-monitor track. It must not claim completion of a real in-app browser.

## Pre-Slice 0: Transcript Snapshot Gallery

Status: completed in `f7084e5`.

Before another browser-surface implementation slice, Kiln should make browser
screenshots visible where the operator already has causal context: next to the
tool call that produced them.

The pre-slice should:

- Project every `browser_*` result with screenshot evidence into the transcript
  tool-call presentation, not only into a separate workbench tab.
- Render screenshots as a compact gallery attached to the corresponding tool
  call row, with stable sequential labels such as `Capture 1`, `Capture 2`,
  scoped to the browser session or current turn.
- Keep the resource plane as the source of truth. Transcript state should store
  artifact URIs, titles, MIME type, relation, and sequence metadata, not inline
  image blobs.
- Preserve cross-surface contracts: GUI may render thumbnails and a gallery,
  while TUI/CLI/SDK can render numbered resource links from the same
  presentation model.
- Treat the dynamic Browser tab as an optional focused view of the latest
  browser state. It must not be the only way to inspect browser evidence.
- Replay correctly from persisted sessions, including sessions loaded after the
  turn completes.

Verification for this slice should include contract projection tests,
session-store replay tests, live WebSocket event tests, and GUI transcript
rendering tests using multiple browser screenshots from one turn.

## Current Research Decision

Status: reopened 2026-05-13.

Browser operator research is captured in
`docs/research/14-live-browser-operator-surface.md`. The earlier decision
correctly established runtime-owned browser authority, durable resource-plane
evidence, GUI projection, and explicit operator ownership transitions. It was
not sufficient as a completion definition for a true embedded browser operator
surface.

The corrected target is split:

- This file owns browser operator foundations, snapshot monitoring, brokered
  input, and evidence.
- `03` owns the native browser-host decision and prototype.
- `04` owns the real embedded in-app browser operator surface.

This file is complete only through the safe browser lock baseline:
provider-owned sessions, durable artifact-backed captures, GUI projection, and
explicit operator takeover/release ownership transitions. It is not the live
browser operator surface because Kiln does not yet provide a real embedded
browser view inside the app.

## Completion Definition

This foundation track is complete only when all of the following are true:

- The GUI Browser surface truthfully labels snapshot-polling as a snapshot
  monitor, not as live browser.
- Browser session state, observations, artifact links, and ownership state
  replay from durable session evidence.
- The operator can take control, broker click/type/scroll/key input, and release
  control through the gateway/runtime/provider boundary.
- While ownership is `operator`, agent browser mutations fail closed and report
  the ownership block.
- Releasing control captures a fresh observation artifact before agent browser
  actions resume.
- The gateway contract includes typed browser session updates, typed snapshot
  monitor frames where available, typed operator input frames, and input
  acknowledgements or failures.
- Durable evidence records takeover, release, input batches or summaries,
  fresh observations, and transport mode where available.
- CLI, TUI, SDK, and replay surfaces degrade to status plus resource links.
- Unit, contract, gateway, GUI, and replay tests prove the handoff.

Real embedded browser completion is explicitly out of scope for this file.

## Slice 1: Browser Session State Projection

Status: completed in `d990c19`.

The first post-research implementation slice added a shared browser session
state projection to the gateway contract, runtime interactive-use projection,
GUI WebSocket validation, GUI session store, and Browser tab rendering while
preserving the existing `interactive_use_updated.snapshot` compatibility path.

## Slice 2: Browser Session Lifecycle Updates

Status: completed.

This slice added a browser session lifecycle update frame so future stream
transport code can publish `starting`, `live`, `paused`, `failed`, `ended`, and
ownership changes without requiring a new browser tool snapshot.

## Slice 3: Provider-Owned Screenshot Stream

Status: completed.

This slice added an optional Playwright provider-owned screenshot stream that
emits `browser_session_updated` lifecycle updates with artifact-backed latest
captures. The runtime provider remains the browser authority, the core tool
surface supplies the resource-plane artifact sink, the Windows/Bun Node sidecar
uses the same stream event protocol, and the GUI gateway forwards updates over
the existing operator WebSocket.

## Slice 4: Operator Takeover Lock

Status: completed.

This slice added an operator-control lock over browser sessions. GUI can
request takeover or release through a typed outbound frame, runtime routes the
request to the configured browser provider, and the provider blocks agent
browser mutations while ownership is `operator`. Release returns ownership to
the agent and captures a fresh artifact-backed observation before browser
actions resume.

## Slice 5: Snapshot-Polling Monitor And Brokered Input

Status: completed.

This slice added typed viewport dimensions to browser captures, gateway
emission of browser viewport frames from artifact-backed captures, GUI Browser
tab rendering for snapshot monitor frames loaded from the resource plane, and
brokered operator click, wheel, text, and keypress input through
`browser_operator_input`. The in-process Playwright provider and the Windows/Bun
sidecar both gate input on the existing operator ownership lock and return typed
acknowledgements.

This slice is a production increment, not a real embedded browser. The
transport is snapshot-polling and must be presented as monitoring/evidence, not
as an actual live browser.

## Slice 6: CDP Screencast Transport And Operator Evidence

Status: completed.

This slice added local Playwright/Chromium CDP screencast support behind the
runtime-owned browser provider. This is a pushed frame stream, not a real
embedded browser. When Playwright exposes `newCDPSession` and an artifact sink
is available, the provider starts `Page.startScreencast`, acknowledges frames
with `Page.screencastFrameAck`, writes frame content through the artifact plane,
and marks forwarded viewport frames with `transport: cdp-screencast`. Snapshot
polling remains the fallback for providers without CDP or artifact
materialization.

The same transport marker is carried through the Windows/Bun sidecar state and
the GUI gateway. Operator pointer, wheel, text, and key input can dispatch
through CDP when a CDP stream is active, including raw key down/up phases that
were previously reserved for the CDP slice.

This slice also added sanitized browser operator evidence session events for
takeover, release, and input acknowledgements. Text input evidence records text
length instead of raw text.

Remaining acceptance gap for this foundation track: persisted evidence must
truthfully show whether a session used snapshot monitor, CDP screencast, or a
future embedded browser host. Completion of real embedded browser UX belongs to
`04`.

## Research Requirement

Before the remaining browser-control implementation, compare current
browser-agent surfaces from major labs and agent products, including their
security model, viewport streaming design, takeover/lock semantics, artifact
capture, replay model, and operator intervention controls.

The research must continue to evaluate whether Kiln should use one of these
approaches per provider:

- Playwright/Chromium CDP screenshot stream with model-visible browser tools.
- Remote browser instance with an operator-visible stream and separate tool
  control channel.
- Embedded browser/WebView surface controlled by a brokered automation layer.
- Hybrid snapshot-first mode that upgrades to live streaming only while an
  agent actively controls a session.

## Design Constraints

- Preserve headless-core and surface-replaceability invariants.
- Keep browser authority in the runtime provider, not the GUI component tree.
- Treat the GUI tab as an operator projection, not the source of automation
  authority.
- Expose lock/ownership when an agent controls the browser.
- Keep screenshots, streams, traces, and replay artifacts in the resource plane
  with bounded retention.
- Fail closed when browser provider, domain policy, or stream transport is not
  configured.

## Future Enhancements

- What stream rate is enough for debugging without excessive CPU/GPU/network
  cost?
- Should embedded browser sessions survive agent turns, or close by default after
  one-off tasks?
- How should this relate to local desktop `computer_*` automation when the user
  asks for Edge or another installed browser?
- Which remote-provider live URL adapters should be added after the local CDP
  transport, and how should their sensitive URLs be scoped?
