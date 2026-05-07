# Config Projection

Kiln treats `~/.kiln/config.yaml` as the global source of truth for local
operator and harness configuration. Project `kiln.yaml` may override it for a
workspace, but native harness files are projected artifacts, not source state.

Supported native projection targets are Claude Code, Codex, and OpenCode.
Harness integration strategy is capability-driven; see
`harness-integration-capabilities.md` for runtime config injection, plugin,
MCP, hook, and proof rules. Additional harnesses require a new roadmap slice
when adoption justifies the cost.

## Ownership

The config projection boundary is owned by the CLI config layer.

- `packages/cli/src/config/global-config.ts` owns canonical global config
  validation.
- `packages/cli/src/config/harness-integration-capabilities.ts` owns harness
  integration capability declarations.
- `packages/cli/src/config/config-merger.ts` merges global and project config.
- `packages/cli/src/config/native-*-projection.ts` owns native file IO for
  permissions, hooks, agents, and skills.
- `packages/cli/src/config/native-projection-state.ts` owns install-state,
  managed-field hashes, whole-file hashes, and drift detection.
- `packages/cli/src/config/managed-agent-routes.ts` projects enabled engine and
  managed-agent config into runtime `ManagedInvocationToolOptions`.
- `packages/cli/src/commands/sync.ts` orchestrates sync. It does not own
  projection translation rules.
- `packages/cli/src/commands/uninstall.ts` removes recorded managed projection
  state from native files.

No GUI, TUI, runtime, SDK, or MCP surface may rebuild these rules independently.
Those surfaces consume resolved config, route health, gateway contracts, or
runtime tool options.

## Global Config

Global config is the active user-level contract. It includes:

- `engines` for harness availability and billing metadata
- `routing` and optional budget-aware fallback behavior
- `models.default` and provider-specific `models.<engine>` values
- `permissions`, `mcp`, and `hooks`
- `managedAgents` route policy
- `identity`, `ui.theme`, and bundled `components`

The current canonical schema version is `"1"`. Kiln does not support
compatibility shims for obsolete or partial global config files. Invalid global
config is an adoption error: commands that intentionally write a canonical
replacement must back up the invalid file before writing.

Agents and skills are canonical filesystem config, not inline YAML fields.
Global definitions live under `~/.kiln/agents/` and `~/.kiln/skills/`; project
definitions live under `.kiln/agents/` and `.kiln/skills/`. Native harness
agent and skill files remain generated projections.

## Sync Contract

`kiln sync` projects the merged Kiln config into supported native harness files
when native projection is the selected harness strategy. Projection is one-way.

Sync executes serially by projection surface and target. Successful writes remain
committed if a later target fails; Kiln does not automatically roll native files
back. It reports all observed target errors and exits non-zero on any target
failure.

Before overwriting an existing native projection file, Kiln writes an append-only
backup under `.kiln/backups/<target-id>/`. New files are not backed up.

If global config marks a known harness engine as `enabled: false`, sync first
uninstalls recorded managed projections for that harness and excludes that
harness from new permission, hook, agent, and skill projection writes.

## Install State And Drift

`.kiln/install-state.json` records each managed projection target. Document
targets track managed field paths and field hashes. File targets track the
whole-file `$file` hash.

On sync, Kiln compares current native content against install-state before
writing. Drift on managed fields or managed files aborts that target unless the
operator confirms `--force`. Unmanaged native keys remain outside the drift
contract and are preserved by document-field projection.

`kiln import-native <target>` is the explicit path to absorb selected native
settings into Kiln config. It is not reverse sync. It supports Codex and
OpenCode native settings that Kiln can represent in canonical global config.

`kiln uninstall [target]` removes only recorded managed projection state.
Harness aliases such as `codex` resolve to all recorded targets for that
harness, including config, agents, skills, and hooks. Exact target IDs remain
available for surgical removal.

## Managed Agent Route Projection

Ordered `routing.routes` project into governed managed-agent runtime routes
when no explicit `managedAgents.routes` allowlist is present. Eligible direct
providers require an explicit tool-call-capable model; harnesses require
live-proven result handoff for the requested managed profile and use their route
model, provider-specific `models.<engine>`, or the adapter's safe default. If no
ordered route list exists, enabled supported child engines project into the same
read-only route contract only when their handoff proof is complete. The CLI
resolves route health once using global config, engine availability, credential
state, provider-advertised model catalogs, model capability, profile-specific
harness proof, and optional managed-agent overrides, then passes the same
`ManagedInvocationToolOptions` to
GUI, TUI, CLI run, and operator gateway sessions.

When at least one healthy route exists, runtime tool projection exposes
`managed_agent.invoke`. Missing or unhealthy routes fail closed with operator
diagnostics. Surfaces do not decide their own child-agent provider list.

Synthesized child routes are read-only and use `foundation-readonly-plan`. Write
capable routes require explicit route config plus live-proven write evidence
support. A harness that can prove write evidence but cannot yet prove
substantive read-only result handoff remains unavailable for
`foundation-readonly-plan`.

## Invariants

- Native harness files are projected artifacts.
- Harness integration decisions come from the shared capability model, not
  scattered per-command conditionals.
- Drift is an error condition, not a steady state.
- Projection targets are explicit and bounded to Claude Code, Codex, and
  OpenCode.
- Model names are provider-specific; cross-provider defaults must not be blindly
  copied into harness config.
- Config projection must be shared by all operator surfaces.
- Managed-agent route projection is governed config, not assistant preference.
- `routing.routes` is the default managed-agent route source; explicit
  `managedAgents.routes` is an allowlist override, not a second routing graph to
  keep in sync.
- Agent and skill definitions are canonical only under Kiln-owned agent and
  skill directories, never in native harness folders.
