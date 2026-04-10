<p align="center">
  <img src="https://raw.githubusercontent.com/sequelcore/kiln/main/docs/assets/mascot.png" alt="Kiln" width="120" />
</p>

<h1 align="center">@kilnai/cli</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@kilnai/cli"><img src="https://img.shields.io/npm/v/@kilnai/cli.svg" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

<p align="center">CLI and MCP server for the Kiln AI orchestration engine.</p>

---

## What is this?

`@kilnai/cli` is the command-line interface for [Kiln](https://github.com/sequelcore/kiln). It provides an interactive setup wizard, dev mode with YAML hot-reload, and an MCP server for Claude Code integration.

## Install

```bash
bun add -g @kilnai/cli
```

Or use directly:

```bash
bunx kiln init
```

## Commands

### `kiln init`

Interactive wizard that generates `app.yaml` and `gateway.yaml`:

```bash
kiln init
```

Walks you through:
- Provider selection (Anthropic, OpenAI, DeepSeek, Ollama)
- Channel selection (CLI, Web, WhatsApp, Slack, API)
- Team mode (sequential, supervisor, swarm)
- Quality gates (test, lint, typecheck)
- Domain detection (React, Python, docs, etc.)

### `kiln dev`

Start in dev mode with YAML hot-reload and Studio UI:

```bash
kiln dev
```

- Watches `app.yaml` for changes and reloads automatically
- Serves Studio at `/studio` for visual inspection
- Exposes dev endpoints at `/dev/*` for state, events, memory, cost

### `kiln run`

Run a single task:

```bash
kiln run "Implement the login page"
```

### `kiln tui`

Start the interactive terminal UI:

```bash
kiln tui
```

Useful flags:

- `--provider <name>` to select the initial provider
- `--theme <name>` to select a theme
- `--port <number>` to override the local TUI gateway port
- `--plan` to start in plan mode

Current transport behavior:

- gateway transport is the default path
- direct transport is available only with `KILN_TUI_TRANSPORT=direct`

The default gateway path keeps TUI conversations on the runtime session pipeline so provider routing, continuity, approvals, and sidebar route labels reflect the actual backend used for each turn.

### `kiln gateway`

Start the production gateway:

```bash
kiln gateway
```

### `kiln domain`

Manage domain kits:

```bash
kiln domain detect     # Auto-detect project type
kiln domain list       # List available domain kits
```

### `kiln skill`

Manage skill packs:

```bash
kiln skill list        # List installed skills
kiln skill search      # Search skill registry
```

### `kiln memory`

Inspect and manage agent memory:

```bash
kiln memory list       # List memory entries
kiln memory search     # Full-text search
```

### `kiln status`

Show current session status:

```bash
kiln status
```

### `kiln cron`

Manage schedule triggers:

```bash
kiln cron list                    # List all schedules
kiln cron add <name> <cron> <task> [--timezone <tz>]
kiln cron remove <name>
kiln cron run <name>              # Fire immediately without resetting schedule
```

## MCP Server

The CLI includes a built-in MCP server for Claude Code integration:

```bash
kiln mcp-config        # Print MCP server configuration for Claude Code
```

This lets Claude Code use Kiln tools directly in your development workflow.

## Documentation

- [Getting Started](https://github.com/sequelcore/kiln/blob/main/docs/getting-started.md)
- [App Configuration](https://github.com/sequelcore/kiln/blob/main/docs/configuration/app-yaml.md)
- [Gateway Configuration](https://github.com/sequelcore/kiln/blob/main/docs/configuration/gateway-yaml.md)

## License

[MIT](https://github.com/sequelcore/kiln/blob/main/LICENSE)
