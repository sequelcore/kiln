# Roadmap 06 Browser Session Lifecycle Plan

Objective: add an operator-frame surface for browser session lifecycle updates
after the browser session state projection slice. This lets future stream
transport code publish browser session state changes without coupling lifecycle
updates to tool-result snapshot frames.

Non-goals:
- Do not implement continuous viewport streaming.
- Do not add operator takeover controls in this slice.
- Do not introduce a provider-specific remote browser SDK.
- Do not remove `interactive_use_updated` compatibility.

Surface map:
- `packages/gateway-contracts/src/frames.ts` owns GUI inbound frame shapes and
  now exports `GuiBrowserSessionState`.
- `packages/gui/src/lib/ws-client.ts` validates inbound operator WebSocket
  frames before the App shell dispatches them.
- `packages/gui/src/lib/session-store.ts` owns browser session projection state
  for live and replayed sessions.
- `packages/gui/src/components/app-shell.tsx` dispatches inbound frames into
  session-store actions.
- `packages/gui/src/components/operator-surface-tabs.tsx` already renders the
  Browser tab from `GuiBrowserSessionState`.

Implementation slices:
1. Gateway contract: add `GuiBrowserSessionUpdatedFrame` with
   `type: "browser_session_updated"` and `browserSession`.
2. GUI validation: accept `browser_session_updated` frames through the local
   zod inbound-frame schema.
3. GUI state: add an `onBrowserSessionUpdated` store action that applies
   session-scoped browser state and clears stale state when ownership is
   `released` or stream status is `ended`.
4. App shell: dispatch the new frame to the store.

Test-first sequence:
1. Add failing gateway-contract frame tests for `browser_session_updated`.
2. Add failing GUI WebSocket validation tests for `browser_session_updated`.
3. Add failing GUI session-store tests for live stream lifecycle updates and
   session-scoped filtering.
4. Extend App shell dispatch tests only if existing frame-dispatch coverage
   misses the new branch.

Verification gates:
- `bun test packages/gateway-contracts/tests/browser-session-state.test.ts`
- `bun run --filter @kilnai/gui test -- tests/session-store.test.ts tests/ws-client.test.ts tests/operator-surface-tabs.test.tsx`
- `bun run typecheck`
- `bun run --filter @kilnai/gui build`

Residual risks:
- This slice only adds the lifecycle frame and GUI state handling; no runtime
  provider emits real stream lifecycle data yet.
- Stream URLs and tokens remain intentionally absent from the public state
  shape until a sensitive-resource policy is implemented.
