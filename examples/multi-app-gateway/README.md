# Multi-App Gateway

Production gateway hosting multiple AI apps with Docker.

A single Kiln gateway process hosting two independent apps (support + booking), each with multi-tenant configuration, separate memory stores, and independent channel bindings. Includes Docker deployment files.

## What this demonstrates

- **Multi-app hosting** -- Two apps on one gateway, one port, shared infrastructure
- **Multi-tenant per app** -- Each app has its own tenant registry and configurations
- **Independent routing** -- WebSocket and API paths scoped per app
- **Docker deployment** -- Production-ready Dockerfile with health checks
- **Tenant provisioning** -- Auto-provisions demo tenants on startup via admin API

## Prerequisites

- [Bun](https://bun.sh) 1.1+
- Anthropic API key
- Docker (optional, for containerized deployment)

## Quick start (local)

```bash
# 1. Install (from monorepo root)
cd ../.. && bun install && cd examples/multi-app-gateway

# 2. Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Start
bun run start
```

## Quick start (Docker)

```bash
# 1. Create .env file
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# 2. Build and run
docker compose up --build
```

## Project structure

```
multi-app-gateway/
  gateway.yaml                  # 2 apps, 4 channels (web + api per app)
  apps/
    support/app.yaml            # Support agent configuration
    booking/app.yaml            # Booking agent configuration
  tenants/
    support-demo.json           # TechShop support tenant
    booking-demo.json           # Bella Salon booking tenant
  server.ts                     # Gateway startup + tenant provisioning
  Dockerfile                    # Bun Alpine production image
  docker-compose.yml            # Single service + persistent volume
```

## Endpoints

| Path | App | Channel |
|------|-----|---------|
| `/health` | -- | Health check (all apps) |
| `/apps/support/ws?widgetId=techshop-widget` | Support | WebSocket |
| `/apps/booking/ws?widgetId=bella-widget` | Booking | WebSocket |
| `/api/support/message` | Support | REST API |
| `/api/booking/message` | Booking | REST API |
| `/admin/support/tenants` | Support | Admin (tenant CRUD) |
| `/admin/booking/tenants` | Booking | Admin (tenant CRUD) |

## How it works

```
                              Gateway (port 3000)
                             /                    \
                     /apps/support/            /apps/booking/
                    /                            \
             Support App                    Booking App
           (TenantRegistry)              (TenantRegistry)
          /        |                    /        |
  techshop-widget  API          bella-widget     API
  (WebSocket)    (/api/support) (WebSocket)   (/api/booking)
```

Each app has:
- Its own `app.yaml` with agent configuration
- Its own tenant registry (stored at `~/.kiln/gateway/{app}/tenants/`)
- Its own memory database (stored at `~/.kiln/gateway/{app}/memory/`)
- Independent WebSocket and API endpoints

## Adding a new app

1. Create `apps/my-app/app.yaml` with your agent config
2. Add the app to `gateway.yaml`:
   ```yaml
   - name: my-app
     config: apps/my-app/app.yaml
     channels:
       - type: web
         multiTenant: true
   ```
3. Create a tenant config in `tenants/` and add it to `server.ts`
4. Restart the gateway

## Adding tenants at runtime

Use the admin API to create tenants without restarting:

```bash
curl -X POST http://localhost:3000/admin/support/tenants \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "acme-corp",
    "appName": "support",
    "name": "ACME Corporation",
    "description": "Support assistant for ACME Corp products",
    "widgetId": "acme-widget",
    "enabled": true
  }'
```

## Production considerations

- **Secrets**: Use Doppler, Vault, or environment variables for API keys
- **Persistence**: Mount `~/.kiln/gateway` as a Docker volume for tenant configs and memory
- **Monitoring**: The `/health` endpoint reports per-app and per-subsystem status
- **Scaling**: One gateway per machine; scale horizontally behind a load balancer
- **Admin auth**: Set `adminTokenEnv` on channels in `gateway.yaml` to require bearer auth

## Related examples

- [support-agent](../support-agent/) -- Full support agent with MCP tools and safety
- [booking-assistant](../booking-assistant/) -- Full booking agent with billing and triggers
- [whatsapp-bot](../whatsapp-bot/) -- WhatsApp channel integration
