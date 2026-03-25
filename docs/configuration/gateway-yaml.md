# Gateway YAML Reference

`gateway.yaml` configures the persistent Gateway process that hosts multiple Apps on a single port. The Gateway is the production deployment unit.

Source: `packages/core/src/engine/gateway/gateway-config.ts`, `packages/runtime/src/gateway/gateway-server.ts`

---

## Full Example

```yaml
port: 4800

apps:
  - name: my-app
    config: ./apps/my-app.yaml
    workspace: /workspaces/my-app
    channels:
      - type: api
        path: /api/my-app
        apiKeyEnv: MY_APP_API_KEY
      - type: web
        multiTenant: true
        adminTokenEnv: MY_APP_ADMIN_TOKEN
        allowedOrigins:
          - https://myapp.com
          - https://app.myapp.com

  - name: assistant-ai
    config: ./apps/assistant-ai.yaml
    channels:
      - type: api
        path: /api/assistant
        apiKeyEnv: ASSISTANT_API_KEY
      - type: whatsapp
        phoneNumber: "+521234567890"
        appSecretEnv: META_APP_SECRET

  - name: ops-ai
    config: ./apps/ops-ai.yaml
    channels:
      - type: slack
        botToken: xoxb-...
      - type: api
        path: /api/ops
        apiKeyEnv: OPS_API_KEY

  - name: social-ai
    config: ./apps/social-ai.yaml
    channels:
      - type: instagram
        appSecretEnv: META_APP_SECRET
        verifyTokenEnv: META_VERIFY_TOKEN
      - type: messenger
        appSecretEnv: META_APP_SECRET
        verifyTokenEnv: META_VERIFY_TOKEN

  - name: support-ai
    config: ./apps/support-ai.yaml
    channels:
      - type: email
        appSecretEnv: EMAIL_WEBHOOK_SECRET
```

---

## Field Reference

### Top-Level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `port` | `number` | No | TCP port (1–65535). Defaults to `4800`. |
| `apps` | `GatewayAppBinding[]` | Yes | List of Apps to host. At least one required. |
| `auth` | `GatewayAuthConfig` | No | Gateway-level JWT authentication for API and admin routes. |
| `mcp` | `GatewayMcpConfig` | No | Gateway-level MCP server configuration. |

### GatewayAppBinding

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique App identifier. Used for memory namespacing. Must be unique across all Apps in the file. |
| `config` | `string` | Yes | Path to the App YAML file, relative to the `gateway.yaml` directory. |
| `workspace` | `string` | No | Filesystem path for the App's git workspace. Mode A only. |
| `channels` | `GatewayChannelBinding[]` | Yes | Channel bindings for this App. At least one required. |

### GatewayChannelBinding

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | Channel adapter type: `api`, `web`, `whatsapp`, `instagram`, `messenger`, `slack`, `email`, `cli`. |
| `path` | `string` | No | URL path prefix for `api` channel bindings. Must be unique across all Apps. |
| `phoneNumber` | `string` | No | E.164 phone number for `whatsapp` bindings. Must be unique across all Apps. |
| `botToken` | `string` | No | Bot User OAuth Token for `slack` bindings (format: `xoxb-...`). |
| `multiTenant` | `boolean` | No | Enable multi-tenant mode for `web` channel. Uses `ws-tenant-routes` with widgetId-based routing. |
| `verifyTokenEnv` | `string` | No | Env var for WhatsApp webhook verification token. |
| `adminTokenEnv` | `string` | No | Env var for Bearer token protecting admin routes (tenant CRUD). |
| `accessTokenEnv` | `string` | No | Env var for WhatsApp Business API access token. |
| `apiKeyEnv` | `string` | No | Env var for API key protecting REST endpoints. Applied as `X-Api-Key` header middleware. |
| `appSecretEnv` | `string` | No | Env var for Meta App Secret (WhatsApp, Instagram, Messenger) or email webhook signing secret. Used to verify HMAC-SHA256 on incoming webhooks. |
| `instagramPageId` | `string` | No | Instagram Page ID for `instagram` bindings. Used for tenant resolution. |
| `messengerPageId` | `string` | No | Facebook Page ID for `messenger` bindings. Used for tenant resolution. |
| `emailAddress` | `string` | No | Inbound email address for `email` bindings. Used for tenant resolution (case-insensitive). |
| `allowedOrigins` | `string[]` | No | Allowed origins for WebSocket connections. Localhost/127.0.0.1 always allowed. Empty = open. |

Validation enforces: port in range, unique App names, unique API paths, unique phone numbers. Errors are aggregated and reported before the server starts.

---

## Authentication

Each channel type has one natural authentication mechanism configured via YAML. The gateway resolves environment variables at startup and applies middleware automatically.

| Channel | Auth Mechanism | Config Field | Header / Param |
|---------|---------------|--------------|----------------|
| CLI | None (local) | — | — |
| REST API | API key | `apiKeyEnv` | `X-Api-Key` header |
| WebSocket widget | Origin validation | `allowedOrigins` (channel + tenant) | `Origin` header |
| WebSocket Mode B | API key | `apiKeyEnv` | `?apiKey=` query param |
| WhatsApp | HMAC-SHA256 | `appSecretEnv` | `X-Hub-Signature-256` header |
| Instagram | HMAC-SHA256 | `appSecretEnv` | `X-Hub-Signature-256` header |
| Messenger | HMAC-SHA256 | `appSecretEnv` | `X-Hub-Signature-256` header |
| Slack | HMAC-SHA256 | Built into `SlackChannel.verifyRequest()` | `X-Slack-Signature` header |
| Email | HMAC-SHA256 | `appSecretEnv` | Webhook signature header |
| Admin | Bearer token | `adminTokenEnv` | `Authorization: Bearer <token>` header |

**Two-level auth for WebSocket widgets:** Channel-level `allowedOrigins` provides the default. Per-tenant `TenantConfig.allowedOrigins` overrides the default when set. Localhost and 127.0.0.1 (any port) are always allowed regardless of configuration.

**Startup warnings.** The gateway logs warnings for missing auth configuration:
- WhatsApp channel without `appSecretEnv` — webhook signatures will not be verified
- Instagram channel without `appSecretEnv` — webhook signatures will not be verified
- Messenger channel without `appSecretEnv` — webhook signatures will not be verified
- Email channel without `appSecretEnv` — webhook signatures will not be verified
- API channel without `apiKeyEnv` — endpoints are unauthenticated
- Multi-tenant app without `adminTokenEnv` — admin routes are unauthenticated

**Graceful degradation.** All auth fields are optional. When omitted, the channel runs unauthenticated. This allows incremental adoption and frictionless local development.

---

## Gateway-Level JWT Auth

Use the top-level `auth` block to require JWTs on gateway API and admin routes.

```yaml
auth:
  algorithm: RS256
  jwksUri: $GATEWAY_JWKS_URI
  issuer: https://auth.myapp.com
  audience: kiln-gateway
```

`jwksUri` accepts either a literal URL or a value starting with `$`, which is resolved from the environment at startup. If the referenced env var is missing or empty, gateway validation fails before startup completes.

For HS256, use `secretEnv` instead:

```yaml
auth:
  algorithm: HS256
  secretEnv: GATEWAY_JWT_SECRET
```

---

## Mode A vs Mode B

Both modes can coexist in the same Gateway process on different Apps.

### Mode A — Claude Code Sessions

Mode A apps omit the `runtime` field or set `runtime: claude-code`. They require an API key, use phase-gated workflows, and run one session per task.

The `workspace` field in the App binding sets the filesystem path for the session's git workspace.

### Mode B — Provider-Adapter Sessions

Mode B apps declare `runtime: provider-adapter` in their `app.yaml`, along with a `provider` block and an optional `billing` block. They support concurrent multi-user sessions with no phase machine.

```yaml
# Inside app.yaml (not gateway.yaml)
runtime: provider-adapter

provider:
  name: anthropic
  model: claude-haiku-4-5
  apiKeyEnv: ANTHROPIC_API_KEY

billing:
  budgetEndpoint: https://api.example.com/billing/budget?tenantId={userId}
  usageEndpoint: https://api.example.com/billing/usage
  overBudgetMessage: "You have reached your monthly limit."
  headers:
    X-Gateway-Secret: $MY_GATEWAY_SECRET
  tiers:
    free:
      agents: [fast]
    pro:
      agents: [fast, coding]
    premium:
      agents: [fast, coding, reasoning]
```

Supported providers: `anthropic`, `openai`, `deepseek`, `openrouter`, `ollama`. The `apiKeyEnv` field names the environment variable holding the key. Ollama requires no key. OpenRouter also reads `OPENROUTER_APP_URL` and `OPENROUTER_APP_NAME` for attribution headers.

---

## Mode B Details

### Session Lifecycle

Sessions are keyed by `{appName}:{userId}`. Each user has one session per App.

| Property | Description |
|----------|-------------|
| `id` | `{appName}:{userId}:{timestamp}` |
| `lastActivityAt` | Updated on every message. |
| `isExpired` | `true` when `now - lastActivityAt > 30 minutes`. |

Expired sessions are recreated rather than resumed. In-flight requests dropped on shutdown are not recovered.

### Billing Configuration

| Field | Type | Description |
|-------|------|-------------|
| `budgetEndpoint` | `string` | GET URL. `{userId}` is interpolated to the tenant ID at request time. Must return `{ "allowed": boolean, "remaining": number, "unit": string, "reason"?: string }`. |
| `usageEndpoint` | `string` | POST URL (no interpolation). Receives `{ "tenantId": string, "messages": number, "tokens": number, "model": string }`. |
| `overBudgetMessage` | `string` | Returned to the user when `allowed` is `false`. |
| `headers` | `Record<string, string>` | Optional headers sent on both budget and usage requests. Values starting with `$` are resolved from environment variables (e.g., `$MY_SECRET`). |
| `tiers` | `Record<string, BillingTier>` | Optional tier-to-agents mapping. |
| `tiers.<name>.agents` | `string[]` | Agent tiers allowed for this plan (e.g., `["fast", "coding"]`). |

### Budget Enforcement

Three functions implement budget control, all fail-open. Auth headers from `billing.headers` are sent on every request.

**`checkBudget(billing, tenantId)`** — Sends a GET to `budgetEndpoint` (with `{userId}` interpolated to the tenant ID). If the response has `allowed: false`, skips the LLM call and returns `overBudgetMessage`. On network error or non-2xx response, returns `{ allowed: true }` and proceeds.

**`reportUsage(billing, usage)`** — Sends a POST to `usageEndpoint` after each LLM call with `{ tenantId, messages, tokens, model }`. Fire-and-forget: errors are silently swallowed. Usage reporting never blocks the response path.

**`checkTier(billing, userPlan, requestedTier)`** — Synchronous. Verifies the requested agent tier is in `billing.tiers[userPlan].agents`. Returns `{ allowed: true }` for any unknown plan (fail-open).

Budget enforcement runs on all channels: REST API (`/message`), WebSocket, and WhatsApp webhooks.

---

## API Routes

All routes are served from the single Gateway process on the configured port.

### Health & Observability

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Returns status of all loaded Apps and their channel types. |
| `GET` | `/metrics` | Prometheus text exposition format. Counters (messages, tool calls, errors, routing decisions) and histograms (latency, tokens). Available when `PrometheusCollector` is configured as an EventStore sink. |

```json
{
  "status": "ok",
  "apps": [
    { "name": "my-app", "status": "ok", "channels": ["api", "web"] }
  ]
}
```

### Mode B App Routes

Mounted at the `path` declared in the App's `api` channel binding.

| Method | Path | Request Body | Response Body |
|--------|------|--------------|---------------|
| `POST` | `/{path}/message` | `{ message, userId, plan? }` or `{ parts, userId }` | `{ content, parts, inputTokens, outputTokens, sessionId }` |
| `GET` | `/{path}/sessions` | — | `{ sessions: [...] }` |
| `DELETE` | `/{path}/sessions/:userId` | — | `{ removed: boolean }` |

When budget is exhausted, `POST /message` returns `{ content: "...", budgetExhausted: true }` without calling the provider. When tier is restricted, it returns `{ content: "...", tierRestricted: true }`.

### Delegation Internal Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/_internal/delegation/delegate` | Execute a cross-App delegation. |
| `GET` | `/_internal/delegation/delegation-targets` | List Apps registered as delegation targets. |

### Memory Routes (all modes)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/memory/:scope` | Memory entries for a scope. Accepts `q` and `tags` query params. |
| `POST` | `/api/memory` | Create a memory entry. Returns `{ id }`. |
| `DELETE` | `/api/memory/:id` | Delete a memory entry by ID. |

### Enrichment Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/{path}/enrichment` | List enrichments with cursor pagination. Query params: `cursor`, `limit`. |
| `GET` | `/{path}/enrichment/:sessionId` | Get enrichment by session ID. |
| `DELETE` | `/{path}/enrichment/:sessionId` | Delete enrichment record (GDPR). |

### Dev Routes (devMode only)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dev/state` | App state summary. |
| `GET` | `/dev/events` | SSE event stream. |
| `GET` | `/dev/memory/:scope` | Memory entries for a scope (mirrors `/api/memory/:scope`). |
| `POST` | `/dev/memory` | Write a memory entry (mirrors `/api/memory`). |
| `DELETE` | `/dev/memory/:id` | Delete a memory entry (mirrors `/api/memory/:id`). |
| `GET` | `/dev/cost` | Cost summary. |
| `GET` | `/dev/apps` | Loaded App list. |
| `GET` | `/dev/triggers` | Trigger registry state. |
| `GET` | `/dev/app-graph` | App topology for Studio graph view. |
| `GET` | `/dev/yaml` | Raw YAML content. |
| `PUT` | `/dev/yaml` | Write and hot-reload YAML. |
| `GET` | `/dev/safety` | Safety pipeline metrics. |
| `POST` | `/dev/approve` | Approve a pending phase gate. |
| `POST` | `/dev/reject` | Reject a pending phase gate. |

### Channel Webhook Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/whatsapp/{appName}/webhook` | WhatsApp webhook verification (Meta challenge-response). |
| `POST` | `/whatsapp/{appName}/webhook` | WhatsApp inbound messages. |
| `GET` | `/instagram/{appName}/webhook` | Instagram webhook verification (Meta challenge-response). |
| `POST` | `/instagram/{appName}/webhook` | Instagram DM inbound messages. |
| `GET` | `/messenger/{appName}/webhook` | Messenger webhook verification (Meta challenge-response). |
| `POST` | `/messenger/{appName}/webhook` | Messenger inbound messages. |
| `POST` | `/email/{appName}/webhook` | Email inbound webhook (provider-agnostic). |

All three Meta channels (WhatsApp, Instagram, Messenger) share the same verification flow: GET requests return `hub.challenge` when `hub.verify_token` matches `verifyTokenEnv`. POST requests verify `X-Hub-Signature-256` HMAC-SHA256 when `appSecretEnv` is configured.

### WebSocket Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/apps/:appName/ws` | WebSocket upgrade for Apps with a `web` channel binding. Supports `?token=` (dev mode) or `?apiKey=` (production) query param for auth. |

---

## Deployment Topologies

### Local Development

```
Developer machine
  kiln dev [--playground]
    localhost:4800 -> Gateway (devMode: true)
      /studio/         -> Kiln Studio SPA
      /dev/events      -> SSE event stream
    ~/.kiln/           -> user + agent memory
    {projectDir}/.kiln/ -> project memory
    YamlWatcher        -> hot-reload on file changes
```

Single-user, single-project. `--playground` opens Studio in the browser.

### VPS (Production)

```
VPS (e.g., DigitalOcean + Coolify)
  kiln-gateway (single port)
    App: my-app       -> /workspaces/project/ (git workspace)
    App: assistant-ai -> provider adapter (no workspace)
    App: ops-ai       -> provider adapter (no workspace)
  Reverse proxy (Caddy)
    /api/my-app    -> Gateway App: my-app
    /api/assistant -> Gateway App: assistant-ai
    /webhooks/*    -> trigger webhook endpoints
```

24/7 availability. Multiple Apps, one process, one port. Memory on a persistent data volume.

### CI / Headless

```
Hardened VM (GitHub Actions or similar)
  kiln run --api-key $ANTHROPIC_API_KEY
    No GUI, results saved to git, exits on completion
```

For automated PR reviews, regression testing, and scheduled analysis.

---

## Cost Reference

### Per-Tier Pricing

| Tier | Model | Input ($/M tokens) | Output ($/M tokens) | Cache Read ($/M tokens) |
|------|-------|---------------------|----------------------|------------------------|
| `reasoning` | Opus 4.6 | $15 | $75 | $1.50 |
| `coding` | Sonnet 4.6 | $3 | $15 | $0.30 |
| `fast` | Haiku 4.5 | $0.80 | $4 | $0.08 |

### Typical Mode A Session (Phase-Gated Task)

| Phase | Agent Tier | Approx. Cost |
|-------|-----------|--------------|
| Analyze | fast | $0.01 |
| Research | fast | $0.02 |
| Architect | reasoning | $0.30 |
| Implement | coding x2 | $0.40 |
| Verify | fast | $0.05 |
| Synthesize | fast | $0.02 |
| **Total** | | **~$0.80** |

With prompt cache hits (static prefix cached after first turn), the implementation phase cost drops approximately 70%. A warm-cache session typically costs $0.25–$0.50.

### Typical Mode B Conversation

A single turn with `fast` tier costs approximately $0.001. A full multi-turn session (10–15 turns, `reasoning` tier) costs approximately $0.10–$0.20.

---

## Session & Handoff

Mode B apps support human handoff -- transitioning a conversation from AI to a human operator and back. Configuration is set in the app's `app.yaml`, not `gateway.yaml`.

### SessionMode State Machine

Sessions have a `sessionMode` that governs how messages are processed:

```
ai_active ──→ queued ──→ human_active ──→ ai_active
    │             │            │
    │             └────────────┴──→ resolved
    └──→ resolved ──→ ai_active (auto-reopen on new user message)
```

| Mode | Behavior |
|------|----------|
| `ai_active` | AI processes messages normally (default) |
| `queued` | Messages are stored in session history but AI does not respond; `queued: true` is returned |
| `human_active` | A human operator is handling the conversation via the handoff API |
| `resolved` | Conversation is closed; auto-reopens to `ai_active` on the next user message |

Invalid transitions (e.g., `ai_active` → `resolved`) throw `INVALID_SESSION_TRANSITION`.

### Session Store

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `redis.url` | `string` | — | Optional Redis URL for session persistence. When omitted, sessions are stored in-memory (lost on restart). |

The `SessionStore` interface supports pluggable backends:

| Method | Description |
|--------|-------------|
| `get(key)` | Retrieve a session by key (deserializes from JSON for non-reference stores) |
| `set(key, session)` | Store a session (serializes to JSON for non-reference stores) |
| `delete(key)` | Remove a session by key |
| `deleteByPrefix(prefix)` | Remove all sessions matching a key prefix (used by `invalidateByTenant`) |
| `keys()` | List all stored session keys |

Two implementations ship: `InMemorySessionStore` (default, Map-based) and `RedisSessionStore` (dynamic `ioredis` import, TTL, key prefix).

### Optimistic Concurrency

Each `ModeBSession` tracks a `version` counter that increments on every mutation (addUserMessage, addAssistantMessage, setSessionMode, injectOperatorMessage). When saving via `SessionRegistry.save()`, the stored version is compared to the session's `loadedVersion`. A mismatch throws `CONCURRENT_SESSION_MODIFICATION` (retryable). This prevents lost updates when two requests modify the same session concurrently (critical for Redis-backed stores where each `get()` returns a new deserialized object).

### Escalation Detection

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `escalation.keywords` | `string[]` | Built-in EN/ES keywords | Custom keywords that trigger escalation (e.g., `["help", "agent", "human"]`). |
| `escalation.loopThreshold` | `number` | `0.85` | Word-overlap similarity threshold for detecting conversational loops. Range 0.0--1.0. |

Escalation detection runs after every AI response. When triggered, an `ESCALATION_DETECTED` conversation event is emitted with the reason and a context summary. The session transitions to `queued` mode automatically.

### Handoff API Routes

When a multi-tenant web or WhatsApp channel is configured, handoff routes are mounted under the app's path. All routes require Bearer authentication via `adminTokenEnv`. A startup warning is logged if no `adminToken` is configured.

#### POST /{path}/handoff

Transition session to `queued` or `human_active`.

**Request:**
```json
{
  "tenantId": "string",
  "userId": "string",
  "targetMode": "queued" | "human_active",
  "operatorId": "string (optional)",
  "reason": "string (optional)"
}
```

**Response (200):**
```json
{
  "success": true,
  "sessionId": "string",
  "previousMode": "ai_active",
  "newMode": "queued"
}
```

**Errors:** 400 (missing fields), 404 (session not found), 409 (invalid transition or concurrent modification).

#### POST /{path}/release

Release session back to `ai_active`. Optionally inject a context summary as a user message.

**Request:**
```json
{
  "tenantId": "string",
  "userId": "string",
  "contextSummary": "string (optional)"
}
```

**Response (200):**
```json
{
  "success": true,
  "sessionId": "string",
  "previousMode": "human_active",
  "newMode": "ai_active"
}
```

#### POST /{path}/operator-message

Send a human-authored message to the end user. Injects the message into session history as an assistant message and delivers via the specified channel.

**Request:**
```json
{
  "tenantId": "string",
  "userId": "string",
  "message": "string",
  "channel": "whatsapp" | "web",
  "operatorId": "string (optional)"
}
```

**Response (200):**
```json
{ "success": true, "delivered": true }
```

**Errors:** 409 (session in `ai_active` or `resolved` mode), 422 (missing WhatsApp credentials), 502 (WhatsApp delivery failed).

#### GET /{path}/session-history

Retrieve the full conversation history for a session.

**Query params:** `tenantId`, `userId` (both required).

**Response (200):**
```json
{
  "sessionId": "string",
  "mode": "ai_active",
  "messageCount": 12,
  "history": [{ "role": "user", "parts": [...] }, ...],
  "createdAt": "ISO8601",
  "lastActivityAt": "ISO8601"
}
```

### Handoff Conversation Events

The following conversation events are emitted during handoff workflows (delivered via the `conversationEventEmitter` webhook):

| Event Type | Emitted When |
|------------|-------------|
| `HANDOFF_INITIATED` | Session transitions to queued/human_active via handoff API |
| `HANDOFF_RELEASED` | Session released back to ai_active via release API |
| `OPERATOR_MESSAGE_SENT` | Operator message delivered to end user |
| `HANDOFF_MESSAGE_QUEUED` | User message received while session is in queued/human_active mode |
| `ESCALATION_DETECTED` | Escalation detector triggers (keywords or loop detection) |
| `SESSION_EXPIRED` | Session cleaned up due to idle timeout |
| `TOOL_CALLED` | A tool was invoked by the LLM |
| `TOOL_EXECUTED` | A tool execution completed |

**Tool event payload fields:**

| Field | Type | Included In |
|-------|------|-------------|
| `toolName` | string | TOOL_CALLED, TOOL_EXECUTED |
| `toolInput` | object | TOOL_CALLED (parameters, truncated) |
| `durationMs` | number | TOOL_EXECUTED (execution duration in milliseconds) |
| `success` | boolean | TOOL_EXECUTED (whether execution succeeded) |
| `resultSummary` | string | TOOL_EXECUTED (brief result summary, max 200 chars) |

---

## Startup and Shutdown

**Startup order:**
1. Parse and validate `gateway.yaml`. Throw `GatewayLoaderError` on invalid config.
2. Load all App YAML files via `resolveApps()`. Assign memory paths (`~/.kiln/gateway/{appName}/`).
3. Resolve auth environment variables from config (`auth.jwksUri` when prefixed with `$`, plus channel fields such as `apiKeyEnv`, `appSecretEnv`, `adminTokenEnv`, and `accessTokenEnv`).
4. Instantiate `ChannelRegistry` per App.
5. Initialize `ModeBOrchestrator` for each Mode B App. The `model` field from each App's provider config is passed to `OrchestratorDeps` for accurate cost tracking. If `model` is omitted, a warning is logged and costs default to $0.
6. Build `DelegationRegistry` from all Mode B Apps.
7. Initialize `SafetyPipeline` for each App with a `safety` block.
8. Log auth warnings for channels missing auth configuration.
9. Mount all Hono routes with auth middleware: health, per-App routes, trigger webhooks, delegation internal.
10. Call `Bun.serve()`. Exit with code 1 on `EADDRINUSE`.
11. Register `TriggerRegistry` lifecycle (event listeners, cron schedulers).

**Shutdown:** SIGINT or SIGTERM calls `server.stop(true)` to drain in-flight requests. In-flight Mode B requests without a provider response are dropped. No session state persists across restarts.
