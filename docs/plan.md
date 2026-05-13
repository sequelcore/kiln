# Roadmap 06 Provider Screenshot Stream Plan

Objective: implement the next Roadmap 06 slice by adding a provider-owned live
browser screenshot stream to the Playwright browser provider. The stream emits
browser session lifecycle state and latest capture resource links without
moving browser authority into GUI code.

Non-goals:
- Do not embed a GUI-owned browser or WebView.
- Do not expose stream URLs, cookies, profile IDs, or provider tokens.
- Do not add operator takeover controls in this slice.
- Do not make live streaming mandatory for all browser sessions.

Surface map:
- `packages/runtime/src/interactive/playwright-browser-use-provider.ts` owns
  Playwright browser sessions, page actions, idle close, and screenshot
  artifact writes.
- `packages/runtime/tests/interactive/playwright-browser-use-provider.test.ts`
  covers provider behavior with fake Playwright pages and fake timers.
- `packages/runtime/src/interactive/playwright-node-sidecar.ts` owns the
  Windows/Bun Node sidecar browser process and must emit the same stream state.
- `packages/core/src/tools/infrastructure/interactive-use-tool.ts` attaches
  the resource-plane artifact sink used by stream captures.
- `packages/runtime/src/gateway/gui-gateway.ts` forwards provider browser
  session updates over the GUI operator WebSocket.
- `packages/gateway-contracts/src/frames.ts` already defines browser stream
  lifecycle state consumed by GUI.

Implementation slices:
1. Add provider options for an optional live stream:
   `liveStream.enabled`, `liveStream.intervalMs`, and
   `onBrowserSessionUpdated`.
2. Emit `starting` when a browser session is created and periodic `live`
   updates with latest screenshot artifact links while the session remains
   active.
3. Stop stream timers on explicit stop, idle close, startup failure, and
   `closeAll`, emitting `ended`/`released` for normal session close.
4. Keep stream capture failures fail-closed for the stream only: emit `failed`
   stream status but do not crash the browser automation session.
5. Carry the same update protocol across the Node sidecar path used by
   Windows/Bun runtime hosts.
6. Wire provider updates into the GUI gateway `browser_session_updated` frame.

Test-first sequence:
1. Add failing provider test proving `starting`, periodic `live`, and `ended`
   updates are emitted with latest capture URIs.
2. Add failing provider test proving stream capture failure emits `failed`
   without throwing from the active session.
3. Add failing core tool test proving live providers receive a resource-plane
   artifact sink.
4. Add failing GUI gateway test proving browser stream updates are forwarded
   during an active GUI turn.

Verification gates:
- `bun test packages/runtime/tests/interactive/playwright-browser-use-provider.test.ts`
- `bun test packages/core/tests/tools/infrastructure/interactive-use-tool.test.ts`
- `bun x vitest run packages/runtime/tests/gateway/gui-gateway.test.ts -t "forwards browser session stream updates"`
- `bun run typecheck`

Residual risks:
- The stream is artifact-backed screenshot polling, not WebRTC or a remote live
  URL transport.
- Operator takeover, pause, and lock controls remain a separate Roadmap 06
  slice because they require explicit ownership and audit transitions.
