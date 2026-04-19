# ADR-007: TUI Gateway Architecture

**Status:** Accepted (amended 2026-04-09)  
**Date:** 2026-04-02  
**Deciders:** Ricardo Armenta

> **Number corrected 2026-04-17:** originally filed as ADR-002 in conflict with `ADR-002-subprocess-integration.md`. Renumbered to ADR-007 to resolve the duplication. No content changed except the title and this note. Content substantially informs (and is partially superseded by) ADR-006.

## Context

The Kiln TUI (`kiln tui`) needs multi-turn conversation, memory, safety pipeline, MCP tools, knowledge RAG, cost tracking, and multi-provider support. The initial prototype spawns provider sessions directly from the CLI package, bypassing the gateway orchestration layer.

The gateway already provides all of these capabilities through `RuntimeSessionOrchestrator`, `RuntimeSession`, and the WebSocket protocol proven by `@kilnai/widget`. Building a second orchestration path in the CLI would violate DDD bounded context boundaries and duplicate stable, tested code.

### Amendment: Subscription-Backed Execution

The original ADR assumed the gateway would call LLMs via `ProviderAdapter` (direct HTTP API calls with API keys, pay-per-token). However, Kiln's core differentiator is **subscription arbitrage** — routing through flat-rate CLI subscriptions ($20/mo Claude Code, $20/mo Codex, $10/mo OpenCode) via subprocess execution.

The gateway must support **subscription-backed CLI execution** for local developer channels (TUI) rather than assuming API-key adapters for all channels. The execution backend is a runtime concern, not a TUI concern.

## Decision

The TUI will connect to a local Kiln gateway via WebSocket. The TUI becomes a pure rendering layer (OpenTUI) with no orchestration logic. The gateway owns all orchestration, session state, memory, and safety.

For local developer channels (TUI), the gateway uses an injected session-manager-backed execution path. Harness providers still execute through CLI subprocesses where appropriate, while direct providers execute through Kiln's provider-session path. For deployed/web channels (widget, WhatsApp, etc.), the gateway uses API-backed `ProviderAdapter` executors. The execution backend is chosen by the runtime based on channel type.

### Architecture

```
kiln tui (thin client)
  - OpenTUI rendering (Yoga flexbox, styled text)
  - Keyboard input
  - WebSocket connection to local gateway
  - Event-to-renderable mapping

        | WebSocket (widget protocol)

Local Kiln Gateway (auto-started on port 4801)
  - RuntimeSessionOrchestrator (provider routing, tool auth, AI guard)
  - SessionRegistry (multi-turn, persistence, concurrency)
  - Safety pipeline (PII, content, rails)
  - Memory (SQLite, FTS5, decay, compaction)
  - Knowledge RAG (if configured)
  - MCP tools (25 gateway tools)
  - Cost tracking (per-role:model)
  - Enrichment (post-conversation)
        |
  Execution Backend (per-channel)
  ├── Session-manager-backed executor (TUI channel)
  │     wraps harness sessions and direct provider sessions
  │     gateway remains the owner of session continuity and orchestration
  │     harness backends may spawn claude/codex/opencode subprocesses per turn
  └── ApiExecutor (widget/web channels)
        direct HTTP to LLM API
        uses API keys (pay-per-token)
```

### Execution Model

The gateway is the sole owner of interactive continuity:

1. Gateway recalls memory, assembles context, runs input safety
2. Gateway reconstructs full prompt: system prompt + memory + conversation history + user message
3. Gateway invokes the selected backend through the injected session manager
4. Harness backends may spawn a CLI binary in one-shot mode, while direct providers call Kiln adapters directly
5. Gateway runs output safety, stores turn in session history, tracks cost
6. Gateway sends response to TUI over WebSocket

The execution backend does NOT own conversation state for the TUI path. The gateway is the sole owner of session history, memory, and context management. This avoids the "two masters of session state" problem.

### Protocol

TUI-specific WebSocket protocol (not the widget protocol — no widgetId, no tenant, stateless per userId):

**Outbound (TUI → gateway)**
- `{ type: "message", content: string }` — user turn
- `{ type: "clear" }` — reset session; gateway replies `cleared`
- `{ type: "provider", provider: string, model?: string }` — switch provider/model for the next turn; gateway replies `provider_changed`

**Inbound (gateway → TUI)**
- `{ type: "thinking" }` — work started (triggers spinner)
- `{ type: "activity", activity: "tool_use" | "tool_result" | "cost_update", toolName?, output?, usd?, inputTokens?, outputTokens?, input? }` — streamed mid-turn events
- `{ type: "done", content, inputTokens, outputTokens, routedProvider?, routedModel? }` — full response text + token counts + actual execution route
- `{ type: "error", message }` — turn failed
- `{ type: "cleared" }` — session reset acknowledged
- `{ type: "provider_changed", provider }` — provider selection acknowledged for subsequent turns

**Activity routing in TUI (`handleActivity`)**
- `tool_use` → `handleToolUse` (renders `⟳ tool [args]` in chat + sidebar counter)
- `tool_result` → `handleToolResult` (updates tool row with truncated output)
- `cost_update` → `handleCostUpdate` (accumulates cost + tokens; preferred token source for subscription sessions)
- Late-arriving frames (after turn completes) are dropped by a `status !== "running"` guard

**Heartbeat**: ping/pong (30s interval, 90s timeout)  
**Auto-reconnect**: exponential backoff (1s → 30s max)

### Migration Path

- **Phase 1 (historical, v0.23.x)**: Direct provider sessions. Useful as the first prototype. No memory, safety, or MCP.
- **Phase 2 (delivered, Phase 7c / v0.24.2)**: `kiln tui` auto-starts `startTuiGateway()` on port 4801, connects via WS. TUI is now the rendering layer. Gateway owns the pipeline and invokes execution through the injected session manager. Full Kiln pipeline.
- **Phase 3 (partially delivered, Phase 7d-7f / v0.24.3-v0.24.5)**: Budget visibility, routing indicator, and interactive-default CLI entrypoint are now shipped. Remaining future work is remote attach and richer streaming, not the base TUI gateway path.
- **Phase 4 (delivered, 2026-04-09)**: Gateway transport is now the default startup path again, provider/model route labels are derived from actual completion metadata, and execution identity is injected at invocation time so model/provider self-reporting matches the real backend for the turn.

## Consequences

### Positive
- Single orchestration path (gateway) for all clients (widget, TUI, Mode B REST, channels)
- TUI gets memory, safety, knowledge, MCP, cost tracking, enrichment for free
- No duplication of session management, provider routing, or tool authorization
- **Subscription arbitrage preserved** — TUI can still use flat-rate CLI subscriptions when the selected backend is harness-backed
- Multi-turn conversation = RuntimeSession (proven, tested)
- TUI stays thin (~200 lines rendering code)
- Execution backend is a runtime concern — clean DDD boundary

### Negative
- Requires local gateway process (mitigated: in-process `startTuiGateway()`)
- Each turn spawns a subprocess (1-3s latency per spawn)
- No mid-turn MCP tool calls from the subprocess (stateless one-shot mode)
- Gateway must reconstruct full history each turn (same as API calls — not a new cost)
- Done-only frames in Phase 7c (no token-by-token streaming until Phase 7d)

### Neutral
- Direct provider fallback remains useful for `kiln run` and explicit `KILN_TUI_TRANSPORT=direct` debugging
- Widget WsClient can be adapted for TUI package (remove browser-specific code)
- `ProviderAdapter` continues to serve deployed/web channels unchanged

## Key Files

| File | Role | Status |
|------|------|--------|
| `packages/tui/src/app.tsx` | TUI rendering layer (OpenTUI) | ✅ Implemented (v0.24.1) |
| `packages/tui/src/ui.ts` | UI components (layout, input, sidebar) | ✅ Implemented |
| `packages/tui/src/state.ts` | Reactive state management | ✅ Implemented |
| `packages/tui/src/handlers.ts` | Session event handlers | ✅ Implemented |
| `packages/tui/src/render.ts` | Render helpers | ✅ Implemented |
| `packages/tui/src/ws-client.ts` | WebSocket client (adapted from widget) | ✅ Implemented |
| `packages/tui/src/gateway-session.ts` | SessionLike over WS (maps frames to events) | ✅ Implemented |
| `packages/tui/src/theme.ts` | 12 built-in themes | ✅ Implemented |
| `packages/runtime/src/gateway/tui-gateway.ts` | TUI gateway logic (WS handler, RuntimeSessionOrchestrator) | ✅ Implemented |
| `packages/runtime/src/execution/cli-subscription-executor.ts` | CLI subprocess execution | ✅ Implemented |
| `packages/runtime/src/execution/api-executor.ts` | API-backed execution (for web channels) | ✅ Implemented |
| `packages/runtime/src/execution/model-executor.ts` | ModelExecutor interface | ✅ Implemented |
| `packages/runtime/src/gateway/gateway-server.ts` | startTuiGateway() entrypoint | ✅ Existing |
| `packages/runtime/src/session/runtime-session-orchestrator.ts` | Multi-turn orchestration | ✅ Existing |
| `packages/runtime/src/session/runtime-session.ts` | Session persistence | ✅ Existing |
| `packages/widget/src/ws-client.ts` | Reference WS client implementation | ✅ Existing |
