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
      - type: slack
        botToken: xoxb-...
      - type: api
        path: /api/ops
```

---

## Field Reference

### Top-Level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `port` | `number` | No | TCP port (1–65535). Defaults to `4800`. |
| `apps` | `GatewayAppBinding[]` | Yes | List of Apps to host. At least one required. |

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
| `type` | `string` | Yes | Channel adapter type: `api`, `web`, `whatsapp`, `slack`, `cli`. |
| `path` | `string` | No | URL path prefix for `api` channel bindings. Must be unique across all Apps. |
| `phoneNumber` | `string` | No | E.164 phone number for `whatsapp` bindings. Must be unique across all Apps. |
| `botToken` | `string` | No | Bot User OAuth Token for `slack` bindings (format: `xoxb-...`). |

Validation enforces: port in range, unique App names, unique API paths, unique phone numbers. Errors are aggregated and reported before the server starts.

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
  budgetEndpoint: https://api.example.com/billing/budget/{userId}
  usageEndpoint: https://api.example.com/billing/usage/{userId}
  overBudgetMessage: "You have reached your monthly limit."
  tiers:
    free:
      agents: [fast]
    pro:
      agents: [fast, coding]
    premium:
      agents: [fast, coding, reasoning]
```

Supported providers: `anthropic`, `openai`, `deepseek`, `ollama`. The `apiKeyEnv` field names the environment variable holding the key. Ollama requires no key.

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
| `budgetEndpoint` | `string` | GET URL. `{userId}` is interpolated at request time. Must return `{ "remaining": number, "unit": string }`. |
| `usageEndpoint` | `string` | POST URL. `{userId}` interpolated. Receives `{ "tokens": number, "model": string, "role": string }`. |
| `overBudgetMessage` | `string` | Returned to the user when `remaining <= 0`. |
| `tiers` | `Record<string, BillingTier>` | Optional tier-to-agents mapping. |
| `tiers.<name>.agents` | `string[]` | Agent tiers allowed for this plan (e.g., `["fast", "coding"]`). |

### Budget Enforcement

Three functions implement budget control, all fail-open:

**`checkBudget(billing, userId)`** — Sends a GET to `budgetEndpoint`. If `remaining <= 0`, skips the LLM call and returns `overBudgetMessage`. On network error or non-2xx response, returns `{ allowed: true }` and proceeds.

**`reportUsage(billing, userId, usage)`** — Sends a POST to `usageEndpoint` after each LLM call. Fire-and-forget: errors are silently swallowed. Usage reporting never blocks the response path.

**`checkTier(billing, userPlan, requestedTier)`** — Synchronous. Verifies the requested agent tier is in `billing.tiers[userPlan].agents`. Returns `{ allowed: true }` for any unknown plan (fail-open).

---

## API Routes

All routes are served from the single Gateway process on the configured port.

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Returns status of all loaded Apps and their channel types. |

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

### A2A Routes

Mounted when the App has `a2aConfig` in its YAML.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/{appName}/a2a/.well-known/agent.json` | Agent Card for this App. |
| `POST` | `/{appName}/a2a/` | JSON-RPC 2.0 dispatch: `tasks/send`, `tasks/sendSubscribe`, `tasks/get`, `tasks/cancel`. |

### Delegation Internal Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/_internal/delegation/delegate` | Execute a cross-App delegation. |
| `GET` | `/_internal/delegation/delegation-targets` | List Apps registered as delegation targets. |

### Dev Routes (devMode only)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dev/state` | App state summary. |
| `GET` | `/dev/events` | SSE event stream. |
| `GET` | `/dev/memory/:scope` | Memory entries for a scope. |
| `POST` | `/dev/memory` | Write a memory entry. |
| `DELETE` | `/dev/memory/:id` | Delete a memory entry. |
| `GET` | `/dev/cost` | Cost summary. |
| `GET` | `/dev/apps` | Loaded App list. |
| `GET` | `/dev/triggers` | Trigger registry state. |
| `GET` | `/dev/app-graph` | App topology for Studio graph view. |
| `GET` | `/dev/yaml` | Raw YAML content. |
| `PUT` | `/dev/yaml` | Write and hot-reload YAML. |
| `GET` | `/dev/safety` | Safety pipeline metrics. |
| `POST` | `/dev/approve` | Approve a pending phase gate. |
| `POST` | `/dev/reject` | Reject a pending phase gate. |

### WebSocket Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/apps/:appName/ws` | WebSocket upgrade for Apps with a `web` channel binding. Supports optional `?token=` query param for auth when `validateToken` is configured. |

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

## Startup and Shutdown

**Startup order:**
1. Parse and validate `gateway.yaml`. Throw `GatewayLoaderError` on invalid config.
2. Load all App YAML files via `resolveApps()`. Assign memory paths (`~/.kiln/gateway/{appName}/`).
3. Instantiate `ChannelRegistry` per App.
4. Initialize `ModeBOrchestrator` for each Mode B App.
5. Build `DelegationRegistry` from all Mode B Apps.
6. Initialize `SafetyPipeline` for each App with a `safety` block.
7. Mount all Hono routes: health, per-App routes, A2A routes, trigger webhooks, delegation internal.
8. Call `Bun.serve()`. Exit with code 1 on `EADDRINUSE`.
9. Register `TriggerRegistry` lifecycle (event listeners, cron schedulers).

**Shutdown:** SIGINT or SIGTERM calls `server.stop(true)` to drain in-flight requests. In-flight Mode B requests without a provider response are dropped. No session state persists across restarts.
