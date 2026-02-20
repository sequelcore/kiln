<p align="center">
  <img src="docs/assets/mascot.png" alt="Kiln" width="180" />
</p>

<h1 align="center">Kiln</h1>

<p align="center">
  <a href="https://github.com/sequelcore/kiln/actions/workflows/ci.yml"><img src="https://github.com/sequelcore/kiln/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

<p align="center">Domain-agnostic AI orchestration engine. YAML-configured, multi-tenant, multi-channel.</p>

## Why Kiln?

**Configuration**
- YAML-first -- define agents, workflows, tools, gates, and triggers in a single file
- 7 primitives (Agent, Capability, Workflow, Memory, Task, Channel, Trigger) + 3 composites (Team, Router, App)
- 5 built-in domain kits (react-ts, python, docs, support, data-pipeline) with auto-detection

**Agents**
- Agent Identity Standard -- name, role, goal, backstory assembled into system prompts automatically
- 3 team modes: sequential, supervisor (manager delegates by name), swarm (agents hand off to each other)
- 4 provider adapters: Anthropic, OpenAI, DeepSeek, Ollama

**Reliability**
- Phased workflows with configurable quality gates (test, lint, typecheck)
- Checkpointing: resume after crash, fork for A/B testing, replay from any point
- Interrupt/resume at any phase for human-in-the-loop workflows
- Guardrails + structured outputs with JSON Schema validation and retry

**Memory**
- 5 scopes (user, agent, team, project, org) backed by SQLite + FTS5
- Configurable decay curves + auto-compaction when stores exceed threshold
- Git-synced project and org scopes via gzipped JSONL

**Security**
- Prompt injection detection: Tier 1 heuristic (20+ patterns) + Tier 2 deep LLM scan
- Guardian review for destructive capabilities via secondary LLM
- AES-256-GCM encrypted secrets with PBKDF2 key derivation and atomic rotation
- Append-only audit logging with SHA-256 hash chaining + tamper verification
- Tenant isolation: memory namespace enforcement + per-tenant filesystem jails

**Runtime**
- Multi-tenant gateway: multiple apps in one Bun/Hono process with per-app isolation
- 5 channel adapters: CLI, Web (WebSocket), WhatsApp, Slack, REST API (SSE)
- Triggers: webhooks (HMAC-SHA256), event listeners, cron scheduler
- Budget enforcement with per-role cost tracking and tier limits
- Cross-app delegation with schema contracts

**Developer Experience**
- `kiln init` -- interactive wizard generates app.yaml + gateway.yaml
- `kiln dev` -- hot-reload with YAML file watching + inline web debugger at `/dev/`
- `kiln skill list|install|publish` -- skill marketplace with 3-tier discovery
- 38 error codes with context-aware suggestions and doc links
- 29 typed events with multi-level streaming (state/phase/tool/token)

## Quick Start

```bash
bun add @kilnai/core @kilnai/runtime @kilnai/cli
```

Generate your app with the interactive wizard:

```bash
bunx kiln init
```

Start the development server with hot-reload:

```bash
bunx kiln dev
```

Or define your app manually in YAML:

```yaml
name: my-app
channels: [cli, web]

memory:
  scopes: [user, "agent:*", "project:*"]
  backend: sqlite+fts5

router:
  fallback: main

teams:
  main:
    mode: supervisor
    manager: architect
    agents:
      architect:
        name: Aria
        role: Senior Architect
        goal: Design robust, maintainable solutions with minimal complexity
        backstory: >
          Pragmatic architect who values simplicity over cleverness.
          Always considers failure modes and edge cases first.
        tier: reasoning
        tools: []
        structured: true
      worker:
        name: Marcus
        role: Implementation Specialist
        goal: Write clean, well-tested code that follows team conventions
        tier: coding
        tools: [memory_save, memory_recall, verify]
        count: 2
        sandbox: true

    workflow:
      phases: [analyze, plan, implement, verify]
      gates:
        plan:
          requires: [human_approval]
        verify:
          requires: [tests_pass, typecheck]

    capabilities:
      - name: memory_save
        description: Save a memory entry to scoped storage
        tags: [memory]
      - name: memory_recall
        description: Recall memories by query
        tags: [memory]
      - name: verify
        description: Execute quality gates
        tags: [verification]

    qualityGates:
      - name: typecheck
        command: "tsc --noEmit"
        required: true
      - name: test
        command: "vitest run"
        required: true

triggers:
  - name: on-deploy
    type: webhook
    path: /hooks/deploy
    team: main
    task: "Deploy triggered by {{payload.user}}"
    secretEnv: DEPLOY_WEBHOOK_SECRET
  - name: nightly-audit
    type: schedule
    cron: "0 2 * * *"
    team: main
    task: "Run nightly security audit"
```

## AI-Assisted Setup

```bash
# Option 1: Interactive wizard
bunx kiln init

# Option 2: AI-assisted
# Paste this README into Claude Code (or any AI coding agent) and say:
#   "Set up a Kiln app for [use case] with [provider] and [channels]."
# The agent will generate app.yaml, gateway.yaml, and wire everything up.
```

## Architecture

7 primitives + 3 composites, all defined as pure TypeScript interfaces:

```
App (YAML-configured)
+-- Router (pattern rules -> classifier -> fallback)
+-- Teams[]
|   +-- Team = Agents + Workflow + Capabilities + QualityGates
|   +-- mode: sequential | supervisor | swarm
+-- Memory (scoped: user, agent, team, project, org)
+-- Channels[] (CLI, Web, WhatsApp, Slack, API)
+-- Triggers[] (webhook, event, schedule)
```

**Primitives:** Agent, Capability, Workflow, Memory, Task, Channel, Trigger.
**Composites:** Team, Router, App.

The runtime hosts multiple Apps in a single process. Each app gets its own routes, memory namespace, budget enforcement, and trigger lifecycle. See [docs/architecture.md](docs/architecture.md) for the full reference.

## Packages

| Package | Description |
|---------|-------------|
| [`@kilnai/core`](packages/core) | Engine primitives, composites, YAML loader, provider adapters, memory (decay + compaction), task tree, orchestrator (checkpoint/resume/fork), domain config (5 kits), package distribution, skill system, security (6 layers), events (29 types), cost tracking |
| [`@kilnai/runtime`](packages/runtime) | Multi-app gateway server, Mode B sessions, multi-tenant management, channel adapters (5), trigger runtime (webhook/event/cron), budget middleware, cross-app delegation |
| [`@kilnai/cli`](packages/cli) | CLI commands (init, dev, run, gateway, skill, domain), interactive wizard, YAML hot-reload watcher, formatters |

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | Full architecture reference: primitives, composites, runtime modes, security, triggers, events |
| [Evolution Plan](docs/evolution-plan.md) | Vision, competitive position, roadmap, design principles |
| [Gateway](docs/gateway.md) | Gateway runtime configuration and deployment reference |
| [Channels](docs/channels.md) | Channel adapter reference (CLI, Web, WhatsApp, Slack, API) |
| [Marketplace](docs/marketplace.md) | Domain marketplace and package distribution reference |
| [Consumer Guide](docs/consumer-guide.md) | Integration guide for consumer applications |
| [Preset Format](docs/preset-format.md) | Preset YAML format specification |

## Development

```bash
git clone https://github.com/sequelcore/kiln.git
cd kiln
bun install
bun run typecheck    # Type-check all packages
bun run test         # Run all tests
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
