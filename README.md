<p align="center">
  <img src="docs/assets/mascot.png" alt="Kiln" width="180" />
</p>

<h1 align="center">Kiln</h1>

<p align="center">
  <a href="https://github.com/sequelcore/kiln/actions/workflows/ci.yml"><img src="https://github.com/sequelcore/kiln/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

<p align="center">Domain-agnostic AI orchestration engine. YAML-configured, multi-tenant, multi-channel.</p>

## Quick Start

```bash
bun add @kilnai/core @kilnai/runtime @kilnai/cli
bunx kiln init
bunx kiln dev
```

## Highlights

- **YAML-first** -- agents, workflows, tools, gates, and triggers defined in a single file; no code required
- **7 primitives + 3 composites** -- Agent, Capability, Workflow, Memory, Task, Channel, Trigger compose into Team, Router, App
- **4 provider adapters** -- Anthropic, OpenAI, DeepSeek, Ollama; swap with one YAML field change
- **3 team modes** -- sequential, supervisor (manager delegates by name), swarm (agents hand off to each other)
- **Phase-gated workflows** -- configurable phases, quality gates (test, lint, typecheck), checkpoint/resume, human-in-the-loop
- **5 memory scopes** -- user, agent, team, project, org; SQLite + FTS5 with decay curves and auto-compaction
- **8 channel adapters** -- CLI, Web (WebSocket), WhatsApp, Instagram, Messenger, Slack, Email, REST/SSE
- **Multi-tenant gateway** -- multiple apps in one Bun/Hono process, each isolated by memory, sessions, and routes
- **Triggers** -- webhooks (HMAC-SHA256), event listeners, cron scheduler with `{{payload.field}}` interpolation
- **Enterprise safety** -- PII detection (6 types), content classification (6 categories), 4 policy rails
- **Security** -- prompt injection detection, AES-256-GCM secrets, append-only audit log with hash chaining
- **Knowledge (RAG)** -- chunkers, embedding adapters, vector store, retrieval pipeline, auto-injected capability
- **Eval framework** -- 12 scorer types (rule-based + LLM-as-judge), YAML-configured experiments, comparator
- **React SDK** -- `@kilnai/react` hooks for frontend integration
- **Studio** -- graph view, playground, timeline, memory inspector, eval dashboard at `/studio` in dev mode
- **73 error codes** with context-aware suggestions and doc links

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
| [`@kilnai/core`](packages/core) | Engine primitives, composites, YAML loader, provider adapters, memory, orchestrator, domain kits, security, safety, eval |
| [`@kilnai/runtime`](packages/runtime) | Multi-app gateway server, channel adapters, trigger runtime, budget middleware, cross-app delegation, A2A protocol |
| [`@kilnai/react`](packages/sdk) | React hooks SDK (KilnProvider, useKilnChat, useKilnWsChat, useKilnEvents, useKilnMemory, useKilnState) |
| [`@kilnai/widget`](packages/widget) | Embeddable chat widget -- Shadow DOM, auto-reconnect WebSocket, zero runtime deps, single IIFE bundle |
| [`@kilnai/cli`](packages/cli) | CLI commands (init, dev, run, gateway, skill, domain), interactive wizard, YAML hot-reload |

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, wizard walkthrough, first app |
| [Core Concepts](docs/concepts.md) | Primitives, composites, team modes, runtime modes, event system |
| [App Configuration](docs/configuration/app-yaml.md) | Full app.yaml reference |
| [Gateway Configuration](docs/configuration/gateway-yaml.md) | Full gateway.yaml reference |
| [Channels](docs/guides/channels.md) | Channel adapter setup and options |
| [Memory](docs/guides/memory.md) | Scopes, decay, compaction, git sync |
| [Safety](docs/guides/safety.md) | PII scanner, content classifier, policy rails |
| [Triggers](docs/guides/triggers.md) | Webhooks, event listeners, cron scheduler |
| [Multi-Tenant](docs/guides/multi-tenant.md) | Gateway multi-app hosting and isolation |
| [Domains](docs/guides/domains.md) | Domain kits, detection, marketplace |
| [Eval](docs/guides/eval.md) | Scorers, datasets, experiments |
| [React SDK](docs/sdk/react-hooks.md) | `@kilnai/react` hooks reference |
| [Studio](docs/sdk/studio.md) | Dev UI: graph, playground, timeline, memory, eval |
| [Multi-Agent Routing](docs/guides/multi-agent.md) | Multiple agents per tenant, routing tiers, handoff briefs |
| [Model Routing](docs/guides/model-routing.md) | Per-request model selection, complexity scoring |
| [Enrichment](docs/guides/enrichment.md) | Post-conversation analytics (effort score, sentiment, CSAT) |
| [Observability](docs/guides/observability.md) | OTel spans, Prometheus metrics, cost tracking |
| [FAQ](docs/faq.md) | Common questions |
| [Architecture](docs/architecture.md) | Internal design reference for contributors |
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
