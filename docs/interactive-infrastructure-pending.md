# Interactive Infrastructure -- Pending Work

Status after Phases 1-4 (4 phases, ~2100 lines, 2573 tests).

## 1. ~~Gateway-Hosted Orchestrator~~ (Done -- Phase 4)

Implemented via `DevOrchestrator` in `packages/runtime/src/gateway/dev-orchestrator.ts`. Bridges core `Orchestrator` with `ApprovalGateRegistry` and gateway `EventBus`. Wired to `POST /dev/run` (start), `GET /dev/run` (status), and reflected in `GET /dev/state`. Both `startGateway` (dev mode) and `startDevServer` instantiate a `DevOrchestrator`.

## 2. Studio Playground WebSocket Chat (High)

Playground uses `useKilnChat` which does HTTP POST to `/apps/{appName}/message`. The WebSocket route at `/apps/:appName/ws` exists with session scoping but Studio doesn't connect to it. For real-time streaming responses, Playground should use WebSocket instead of request-response.

**Approach:** Create a `useKilnWsChat` hook in `@kilnai/react` that opens a WebSocket, sends messages as JSON frames, and receives streamed responses. Or enhance `useKilnChat` to support both modes.

**Key files:** `packages/sdk/src/use-kiln-chat.ts`, `packages/studio/src/routes/playground.tsx`, `packages/runtime/src/gateway/ws-routes.ts`.

## 3. Identity Resolution for WebSocket (Low)

`validateToken` callback is plumbed through `WsRoutesConfig` -> `GatewayServerConfig` but no default implementation exists. Consumers must provide their own validator. Could ship a built-in JWT validator or session token store.

**Key files:** `packages/runtime/src/gateway/ws-routes.ts` (`validateToken` in `WsRoutesConfig`).

## 4. Cost View Auto-Refresh (Low)

Studio Cost view has a manual Refresh button. Could auto-refresh by polling or subscribing to `cost_update` SSE events via `useKilnEvents`.

**Key files:** `packages/studio/src/routes/cost.tsx`.

## 5. Studio Safety View (Low)

Safety metrics are wired to `GET /dev/safety` and return per-app pipeline counters (scans, blocks, PII detections, content classifications, policy evaluations). No Studio view exists for this data.

**Approach:** New route `packages/studio/src/routes/safety.tsx` with per-app metric cards. Register in sidebar.

**Key files:** `packages/core/src/safety/safety-pipeline.ts` (SafetyMetrics), `packages/runtime/src/gateway/gateway-server.ts` (getSafetyMetrics wiring), `packages/studio/src/app.tsx`, `packages/studio/src/components/sidebar.tsx`.
