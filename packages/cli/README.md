<p align="center">
  <img src="https://raw.githubusercontent.com/sequelcore/kiln/main/docs/assets/mascot.png" alt="Kiln" width="120" />
</p>

<h1 align="center">@kilnai/cli</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@kilnai/cli"><img src="https://img.shields.io/npm/v/@kilnai/cli.svg" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License: Apache-2.0" /></a>
</p>

<p align="center">CLI, GUI launcher, and MCP tooling for the Kiln governed AI control plane.</p>

---

## What is this?

`@kilnai/cli` is the command-line interface for
[Kiln](https://github.com/sequelcore/kiln). It provides local operator
commands, GUI/TUI launchers, config projection tools, workflow commands, and
the dev-tools MCP server.

## Install

```bash
bun add -g @kilnai/cli
```

This installs the official CLI, GUI launcher/assets, TUI, runtime, and gateway
contracts so `kiln gui` and `kiln tui` can run from any project directory.

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
- Provider selection
- Channel selection
- Team mode selection for YAML app scaffolding
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

Useful flags:

- `--provider <name>` to select the provider for the run
- `--model <name>` to select the model for providers that require model selection
- `--output answer` to write only assistant content to stdout for exact-format evals
- `--output json` to write a structured `kiln.run.output.v1` envelope
- `--effort <minimal|low|medium|high|xhigh>` or
  `--reasoning-effort <minimal|low|medium|high|xhigh>` to set reasoning effort
  for providers/models that support it
- `--authority <auto|read_only|audited|destructive>` to request a bounded turn
  authority on direct providers
- `--plan` to start in plan mode
- `--workers <number>` to run isolated parallel workers

Reasoning effort is forwarded through the shared session contract. For the
Codex CLI wrapper it becomes Codex's `model_reasoning_effort` config override;
for direct runtime providers it is sent as provider request metadata.

`audited` keeps action-level approval gates. Human interactive CLI runs prompt
when Runtime emits `approval_requested`; non-interactive and structured-output
runs fail closed instead of auto-approving. `destructive` is an explicit
operator authority request, not a substitute for `audited` automation.
`codex-oauth` is a Kiln direct provider and does not launch Codex CLI. The
separate `codex` provider is the native harness route; on Windows it requires a
spawnable native executable (`.exe`/`.com`) and never executes `.cmd`/`.bat`
through a shell.

### `kiln tui`

Start the interactive terminal UI:

```bash
kiln tui
```

Useful flags:

- `--provider <name>` to select the initial provider
- `--model <name>` to select the initial model
- `--theme <name>` to select a theme
- `--port <number>` to override the local TUI gateway port
- `--plan` to start in plan mode

Current transport behavior:

- gateway transport is the default path
- direct transport is available only with `KILN_TUI_TRANSPORT=direct`

The default gateway path keeps TUI conversations on the runtime session
pipeline so provider routing, continuity, approvals, reasoning effort, and
sidebar route labels reflect the actual backend used for each turn.

Inside the TUI, use `/provider` to change provider/model and `/effort` to cycle
the active model's advertised reasoning effort options.

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

### `kiln benchmark`

Inspect benchmark contracts and write local evidence artifacts:

```bash
kiln benchmark profiles
kiln benchmark readiness --baseline ./.kiln/benchmarks/tool.json
kiln benchmark run-internal --profile kiln-tool-agent --output ./.kiln/benchmarks/tool.json
kiln benchmark run-internal --profile kiln-tool-agent --provider codex --model gpt-5.5 --reasoning-effort-sweep low,medium,high --output ./.kiln/benchmarks/effort.json
```

`run-internal` writes one benchmark JSON status document to stdout and stores
the full baseline artifact at `--output`. Per-item session output is routed
through the non-human run-output contract so assistant deltas, tool notices, and
provider fallback notices do not pollute stdout.

Reasoning-effort runs require an explicit provider/model pair. Use
`--reasoning-effort <level>` for one fixed level or
`--reasoning-effort-sweep <comma-list>` for a paired comparison. Every member
has a distinct reproducibility hash and capability-backed resolution evidence.
Experimental `xhigh` additionally requires `--allow-experimental-xhigh`,
`--effort-budget-usd`, and `--estimated-effort-cost-usd`.

Rust optimization is tracked in `docs/roadmap/00.0.1-rust-module-optimization.md`.
The CLI no longer exposes a Rust readiness proof command; future Rust module
evidence should be added through a dedicated approved slice instead of a
temporary benchmark subcommand.

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

[Apache-2.0](https://github.com/sequelcore/kiln/blob/main/LICENSE)
