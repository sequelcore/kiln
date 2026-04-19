<p align="center">
  <img src="https://raw.githubusercontent.com/sequelcore/kiln/main/docs/assets/mascot.png" alt="Kiln" width="120" />
</p>

<h1 align="center">@kilnai/runtime</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@kilnai/runtime"><img src="https://img.shields.io/npm/v/@kilnai/runtime.svg" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

<p align="center">Multi-app gateway server, multi-tenant management, and channel adapters for Kiln.</p>

---

## What is this?

`@kilnai/runtime` is the production runtime for [Kiln](https://github.com/sequelcore/kiln). It turns your YAML-configured AI apps into a running server with:

- **Multi-app gateway** -- host multiple Kiln apps in one Bun/Hono process
- **8 channel adapters** -- CLI, Web (WebSocket), WhatsApp, Instagram, Messenger, Slack, Email, REST API
- **Multi-tenant isolation** -- per-tenant memory, system prompts, billing, and channel credentials
- **Budget middleware** -- per-tenant token budgets with fail-open enforcement
- **Trigger runtime** -- webhooks (HMAC-SHA256), event listeners, cron scheduler
- **Cross-app delegation** -- Kiln-native and A2A protocol support
- **Session management** -- per-user sessions with idle cleanup
- **Safety & security middleware** -- prompt injection scanning, PII/content/rails pipeline

## Install

```bash
bun add @kilnai/runtime
```

Requires `@kilnai/core` as a peer dependency.

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

### Dev mode with hot-reload

```typescript
import { startDevServer } from "@kilnai/runtime";

await startDevServer("app.yaml", { port: 3000 });
```

## Key exports

| Module | Exports |
|--------|---------|
| Gateway | `startGateway()`, `startDevServer()`, `createGatewayApp()`, `resolveApps()` |
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
| `GET /api/memory` | Memory read API |

## Documentation

- [Gateway Configuration](https://github.com/sequelcore/kiln/blob/main/docs/configuration/gateway-yaml.md)
- [Channels Guide](https://github.com/sequelcore/kiln/blob/main/docs/guides/channels.md)
- [Multi-Tenant Guide](https://github.com/sequelcore/kiln/blob/main/docs/guides/multi-tenant.md)
- [Triggers Guide](https://github.com/sequelcore/kiln/blob/main/docs/guides/triggers.md)
- [Examples](https://github.com/sequelcore/kiln/tree/main/examples)

## License

[MIT](https://github.com/sequelcore/kiln/blob/main/LICENSE)
