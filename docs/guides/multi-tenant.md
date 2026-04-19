# Multi-Tenant

The Gateway hosts multiple Apps in a single process, with each App fully isolated by memory namespace, session registry, agent pool, and channel binding. Multi-tenancy in Kiln operates at two levels: App-level isolation (one App per customer product, enforced at startup) and provider-adapter session isolation (one session per `userId` per App, enforced at request time).

## Tenant Configuration in gateway.yaml

Each App in `gateway.yaml` is an isolated tenant unit. The `name` field is the isolation key — it namespaces memory, sessions, and delegation targets.

```yaml
port: 4800

apps:
  - name: acme-assistant
    config: ./apps/acme.yaml
    channels:
      - type: api
        path: /api/acme
      - type: whatsapp
        phoneNumber: "+521234567890"

  - name: ops-ai
    config: ./apps/ops.yaml
    channels:
      - type: api
        path: /api/ops
      - type: slack
        botToken: xoxb-...
```

`validateGatewayConfig()` enforces unique app names, unique API paths, unique phone numbers, unique Instagram page IDs, unique Messenger page IDs, and unique email addresses. Duplicate values are rejected at startup before any App is loaded.

## Per-App Isolation Model

| Resource | Isolation Mechanism |
|----------|---------------------|
| Memory | `~/.kiln/gateway/{appName}/` prefix. Same scope name in different Apps maps to different SQLite databases and JSONL files. |
| Sessions | `SessionRegistry` keys by `{appName}:{userId}`. No session is accessible across Apps. |
| Agents | Each provider-adapter app has its own `RuntimeSessionOrchestrator` and `ProviderAdapter` instance. |
| Channel bindings | `ChannelRegistry` is instantiated per App. Messages on one App's channel cannot reach another App. |
| Delegation memory | Delegation calls write no git-synced memory and have no workspace access. |

Cross-App communication is always explicit: an agent must declare a `type: delegation` capability that names the target App. See [delegation](./delegation.md).

## Provider-Adapter Session Management

provider-adapter apps support concurrent multi-user sessions managed by `SessionRegistry`. Sessions are created on first message and destroyed on explicit delete or idle timeout.

**Session key:** `{appName}:{userId}`

**Session ID format:** `{appName}:{userId}:{timestamp}`

| Property | Description |
|----------|-------------|
| `conversationHistory` | Ordered `AgentMessage[]` (user + assistant). |
| `messageCount` | Total messages in the session. |
| `createdAt` | Session creation time. |
| `lastActivityAt` | Updated on every message via `touch()`. |
| `isExpired` | `true` when `now - lastActivityAt > idleTimeoutMs`. Default idle timeout: 30 minutes. |

`SessionRegistry.getOrCreate()` returns an existing non-expired session or creates a new one. Expired sessions are recreated, not resumed — conversation history is not carried over. `cleanup()` removes all expired sessions and returns the count removed.

### SessionRegistry API

| Method | Description |
|--------|-------------|
| `getOrCreate(config)` | Returns existing non-expired session or creates new. |
| `get(appName, userId, tenantId?)` | Returns session if it exists (may be expired). Tenant-scoped when `tenantId` is provided. |
| `save(session)` | Persist a mutated session. Uses optimistic concurrency: throws `CONCURRENT_SESSION_MODIFICATION` if the stored version diverges from `loadedVersion`. Required for non-reference stores (e.g., Redis). |
| `remove(appName, userId, tenantId?)` | Deletes session. Returns `true` if it existed. |
| `invalidateByTenant(appName, tenantId)` | Removes all sessions for a tenant. Returns count removed. Used on tenant config updates. |
| `activeSessions()` | Returns all non-expired sessions. |
| `activeCount()` | Returns count of non-expired sessions. |
| `cleanup()` | Removes expired sessions. Returns count removed. Emits `SESSION_EXPIRED` events. |

### Session Store

`SessionRegistry` accepts a pluggable `SessionStore` backend. Two implementations ship:

- **`InMemorySessionStore`** (default) -- Map-based, suitable for dev mode and single-process deployments. Sessions are references, so mutations are visible immediately without calling `save()`.
- **`RedisSessionStore`** -- Uses `ioredis` (dynamically imported). Sessions are serialized to JSON on write and deserialized on read, so `save()` must be called after every mutation.

### SessionMode

Sessions have a `sessionMode` field that controls how messages are processed:

| Mode | Behavior |
|------|----------|
| `ai_active` | AI processes messages normally (default) |
| `queued` | Messages stored but AI does not respond |
| `human_active` | Human operator handling the conversation |
| `resolved` | Conversation closed; auto-reopens on new user message |

The AI guard in `RuntimeSessionOrchestrator` checks `sessionMode` before processing. When a session is `queued` or `human_active`, the message is stored and `{ queued: true }` is returned. When a session is `resolved`, it auto-transitions to `ai_active` and processes normally.

See [Gateway YAML Reference](../configuration/gateway-yaml.md#session--handoff) for the full handoff API.

## Budget Enforcement

Apps that declare a `billing` block in their YAML get budget enforcement on every `POST /message` request. All three budget checks are fail-open by design -- billing outages never block users.

For the complete billing configuration reference (YAML fields, endpoint contracts, tier definitions), see [Gateway YAML Reference](../configuration/gateway-yaml.md#mode-b-details).

## Tenant Admin Routes

The Gateway exposes CRUD routes for managing tenants at runtime. These are mounted when a `TenantRegistry` is initialized.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/tenants` | List all registered tenants. |
| `POST` | `/admin/tenants` | Create a new tenant. |
| `PATCH` | `/admin/tenants/:id` | Update tenant configuration. |
| `DELETE` | `/admin/tenants/:id` | Remove a tenant. |

Sensitive tenant fields (API keys, webhook secrets) are automatically encrypted by `AesSecretStore` before persistence. See [architecture](../architecture.md#security-architecture) for encryption details.

### Mutable Tenant Config Fields

These fields can be updated via `PATCH /admin/{appName}/tenants/:tenantId`:

| Field | Type | Purpose |
|-------|------|---------|
| `name` | string | Agent display name (used in system prompt as agent identity) |
| `businessName` | string | Business name (used in system prompt as business identity) |
| `greeting` | string | Welcome message sent to web widget users on connect |
| `widgetId` | string | UUID for multi-tenant web widget routing |
| `persona` | string | Agent persona description (system prompt base) |
| `tone` | string | Communication tone (formal/friendly/casual) |
| `language` | string | Default language (BCP-47); agent auto-detects customer language |
| `services` | array | Business services injected into system prompt |
| `hours` | object | Business hours injected into system prompt |
| `faqEntries` | array | FAQ pairs injected into system prompt |
| `allowedOrigins` | string[] | Allowed origins for WebSocket connections (overrides channel-level default) |
| `escalationContact` | object | Contact for human handoff |
| `tools` | string[] | Tool name allowlist -- only listed tools are available |
| `toolConfig` | object | Tool execution config: `maxIterationsPerSession`, `rateLimits` |
| `webhookTools` | array | External webhook-backed tools with HMAC signing |
| `instagramPageId` | string | Instagram Page ID for tenant resolution via Instagram DM |
| `instagramAccessToken` | string | Instagram Page access token for sending DMs |
| `messengerPageId` | string | Facebook Page ID for tenant resolution via Messenger |
| `messengerAccessToken` | string | Messenger Page access token for sending messages |
| `emailAddress` | string | Inbound email address for tenant resolution (case-insensitive) |
| `emailFromAddress` | string | Outbound sender email address |
| `emailFromName` | string | Outbound sender display name |
| `emailTransportConfig` | object | Email transport provider config (Postmark, Resend, or generic) |
| `preChatForm` | object | Pre-chat form config for web widget (see [Channels: Pre-Chat Form](channels.md#pre-chat-form)) |
| `agents` | array | Multi-agent config: each agent has id, name, role, goal, tools (see [Multi-Agent Routing](multi-agent.md)) |
| `routing` | object | Agent routing config: rules, fallback, maxHandoffs, embeddingThreshold (see [Multi-Agent Routing](multi-agent.md)) |
| `integrations` | array | Integration adapters: provider, credentialKey, operations filter, config (see [Tool Use: Integration Tools](tool-use.md#integration-tools)) |
| `groundingMode` | string | RAG grounding: `"off"` (default) or `"strict"`. When strict, appends grounding directive after knowledge context to prevent hallucination |
| `sessionLimits` | object | Abuse protection: `maxTokens`, `maxTurns` per session (auto-escalates to `human_active`) |
| `whatsappCoexistence` | object | WhatsApp coexistence: `enabled`, `autoReleaseMs` for business app auto-handoff |

Session invalidation: when a tenant config is updated via PATCH, `SessionRegistry.invalidateByTenant()` clears all active sessions for that tenant so the next message picks up fresh config.

## Tenant Resolution by Channel

Each channel resolves tenants using a channel-specific identifier:

| Channel | Resolution Method | Lookup Field | Notes |
|---------|------------------|--------------|-------|
| Web | `resolveByWidgetId(widgetId, appName)` | `widgetId` | UUID from widget `data-widget-id` |
| WhatsApp | `resolveByPhoneNumber(phoneNumber, appName)` | `phoneNumber` | E.164 format |
| Instagram | `resolveByInstagramPageId(pageId, appName)` | `instagramPageId` | Instagram Page ID from webhook payload |
| Messenger | `resolveByMessengerPageId(pageId, appName)` | `messengerPageId` | Facebook Page ID from webhook payload |
| Email | `resolveByEmailAddress(emailAddress, appName)` | `emailAddress` | Case-insensitive match |

All resolution methods return the matching `TenantConfig` or throw `TENANT_NOT_FOUND`.

## Tenant Tool Configuration

Tenants can configure tool execution behavior at three levels:

### Tool Allowlist

The `tools` field restricts which capabilities are available to a tenant's sessions. When set, only named tools (plus any webhook tools) are allowed. When omitted, all app-level capabilities are available.

### Webhook Tools

External HTTP endpoints registered as tools via `webhookTools`. Each entry defines:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Tool name (unique per tenant) |
| `description` | string | no | Description shown to the LLM |
| `url` | string | yes | HTTPS endpoint URL |
| `secret` | string | yes | HMAC-SHA256 signing secret (encrypted at rest) |
| `timeout` | number | no | Timeout in seconds (default: 30) |
| `inputSchema` | object | no | JSON Schema for tool input |

Webhook secrets are encrypted by `AesSecretStore` using the key pattern `tenant:{tenantId}:webhookTool:{toolName}`.

Requests include `X-Kiln-Signature: sha256=<hmac>` and `X-Kiln-Timestamp` headers for verification.

### Rate Limiting

Per-tenant rate limiting via `toolConfig.rateLimits`:

```yaml
# Example PATCH body
{
  "toolConfig": {
    "maxIterationsPerSession": 15,
    "rateLimits": {
      "defaultPerMinute": 60,
      "perTool": {
        "process_refund": 5,
        "send_notification": 10
      }
    }
  }
}
```

Uses a 60-second sliding window. Rate-limited calls return error results to the LLM with retry-after guidance. Per-tenant isolation ensures one tenant's usage doesn't affect others.
