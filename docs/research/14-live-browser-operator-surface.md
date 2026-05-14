# Live Browser Operator Surface Research

## Purpose

This note records the research basis for the late browser operator sequence:
browser operator foundations, native browser-host decision, and the real
embedded browser operator surface. It informs future architecture and
implementation slices; it does not override the operator-surface doctrine in
`docs/architecture/operator-surfaces.md` or runtime taxonomy in
`docs/architecture/runtime-surfaces.md`.

## Scope

Sources reviewed for this slice, rechecked on 2026-05-13 where the source is
time-sensitive:

- OpenAI Computer Use:
  https://developers.openai.com/api/docs/guides/tools-computer-use
- Anthropic computer use tool:
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
- Browserbase browser sessions and Live View:
  https://docs.browserbase.com/platform/browser/getting-started/using-browser-session
  and
  https://browserbase.mintlify.app/features/session-live-view
- Cloudflare Browser Run / Browser Rendering Live View and Human in the Loop:
  https://developers.cloudflare.com/browser-rendering/features/live-view/
  and
  https://developers.cloudflare.com/browser-rendering/features/human-in-the-loop/
- Steel session embeds:
  https://docs.steel.dev/overview/sessions-api/embed-sessions
- Hyperbrowser Live View:
  https://www.hyperbrowser.ai/docs/sessions/live-view
- Browser Use Cloud live preview and recording:
  https://docs.browser-use.com/cloud/tips/live-view/iframe-embed
  and
  https://docs.browser-use.com/cloud/browser/playwright-puppeteer-selenium
- Chrome DevTools Protocol Page and Input domains:
  https://chromedevtools.github.io/devtools-protocol/tot/Page/
  and
  https://chromedevtools.github.io/devtools-protocol/tot/Input/
- Playwright CDPSession and BrowserContext CDP support:
  https://playwright.dev/docs/api/class-cdpsession
  and
  https://playwright.dev/docs/api/class-browsercontext#browser-context-new-cdp-session
- OpenAI Codex plan/app notes:
  https://help.openai.com/en/articles/11369540
  and
  https://openai.com/index/introducing-the-codex-app

## 2026-05-13 Reassessment

The browser operator track was previously marked complete after Kiln shipped
screenshot projection, provider-owned screenshot polling, and a safe operator
takeover lock. That baseline is useful, but it does not satisfy the actual user
experience target: a real browser surface inside Kiln that the operator can
watch and control without leaving the app.

Current Kiln behavior is closer to a snapshot monitor than a real in-app
browser:

- Runtime emits `browser_session_updated` with the latest screenshot artifact.
- Gateway emits `browser_live_viewport_frame` from artifact-backed captures
  when viewport dimensions are known, preserving whether the source transport
  is snapshot polling or local CDP screencast.
- GUI renders the latest viewport frame in the Browser tab and can load the
  frame from the resource plane.
- Takeover transfers ownership and blocks agent mutations. While ownership is
  `operator`, GUI sends viewport-relative click, wheel, text, and keypress input
  through `browser_operator_input`, and runtime/provider code acknowledges or
  rejects the input.
- The Windows/Bun sidecar path handles the same operator input operation and
  carries the CDP screencast transport marker when available.
- GUI gateway emits sanitized browser operator evidence events for takeover,
  release, and input acknowledgements. Text input is summarized by length, not
  raw text.
- Continuous stream frames are not durable transcript evidence, and persisted
  sessions mostly contain explicit `browser_observe` screenshot artifacts.
- If the runtime starts a headed session, the visible browser can compete with
  the chat surface instead of living inside the operator transcript.

Therefore the browser operator work is now split into three concerns:

1. Completed browser operator foundations in
   `docs/architecture/developer-tools.md` and `docs/guides/tool-use.md`:
   snapshot monitor, frame-stream fallback, brokered input, and evidence.
2. `02-native-browser-host-decision.md`
   Native browser-host decision and proof. This is narrower than the broad
   high-density native operator-surface experiment in Roadmap 04.
3. `03-embedded-browser-operator-surface.md`
   Real embedded browser operator surface.

Snapshot evidence, CDP frame streams, brokered input, sanitized evidence, and
lock semantics are useful foundations. They are not completion proof for a real
embedded browser.

## External Patterns

### Screenshot Loop Remains The Model Contract

OpenAI and Anthropic both frame computer use around a host application that
executes model-requested actions and returns screenshots. The model does not
own the browser or desktop directly; the harness owns action execution,
screenshot capture, policy, and escalation.

Evidence:

- OpenAI Computer Use describes a loop where the application inspects
  `computer_call`, executes returned actions, captures the updated screen, and
  sends it back as `computer_call_output`.
- Anthropic computer use documents a sandboxed computer tool with screenshot,
  mouse, and keyboard capabilities, and states that the application must
  implement screenshot capture and action execution.

Implication for Kiln: browser authority must remain in runtime/provider code.
GUI can display the current viewport and operator controls, but it must not
become the actor that executes browser actions.

### Live View Is An Operator Projection

Browserbase, Cloudflare Browser Run, Steel, Hyperbrowser, and Browser Use Cloud
all expose a live browser session as a URL, iframe, WebRTC stream, hosted UI,
dashboard, or DevTools-compatible endpoint. These surfaces help operators debug,
monitor, demonstrate, or intervene, while automation continues through a
separate browser session/control channel.

Evidence:

- Browserbase Live View exposes real-time session visibility and embedded
  application views for human-in-the-loop use.
- Cloudflare Browser Run Live View can be reached through dashboard, hosted UI,
  or native Chrome DevTools for an existing browser session.
- Steel separates active live-session streams from past-session replay embeds.
- Hyperbrowser and Browser Use Cloud expose live URLs that can be embedded in
  an application.

Implication for Kiln: live browser should be a projection of a runtime-owned
browser session. The GUI tab may embed or render that projection, but the
runtime must remain the session owner and event source.

### Mature Products Separate Live View, Control, And Replay

Remote browser products converge on three separate capabilities:

- Live view: a real-time viewport projection for an active browser session.
- Human control: a governed way for a person to step in and operate the same
  session.
- Replay: recordings, traces, artifacts, or screenshots for after-the-fact
  debugging.

Cloudflare Browser Run exposes Live View through a dashboard, hosted UI, and
native Chrome DevTools, and states that the hosted UI provides a live
interactive view for a remote session. Cloudflare Human in the Loop describes a
human opening the live view URL, completing the blocked action, and handing the
session back to automation. Steel documents WebRTC live-session embeds and
separate MP4/HLS past-session replay. Hyperbrowser exposes an embeddable
authenticated live URL and warns that anyone with the URL can access the
session. Browserbase and Browser Use follow the same hosted or embeddable live
view pattern.

Implication for Kiln: the Browser tab cannot be just a nicer screenshot viewer.
It needs a first-class live viewport stream, a first-class input channel, and a
separate durable evidence channel.

### Human Takeover Is A First-Class Safety Boundary

Cloudflare documents a human-in-the-loop flow where a human opens the Live View
URL, completes a task such as authentication or sensitive data entry, and the
automation script resumes afterward. Browserbase and Hyperbrowser likewise
describe embedded live views as enabling human-in-the-loop interactions, and
Hyperbrowser explicitly supports read-only live views.

Evidence:

- Cloudflare Human in the Loop documents login, MFA, CAPTCHA, sensitive data
  entry, complex interactions, and verification as reasons to hand a live
  browser to a human before resuming automation.
- Browserbase describes embedded Live View as enabling remote control for
  authentication, CAPTCHAs, and unexpected errors.
- Hyperbrowser supports `viewOnlyLiveView` so a live view can be made
  read-only.

Implication for Kiln: takeover is not a cosmetic button. It needs explicit
ownership state, a lock transfer, audit events, timeout behavior, and a clear
return-to-agent transition. Sensitive flows should stop and request operator
action instead of letting the model continue unattended.

### Replay Is Usually Separate From Live Stream

Steel separates live session streams from past-session replay. Browser Use Cloud
exposes optional recordings as presigned MP4 URLs after session completion. The
live stream is useful for active monitoring, but durable replay is artifact
or recording backed.

Evidence:

- Steel documents separate live-session stream embeds and past-session replay
  embeds.
- Browser Use Cloud documents optional recordings and presigned recording URLs
  after the session or task has completed.

Implication for Kiln: the resource plane remains the durable replay source.
Live stream frames may be ephemeral, but milestone screenshots, recordings,
trace metadata, and stream lifecycle events need artifact-backed records.

### CDP Provides The Local Browser Primitives

For a local Playwright/Chromium provider, Chrome DevTools Protocol provides the
lowest-level primitives Kiln needs:

- `Page.startScreencast` emits viewport image frames with metadata.
- `Page.screencastFrameAck` acknowledges frames so the frontend can apply
  backpressure.
- `Input.dispatchMouseEvent` dispatches pointer and wheel events in CSS pixel
  viewport coordinates.
- `Input.dispatchKeyEvent` dispatches browser-level keyboard events.
- Playwright exposes `CDPSession` so protocol methods can be sent and protocol
  events subscribed to from a page or browser context.

Playwright documents that CDP sessions are Chromium-only. That is acceptable
for the first local live-control transport because Kiln's current provider path
already uses Playwright and the native browser problem is isolated behind a
provider boundary. It does mean the gateway/GUI contract must be transport
neutral so future Firefox/WebKit, WebRTC, VNC, or remote-provider adapters do
not leak CDP into surface code.

Implication for Kiln: CDP can control Chromium and can support frame-stream
fallbacks, but a real in-app browser requires a native browser host. GUI should
send normalized input/control intents to runtime; runtime should validate
ownership, policy, and coordinates, then dispatch through the active host or
provider adapter.

### Live URLs Are Secrets

Hyperbrowser warns that anyone with a live URL can view and potentially
interact with the session unless view-only mode is enabled. Browserbase exposes
disconnect events for embedded live views. Browser Use Cloud uses hosted live
URLs and recording URLs with expiration. Cloudflare Live View can be reached
through dashboard, hosted UI, or DevTools target URLs.

Evidence:

- Hyperbrowser documents live URLs with embedded authentication tokens and warns
  that anyone with the URL can access the live view.
- Browserbase documents a `browserbase-disconnected` postMessage event for
  embedded live views.
- Browser Use Cloud documents hosted live URLs and expiring presigned recording
  URLs.
- Cloudflare Live View exposes target URLs through dashboard, hosted UI, and
  DevTools flows.

Implication for Kiln: live view URLs and stream tokens must be treated as
sensitive resources. They should not be stored in normal transcript text,
copied into model-visible prompt context, or exposed across tenants.

## Decision

Kiln should use a split browser operator model:

1. Browser automation remains owned by the runtime provider.
2. Every browser observation that matters for replay is stored as an artifact
   or resource-plane record.
3. GUI and future rich surfaces may subscribe to browser viewport projections
   while a browser session is active.
4. GUI sends operator input as typed intents, never direct browser commands.
5. Runtime validates ownership, domain policy, session liveness, and input
   bounds before dispatching input through the provider.
6. Snapshot-polling viewport frames are an acceptable monitor/evidence
   fallback, not live browser.
7. Local CDP screencast is an acceptable frame-stream fallback/diagnostic
   transport, not a real embedded browser.
8. A real in-app browser requires a native browser host decision before
   implementation.
9. Remote provider live URLs or WebRTC streams should be represented as
   sensitive resource-backed transports behind the same gateway contract.
10. Operator takeover requires explicit lock transition, audit event, timeout,
   release, and a fresh post-release observation.

This rejects treating screenshot polling or CDP screencast as completion.
Snapshot evidence must remain sufficient for replay, terminal surfaces, SDK
consumers, and environments where embedded browser is unavailable, but the
operator experience target requires a real native embedded browser host.

## Architecture Consequences

### Runtime Contract

Future implementation should introduce a runtime-owned browser session state
contract with at least:

- browser session id
- provider id and browser backend
- active URL and page title when known
- stream availability: unavailable, starting, live, paused, ended, failed
- ownership: agent, operator, released
- interactivity mode: view-only, operator-control, agent-control
- policy state: allowed domains, blocked action reason, pending safety check
- resource links for latest screenshot, milestone captures, and recordings
- browser surface capability: unavailable, snapshot-monitor, frame-stream,
  external-browser, embedded-browser
- transport/host: snapshot-polling, cdp-screencast, electron-webcontents,
  tauri-webview, webrtc, hosted-url
- input capability: none, pointer, keyboard, wheel, drag, text
- input acknowledgement: accepted, blocked, failed, stale-session

The contract should project through gateway/operator events before GUI renders
it. TUI/CLI/SDK should be able to degrade this to text and resource links.

### Browser Surface And Transport

Accepted categories:

- snapshot monitor for artifact-backed observability and replay degradation
- local Playwright/Chromium CDP screencast as a frame-stream fallback
- native embedded browser host after `03` selects and proves it
- remote provider live URL or WebRTC stream represented as a sensitive
  resource link plus lifecycle metadata

The GUI should consume a stable gateway contract rather than provider-specific
SDKs. Provider-specific URLs should be wrapped by runtime policy so surfaces
do not learn more authority than needed.

### Input Broker

Operator input must flow through the same authority boundary as agent browser
actions:

1. GUI captures pointer, keyboard, wheel, drag, and text events only while the
   current browser session ownership is `operator`.
2. GUI normalizes events to viewport-relative coordinates and typed input
   intents.
3. Gateway validates the frame shape and active session id.
4. Runtime provider validates ownership, allowed domains, session state,
   viewport dimensions, and coordinate bounds.
5. Provider dispatches through CDP or the provider-native control channel.
6. Provider returns an acknowledgement or blocked/failed reason.
7. Runtime emits a lightweight audit event and captures milestone screenshots
   on takeover, release, navigation, failure, and explicit operator request.

The transcript should not persist every mouse move. It should persist control
state transitions, input batch summaries, fresh observations, and recording or
trace links. This keeps evidence useful without turning replay into an
unbounded stream log.

### Takeover And Lock Semantics

The operator should not compete with the model for browser control. Required
states:

- `agent-control`: model actions may execute, operator can observe
- `handoff-requested`: model/runtime stopped for sensitive or blocked action
- `operator-control`: model actions are paused, operator owns input
- `returning-to-agent`: operator released control, runtime captures fresh
  observation before the model resumes
- `released`: session ended, live stream unavailable, artifacts remain

Transitions must be auditable and should carry operator id, reason, timestamp,
and resulting observation artifact.

### Security

Live browser work must fail closed when:

- no browser provider is configured
- no stream transport is configured but a live stream is requested
- domain policy blocks the active URL or action
- a live URL/token cannot be scoped safely
- the model reports prompt injection or suspicious page instructions
- an operator-control lock is active

Live view URLs, stream tokens, recordings, cookies, and profile identifiers are
secrets. They belong in resource metadata and privileged inspector surfaces, not
normal transcript text.

## Recommended Next Slice

The 2026-05-13 slices implemented contract frames, snapshot-monitor projection,
GUI viewport-frame rendering, brokered click/wheel/text/key input, gateway
acknowledgements, sidecar input parity, local CDP screencast transport,
CDP-backed raw key down/up dispatch, and sanitized operator evidence.

The browser-foundation work has been absorbed into canonical architecture and
guide documentation. The next completion work is now split:

1. Execute `02`: decide and prove the native browser host, including any
   ADR-006 amendment.
2. Execute `03`: build and prove the real embedded browser operator surface.
3. Keep `04` as the broader native high-density operator surface experiment.
