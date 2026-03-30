<p align="center">
  <img src="docs/assets/mascot.png" alt="Kiln" width="180" />
</p>

<h1 align="center">Kiln</h1>

<p align="center">
  <a href="https://github.com/sequelcore/kiln/actions/workflows/ci.yml"><img src="https://github.com/sequelcore/kiln/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

<p align="center">Domain-agnostic AI orchestration engine. YAML-configured, multi-tenant, multi-channel.</p>

---

Build conversational AI products without writing orchestration code. Define agents, tools, channels, and routing rules in YAML. Kiln handles sessions, memory, safety, cost tracking, and observability so you ship features instead of infrastructure.

## Quick Start

```bash
bun add @kilnai/core @kilnai/runtime @kilnai/cli
bunx kiln init
bunx kiln dev
```

## Highlights

### Core Engine
- **YAML-first** -- agents, workflows, tools, gates, triggers, and routing defined in configuration; no code required
- **7 primitives + 3 composites** -- Agent, Capability, Workflow, Memory, Task, Channel, Trigger compose into Team, Router, App
- **4 provider adapters** -- Anthropic, OpenAI, DeepSeek, Ollama; swap with one YAML field change
- **3 team modes** -- sequential, supervisor, swarm
- **73 error codes** with context-aware suggestions and doc links

### Channels & Gateway
- **8 channel adapters** -- CLI, Web (WebSocket), WhatsApp, Instagram, Messenger, Slack, Email, REST API
- **Multi-tenant gateway** -- multiple apps in one Bun/Hono process, isolated by memory, sessions, and routes
- **Human handoff** -- session mode state machine (ai_active/queued/human_active/resolved), escalation detection, operator messaging
- **Embeddable widget** -- Shadow DOM chat widget with auto-reconnect WebSocket, zero runtime deps

### Intelligence
- **Multi-agent routing** -- multiple agents per tenant with 3-tier routing (regex, embedding similarity, fallback), warm handoff briefs, ping-pong guard
- **Model routing** -- per-request LLM selection via complexity scoring (5 signals, <1ms) and rules engine (7 condition types)
- **Tool use** -- agentic tool loop with 4-level authorization, webhook tools (HMAC-SHA256), rate limiting, ToolRAG, result sanitization
- **Knowledge (RAG)** -- chunkers, embedding adapters, PgVector (halfvec + HNSW + RRF hybrid search), Cohere reranking, STT (OpenAI, Deepgram), contact memory with GDPR deletion

### Operational
- **Conversation enrichment** -- post-conversation analytics (effort score, sentiment, resolution, CSAT) via rule-based + LLM pipeline
- **Observability** -- OpenTelemetry spans (gen_ai.* conventions), Prometheus metrics (GET /metrics), per-model cost tracking
- **5 memory scopes** -- user, agent, team, project, org; SQLite + FTS5 with decay curves and auto-compaction
- **Enterprise safety** -- PII detection (6 types, Luhn validation), content classification, 4 policy rails, prompt injection detection
- **Security** -- AES-256-GCM secrets, timing-safe auth, append-only audit log with hash chaining
- **Eval framework** -- 12 scorer types (rule-based + LLM-as-judge), YAML-configured experiments, comparator

## Examples

| Example | Description | Features |
|---------|-------------|----------|
| [hello-agent](examples/hello-agent) | Your first AI agent in 60 seconds | YAML config, web channel, conversation memory |
| [support-agent](examples/support-agent) | E-commerce support with tools and safety | MCP tools, PII redaction, topic rails |
| [booking-assistant](examples/booking-assistant) | Appointment booking for a hair salon | Multi-tenant, billing, webhook triggers, chat widget |
| [multi-app-gateway](examples/multi-app-gateway) | Production gateway hosting multiple apps | Multi-app, Docker, tenant provisioning |
| [whatsapp-bot](examples/whatsapp-bot) | WhatsApp multi-tenant business bot | WhatsApp Cloud API, builtin tools, persistent memory |

## Packages

| Package | Description |
|---------|-------------|
| [`@kilnai/core`](packages/core) | Engine primitives, YAML loader, provider adapters, memory, orchestrator, knowledge, safety, security, eval, enrichment, observability |
| [`@kilnai/runtime`](packages/runtime) | Multi-app gateway, 8 channel adapters, tenant management, session registry, triggers, budget middleware, handoff, A2A |
| [`@kilnai/cli`](packages/cli) | CLI commands (init, dev, run, gateway, skill, domain, cron), interactive wizard, YAML hot-reload |
| [`@kilnai/react`](packages/sdk) | React hooks (KilnProvider, useKilnChat, useKilnWsChat, useKilnEvents, useKilnMemory, useKilnState, useApproval) |
| [`@kilnai/widget`](packages/widget) | Embeddable chat widget -- Shadow DOM, auto-reconnect WebSocket, zero runtime deps, single IIFE bundle |
| [`@kilnai/studio`](packages/studio) | Dev UI -- graph view, playground, timeline, memory, eval, cost, safety (private, served at `/studio`) |

## Documentation

Full documentation at [docs/README.md](docs/README.md).

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, wizard walkthrough, first app |
| [Core Concepts](docs/concepts.md) | Primitives, composites, team modes, runtime modes |
| [App YAML](docs/configuration/app-yaml.md) | Full app.yaml reference |
| [Gateway YAML](docs/configuration/gateway-yaml.md) | Full gateway.yaml reference |
| [Channels](docs/guides/channels.md) | 8 channel adapters setup and options |
| [Knowledge](docs/guides/knowledge.md) | RAG pipeline, vector stores, STT, contact memory |
| [Tool Use](docs/guides/tool-use.md) | Authorization, webhook tools, rate limiting, ToolRAG |
| [Multi-Agent Routing](docs/guides/multi-agent.md) | Multiple agents, routing tiers, handoff briefs |
| [Model Routing](docs/guides/model-routing.md) | Per-request model selection, complexity scoring |
| [Enrichment](docs/guides/enrichment.md) | Post-conversation analytics (effort score, sentiment, CSAT) |
| [Observability](docs/guides/observability.md) | OTel spans, Prometheus metrics, cost tracking |
| [Multi-Tenant](docs/guides/multi-tenant.md) | Tenant isolation, registry, per-tenant config |
| [Memory](docs/guides/memory.md) | Scopes, decay, compaction, git sync |
| [Safety](docs/guides/safety.md) | PII scanner, content classifier, policy rails |
| [Eval](docs/guides/eval.md) | Scorers, datasets, experiments |
| [FAQ](docs/faq.md) | Common questions |
| [Changelog](docs/changelog.md) | Version history |

## Development

```bash
git clone https://github.com/sequelcore/kiln.git
cd kiln
bun install
bun run typecheck
bun run test
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
