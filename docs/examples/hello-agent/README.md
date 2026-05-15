# Hello Agent

Smallest gateway-backed Kiln app.

This example keeps the runtime surface deliberately small: one app declaration,
one gateway binding, one web channel, and one HTML client. It is the fastest way
to see the current governed session path from source.

## What this demonstrates

- App declaration through `app.yaml`
- Gateway app binding through `gateway.yaml`
- WebSocket web channel over the runtime session pipeline
- Governed user-scoped memory
- Minimal `startGateway()` entry point

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- Anthropic API key

## Quick start

```bash
# 1. Install dependencies (from monorepo root)
cd ../../.. && bun install && cd docs/examples/hello-agent

# 2. Set your API key
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY

# 3. Start
bun run start
```

Open `index.html` in your browser and start chatting.

## Project structure

```
hello-agent/
  app.yaml       # Agent definition: name, role, persona, tier
  gateway.yaml   # Gateway config: port, app binding, channels
  server.ts      # Entry point (3 lines)
  index.html     # Chat UI (raw WebSocket, open directly in browser)
```

## How it works

1. `server.ts` calls `startGateway()` which loads `gateway.yaml`
2. The gateway parses `app.yaml` and creates a provider-adapter runtime path
3. A WebSocket endpoint is mounted at `/apps/hello-agent/ws`
4. `index.html` connects to the WebSocket and exchanges JSON frames:
   - Send: `{ "type": "message", "content": "Hello!" }`
   - Receive: `{ "type": "done", "content": "Hi there! How can I help?" }`
5. User-scoped conversation memory persists across messages

## Customizing

**Change the model:** Edit `provider.model` in `app.yaml`. The current default
uses the model configured in the file; see the model-routing guide for the
registered model catalog.

**Change the provider:** Set `provider.name` to `openai`, `deepseek`, or `ollama` and update the model accordingly.

**Add personality:** Edit the `backstory` field in `app.yaml` to change how the agent behaves.

## Next steps

- [support-agent](../support-agent/) -- Add MCP tools, safety policy, and mock data
- [booking-assistant](../booking-assistant/) -- Add tenants, billing hooks, widget, and webhook triggers
- [multi-app-gateway](../multi-app-gateway/) -- Host multiple apps behind one gateway
