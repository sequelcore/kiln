<p align="center">
  <img src="https://raw.githubusercontent.com/sequelcore/kiln/main/docs/assets/mascot.png" alt="Kiln" width="120" />
</p>

<h1 align="center">@kilnai/runtime</h1>

<p align="center">
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License: Apache-2.0" /></a>
</p>

<p align="center">Multi-app gateway server, multi-tenant management, and channel adapters for Kiln.</p>

---

## What is this?

> [!IMPORTANT]
> This is a provisional workspace package in a source-only development tree.
> There is no supported package installation for the current repository state.

`@kilnai/runtime` is the production runtime for [Kiln](https://github.com/sequelcore/kiln). It turns your YAML-configured AI apps into a running server with:

- **Multi-app gateway** -- host multiple Kiln apps in one Bun/Hono process
- **8 channel adapters** -- CLI, Web (WebSocket), WhatsApp, Instagram, Messenger, Slack, Email, REST API
- **Multi-tenant isolation** -- tenant-scoped governed memory, system prompts, billing, and channel credentials
- **Budget middleware** -- per-tenant token budgets with fail-open enforcement
- **Trigger runtime** -- webhooks (HMAC-SHA256), event listeners, cron scheduler
- **Cross-app delegation** -- Kiln-native and A2A protocol support
- **Session management** -- per-user sessions with idle cleanup
- **Safety & security middleware** -- prompt injection scanning, PII/content/rails pipeline

## Use in this workspace

```bash
bun install --frozen-lockfile
bun run --filter @kilnai/runtime test
```

Workspace consumers declare this package with `workspace:*`. It depends on
`@kilnai/core`, `@kilnai/gateway-contracts`, and the GUI static asset package.
The current coordinates are expected to change before the next public release.

## Usage

### Minimal gateway

```typescript
import { startGateway } from "@kilnai/runtime";

await startGateway("gateway.yaml");
```

### Gateway config (gateway.yaml)

```yaml
port: 3000

apps:
  - name: my-agent
    config: app.yaml
    channels:
      - type: web
      - type: api
        path: /api/chat
```

### Multi-tenant with WhatsApp

```yaml
port: 3000

apps:
  - name: my-saas
    config: app.yaml
    channels:
      - type: whatsapp
        multiTenant: true
      - type: web
        multiTenant: true
```

## Key exports

| Module | Exports |
|--------|---------|
| Gateway | `startGateway()`, `createGatewayApp()`, `resolveApps()` |
| Session | `RuntimeSessionOrchestrator`, `RuntimeSession`, `SessionRegistry`, `SessionMode`, `SessionStore`, `InMemorySessionStore`, `RedisSessionStore`, `serializeSession`, `deserializeSession` |
| Tenant | `TenantRegistry`, `buildTenantSystemPrompt()`, `extractSuggestions()` |
| Triggers | `TriggerRegistry`, `createWebhookHandler()`, `EventListener`, `Scheduler` |
| Channels | `WebChannel`, `WhatsAppChannel`, `InstagramChannel`, `MessengerChannel`, `SlackChannel`, `EmailChannel`, `CliChannel`, `ApiChannel` |
| Budget | `checkBudget()`, `reportUsage()` |

## Endpoints

When the gateway starts, it automatically mounts:

| Path | Purpose |
|------|---------|
| `GET /health` | Health check with per-app and per-subsystem status |
| `GET /apps/{name}/ws` | WebSocket channel (non-tenant) |
| `GET /apps/{name}/ws?widgetId=X` | WebSocket channel (multi-tenant) |
| `POST /api/{path}/message` | REST API channel |
| `POST /whatsapp/{name}/webhook` | WhatsApp webhook |
| `POST /webhooks/{name}/{path}` | Webhook triggers |
| `POST /admin/{name}/tenants` | Tenant CRUD (admin API) |
| `POST /{path}/handoff` | Initiate handoff (transition to queued/human_active) |
| `POST /{path}/release` | Release session back to ai_active |
| `POST /{path}/operator-message` | Send operator message to end user |
| `GET /{path}/session-history` | Retrieve full conversation history |

## Documentation

- [Gateway configuration](../../docs/configuration/gateway-yaml.md)
- [Channels guide](../../docs/guides/channels/channels.md)
- [Multi-tenant guide](../../docs/guides/config/multi-tenant.md)
- [Triggers guide](../../docs/guides/channels/triggers.md)
- [Examples](../../docs/examples/README.md)

## License

[Apache 2.0](../../LICENSE)
