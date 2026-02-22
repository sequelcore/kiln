# Multi-Tenant

The Gateway hosts multiple Apps in a single process, with each App fully isolated by memory namespace, session registry, agent pool, and channel binding. Multi-tenancy in Kiln operates at two levels: App-level isolation (one App per customer product, enforced at startup) and Mode B session isolation (one session per `userId` per App, enforced at request time).

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

`validateGatewayConfig()` enforces unique app names, unique API paths, and unique phone numbers. Duplicate values are rejected at startup before any App is loaded.

## Per-App Isolation Model

| Resource | Isolation Mechanism |
|----------|---------------------|
| Memory | `~/.kiln/gateway/{appName}/` prefix. Same scope name in different Apps maps to different SQLite databases and JSONL files. |
| Sessions | `SessionRegistry` keys by `{appName}:{userId}`. No session is accessible across Apps. |
| Agents | Each Mode B App has its own `ModeBOrchestrator` and `ProviderAdapter` instance. |
| Channel bindings | `ChannelRegistry` is instantiated per App. Messages on one App's channel cannot reach another App. |
| Delegation memory | Delegation calls write no git-synced memory and have no workspace access. |

Cross-App communication is always explicit: an agent must declare a `type: delegation` capability that names the target App. See [delegation](./delegation.md).

## Mode B Session Management

Mode B Apps support concurrent multi-user sessions managed by `SessionRegistry`. Sessions are created on first message and destroyed on explicit delete or idle timeout.

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
| `get(appName, userId)` | Returns session if it exists (may be expired). |
| `remove(appName, userId)` | Deletes session. Returns `true` if it existed. |
| `activeSessions()` | Returns all non-expired sessions. |
| `cleanup()` | Removes expired sessions. Returns count removed. |

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
