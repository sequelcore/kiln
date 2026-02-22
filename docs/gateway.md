# Gateway

The Gateway is a persistent Bun/Hono process that hosts multiple Apps in a single deployment. One process, one port, multiple Apps — each isolated by memory namespace, channel binding, and agent pool. The Gateway is the production deployment unit: it replaces running individual CLI sessions by hosting all Apps concurrently under a single supervisor.

## Configuration

The Gateway is configured via a `gateway.yaml` file. This file declares the port, the list of Apps to load, and the channel bindings for each App.

### gateway.yaml Format

```yaml
port: 4800

apps:
  - name: my-app
    config: ./apps/my-app.yaml
    workspace: /workspaces/my-app
    channels:
      - type: api
        path: /api/my-app
      - type: web

  - name: assistant-ai
    config: ./apps/assistant-ai.yaml
    channels:
      - type: api
        path: /api/assistant
      - type: whatsapp
        phoneNumber: "+521234567890"

  - name: ops-ai
    config: ./apps/ops-ai.yaml
    channels:
      - type: api
        path: /api/ops
      - type: slack
        botToken: xoxb-...
```

### GatewayConfig Types

| Type | Field | Type | Required | Description |
|------|-------|------|----------|-------------|
| `GatewayConfig` | `port` | `number` | Yes | TCP port (1–65535). Defaults to 4800 if omitted. |
| `GatewayConfig` | `apps` | `GatewayAppBinding[]` | Yes | List of Apps to host. At least one required. |
| `GatewayAppBinding` | `name` | `string` | Yes | Unique App identifier. Used for memory namespacing and routing. |
| `GatewayAppBinding` | `config` | `string` | Yes | Relative path to the App YAML file from the gateway.yaml directory. |
| `GatewayAppBinding` | `workspace` | `string` | No | Filesystem path for the App's git workspace (Mode A only). |
| `GatewayAppBinding` | `channels` | `GatewayChannelBinding[]` | Yes | At least one channel binding. |
| `GatewayChannelBinding` | `type` | `string` | Yes | Channel adapter type: `api`, `web`, `whatsapp`, `slack`, `cli`. |
| `GatewayChannelBinding` | `path` | `string` | No | URL path prefix for `api` channel bindings. Must be unique across all Apps. |
| `GatewayChannelBinding` | `phoneNumber` | `string` | No | Phone number for `whatsapp` bindings. Must be unique across all Apps. |
| `GatewayChannelBinding` | `botToken` | `string` | No | Bot token for `slack` bindings. |

`validateGatewayConfig()` enforces: port in range, non-empty apps array, unique app names, unique API paths, unique phone numbers.

Source: `packages/core/src/engine/gateway/gateway-config.ts`

## App Resolution

On startup, `resolveApps()` processes each `GatewayAppBinding` in order:

1. Resolves `config` as a path relative to the `gateway.yaml` directory.
2. Reads and parses the App YAML via `parseAppYaml()` to produce an `App` composite.
3. Assigns a memory base path: `~/.kiln/gateway/{appName}/`.
4. Attempts to parse Mode B config from the same YAML via `parseModeBConfig()`. Returns `null` for Mode A Apps; this failure is non-fatal.

Each `ResolvedApp` carries:

```typescript
interface ResolvedApp {
  name: string;
  app: App;
  binding: GatewayAppBinding;
  memoryBasePath: string;   // ~/.kiln/gateway/{appName}/
  modeBConfig?: ModeBConfig;
}
```

Memory namespacing means that `agent:architect` in one App and `agent:architect` in another App resolve to different SQLite databases. Two Apps never share a memory backend.

Source: `packages/runtime/src/gateway/app-resolver.ts`

## Runtime Modes

The Gateway supports two runtime modes. Both can coexist in the same process on different Apps.

### Mode A — Claude Code Sessions

Used by Apps that require deep, phase-gated workflows: plan, implement, test, verify.

- Requires an API key (Anthropic or BYOK provider).
- Sessions are created via the Agent SDK `query()` function, which launches a Claude Code subprocess internally.
- Phase machine governs transitions through the configured phase sequence.
- MCP server provides tools over stdio to the session.
- Events stream to the web console via WebSocket.
- One active session per task; not concurrent.

An App YAML declares Mode A by omitting the `runtime` field or setting it to `claude-code`.

### Mode B — Provider-Adapter Sessions

Used by conversational Apps that do not require a phase-gated coding workflow: domain Q&A, evaluations, compliance assistance.

- No Claude Code subprocess. Provider adapters are called directly via `createMessage()`.
- Supports concurrent multi-user sessions via `SessionRegistry`.
- Budget enforcement middleware gates each LLM call.
- No phase machine. Single-turn or multi-turn conversation tracked in `ModeBSession`.

An App YAML declares Mode B with:

```yaml
runtime: provider-adapter

provider:
  name: anthropic
  model: claude-haiku-4-5
  apiKeyEnv: ANTHROPIC_API_KEY

billing:
  budgetEndpoint: https://api.example.com/billing/budget/{userId}
  usageEndpoint: https://api.example.com/billing/usage/{userId}
  overBudgetMessage: "You have reached your monthly limit."
  tiers:
    free:
      agents: [fast]
    pro:
      agents: [fast, coding]
```

Supported providers: `anthropic`, `openai`, `deepseek`, `ollama`. The `apiKeyEnv` field names the environment variable holding the API key. Ollama requires no key.

## Mode B Runtime

### Message Processing Flow

`ModeBOrchestrator.processMessage()` executes the following on each inbound message:

1. Appends the user message to `ModeBSession.conversationHistory`.
2. Builds the system prompt: `session.systemPrompt` + optional `recalledMemory` block.
3. Calls `provider.createMessage()` with the full conversation history.
4. Appends the assistant response to the session history.
5. Returns `OrchestrateResult`: `parts` (readonly ContentPart[]), `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`.

Source: `packages/runtime/src/session/mode-b-orchestrator.ts`

### ModeBSession Lifecycle

Each user gets one session per App. Sessions are keyed by `{appName}:{userId}`.

| Property | Description |
|----------|-------------|
| `id` | `{appName}:{userId}:{timestamp}` |
| `createdAt` | Session creation time. |
| `lastActivityAt` | Updated on every message (`touch()`). |
| `isExpired` | `true` when `now - lastActivityAt > idleTimeoutMs`. |
| `messageCount` | Total messages in conversation history. |
| `conversationHistory` | Ordered `AgentMessage[]` (user + assistant alternating). |

Default idle timeout is 30 minutes. Sessions that have expired are recreated by `getOrCreate()` rather than resumed.

Source: `packages/runtime/src/session/mode-b-session.ts`

### SessionRegistry

`SessionRegistry` manages all Mode B sessions across the Gateway process. A single `SessionRegistry` instance is shared across all Mode B Apps.

| Method | Description |
|--------|-------------|
| `getOrCreate(config)` | Returns existing non-expired session or creates a new one. |
| `get(appName, userId)` | Returns the session if it exists (may be expired). |
| `remove(appName, userId)` | Deletes the session. Returns `true` if it existed. |
| `activeSessions()` | Returns all non-expired sessions. |
| `activeCount()` | Count of non-expired sessions. |
| `cleanup()` | Removes all expired sessions. Returns count removed. |

Source: `packages/runtime/src/session/session-registry.ts`

## Budget Enforcement

Budget middleware runs on every `POST /message` request for Mode B Apps that declare a `billing` block.

### checkBudget(billing, userId)

Sends a `GET` to `billing.budgetEndpoint` with `{userId}` interpolated. The product API must respond with:

```json
{ "remaining": 1000, "unit": "tokens" }
```

If `remaining <= 0`, the LLM call is skipped and the `overBudgetMessage` is returned. The middleware is **fail-open**: any network error or non-2xx response returns `{ allowed: true }`. Users are never blocked by a billing service outage.

### reportUsage(billing, userId, usage)

Sends a `POST` to `billing.usageEndpoint` with `{userId}` interpolated after each LLM call. The body is:

```json
{ "tokens": 1234, "model": "claude-haiku-4-5", "role": "fast" }
```

This call is **fire-and-forget**: errors are silently swallowed. Usage reporting never blocks the response.

### checkTier(billing, userPlan, requestedTier)

Synchronous check. Looks up `billing.tiers[userPlan].agents` and verifies the requested agent tier is in the list. Returns `{ allowed: true }` for any unknown plan (fail-open). Used to block free-tier users from invoking `coding` or `reasoning` agents.

### BillingConfig

```typescript
interface BillingConfig {
  budgetEndpoint: string;    // GET URL, {userId} interpolated
  usageEndpoint: string;     // POST URL, {userId} interpolated
  overBudgetMessage: string; // Returned as response content when budget exhausted
  tiers?: Record<string, BillingTier>;
}

interface BillingTier {
  agents: string[];  // e.g. ["fast"], ["fast", "coding"]
}
```

Source: `packages/runtime/src/gateway/budget-middleware.ts`

## Cross-App Delegation

Delegation is a mechanism for one App's agent to request cognitive work from another App's agent and receive a structured JSON result. It is distinct from API calls: delegation asks for reasoning, not data retrieval.

### AppDelegation Protocol

```typescript
interface AppDelegation {
  fromApp: string;
  toApp: string;
  task: string;
  schema: Record<string, unknown>;  // JSON Schema for expected response
  context?: string;
  priority?: number;                // 0–10, default 5
  timeout?: number;                 // ms, default 120_000
}
```

The `schema` field is a JSON Schema object. The target App's provider must return a JSON response that validates against it. Self-delegation (`fromApp === toApp`) is rejected at validation time.

### DelegationRegistry

At startup, `startGateway()` builds a `DelegationRegistry` from all Mode B Apps:

```typescript
interface DelegationRegistry {
  targets: ReadonlyMap<string, DelegationTarget>;
}

interface DelegationTarget {
  appName: string;
  provider: ProviderAdapter;
  systemPrompt: string;
}
```

Only Mode B Apps (`runtime: provider-adapter`) are eligible as delegation targets. Mode A Apps are not registered.

### executeDelegation() Lifecycle

1. Validates the `AppDelegation` via `validateDelegation()`. Returns `PROVIDER_ERROR` on validation failure.
2. Looks up `toApp` in the registry. Returns `TARGET_APP_NOT_FOUND` (404) if absent.
3. Generates a `delegationId` via `crypto.randomUUID()`.
4. Builds a composite system prompt: target's base system prompt + delegation task + optional context.
5. Races `provider.createMessage()` against the timeout. Returns `TIMEOUT` (408) on expiry.
6. Parses the response body as JSON. Returns `SCHEMA_VALIDATION_FAILED` (422) if parsing fails.
7. Validates the parsed object against `delegation.schema` via `validateResponseSchema()`. Returns `SCHEMA_VALIDATION_FAILED` (422) on mismatch.
8. Returns `AppDelegationResult` on success.

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `TARGET_APP_NOT_FOUND` | 404 | `toApp` is not registered in the delegation registry. |
| `TIMEOUT` | 408 | Provider call did not complete within `timeout` ms (default 120s). |
| `SCHEMA_VALIDATION_FAILED` | 422 | Response is not valid JSON or does not match the declared schema. |
| `TARGET_APP_NOT_READY` | 503 | Target App registered but not available to handle requests. |
| `PROVIDER_ERROR` | 502 | Provider returned an error or delegation request failed validation. |

Delegation sessions do not write to git-synced memory scopes. No workspace access is granted. The delegation is a single reasoning call; no phase machine runs.

Source: `packages/runtime/src/gateway/delegation-handler.ts`, `packages/runtime/src/gateway/delegation-routes.ts`

### A2A Delegation

When `delegationType` is `"a2a"`, `executeDelegation()` routes to `executeA2ADelegation()` instead of the Kiln-native flow. A2A delegation uses the `A2AClient` to communicate with a remote agent via the A2A protocol:

1. Validates that `agentUrl` is present. Returns `TARGET_APP_NOT_FOUND` if missing.
2. Constructs an `A2AMessage` from `a2aMessage` or falls back to wrapping `delegation.task` as a text part.
3. Sends the task via `A2AClient.sendTask()` with the configured timeout.
4. If the remote task completes, extracts the result from the first artifact's first part (data or text).
5. Returns `PROVIDER_ERROR` if the task ends in a non-completed state or returns no extractable data.

A2A delegation does not use the `DelegationRegistry` -- it communicates directly with the remote agent URL.

```typescript
interface ExtendedDelegation extends AppDelegation {
  readonly delegationType?: "a2a";
  readonly agentUrl?: string;
  readonly a2aMessage?: A2AMessage;
}
```

## A2A Protocol (Agent-to-Agent)

Apps with explicit A2A configuration expose A2A-compliant endpoints at `/{appName}/a2a/`.

### Agent Card

Served at `/{appName}/a2a/.well-known/agent.json`. Generated from the App's team capabilities via `generateAgentCard()`.

### JSON-RPC 2.0 Endpoints

All task operations are dispatched via `POST /{appName}/a2a/` with a JSON-RPC 2.0 body.

| Method | Params | Description |
|--------|--------|-------------|
| `tasks/send` | `{ message: A2AMessage }` | Submit a task and receive the completed result synchronously. |
| `tasks/sendSubscribe` | `{ message: A2AMessage }` | Submit a task and stream progress via SSE (task-created, status-update, task-completed/task-failed events). |
| `tasks/get` | `{ id: string }` | Query the status of a previously submitted task. |
| `tasks/cancel` | `{ id: string }` | Cancel a running task. Terminal tasks (completed/failed/canceled) are returned unchanged. |

### A2A Error Codes

| JSON-RPC Code | Constant | Description |
|---------------|----------|-------------|
| `-32600` | `INVALID_REQUEST` | Missing or invalid JSON-RPC envelope. |
| `-32601` | `METHOD_NOT_FOUND` | Unknown method name. |
| `-32602` | `INVALID_PARAMS` | Missing required params (e.g., `message`, `id`). |
| `-32603` | `INTERNAL_ERROR` | Task execution failed internally. |
| `-32001` | `TASK_NOT_FOUND` | No task with the given ID exists. |

### A2A Task Lifecycle

Tasks progress through states: `submitted` -> `working` -> `completed` | `failed` | `canceled`.

The `A2ATaskStore` holds tasks in memory. Terminal tasks can be cleaned up via `cleanExpired(ttlMs)`.

Source: `packages/runtime/src/a2a/a2a-server-routes.ts`, `packages/runtime/src/a2a/a2a-task-store.ts`, `packages/runtime/src/a2a/agent-card-generator.ts`

## API Routes

All routes are served from the single Gateway process on the configured port.

### Gateway-Level Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Returns status of all loaded Apps and their channel types. |

Health response shape:

```json
{
  "status": "ok",
  "apps": [
    { "name": "my-app", "status": "ok", "channels": ["api", "web"] },
    { "name": "assistant-ai", "status": "ok", "channels": ["api", "whatsapp"] }
  ]
}
```

### Mode A App Routes

Apps without a `modeBRuntime` respond with a basic status object:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/{channel.path}/` | Returns `{ app: "{name}", status: "ok" }`. |

### Mode B App Routes

Mounted at the path declared in the App's `api` channel binding.

| Method | Path | Request Body | Response Body | Description |
|--------|------|--------------|---------------|-------------|
| `POST` | `/{path}/message` | `{ message, userId, plan? }` or `{ parts, userId, plan? }` | `{ content, parts, inputTokens, outputTokens, sessionId }` | Send a message. Accepts `message` (string) or `parts` (ContentPart[]). Response includes both `content` (extracted text) and `parts` (full multimodal). |
| `GET` | `/{path}/sessions` | — | `{ sessions: [{ id, userId, messageCount, createdAt, lastActivityAt }] }` | List active sessions for this App. |
| `DELETE` | `/{path}/sessions/:userId` | — | `{ removed: boolean }` | Remove the session for a specific user. |

When budget is exhausted, `POST /message` returns `{ content: "{overBudgetMessage}", parts: [{ type: "text", text: "{overBudgetMessage}" }], budgetExhausted: true }` without calling the provider.

When tier is restricted, `POST /message` returns `{ content: "...", tierRestricted: true }`.

Source: `packages/runtime/src/gateway/mode-b-routes.ts`

### A2A Routes

Mounted at `/{appName}/a2a` when the App has explicit `a2aConfig`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/{appName}/a2a/.well-known/agent.json` | Returns the Agent Card for this App. |
| `POST` | `/{appName}/a2a/` | JSON-RPC 2.0 dispatch: `tasks/send`, `tasks/sendSubscribe`, `tasks/get`, `tasks/cancel`. |

### Delegation Internal Routes

Mounted at `/_internal/delegation` when a delegation registry is available.

| Method | Path | Request Body | Response Body | Description |
|--------|------|--------------|---------------|-------------|
| `POST` | `/_internal/delegation/delegate` | `{ fromApp, toApp, task, schema, context?, priority?, timeout? }` | `AppDelegationResult` or `{ error, code }` | Execute a cross-app delegation. |
| `GET` | `/_internal/delegation/delegation-targets` | — | `{ targets: string[] }` | List App names registered as delegation targets. |

## Per-App Isolation

Each App loaded by the Gateway is isolated in the following ways:

| Resource | Isolation Mechanism |
|----------|---------------------|
| Memory | `~/.kiln/gateway/{appName}/` prefix. Same scope name in different Apps maps to different SQLite databases and JSONL files. |
| Sessions | `SessionRegistry` keys by `{appName}:{userId}`. No session is accessible across Apps. |
| Agents | Each Mode B App has its own `ModeBOrchestrator` and `ProviderAdapter` instance. No shared agent pools. |
| Channel bindings | `ChannelRegistry` is instantiated per App. Incoming messages on one App's channel cannot reach another App. |
| Delegation memory | Delegation sessions write no git-synced memory. No workspace paths are accessible during delegation. |

Cross-App communication is explicit and typed: one App must declare a `type: delegation` capability referencing the target App by name.

## Startup and Shutdown

### startGateway() Flow

1. Reads and parses `gateway.yaml` via `parseGatewayYaml()`. Throws `GatewayLoaderError` on invalid config.
2. Calls `resolveApps()` to load all App YAML files and assign memory paths.
3. Creates a `ChannelRegistry` per App.
4. Initializes `ModeBOrchestrator` and `ModeBAppRuntime` for each Mode B App.
5. Builds a `DelegationRegistry` from all Mode B Apps.
6. Calls `createGatewayApp()` to produce the Hono app with all routes mounted.
7. Mounts static SPA files from `dist/console/` for the web console.
8. Calls `Bun.serve({ port, fetch, websocket })`.
9. If `EADDRINUSE` is thrown, logs the error and exits with code 1.
10. Logs the started port and list of App names.
11. Awaits SIGINT or SIGTERM to call `server.stop(true)`.

Source: `packages/runtime/src/gateway/gateway-server.ts`

### Shutdown

The Gateway registers handlers for `SIGINT` and `SIGTERM`. On either signal:

1. Logs `"Gateway shutting down..."`.
2. Calls `server.stop(true)` to drain in-flight requests before closing.
3. The startup `Promise` resolves and the process exits cleanly.

No session state is persisted across restarts. In-flight Mode B requests that have not yet received a provider response are dropped on shutdown.

## Deployment Topologies

### Local Development

```
Developer machine
  CLI process
    localhost:4800 -> web console
    stdio -> Claude Code session (API key)
    ~/.kiln/ -> user + agent memory
    {projectDir}/.kiln/ -> project memory
```

Single-user, single-project. Memory local. Started with the consumer app CLI.

### VPS Gateway

```
VPS (e.g., DigitalOcean, Coolify-managed)
  kiln-gateway (Hono, single port)
    App: my-app       -> /workspaces/project/ (git clone)
    App: assistant-ai -> provider adapter (no workspace)
    App: ops-ai       -> provider adapter (no workspace)
  Reverse proxy (Caddy)
    /api/my-app    -> Gateway App:my-app
    /api/assistant -> Gateway App:assistant-ai
    /webhooks/*    -> ChannelRouter
```

24/7 availability. Channel webhooks exposed via reverse proxy. Git workspaces for Mode A code access. Memory persisted to a data volume. Multiple Apps served from one deployment.

### CI / Headless

```
Hardened VM (GitHub Actions or similar)
  run "task" --api-key $ANTHROPIC_API_KEY
    No GUI, results saved to git, exits on completion
```

For automated PR reviews, regression testing, and scheduled analysis runs. Uses API key mode.

## Cost Reference

### Per-Tier Pricing

| Tier | Model | Input ($/M tokens) | Output ($/M tokens) | Cache Read ($/M tokens) |
|------|-------|---------------------|----------------------|-------------------------|
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

With prompt cache hits (static prefix cached after first turn), the implementation phase cost drops approximately 70%. A typical warm-cache session costs $0.25-$0.50.

### Typical Mode B Conversation Turn

A single turn with `fast` tier costs approximately $0.001. A full multi-turn session (10-15 turns, `reasoning` tier) costs approximately $0.10-$0.20.
