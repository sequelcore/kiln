# Kiln

Domain-agnostic AI orchestration engine. AGPL-3.0.

## Packages

| Package | Description |
|---------|-------------|
| `@kiln/core` | Engine primitives, composites, provider adapters, memory, task tree, events, cost tracking |
| `@kiln/runtime` | Multi-app gateway server, Mode B sessions, multi-tenant management, channel adapters |

## Quick Start

```bash
bun install
bun run typecheck
bun run test
```

## Architecture

6 primitives (Agent, Capability, Workflow, Memory, Task, Channel) + 3 composites (Team, Router, App) configured via YAML. The gateway runtime hosts multiple Apps in a single Bun/Hono process with per-app isolation, budget enforcement, cross-app delegation, and 5 channel adapters (CLI, Web, WhatsApp, Slack, API).

See `CLAUDE.md` for full architecture documentation.
