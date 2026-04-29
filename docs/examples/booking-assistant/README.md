# Booking Assistant

Appointment scheduling with billing, multi-tenant, and webhook triggers.

A hair salon booking agent that can check availability, create appointments, and cancel bookings. Includes per-tenant billing enforcement, webhook triggers for booking confirmations, and the embeddable Kiln chat widget.

## What this demonstrates

- **MCP tool calling** -- Agent uses calendar tools to check and manage bookings
- **Multi-tenant** -- Per-business configuration with custom personas, services, and hours
- **Billing middleware** -- Per-tenant token budgets with automatic enforcement
- **Webhook triggers** -- External systems can fire booking confirmations
- **Chat widget** -- Embeddable `@kilnai/widget` with greeting and suggestion chips
- **Capability annotations** -- `readOnly` for listing, `destructive` for booking/cancelling

## Prerequisites

- [Bun](https://bun.sh) 1.1+
- Anthropic API key

## Quick start

```bash
# 1. Install (from monorepo root)
cd ../../.. && bun install && cd docs/examples/booking-assistant

# 2. Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Start (launches tools server + billing server + gateway + provisions demo tenant)
bun run start
```

Open `index.html` in your browser. The Kiln chat widget appears in the bottom-right corner with a greeting and suggestion chips.

Try:
- "What services do you offer?"
- "Do you have any openings tomorrow?"
- "Book a haircut for Maria at 2pm tomorrow"
- "Cancel booking BK-1001"

## Project structure

```
booking-assistant/
  app.yaml                # Agent + MCP + billing + trigger config
  gateway.yaml            # Multi-tenant web + API channels
  server.ts               # Orchestrates startup: tools -> billing -> gateway -> tenant
  tools-server.ts         # MCP server with 3 booking tools (port 3200)
  mock-calendar.ts        # In-memory slots, bookings, services
  mock-billing-server.ts  # Token budget tracking (port 3300)
  tenant-example.json     # "Bella Hair Salon" tenant config
  index.html              # Landing page with embedded @kilnai/widget
```

## Architecture

```
Browser (widget)
  | WebSocket (/apps/booking-assistant/ws?widgetId=bella-demo-widget)
  v
Gateway (port 3000)
  |-- Budget check --> Mock Billing (port 3300)
  |-- Tenant lookup --> TenantRegistry (bella-salon)
  |-- System prompt injection (services, hours, FAQs)
  v
Anthropic API (Claude Haiku)
  | tool_use: list_available_slots({ date: "2026-03-05" })
  v
MCP Tools Server (port 3200)
  | mock calendar data
  v
Anthropic API (with tool results)
  |-- Usage report --> Mock Billing (port 3300)
  v
Browser (response + suggestions)
```

## Multi-tenant configuration

The `tenant-example.json` shows the full tenant schema used in production by Kilvo:

| Field | Purpose |
|-------|---------|
| `tenantId` | Unique ID for this business |
| `name`, `description` | Injected into the agent's system prompt |
| `services` | Business offerings with prices and durations |
| `hours` | Operating schedule per day |
| `faqEntries` | Q&A pairs the agent can reference |
| `greeting`, `suggestions` | Widget welcome frame and quick-action chips |
| `widgetId` | Connects the HTML widget to this tenant |
| `escalationContact` | Handoff details for complex issues |

## Webhook triggers

Test the booking confirmation webhook:

```bash
curl -X POST http://localhost:3000/webhooks/booking-assistant/hooks/confirmed \
  -H "Content-Type: application/json" \
  -d '{"customerName": "Maria Garcia", "service": "Haircut", "date": "2026-03-05", "time": "14:00"}'
```

## Billing

The mock billing server starts each tenant with 50,000 tokens. After exhaustion, the agent responds with the `overBudgetMessage` from `app.yaml`. Check budget status:

```bash
curl http://localhost:3300/budget?tenantId=bella-salon
```

## Customizing

**Add a service**: Update `tenant-example.json` (the tenant config) and `mock-calendar.ts` (the SERVICES constant).

**Change budget**: Edit `DEFAULT_BUDGET` in `mock-billing-server.ts`.

**Use real billing**: Replace the mock endpoints in `app.yaml` with your billing API.

**Add WhatsApp**: See the [whatsapp-bot](../whatsapp-bot/) example for WhatsApp channel configuration.

## Next steps

- [multi-app-gateway](../multi-app-gateway/) -- Host this + support-agent together in production with Docker
