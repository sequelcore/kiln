# Browser Operator Deferred Split Plan

Objective: keep the browser operator work split into three late ordered tracks
so Kiln does not confuse snapshot monitoring with a real embedded in-app
browser or block nearer foundations:

1. `02-browser-operator-foundations-and-snapshot-monitor.md`: browser operator
   foundations, snapshot monitor, brokered input, and evidence.
2. `03-native-browser-host-decision.md`: native browser host decision and
   proof for the real in-app browser.
3. `04-embedded-browser-operator-surface.md`: real embedded browser
   operator surface.

The active near-term roadmap now starts with
`00.06-multimodal-transport-and-capability-delegation.md`, with
`00.07-agent-qa-showcase-recorder.md` adjacent where it only depends on
governed artifacts, capture evidence, and replay.

The completed baseline keeps runtime/provider authority, artifact-backed
evidence, GUI projection, and operator ownership locks. The 2026-05-13
implementation slices add typed viewport frames, snapshot-monitor projection,
brokered operator input, local Playwright/Chromium CDP screencast as a
frame-stream fallback, and sanitized operator evidence events. These are
foundations, not completion proof for the real embedded browser.

Non-goals for `02`:
- Do not claim snapshot polling or CDP screencast as a real embedded browser.
- Do not embed a GUI-owned browser or WebView before `03` decides the
  native host boundary.
- Do not expose stream URLs, cookies, profile IDs, provider tokens, or live
  view credentials in transcript text.
- Do not make continuous live media mandatory for CLI, TUI, SDK, or replay.
- Do not bypass provider/domain policy for operator input.
- Do not claim CAPTCHA or bot-detection bypass; live control only lets a human
  operate the session when the target site allows it.

Current baseline:
- `packages/runtime/src/interactive/playwright-browser-use-provider.ts` owns
  Playwright browser sessions, screenshot stream polling, takeover/release,
  mutation blocking while ownership is `operator`, brokered operator input, and
  post-release captures.
- `packages/runtime/src/interactive/playwright-node-sidecar.ts` mirrors browser
  session update and operator input protocol for the Windows/Bun sidecar path.
- `packages/runtime/src/gateway/gui-gateway.ts` forwards
  `browser_session_updated`, emits viewport-frame updates from artifact-backed
  browser captures, and routes `browser_session_control` plus
  `browser_operator_input`.
- `packages/gateway-contracts/src/frames.ts` defines browser session state,
  viewport frames, operator input frames, and input acknowledgements.
- `packages/gui/src/components/operator-surface-tabs.tsx` renders snapshot or
  frame-stream viewport frames in the Browser tab, loads artifact-backed frames,
  and sends
  viewport-relative click, wheel, text, and keypress input while ownership is
  `operator`.
- Persisted sessions contain explicit tool calls and resource links. Ephemeral
  stream frames are not enough replay evidence.

Risk hypothesis:
- The current UI can consume CDP-backed frame streams through the same viewport
  contract. Snapshot polling remains the fallback monitor.
- Opening a headed external browser conflicts with the operator transcript and
  should remain a debugging escape hatch, not the primary UX.
- A CDP implementation is Chromium-specific, so the gateway and GUI contracts
  must stay provider-neutral.
- Input events are sensitive authority. Runtime must validate ownership,
  session id, active policy, viewport bounds, and liveness before dispatch.
- Real embedded browser work requires a native host decision first. It should
  not be hidden inside the broad `05-native-operator-surface-experiment.md`.

Implementation slices:
1. Contract: add typed gateway frames for viewport updates, operator input
   intents, and input acknowledgements or failures. **Done.**
2. Runtime boundary: add `BrowserLiveViewportTransport` behind the browser
   provider with transport-neutral state and lifecycle hooks. **Done for
   snapshot polling and local CDP.**
3. Local transport: implement Playwright/Chromium CDP screencast using
   `Page.startScreencast`, frame acknowledgement, and controlled shutdown.
   **Done.**
4. Input broker: route pointer, wheel, keyboard, drag, and text intents through
   gateway into runtime provider, gated by the existing operator lock. **Done
   for click, wheel, text, keypress, and provider/sidecar routing; drag and
   raw key down/up remain with the CDP transport slice.**
5. GUI surface: render a stable snapshot-monitor/frame-stream component that
   maps viewport-relative input and preserves chat visibility. **Done for
   snapshot-polling frames.**
6. Evidence: persist takeover/release, input batch summaries, blocked/failed
   input, fresh observations, and recording or trace references where present.
   **Done for sanitized GUI gateway session events; recording/trace references
   remain provider-adapter work.**
7. Degradation: keep screenshot polling and resource links for replay, CLI,
   TUI, SDK, non-Chromium providers, and disabled live transport.
8. Roadmap split: keep browser foundations, native browser host, and embedded
   browser as `02`, `03`, and `04`, after `00.06`, `00.07`, and `01`.
   **Done.**
9. Embedded browser acceptance: after `03`, add a local proof that opens a
   real embedded browser region inside Kiln, takes control, clicks/types/scrolls,
   releases, and proves the next agent action sees the fresh post-release
   observation. **Moved to `04`.**

Test-first sequence:
1. Add failing gateway-contract tests for viewport, input, and ack frame
   validation.
2. Add failing runtime provider tests for CDP screencast start, frame emit,
   frame ack, stop, and fallback on unsupported provider.
3. Add failing runtime provider tests for operator input accepted only under
   operator ownership and blocked under agent ownership or stale session id.
4. Add failing GUI gateway tests for input frame routing and blocked/failed
   acknowledgement forwarding.
5. Add failing GUI session-store tests for live viewport state and input ack
   state.
6. Add failing GUI component tests for pointer/keyboard/wheel capture only
   while ownership is `operator`.
7. Add failing replay/degradation tests proving persisted evidence does not
   depend on ephemeral live frames.
8. Add one live e2e test for watch, takeover, input, release, and fresh
   observation.

Verification gates:
For the documentary split:
- `git diff --check`
- Roadmap ordering shows `00.06` multimodal first, `00.07` recorder adjacent,
  `01` benchmark, then the late browser/native sequence `02` through `05`.
- `docs/roadmap/README.md` lists `00.06` and `00.07` as active and keeps
  browser/native deferred.
- `docs/research/14-live-browser-operator-surface.md` separates snapshot
  monitor, frame stream, external browser, and embedded browser semantics.

For later implementation work:
- `bun test packages/runtime/tests/interactive/playwright-browser-use-provider.test.ts`
- `bun x vitest run packages/runtime/tests/gateway/gui-gateway.test.ts`
- `bun run --filter @kilnai/gui test -- tests/ws-client.test.ts tests/session-store.test.ts tests/operator-surface-tabs.test.tsx`
- `bun run --filter @kilnai/gui test:e2e`
- `bun run typecheck`

Completion criteria for `02`:
- Browser tab truthfully labels snapshot polling as a monitor, not as a real
  live browser.
- Browser tab can show snapshot-monitor or frame-stream viewport frames for an
  active browser session.
- `Take control` enables brokered click/type/scroll/key input through runtime
  authority.
- Agent browser mutations fail closed while operator owns the session.
- `Release` captures a fresh observation before agent actions resume.
- Session replay keeps useful browser evidence without storing every live
  frame.
- `03` and `04` own the real embedded browser path, and `05` owns the broad
  native operator-surface experiment.
