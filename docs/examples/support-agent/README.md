# Support Agent

E-commerce support flow with MCP tools and safety policy.

This example shows how Kiln admits a customer-support turn, exposes only the
declared tools, applies safety policy, and records the exchange through the
runtime session path.

## What this demonstrates

- **MCP tool integration** -- the runtime calls tools hosted on a separate MCP server
- **Safety policy** -- PII is redacted and configured topics are blocked
- **Governed memory** -- user-scoped chat history is persisted for recall
- **Realistic mock data** -- 5 orders, 3 accounts, ticket creation

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- Anthropic API key

## Quick start

```bash
# 1. Install (from monorepo root)
cd ../../.. && bun install && cd docs/examples/support-agent

# 2. Set your API key
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY

# 3. Start (launches MCP tools server + gateway)
bun run start
```

Open `index.html` in your browser. Try:

- "What's the status of order ORD-1002?"
- "Look up the account for alice@example.com"
- "Create a high priority ticket -- my monitor arrived cracked"

## Project structure

```
support-agent/
  app.yaml         # Agent config + MCP server + safety rules + capabilities
  gateway.yaml     # Gateway binding
  server.ts        # Starts MCP tools server, then gateway
  tools-server.ts  # MCP server (JSON-RPC over HTTP) with 3 tools
  mock-data.ts     # In-memory orders, accounts, tickets
  index.html       # Chat UI (WebSocket)
```

## How it works

```
Browser (index.html)
  │ WebSocket
  ▼
Gateway (port 3000)
  │ receives message, admits it into the runtime pipeline
  ▼
Provider adapter
  │ returns tool_use: check_order_status({ orderId: "ORD-1002" })
  ▼
Gateway executes tool via MCP
  │ HTTP POST to localhost:3100/mcp
  ▼
MCP Tools Server (port 3100)
  │ looks up mock data, returns order details
  ▼
Provider adapter with tool result
  │ generates final response
  ▼
Browser (displays response)
```

The safety pipeline runs on both input and output:
- **PII redaction**: emails, phones, and credit card numbers are replaced with `[REDACTED]`
- **Topic rails**: blocks requests for financial advice, investment tips, legal/medical advice

## Mock data

### Orders

| ID | Status | Items | Customer |
|----|--------|-------|----------|
| ORD-1001 | Delivered | Monitor 27" 4K | alice@example.com |
| ORD-1002 | Shipped | Keyboard + Mouse Pad | alice@example.com |
| ORD-1003 | Processing | Wireless Headphones x2 | bob@example.com |
| ORD-1004 | Cancelled | USB-C Hub | bob@example.com |
| ORD-1005 | Returned | Laptop Stand | carol@example.com |

### Accounts

| Email | Name | Tier | Orders |
|-------|------|------|--------|
| alice@example.com | Alice Johnson | Premium | ORD-1001, ORD-1002 |
| bob@example.com | Bob Smith | Standard | ORD-1003, ORD-1004 |
| carol@example.com | Carol Williams | Standard | ORD-1005 |

## Customizing

**Add a tool**: Define it in `TOOLS` array in `tools-server.ts`, add the handler to `executeTool()`, and declare it in `app.yaml` under `capabilities`.

**Change safety rules**: Edit `safety.pii` and `safety.rails` in `app.yaml`.

**Use real data**: Replace `mock-data.ts` with actual database queries -- the tool interface stays the same.

## Next steps

- [booking-assistant](../booking-assistant/) -- Add tenants, billing hooks, widget, and webhook triggers
- [multi-app-gateway](../multi-app-gateway/) -- Host multiple apps behind one gateway
