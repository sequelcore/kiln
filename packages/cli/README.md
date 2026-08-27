<p align="center">
  <img src="https://raw.githubusercontent.com/sequelcore/kiln/main/docs/assets/mascot.png" alt="Kiln" width="120" />
</p>

<h1 align="center">@kilnai/cli</h1>

<p align="center">
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License: Apache-2.0" /></a>
</p>

<p align="center">CLI, GUI launcher, and MCP tooling for the Kiln governed AI control plane.</p>

---

## What is this?

> [!IMPORTANT]
> This is a provisional workspace package in a source-only development tree.
> There is no supported package installation for the current repository state,
> and the package coordinate is expected to change before the next release.

`@kilnai/cli` is the command-line interface for
[Kiln](https://github.com/sequelcore/kiln). It provides local operator
commands, GUI/TUI launchers, config projection tools, workflow commands, and
the dev-tools MCP server.

## Run from source

```bash
bun install --frozen-lockfile
bun packages/cli/src/index.ts --help
```

Run these commands from the repository root. The command reference below uses
the installed spelling `kiln` to describe the interface; it is not a current
package-install instruction.

## Commands

### `kiln init`

Adopt the current project for its first safe planning turn:

```bash
kiln init
```

The interactive flow selects an already admitted direct target, confirms the
restrictive `read-only` permission posture, and writes only
the private project's `config.yaml` through the configuration mutation authority. It never
writes credentials, machine paths, `app.yaml`, `gateway.yaml`, or wizard state.

For deterministic automation:

```bash
kiln init --non-interactive --target-id <target-id> --approve
```

Provider and target admission must already be complete. Creating a new target
is a separate governed operation; `kiln init` does not manufacture the policy,
economic, or discovery evidence required to admit one. Automation must name an
exact `--target-id` when no default exists; `--approve` never selects the first
catalog entry implicitly. Rerunning a reconciled project is a no-op. If the
canonical write committed but reconciliation failed, rerunning retries that
reconciliation before reporting the first turn ready. While that reconciliation
is active, status remains pending and another apply fails closed. Crash recovery
resumes the exact interrupted proposal, retaining its approval and rollback.

Project state is stored under the operator-private
`~/.kiln/projects/<krp_sha256>/` binding. Its identity-only `adoption.json`
binds the canonical project root to `config.yaml`, context, profiles, skills,
sessions, runtime state, caches, evidence, and backups. A relocated project has
a new identity and must be explicitly re-adopted; the CLI does not read or
migrate a repository-local `.kiln/` tree.

### `kiln dev`

Start the canonical App Gateway from the repository's `gateway.yaml`:

```bash
kiln dev
```

- Requires `gateway.yaml`, or a gateway path supplied with `--config`
- Watches the gateway config and local `app.yaml`, reporting when a restart is required
- Enables project-local swarm coordination for development workflows
- Accepts `--open` to open the existing GUI at `/gui/`; it does not start a separate development UI or control plane

### `kiln run`

Run a single task:

```bash
kiln run "Implement the login page"
```

Useful flags:

- `--target <id>` to select an admitted execution target from the global catalog
- `--output answer` to write only assistant content to stdout for exact-format evals
- `--output json` to write a structured `kiln.run.output.v1` envelope
- `--deliberation-level <id>` to request one advertised model deliberation level
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

- `--theme <name>` to select a theme
- `--port <number>` to override the local TUI gateway port
- `--plan` to start in plan mode

Current transport behavior:

- gateway transport is the default path
- direct transport is available only with `KILN_TUI_TRANSPORT=direct`

The default gateway path keeps TUI conversations on the runtime session
pipeline so provider routing, continuity, approvals, deliberation, and
sidebar route labels reflect the actual backend used for each turn.

Inside the TUI, use `/target` to choose an execution target and, when its policy
admits multiple accounts, either `Automatic (Kiln)` or an eligible account override. Use
`/deliberation` to cycle the admitted model's advertised levels.

### `kiln gateway`

Start or reconcile the supervised production gateway:

```bash
kiln gateway start
kiln gateway status
kiln gateway restart
```

Use `kiln gateway serve` only for a foreground development process. Production
lifecycle state and the local control credential live separately under the
private project's `runtime/app-gateway/` directory.

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
kiln benchmark readiness --baseline ~/.kiln/projects/<krp_sha256>/benchmarks/tool.json
kiln benchmark run-internal --profile kiln-tool-agent --output ~/.kiln/projects/<krp_sha256>/benchmarks/tool.json
kiln benchmark run-internal --profile kiln-model-roster-backend-write --target opencode-go-glm53 --k 5 --output ~/.kiln/projects/<krp_sha256>/benchmarks/glm53-backend.json
kiln benchmark run-internal --profile kiln-tool-agent --target codex-terra --deliberation-level-sweep low,medium,high --output ~/.kiln/projects/<krp_sha256>/benchmarks/deliberation.json
```

`run-internal` writes one benchmark JSON status document to stdout and stores
the full baseline artifact at `--output`. Per-item session output is routed
through the non-human run-output contract so assistant deltas, tool notices, and
provider fallback notices do not pollute stdout.

Route and deliberation comparisons require an explicit configured execution
route. Use `--deliberation-level <id>` for one fixed level or
`--deliberation-level-sweep <comma-list>` for a paired comparison. Every member
has a distinct reproducibility hash and capability-backed resolution evidence;
no level name receives a provider-neutral experimental exception.

Rust optimization is tracked in `docs/roadmap/00.0.1-rust-module-optimization.md`.
The CLI no longer exposes a Rust readiness proof command; future Rust module
evidence should be added through a dedicated approved slice instead of a
temporary benchmark subcommand.

## Canonical MCP

Inspect, safely test, and synchronize canonical global/project MCP servers:

```bash
kiln config read --view mcp
kiln mcp-config --test --server <id>
kiln mcp-config --client codex
kiln mcp-config --repair --client codex
kiln mcp-config --uninstall --client codex
kiln uninstall codex
```

Kiln-owned direct sessions do not depend on native projection. Projection is
managed, reversible, drift-aware, and preserves unmanaged native settings. See
`docs/guides/mcp.md` for configuration, security, App Gateway, and Roblox Studio.
For Codex, `mcp-config` additionally installs the project-scoped Kiln control
plane as a stdio child; it does not require the HTTP Model Gateway process.

## Documentation

- [Getting started](../../docs/getting-started.md)
- [Application configuration](../../docs/configuration/app-yaml.md)
- [Gateway configuration](../../docs/configuration/gateway-yaml.md)

## License

[Apache 2.0](../../LICENSE)
