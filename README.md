<p align="center">
  <img src="docs/assets/mascot.png" alt="Kiln" width="180" />
</p>

<h1 align="center">Kiln</h1>

<p align="center">
  <a href="https://github.com/sequelcore/kiln/actions/workflows/ci.yml"><img src="https://github.com/sequelcore/kiln/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License: Apache-2.0" /></a>
</p>

<p align="center">Domain-agnostic AI orchestration engine and cross-CLI meta-orchestrator.</p>

---

Kiln is two things in one package:

**Engine** (`core` + `runtime`): YAML-configured AI orchestration — 7 primitives, multi-tenant gateway, 8 channel adapters, safety, memory, knowledge RAG, eval, observability. Build conversational AI products without writing orchestration code.

**Meta-orchestrator** (`cli` + `tui`): Routes between CLI subscriptions (Claude Code, Codex, OpenCode) and direct API providers from a single interface. Syncs config, permissions, agents, and skills across all three tools. Tracks budget and sessions cross-platform.

> Every other orchestrator routes between models. Kiln routes between subscriptions.
> Three flat-rate subscriptions treated as a unified resource pool.

## Quick Start

```bash
bun add @kilnai/core @kilnai/runtime @kilnai/cli
bunx kiln init
bunx kiln dev
```

## Engine

### Primitives & Composites
- **7 primitives + 3 composites** — Agent, Capability, Workflow, Memory, Task, Channel, Trigger compose into Team, Router, App
- **YAML-first** — agents, workflows, tools, gates, triggers, and routing defined in configuration
- **76 error codes** with context-aware suggestions and doc links

### Channels & Gateway
- **8 channel adapters** — CLI, Web (WebSocket), WhatsApp, Instagram, Messenger, Slack, Email, REST API
- **Multi-tenant gateway** — multiple apps in one Bun/Hono process, isolated by memory, sessions, and routes
- **Human handoff** — session mode state machine (ai_active/queued/human_active/resolved), escalation detection, operator messaging
- **Embeddable widget** — Shadow DOM chat widget with auto-reconnect WebSocket, zero runtime deps

### Intelligence
- **Coordination Intelligence** — biologically-grounded multi-agent coordination: ThresholdAllocator (ant colony response-threshold model), CascadeController (neural field damped energy), TaskChannel (stigmergy substrate), TeamComposer (4 domain templates), adaptive EMA learning
- **Multi-agent routing** — 3-tier routing (regex, embedding similarity, fallback), warm handoff briefs, ping-pong guard
- **Model routing** — per-request LLM selection via complexity scoring (5 signals, <1ms) and rules engine
- **Native dev tools** — 7 executors (bash, read, write, edit, grep, glob, git), MCP stdio surface, environment-aware binary detection

### Provider Tiers
- **Subscription Direct** ($0 marginal) — OAuth device code flow + PKCE; `codex-oauth` provider targeting ChatGPT Plus
- **Direct API (BYOK)** — Anthropic, OpenAI, DeepSeek, OpenRouter, Ollama; 6 adapters, circuit breaker
- **Harness (CLI wrapper)** — Claude Code, Codex CLI, OpenCode spawned as subprocesses with full session governance
- **9 providers** in unified SessionRegistry; priority-ordered with circuit breaker and capability filtering

### Safety & Security
- **Enterprise safety** — PII detection (6 types, Luhn validation), content classification (6 categories), 4 policy rails, grounding rail (LLM judge), prompt injection detection on inputs and tool results
- **Security** — AES-256-GCM secrets, timing-safe auth, append-only audit log with hash chaining, JWT RS256/HS256 via JWKS
- **Permission governance** — per-tool/command/file policies, data firewall rules, dangerous-command detection; single `KilnPermissionPolicy` translated to all 3 CLI native formats

### Operational
- **Knowledge (RAG)** — chunkers, embedding adapters, PgVector (halfvec + HNSW + RRF hybrid search), Cohere reranking, STT (OpenAI gpt-4o-transcribe, Deepgram nova-3), contact memory with GDPR deletion
- **5 memory scopes** — user, agent, team, project, org; SQLite + FTS5 with decay curves and auto-compaction
- **Eval framework** — 23 scorers (11 rule-based + 12 LLM-as-judge), YAML-configured experiments, consistency runner (pass^k)
- **Observability** — OpenTelemetry spans (gen_ai.* conventions), Prometheus metrics, per-model cache-aware cost tracking
- **Conversation enrichment** — effort score, sentiment, resolution, CSAT via rule-based + LLM pipeline

## Meta-Orchestrator

### kiln run
- Unified session runner across 9 providers with priority-ordered circuit breaker fallback
- **Plan mode** — 3-phase workflow (explore → intent → implement), `submit_plan` approval gate, execution boundaries
- **Parallel workers** — `--workers N` spawns N isolated sessions via `Promise.allSettled`, partial-success semantics
- **Skill capture** — auto-generate skills from session transcripts (two-phase: extract summary → generate SKILL.md)
- Session persistence: `.kiln/sessions/{id}/meta.json` + `transcript.jsonl`

### kiln sync
- `kiln sync` — permissions, agents, skills, AGENTS.md across 3 CLIs from single `kiln.yaml`
- Merge-only semantics — existing keys in native config files are preserved

### kiln auth
- `kiln auth codex login` — OAuth device code flow + PKCE for ChatGPT Plus subscription
- Token persistence at `~/.kiln/auth/codex-oauth.json` with auto-refresh 120s before expiry

### kiln tui
- Two-column terminal interface (chat + sidebar), 5 built-in themes
- In-process gateway on port 4801, provider picker, plan mode badge
- `/clear`, `/plan` commands; `--workers` flag

### 25 MCP Tools
Memory, knowledge, cost, safety, integrations, routing, eval, enrichment, cross-agent memory (teamId-scoped), and 6 swarm primitives (join/leave/status/broadcast/claim/release).

## Packages

| Package | Description |
|---------|-------------|
| [`@kilnai/core`](packages/core) | Engine primitives, YAML loader, provider adapters, memory, orchestrator, knowledge, safety, security, eval, enrichment, observability |
| [`@kilnai/runtime`](packages/runtime) | Multi-app gateway, 8 channel adapters, tenant management, session registry, triggers, budget middleware, handoff, A2A |
| [`@kilnai/cli`](packages/cli) | CLI commands (init, dev, run, auth, sync, gateway, skill, domain, cron, tui, mcp-config), session registry with circuit breaker |
| [`@kilnai/tui`](packages/tui) | Terminal UI — two-column layout, 5 themes, in-process gateway session adapter |
| [`@kilnai/react`](packages/sdk) | React hooks (KilnProvider, useKilnChat, useKilnWsChat, useKilnEvents, useKilnMemory, useKilnState, useApproval) |
| [`@kilnai/widget`](packages/widget) | Embeddable chat widget — Shadow DOM, auto-reconnect WebSocket, zero runtime deps, single IIFE bundle |
| [`@kilnai/studio`](packages/studio) | Dev UI — graph view, playground, timeline, memory, eval, cost, safety (private, served at `/studio`) |

## Examples

| Example | Description | Features |
|---------|-------------|----------|
| [hello-agent](examples/hello-agent) | Your first AI agent in 60 seconds | YAML config, web channel, conversation memory |
| [support-agent](examples/support-agent) | E-commerce support with tools and safety | MCP tools, PII redaction, topic rails |
| [booking-assistant](examples/booking-assistant) | Appointment booking for a hair salon | Multi-tenant, billing, webhook triggers, chat widget |
| [multi-app-gateway](examples/multi-app-gateway) | Production gateway hosting multiple apps | Multi-app, Docker, tenant provisioning |
| [whatsapp-bot](examples/whatsapp-bot) | WhatsApp multi-tenant business bot | WhatsApp Cloud API, builtin tools, persistent memory |

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
| [CLI Wrapper](docs/guides/cli-wrapper.md) | Session backends, resume policy, config sync, context governance |
| [Eval](docs/guides/eval.md) | Scorers, datasets, experiments |
| [TUI Gateway ADR](docs/adr/ADR-002-tui-gateway-architecture.md) | Why the TUI is a thin client over the local gateway |
| [Context Governance ADR](docs/adr/ADR-004-budgeted-sufficient-context-orchestration.md) | Why Kiln manages a virtual context window instead of replaying raw history |
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

[Apache-2.0](LICENSE)
