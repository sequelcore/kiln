# Interactive Infrastructure -- Pending Work

Status after Phases 1-6 (6 phases).

## 1. ~~Gateway-Hosted Orchestrator~~ (Done -- Phase 4)

Implemented via `DevOrchestrator` in `packages/runtime/src/gateway/dev-orchestrator.ts`. Bridges core `Orchestrator` with `ApprovalGateRegistry` and gateway `EventBus`. Wired to `POST /dev/run` (start), `GET /dev/run` (status), and reflected in `GET /dev/state`. Both `startGateway` (dev mode) and `startDevServer` instantiate a `DevOrchestrator`.

## 2. ~~Studio Playground WebSocket Chat~~ (Done -- Phase 5)

Implemented via `useKilnWsChat` hook in `@kilnai/react` and server-side `processMessage` callback in `ws-routes.ts`. Protocol: `WsChatRequest` (client->server) and `WsChatFrame` (server->client, `done`/`error`/`chunk` types). `chunk` reserved for future streaming. Studio Playground swapped from `useKilnChat` to `useKilnWsChat`. Only wired for Mode B apps -- multi-tenant WS chat deferred until frame protocol carries `tenantId`.

## 3. ~~Identity Resolution for WebSocket~~ (Done -- Phase 6)

Implemented via `DevTokenStore` in `packages/runtime/src/gateway/dev-token-store.ts`. In-memory token store with sliding-window TTL (30 min default). Wired to `POST /dev/token` (issue) and `validateToken` callback in both `startGateway` and `startDevServer`. Production JWT validation remains a consumer responsibility.

## 4. ~~Cost View Auto-Refresh~~ (Done -- Phase 6)

Replaced manual Refresh button with SSE-driven auto-refresh. Cost view subscribes to `cost_update` events via `useKilnEvents` and triggers `refetch()` on each event.

## 5. ~~Studio Safety View~~ (Done -- Phase 6)

New `packages/studio/src/routes/safety.tsx` with per-app metric cards (7 metrics in 3-column grid). Registered in sidebar and app routing. Polls `GET /dev/safety` every 5 seconds. Shows "not configured" when safety pipeline is absent.
