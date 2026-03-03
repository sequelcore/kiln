# Hello Agent

Your first Kiln AI agent in 60 seconds.

A minimal example: one agent, one web channel, zero custom code. Everything is defined in YAML.

## What this demonstrates

- YAML-first agent configuration (`app.yaml`)
- Gateway setup (`gateway.yaml`)
- WebSocket web channel with conversation memory
- 3-line server entry point

## Prerequisites

- [Bun](https://bun.sh) 1.1+
- Anthropic API key

## Quick start

```bash
# 1. Install dependencies (from monorepo root)
cd ../.. && bun install && cd examples/hello-agent

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
2. The gateway parses `app.yaml` and creates a Mode B runtime (direct LLM calls)
3. A WebSocket endpoint is mounted at `/apps/hello-agent/ws`
4. `index.html` connects to the WebSocket and exchanges JSON frames:
   - Send: `{ "type": "message", "content": "Hello!" }`
   - Receive: `{ "type": "done", "content": "Hi there! How can I help?" }`
5. Conversation memory persists across messages (SQLite + FTS5)

## Customizing

**Change the model:** Edit `provider.model` in `app.yaml`. Supports `claude-haiku-4-5-20251001`, `claude-sonnet-4-6-20250514`, or any Anthropic model.

**Change the provider:** Set `provider.name` to `openai`, `deepseek`, or `ollama` and update the model accordingly.

**Add personality:** Edit the `backstory` field in `app.yaml` to change how the agent behaves.

## Next steps

- [support-agent](../support-agent/) -- Add tool calling, safety pipeline, and mock data
- [booking-assistant](../booking-assistant/) -- Multi-tenant, billing, webhook triggers
- [multi-app-gateway](../multi-app-gateway/) -- Host multiple apps in production with Docker
