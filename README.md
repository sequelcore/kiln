# Kiln

[![CI](https://github.com/sequelcore/kiln/actions/workflows/ci.yml/badge.svg)](https://github.com/sequelcore/kiln/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A domain-agnostic AI orchestration engine for building multi-agent, multi-tenant applications -- configured entirely via YAML.

## Why Kiln?

- **YAML-first configuration** -- define agents, workflows, tools, and quality gates in a single file
- **Multi-provider** -- Anthropic, OpenAI, DeepSeek, Ollama adapters out of the box
- **Multi-tenant gateway** -- host multiple apps in a single Bun/Hono process with per-app isolation and budget enforcement
- **Multi-channel** -- CLI, Web, WhatsApp, Slack, and REST API adapters
- **Phased workflows** -- configurable phase sequences with approval gates and quality gates (test, lint, typecheck)
- **Scoped memory** -- user, agent, team, project, and org scopes backed by SQLite + FTS5
- **Task tree** -- scoring, selection, deepen/branch/prune operations for structured exploration
- **Cross-app delegation** -- apps can delegate tasks to other apps with schema contracts
- **Cost tracking** -- per-role, cache-aware token usage and pricing

## Quick Start

```bash
bun add @kiln/core @kiln/runtime
```

Define your app in YAML:

```yaml
name: my-app
channels: [cli, web]

memory:
  scopes: [user, "agent:planner", "agent:worker"]
  backend: sqlite+fts5

router:
  fallback: main

teams:
  main:
    agents:
      planner:
        tier: reasoning
        tools: []
        structured: true
      worker:
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
```

## Packages

| Package | Description |
|---------|-------------|
| [`@kiln/core`](packages/core) | Engine primitives, composites, YAML loader, provider adapters, memory, task tree, orchestrator, events, cost tracking |
| [`@kiln/runtime`](packages/runtime) | Multi-app gateway server, Mode B sessions, multi-tenant management, channel adapters |

## Architecture

6 primitives + 3 composites, all defined as pure TypeScript interfaces:

```
App (YAML-configured)
├── Router (pattern rules → classifier → fallback)
├── Teams[]
│   └── Team = Agents + Workflow + Capabilities + QualityGates
├── Memory (scoped: user, agent, team, project, org)
└── Channels[] (CLI, Web, WhatsApp, Slack, API)
```

**Primitives:** Agent, Capability, Workflow, Memory, Task, Channel.
**Composites:** Team, Router, App.

The runtime hosts multiple Apps in a single process. Each app gets its own routes, memory namespace, and budget enforcement.

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
