# Changelog

## v0.24.5 (2026-04-03) -- TUI as Default CLI (7f)

### CLI Entry Point
- The default `kiln` command now launches the interactive TUI if `process.stdout.isTTY` is true.
- If called in a non-interactive context (like CI or piped output), it falls back to the previous default (`devCommand`).

## v0.24.4 (2026-04-03) -- TUI Routing Indicator (7e)

### Routing label in chat
- Each assistant response now shows `[opencode · opencode-o3]` (provider + model if known) or `[opencode]` if no model.
- **Bug fix:** label was using `ctx.provider` (startup arg) — stale after `/provider` switch. Now uses `ctx.state.currentProvider`.

### Sidebar provider display
- Consolidated all `sidebarProviderText` updates into `renderSidebarProvider(state, theme, ui, domain)`.
- Format: `[opencode] sequel/kiln · opencode-o3  via user` (route mode badge).
- `routeMode: "user" | "auto"` added to `ReactiveState` — defaults to `"user"`. Future automatic routing (Phase 7.5) will set `"auto"`.
- `closeProviderPicker` now sets `routeMode: "user"` explicitly on every manual provider switch.

## v0.24.2 (2026-04-03) -- TUI Event Pipeline Fixes

### `/provider` command
- Fixed `/provider` command being sent to the AI as a plain message instead of opening the provider picker.
- Root cause: `TextareaRenderable.onSubmit` guard was missing `/provider` — it correctly skipped `/clear` and `/theme` but passed `/provider` through to `sendMessage`. Added to guard.

### Tool event routing
- `activity` frames for `tool_use` and `tool_result` were silently dropped — `handleActivity` only routed `cost_update`.
- Removed the dead `case "tool_use"` / `case "tool_result"` branches from `sendMessage` (these event types are never emitted by the gateway; all mid-turn events arrive as `activity` frames).
- `handleActivity` now routes: `tool_use` → `handleToolUse`, `tool_result` → `handleToolResult`, `cost_update` → `handleCostUpdate`.

### Status bar race condition
- Command bar could remain stuck on `⟳ executing: …` after a turn completed when `tool_result` activity frames arrived from the WS after the `done` frame.
- Added `if (ctx.state.status !== "running") return` guard at the top of `handleActivity` to discard late-arriving frames.

### Token count pipeline
- Token count always showed `0` despite the gateway forwarding `inputTokens`/`outputTokens` in `cost_update` activity frames.
- Three-part fix: (1) added `inputTokens?`/`outputTokens?` to `SessionEventInternal` activity variant in `types.ts`; (2) `gateway-session.ts` now forwards the fields from the WS frame into the session event; (3) `sendMessage` passes `event.inputTokens`/`event.outputTokens` to `handleActivity` instead of hardcoded `undefined`.

## v0.24.1 (2026-04-03) -- TUI Real-Time Visibility

### Activity Bar Integration
- Moved live activity display from separate bar to command bar status area.
- Command bar now shows: spinner + phase icon + phase name + tool name + details.
- Phase icons: ⚡planning, ⟳executing, 🤔reasoning, 💬responding.
- Details truncated at 40 chars to prevent overflow.

### Sidebar Tool Counter
- Fixed duplicate tool entries in sidebar — now shows single line with call count.
- Format: "⟳ write" (single call) or "⟳ write ×3" (multiple calls).
- `toolCallCounts` added to ReactiveState, tracked in handleToolUse.

### Input Fix
- Fixed Enter key handling: input now clears AND submits correctly.
- Removed duplicate Enter handling from keypress handler (left only in TextareaRenderable.onSubmit).
- Textarea now clears via `inputTextarea.clear()` + state update.

### Extended Theme System
- Expanded from 5 to 12 built-in themes: kiln-dark, dracula, catppuccin-mocha, nord, tokyo-night, gruvbox-dark, rose-pine, kanagawa-wave, everforest-dark, ayu-dark, one-dark, night-owl.
- All themes in `packages/tui/src/theme.ts`.

## v0.24.0 (2026-04-02) -- Kiln TUI v2

### TUI Native Session Persistence
- `IKilnSession`: added `providerSessionId: string | undefined` — unified provider-native session ID across all three backends (replaces split `remoteSessionId`/`threadId` on SessionRecord).
- `SessionRecord` in `wrapper/session-store.ts`: replaced `remoteSessionId` + `threadId` with single `providerSessionId` field.
- `SessionStore`: added `clearLast(provider?: string): Promise<void>` — rewrites JSONL without last matching record.
- `ClaudeSession`, `CodexSession`, `OpenCodeSession`: all implement `providerSessionId` getter.
- OpenCode resume: fixed broken `--attach` path; now uses `client.session.get({ sessionID })` for crash-resilient restart.
- `makeResumableSessionFactory` in `tui.ts`: async factory with closure state + disk persistence; reads last session on startup, persists on dispose.

### TUI Keyboard + Input Fixes
- Printable characters now route to input BEFORE scroll handler — fixes vim keys (`hjkl`) being swallowed.
- Control characters (`cp < 32` or `cp === 127`) excluded from input — fixes Enter and Backspace being appended as text.
- Ctrl+V paste: cross-platform clipboard read (`powershell Get-Clipboard` on Windows, `pbpaste` on macOS, `xclip` on Linux).

### /clear Command
- TUI detects `/clear` input and calls `session.clear()` on the GatewaySession.
- WS protocol: `{ type: "clear" }` frame sent to gateway; gateway calls `onClear()` and replies `{ type: "cleared" }`.
- `TuiGateway` accepts optional `onClear?: () => Promise<void>` callback; clears session store on receipt.

### opencode-style Layout
- Two-column layout: `chatArea` (flex-grow) + 1px `dividerBar` + `sidebar` (width=42).
- Sidebar shows: provider, cumulative cost, working directory, turn count, last tool used.
- Status dot on input line: `●` green=idle, yellow=running, red=error.
- Sidebar auto-collapses when terminal width < 100 columns.
- Removed: header box, bottom status bar.

### Theme Token System
- New file `packages/tui/src/theme.ts`: `KilnTheme` interface (15 semantic color tokens), 5 built-in themes.
- Built-in themes: `kiln-dark` (default), `dracula`, `catppuccin-mocha`, `nord`, `tokyo-night`.
- All hardcoded hex colors in `app.tsx` replaced with `theme.*` token references.
- `--theme <name>` CLI flag on `kiln tui` command.
- `packages/tui/src/index.ts`: exports all themes, `defaultTheme`, `type KilnTheme`.

### Testing
- 4,594 tests passing (up from 4,469), zero typecheck errors.
- New test files: `tui-session-persistence.test.ts`, `session-store-clear.test.ts`, `tui-gateway-clear.test.ts`, extended `opencode-session.test.ts`.
- Fixed stale `codex-session.test.ts`: reasoning items now assert `isThinking: true` (not silently dropped).

## v0.23.2 (2026-03-26) -- MCP OAuth Discovery: Add authorization_endpoint

### Bug Fix

- **`authorization_endpoint` added to OAuth metadata**: Claude Code validates the `/.well-known/oauth-authorization-server` response against RFC 8414 schema and requires `authorization_endpoint`. Also added `code_challenge_methods_supported: ["S256"]` (PKCE) and `"code"` to `response_types_supported` — foundation for future PKCE flow. (`runtime/src/gateway/gateway-routes.ts`)

## v0.23.1 (2026-03-26) -- MCP OAuth Discovery Fix

### Bug Fix

- **OAuth discovery endpoints**: Added `GET /.well-known/oauth-authorization-server` (RFC 8414) and `GET /.well-known/oauth-protected-resource` (RFC 9728) to the gateway routes. Claude Code and other MCP HTTP clients unconditionally hit these endpoints before connecting — without them, the gateway returned 404 which crashed the client's JSON parser with "HTTP 404: Invalid OAuth error response". Both endpoints are registered only when `mcp.enabled: true` and return valid metadata JSON derived from the request origin. No OAuth token issuance — metadata only. (`runtime/src/gateway/gateway-routes.ts`)

## v0.23.0 (2026-03-26) -- MCP Phase 3: Cross-Agent Memory, Swarm Primitives, LLM Eval Scorers

### MCP Phase 3: 25 Tools Total (8 new)

Three workstreams extending the MCP tool surface for external CLI agent orchestration:

**WS1 — Cross-Agent Memory (4 tools, extended)**
- `cross_agent_memory_recall` / `cross_agent_memory_store`: now require `teamId` for proper namespace scoping. Memory stored on `"project"` layer with `_team:<teamId>` tag injection.
- `cross_agent_memory_list`: new tool — list all entries for a team with optional key prefix filter.
- `cross_agent_memory_delete`: new tool — delete a specific key from a team's shared memory (ownership-checked).

**WS2 — Swarm Primitives (6 new tools)**
- `swarm_join`: Join a named agent swarm, returns current membership list.
- `swarm_leave`: Leave a swarm and release all held claims.
- `swarm_status`: Get current members and active resource claims for a swarm.
- `swarm_broadcast`: Broadcast a message to all agents in a swarm (stored, not pushed).
- `swarm_claim`: Optimistic lock on a named resource within a swarm.
- `swarm_release`: Release a previously claimed resource (ownership-checked).
- **`SwarmStore`** (`runtime/src/mcp/swarm-store.ts`): `SqliteMemoryStore`-backed swarm state using tag conventions `_swarm:<swarmId>`, `_member:<agentId>`, `_claim:<resourceId>`, `_broadcast`.

**WS3 — LLM-Based Eval Scorers**
- `eval_score` extended: now accepts `context` (passages for faithfulness/context-relevance) and `scorerOptions` (per-scorer config).
- `evalScoreLlm` dep: routes 12 LLM-as-judge scorer names through `ProviderScorerLlmBridge` inline class.
- `LLM_SCORER_NAMES` set splits scorer requests between rule-based and LLM paths. If no scorers specified, only rule-based runs (avoids unexpected LLM costs).
- `GatewayMcpEvalConfig` (`core/src/engine/gateway/mcp-config.ts`): new type for judge LLM config (`provider`, `model?`, `apiKeyEnv?`). Parsed from `gateway.yaml` `mcp.eval` block.

**Test coverage:** 80 MCP tests (70 gateway-mcp-server + 10 swarm-store), all passing.

## v0.22.0 (2026-03-25) -- Full MCP Tool Wiring

### MCP Phase 2: All 17 Tools Now Wired

The gateway MCP server (introduced in v0.21.0) exposed 17 tool schemas but only 7 were wired to concrete gateway infrastructure. This release wires the remaining 8 dep callbacks:

- **`integration_list`**: Lists all registered integration adapters via `IntegrationRegistry.all()`.
- **`integration_execute`**: Per-tenant credential resolution + adapter execution via `IntegrationExecutor`.
- **`routing_test`**: Dry-run tenant message routing with per-rule regex diagnostics via `DefaultTenantRouter`.
- **`eval_score`**: Score input/output pairs using 5 rule-based scorers (ExactMatch, JsonValidity, Effort, RoutingAccuracy, ToolCallingAccuracy). No LLM dependency.
- **`enrichment_get`**: Retrieve enrichment data for a completed session from `SqliteEnrichmentStore`.
- **`enrichment_list`**: Paginated enrichment listing by tenant via `SqliteEnrichmentStore.listByTenant()`.
- **`budget_check`**: Fail-open budget verification via `checkBudget()` from budget middleware.
- **`budget_report`**: Fire-and-forget usage reporting via `reportUsage()` from budget middleware.

**Infrastructure changes:**
- `tenant-tool-factory.ts`: Added `getIntegrationDeps()` read-only accessor for MCP server wiring.
- `gateway-server.ts`: Wired all 8 dep closures over `loadedApps`, `IntegrationRegistry`, `SqliteEnrichmentStore`, and `budget-middleware`. Added `textParts` static import.

## v0.21.2 (2026-03-25) -- Dev Inspector + SSE Keepalive

### Bug Fixes

- **Dev Inspector**: Fix `SyntaxError: Unexpected string` at line 162 in the inline dev inspector (`/dev/`). The `onclick` handlers for timeline span detail toggle had broken quote escaping inside the template literal — `\'` was rendered as bare `'` in the HTML, breaking the JavaScript. Fixed by using `\\'` in the template literal so the served HTML contains proper `\'` escapes. (`runtime/src/gateway/dev-inspector.ts:166-168`)
- **SSE idle timeout**: Fix dev inspector showing "Disconnected" immediately after connecting. Bun.serve's default `idleTimeout` (10s) was closing the SSE stream before any events arrived. Set `idleTimeout: 255` (uWebSockets uint8 max) on `Bun.serve()` and added a 30-second keepalive heartbeat (`:keepalive` SSE comment) to the `/dev/events` stream. WebSocket connections are unaffected — they use a separate `idleTimeout` in the WebSocket handler. (`runtime/src/gateway/gateway-server.ts:1185`, `runtime/src/gateway/dev-routes.ts:55-62`)

## v0.21.0 (2026-03-24) -- Gateway MCP Server

### MCP Tool Surface for External Agents

- **`GatewayMcpConfig`** (`core/src/engine/gateway/mcp-config.ts`): New domain type for gateway-level MCP server configuration. Fields: `enabled`, optional `path` (default `/mcp`), optional `auth` (`api-key` with `keyEnv`, or `none`). Exported from `@kilnai/core`.
- **`mcp` block in `gateway.yaml`**: Top-level optional config. Parsed and validated by `parseGatewayYaml` with the same error accumulation pattern as `auth` and `observability`.
- **`GatewayMcpServer`** (`runtime/src/mcp/gateway-mcp-server.ts`): MCP server exposing 17 gateway tools via Streamable HTTP. Uses the low-level `Server` class with raw JSON Schema (no Zod dependency). Stateless per-request: fresh Server+Transport pair per request (MCP Streamable HTTP spec). `enableJsonResponse: true` for direct JSON responses. Dynamic `import("@modelcontextprotocol/sdk")` — optional peer dep, fail-open at startup.
- **17 MCP tools**: `memory_recall`, `memory_store`, `memory_delete`, `knowledge_search`, `knowledge_sources`, `cost_summary`, `safety_metrics`, `integration_list`, `integration_execute`, `routing_test`, `eval_score`, `enrichment_get`, `enrichment_list`, `cross_agent_memory_recall`, `cross_agent_memory_store`, `budget_check`, `budget_report`.
- **`GatewayMcpDeps`** (`runtime/src/mcp/gateway-mcp-types.ts`): Dependency injection interface decoupling tool handlers from concrete gateway wiring.
- **Gateway wiring**: `startGateway()` initializes `GatewayMcpServer` when `mcp.enabled: true`. Mounts on configurable path via `honoApp.all()`. Resolves API key from env var. Cleanup on shutdown.
- **`@modelcontextprotocol/sdk`**: Added as optional peer dependency to `@kilnai/runtime` (`^1.12.0`).

**Config example:**

```yaml
mcp:
  enabled: true
  path: /mcp
  auth:
    type: api-key
    keyEnv: MCP_API_KEY
```

## v0.20.0 (2026-03-14) -- Gateway JWT Auth (RS256 + HS256)

### Zero-Trust Inter-Service Authentication

- **`GatewayAuthConfig`** (`core/src/engine/gateway/auth-config.ts`): New domain type for gateway-level JWT authentication. Supports `algorithm: RS256` (JWKS) or `HS256` (shared secret). Optional `issuer` and `audience` claim validation. Exported from `@kilnai/core`.
- **`auth` block in `gateway.yaml`**: Top-level optional config. RS256 requires `jwksUri`; HS256 requires `secretEnv` (env var name). Parsed and validated by `parseGatewayYaml` with the same error accumulation pattern as `observability`.
- **`buildJwtVerifier()`** (`runtime/src/gateway/jwt-verifier.ts`): Builds a `JwtVerifyFn` from `GatewayAuthConfig`. RS256 uses `jose createRemoteJWKSet` (cached, auto-refreshing on key rotation). HS256 resolves the secret from `process.env` once at startup — fails fast if the env var is missing. Dynamic `import("jose")` so the library is only loaded when JWT auth is configured.
- **`requireJwt(verify)`** (`runtime/src/gateway/auth-middleware.ts`): New composable middleware. Extracts Bearer token from `Authorization` header, verifies via `JwtVerifyFn`, attaches decoded payload to `c.set("jwtPayload", payload)`. Returns 401 with no error detail leakage on failure.
- **`GatewayServerConfig.jwtVerifier`**: New optional field. When set, `createGatewayApp` applies `requireJwt` to all API channels (`/path/*`), admin routes (`/admin/:name/*`), outbound routes (`/outbound/:name/*`), handoff routes (`/handoff/:name/*`), and memory routes (`/api/memory/*`). Webhook channels (WhatsApp, Instagram, Messenger, Email) retain their HMAC-SHA256 auth unchanged. Health endpoint is always public.
- **`startGateway` wiring**: JWT verifier built once at startup after `parseGatewayYaml`. Startup log confirms the active mode. Auth warning suppressed for API channels when gateway-level JWT is configured.
- **Backward compatible**: No `auth` block → zero behavior change. Existing `apiKeyEnv` deployments continue working exactly as before.
- **`jose` dependency**: Added to `@kilnai/runtime` dependencies.

**Config examples:**

```yaml
# RS256 -- verify tokens issued by any Vigil-based service (e.g. SHRAD)
auth:
  algorithm: RS256
  jwksUri: "https://auth.myapp.com/.well-known/jwks.json"
  issuer: "https://auth.myapp.com"
  audience: "kiln-gateway"

# HS256 -- shared secret (same as Vigil HS256 mode)
auth:
  algorithm: HS256
  secretEnv: GATEWAY_JWT_SECRET
```

## v0.19.0 (2026-03-11) -- RAG Grounding Tier 2 (Post-Generation Rail)

### Hallucination Prevention: Post-Generation LLM Judge

- **`GroundingRail`**: Stateless post-generation judge in `core/src/safety/grounding-rail.ts`. Accepts the agent response and retrieved knowledge chunks, calls an LLM judge that returns `{ grounded, confidence, ungroundedClaims }` as structured JSON output.
- **`groundingMode: "verified"`**: New third mode extending `"off" | "strict" | "verified"`. When set, the pipeline runs the grounding rail after agent response generation. Ungrounded responses are replaced with a safe fallback message; grounded responses are passed through unchanged.
- **Model selection via `ModelCapabilityRegistry`**: The judge uses the cheapest available model with `supportsStructuredOutput`. No hardcoded provider — uses the same registry infrastructure as model routing.
- **Fail-open design**: Network errors, LLM timeouts, or JSON parse failures do not block the response. The original response is passed through with a trace warning.
- **`grounding_evaluated` event**: New `GroundingEvaluatedEvent` emitted to `EventBus` on every judge call with `grounded`, `confidence`, `ungroundedClaims`, `durationMs`, and `model`.
- **`GROUNDING_BLOCKED` conversation event**: Emitted to the product webhook when a response is replaced. Includes `confidence`, `ungroundedClaims`, and `model`.
- **Pipeline wiring**: `processInboundMessage()` in `message-pipeline.ts` accepts `groundingDeps` (rail, providerPool, modelRegistry, eventBus). `InboundMessageResult` now includes `groundingResult?: GroundingResult`.
- **`MUTABLE_TENANT_FIELDS`**: `groundingMode` was already mutable (added in v0.17.0). No admin API changes needed.
- Covered by `core/tests/safety/grounding-rail.test.ts` (unit) and `runtime/tests/gateway/message-pipeline-grounding.test.ts` (pipeline integration).

## v0.18.0 (2026-03-10) -- OpenRouter Provider Adapter

### OpenRouter Free-Tier Model Access
- **`OpenRouterAdapter`**: extends `OpenAICompatAdapter` for OpenRouter's OpenAI-compatible API (`https://openrouter.ai/api/v1`).
- **`buildHeaders()` extension point**: new `protected` method on `OpenAICompatAdapter` for provider-specific headers. OpenRouter overrides to add `HTTP-Referer` and `X-Title` attribution headers.
- **7 free models** in `MODEL_CATALOG` and `ModelCapabilityRegistry`: Nemotron 3 Nano 30B (default), Step 3.5 Flash, Trinity Large Preview, Llama 3.3 70B, Gemma 3 27B, Qwen3 Coder 480B, Mistral Small 3.1 24B.
- **Gateway wiring**: `case "openrouter"` in `createProviderFromConfig()`. Reads `OPENROUTER_APP_URL` and `OPENROUTER_APP_NAME` env vars for attribution.
- Zero new dependencies — uses raw `fetch` via inherited `OpenAICompatAdapter`.
- All free models support tool calling and streaming. Gemma 3 27B also supports vision.

## v0.17.0 (2026-03-10) -- RAG Grounding Tier 1 + Integration CapabilityAnnotations

### Hallucination Prevention: System Prompt Grounding Directive
- **`groundingMode`** field on `TenantConfig`: `"off"` (default) or `"strict"`.
- When `strict` and knowledge context exists, a grounding directive is appended after the recalled memory section, instructing the model to answer only from provided context, never fabricate data, and offer human escalation when the answer is not in context.
- Wired across all 6 channel handlers: WebSocket, WhatsApp, Instagram, Messenger, Email, and the shared message pipeline (Mode B REST + tenant routes).
- `groundingMode` added to `MUTABLE_TENANT_FIELDS` for admin API updates.
- Zero cost, zero latency — pure system prompt addition.

### Integration CapabilityAnnotations (Phase 3)
- `IntegrationRegistry.getCapabilities()`: surfaces `CapabilityAnnotations` (readOnly, destructive, idempotent, cacheTtl) from adapter operations as `Capability` objects.
- `TenantToolContext.capabilities`: populated from integration operations with annotations in `buildTenantToolContext()`.
- `PerCallToolConfig.perCallCapabilities`: new field carries per-tenant capabilities to the orchestrator.
- `ModeBOrchestrator.resolveCapability()`: merges dep-level (MCP/app) and per-call (integration) capabilities. Dep-level takes precedence.
- Integration tools now participate in tool authorization, cache TTL, retry/fallback, and audit logging — same as MCP and app-defined tools.

## v0.16.0 (2026-03-10) -- Zero-Trust Agent Tool Access

### Agent Tool Scoping: Explicit Opt-In
- **BREAKING:** `TenantAgentConfig.tools` now uses zero-trust semantics:
  - `tools` omitted or `tools: []` → agent gets **no tools** (previously: all tools)
  - `tools: ["*"]` → agent gets all available tools (new wildcard)
  - `tools: ["google_calendar_create_event", ...]` → agent gets only listed tools (unchanged)
- Affects `buildAgentToolContext()` in `runtime/src/tenant/agent-resolver.ts`. The no-agents path (single-agent without `TenantAgentConfig`) is unchanged — tenant-level `tools` field still controls the allowlist.
- **Migration:** Tenants with agents that had `tools: []` (meaning "all") must update to `tools: ["*"]`.

## v0.15.2 (2026-03-10) -- Integration Credential Resolution Fix

### Integration Runtime: Credential Key Mismatch
- **Fix:** `buildTenantToolContext()` now passes `integration.provider` (not `integration.credentialKey`) to `IntegrationExecutor`. Previously, after `TenantRegistry.hydrateSecrets()` replaced `[encrypted]` with the raw token, the executor would use the token as a SecretStore lookup key — which never matched. Now the credential resolver correctly looks up `tenant:{id}:integration:{provider}`.
- **Startup logging:** Gateway logs registered adapter count and provider names on startup (e.g., `Integrations: 3 adapter(s) registered (google_calendar, stripe, google_sheets)`).

## v0.15.1 (2026-03-10) -- AesSecretStore Bug Fixes

### AesSecretStore: Directory Creation + Atomic Writes
- **`mkdirSync` in constructor**: Creates parent directories on initialization. Fixes ENOENT crash in Docker containers where `.kiln/` doesn't exist on first tenant credential write.
- **Atomic `persist()`**: All writes (`set()`, `delete()`) now use tmp+rename pattern (same as `rotateKey()` already did). Prevents corrupted store file if process crashes mid-write.
- **`rotateKey()` deduplicated**: Now delegates to `persist()` instead of duplicating the atomic write logic.

## v0.15.0 (2026-03-09) -- Gateway Integration Wiring

### StartGatewayOptions: Integration & Secret Store Support
- **`integrations` option**: Pass `IntegrationAdapter[]` to `startGateway()` — adapters are registered in an `IntegrationRegistry` and wired into `buildTenantToolContext()` via `configureIntegrationDeps()`.
- **`secretKeyEnv` option**: Env var name for AES-256-GCM master key. Creates `AesSecretStore` and passes it to all `TenantRegistry` instances — enables encrypted credential storage for channel tokens, webhook secrets, and integration credentials.
- **TenantRegistry now receives SecretStore**: Multi-tenant apps automatically encrypt/hydrate sensitive fields (WhatsApp tokens, integration credentials, webhook secrets) when a secret key is configured.
- Zero breaking changes. Both options are optional. Existing gateways without `secretKeyEnv` behave identically to before.

## v0.14.0 (2026-03-09) -- Integration Runtime

### Integration Runtime (Phase 1: Core Interfaces + Runtime Wiring)
- **IntegrationAdapter interface**: Domain interface in `core/engine/domain/integration.ts` — provider, version, operations, execute(). CredentialResolver and ResolvedCredential for credential delegation.
- **IntegrationRegistry**: Adapter registry with `register()`, `get()`, `has()`, `resolveOperation()`, `getToolDefinitions()`. Tool naming: `{provider}_{operation}` with `["integration", provider]` tags.
- **IntegrationExecutor**: Per-tenant adapter execution with credential resolution via CredentialResolver, 30s timeout via AbortSignal, KilnError wrapping for adapter/credential failures.
- **LocalCredentialResolver**: SecretStore-backed credential resolution. JSON-structured credentials (type, value, headers) or plain string as bearer token. Key pattern: `tenant:{tenantId}:integration:{credentialKey}`.
- **TenantConfig.integrations[]**: Per-tenant integration config (provider, credentialKey, operations filter, config). Validation: unique providers, non-empty fields, operations sub-array.
- **Wired via buildTenantToolContext()**: Module-level `configureIntegrationDeps()`/`clearIntegrationDeps()` — zero changes to channel handlers, orchestrator, or message pipeline.
- **Credential encryption**: TenantRegistry encrypts/hydrates/deletes integration credentials alongside webhook tool secrets.
- **Admin API**: `integrations` added to MUTABLE_TENANT_FIELDS.
- **3 new error codes**: `INTEGRATION_TOOL_FAILED`, `INTEGRATION_ADAPTER_NOT_FOUND`, `CREDENTIAL_RESOLVE_FAILED` with context-aware suggestions in error catalog.
- Three tool executor types now operational: WebhookToolExecutor (HTTP POST + HMAC), IntegrationExecutor (adapter registry + credentials), McpClient (external MCP servers).

## v0.13.0 (2026-03-09) -- Widget Markdown Rendering

- **Custom markdown renderer**: Zero-dep markdown renderer in `widget/src/markdown.ts`. Supports bold, italic, inline code, fenced code blocks, ordered/unordered lists, links. Pure DOM API, no innerHTML. 20 dedicated tests.

## v0.12.0 (2026-03-09) -- WhatsApp Coexistence Auto-Handoff

### Coexistence Support
- **smb_message_echoes handling**: When a business owner responds from the WhatsApp Business App (coexistence mode), Kiln auto-transitions the session to `human_active` so the AI agent stops responding.
- **Lazy auto-release**: Configurable `autoReleaseMs` on `TenantConfig.whatsappCoexistence`. When the human has been idle past the timeout and the customer sends a new message, the session auto-transitions back to `ai_active`.
- **HUMAN_TAKEOVER event**: New conversation event type with `handoffSource: "whatsapp_coexistence"` for observability. `HANDOFF_RELEASED` is emitted on auto-release.
- **Session context preservation**: Business messages from the app are injected into session history so the AI has full context when it resumes.
- **WhatsAppCoexistenceConfig**: New `TenantConfig` field (`enabled`, `autoReleaseMs`). Admin API supports `whatsappCoexistence` as mutable field.
- **ModeBSession.lastHumanMessageAt**: New timestamp for tracking human activity, persisted across session serialization.
- Zero breaking changes. All new fields are optional. Existing tenants see no behavioral change.

## v0.11.0 (2026-03-09) -- Eval Benchmarking & Abuse Protection

### Eval Framework (23 scorers + ConsistencyRunner)
- **ConsistencyRunner (pass^k)**: tau-bench pass^k metric. Runs same experiment k times, measures fraction of items passing ALL runs.
- **PolicyAdherenceScorer**: LLM-as-judge for business policy compliance. Config: `policies: string[]`.
- **ContextRelevanceScorer**: LLM-as-judge for RAG retrieval quality (context chunks vs query).
- **ToolTrajectoryScorer**: LLM-as-judge for tool-use sequence efficiency. Reads `metadata.toolCalls`.
- **EffortScorer**: Rule-based, bridges enrichment pipeline's Customer Effort Score into eval. Reads `metadata.effortComponents`.
- **ResolutionScorer**: Rule-based, maps resolution status to score. Reads `metadata.resolution`.
- **EvalInput.metadata**: New optional field forwarded from `DatasetItem.metadata` through `ExperimentRunner`.
- **ToolCallingAccuracyScorer**: Rule-based BFCL-style tool calling accuracy. Compares `metadata.toolCalls` vs `metadata.expectedToolCalls` using F1 (precision + recall).
- **MultiTurnConsistencyScorer**: LLM-as-judge for context retention across conversation turns. Reads `metadata.conversationHistory`.
- **SafetyPreservationScorer**: AgentDojo-inspired dual scorer (safety + utility under adversarial attack). Reads optional `metadata.attackType`.
- **RoutingAccuracyScorer**: Rule-based, compares `metadata.activeAgentId` vs `metadata.expectedAgentId`.
- **HandoffQualityScorer**: LLM-as-judge for context preservation across agent handoffs. Reads `metadata.handoffHistory`.
- **MilestoneScorer**: Rule-based, tracks intermediate checkpoint completion from `metadata.milestones`.
- **Safety adversarial dataset**: 145 test cases covering PII, content, prompt injection, policy rails, and benign controls at `packages/core/evals/safety-adversarial.jsonl`.

### Abuse Protection
- **Per-session token cap**: `TenantConfig.sessionLimits.maxTokens` enforces cumulative token limit per session. Sessions auto-escalate to `human_active` when exceeded.
- **Per-session turn limit**: `TenantConfig.sessionLimits.maxTurns` enforces max user turns per session.
- **Repetitive abuse detection**: `detectRepetitiveAbuse()` catches exact repetition, keyword spam ("continue" loops), and sequential counting attacks. Configurable window size and threshold.
- **SESSION_LIMIT_REACHED event**: New conversation event type with `limitType` (tokens/turns/abuse), `limitValue`, and `limitMax`.
- **Session token tracking**: `ModeBSession.totalTokens` and `ModeBSession.userTurnCount` persisted across session serialization.
- All protections integrated in `processInboundMessage()` pipeline -- applies to all 6 channels automatically.

## v0.10.0 (2026-03-09) -- Visitor Identity & Pre-Chat Form

- **localStorage persistence**: Widget userId now persists across browser sessions via `localStorage` (was `sessionStorage`). Returning visitors get their contact memory recalled automatically.
- **Identify frame**: New `identify` WebSocket frame type enables structured visitor metadata (name, email, phone, custom fields). Gateway sanitizes input (length limits, format validation, zero-width char removal) before use.
- **Pre-chat form**: Tenant-configurable pre-chat form (`TenantConfig.preChatForm`) with up to 10 fields, 3 types (text/email/phone), required/optional per field. Form config delivered via welcome frame. Returning visitors skip the form.
- **displayName on ConversationEvent**: All web channel conversation events now include `displayName` from visitor identity, enabling product backends to associate conversations with named visitors.
- **SDK identify()**: `useKilnWsChat` hook now returns `identify(visitor)` for programmatic visitor identification in React apps.
- **Visitor context injection**: Sanitized visitor info injected into system prompt alongside knowledge and contact memory context.

## v0.9.1 (2026-03-08) -- Cleanup

- **Removed 6 backward compatibility hacks**: ToolResultSanitizer dual-accept, CostTracker `byRole`, 2-segment session keys, session deserialization defaults, span mapper legacy OTel attributes, optional `sessionRegistry`.
- **Documentation consolidation**: Research docs absorbed into formal guides, doc references updated.
- 58 files changed, 419 lines of dead code removed.

## v0.9.0 (2026-03-07) -- Intelligence Layer

- **Multi-model routing**: Per-request model selection via `ModelCapabilityRegistry` (10 models), `ComplexityScorer` (5 signals), and `RulesRouter` (7 condition types). Configurable per-tenant via `TenantModelConfig`.
- **Enrichment pipeline**: Post-conversation analytics with `computeEffortScore()` (rule-based, 0-10 scale) and `LlmConversationEnricher` (sentiment, resolution, CSAT). SQLite-backed `EnrichmentStore` with admin API.
- **Observability**: `PrometheusCollector` (8 counters, 1 histogram at `GET /metrics`), `CompositeEventStore` (fan-out to multiple sinks), `BatchSpanProcessor` for OTel.
- **Cost tracking**: `CostTracker` keyed by `role:model` tuple with `recordEmbedding()` and `recordStt()` support.
- **Event infrastructure**: `SESSION_STARTED`, `CONVERSATION_CLOSED`, `CONVERSATION_ABANDONED`, `MODEL_ROUTED`, `COST_REPORT`, `CONVERSATION_ENRICHED` events. Schema version and trace ID on all events. Conversation event retry with exponential backoff.

## v0.8.0 (2026-03-07) -- Routing Observability

- **Embedding-based routing (Tier 2)**: `AgentRAG` for vector similarity agent selection when no regex matches. `EmbeddingTenantRouter` with 3-tier cascade.
- **Routing templates**: 3 built-in templates (`service-business`, `ecommerce`, `customer-support`).
- **Routing test endpoint**: `POST /tenants/:id/routing/test` for dry-run routing evaluation.
- **Admin API**: `agents` and `routing` added to mutable tenant fields.
- `routingTier` and `routingConfidence` on `AGENT_ROUTED` events.

## v0.7.0 (2026-03-07) -- Agent Handoff

- **Warm handoff briefs**: LLM-generated conversation summary injected on agent switch via `AgentHandoffSummarizer`.
- **Ping-pong guard**: `checkPingPong()` prevents rapid agent switching loops (max handoffs, cooldown, bidirectional pair block).
- **`AGENT_HANDOFF`** conversation event on every agent switch.
- Per-agent cost attribution in `CostTracker`.

## v0.6.0 (2026-03-07) -- Multi-Agent Routing

- **Multi-agent routing**: `TenantConfig.agents[]` + `routing{}` with regex Tier 1.
- **`AgentResolver`**: Single integration point for all 6 channel handlers.
- Session-level `activeAgentId` and `agentTurnHistory` tracking.
- Per-agent tool scoping (intersection of agent tools with tenant allowlist).
- `AGENT_ROUTED` conversation event.

## v0.5.0 (2026-03-07) -- Stabilization

- **Security**: Timing-safe auth via `timingSafeEqual`, indirect injection scanning on tool results, MCP tool description scanning.
- **Knowledge**: `CohereReranker` (Rerank v2, 4x over-fetch), `knowledge_gap` event.
- **Tools**: Tool result caching via `ToolCache` + `cacheTtl` annotation.
- **WebSocket**: Heartbeat (30s ping, 90s timeout).
- **Meta**: `WebhookDedup` for at-least-once delivery protection.
- **PII**: Luhn credit card validation.
- **Testing**: 48 streaming provider tests, 68 adversarial security tests.
- **Coverage**: Vitest coverage config with 80% thresholds.

## v0.4.0 (2026-03-07) -- Multi-Channel

- **Instagram DM**: Graph API v21.0, text + image, 1000 char limit.
- **Messenger**: Graph API v21.0, text + image, 2000 char limit.
- **Email**: Inbound webhook, outbound via Postmark/Resend/Generic, thread tracking (Message-ID chain), loop prevention (RFC 3834).
- **Meta foundation**: Shared `verifyMetaWebhook()` and `validateMetaSignature()` across WhatsApp, Instagram, Messenger.
- 8 total channel adapters (CLI, Web, WhatsApp, Instagram, Messenger, Slack, Email, API).

## v0.3.0 (2026-03-07) -- Tool Use

- **Tool execution loop**: Authorization (4-level annotation-driven), retry/timeout/fallback, result sanitization.
- **ToolRAG**: Embedding-based tool selection for large tool registries.
- **Webhook tools**: `WebhookToolExecutor` with HMAC-SHA256 signing.
- **Rate limiting**: `SlidingWindowRateLimiter` (per-tool, per-tenant).
- **Per-call config**: `PerCallToolConfig` (allowlist, rate limiter, additional tools) via 5th param to `processMessage()`.
- **Conversation events**: `TOOL_EXECUTED` event via `ConversationEventEmitter`.

## v0.2.0 (2026-03-06) -- Knowledge Engine

- **RAG pipeline**: `RetrievalPipeline` with recursive + markdown chunking, contextual enrichment (Anthropic pattern).
- **Vector store**: `PgVectorStore` with PostgreSQL + pgvector (halfvec + HNSW + RRF hybrid search).
- **Embedding**: OpenAI `text-embedding-3-small` (1536d) and Ollama adapters.
- **STT**: OpenAI `gpt-4o-transcribe` and Deepgram `nova-3` adapters with fail-open design.
- **Contact memory**: Per-user fact extraction via LLM (Mem0 ADD/UPDATE/DELETE/NOOP pattern), bi-temporal facts, GDPR deletion.
- **Content extraction**: Local files, URLs (Jina Reader + fallback), PDFs (unpdf).
- **Source management**: `SourceManager` with SHA-256 content deduplication and admin API.

## v0.1.x -- Foundation

- Engine primitives (Agent, Capability, Workflow, Memory, Task, Channel, Trigger) and composites (Team, Router, App).
- YAML loader with full validation and error catalog (73 error codes).
- Orchestrator with phase machine, checkpoint/resume, 3 team modes (sequential, supervisor, swarm).
- 5 provider adapters (Anthropic, OpenAI, DeepSeek, OpenRouter, Ollama).
- MCP client (Streamable HTTP, circuit breaker).
- Memory (SQLite + FTS5, 5 scopes, decay, compaction, git sync).
- Safety pipeline (PII scanner, content classifier, policy rails).
- Security (prompt injection detection, AES-256-GCM secrets, audit log with hash chaining).
- Eval framework (12 scorers, dataset loader, experiment runner, comparator).
- Human handoff (session mode state machine, escalation detection, operator messaging).
- CLI (init wizard, dev mode with hot-reload, gateway command).
- React SDK (`@kilnai/react` hooks).
- Embeddable chat widget (`@kilnai/widget`, Shadow DOM, zero deps).
- Studio dev UI (graph, playground, timeline, memory, eval, cost, safety views).
- Domain kits and skill registry.
- Sandbox (per-agent filesystem + network isolation).
