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
- `packages/cli/src/application/instruction-profile-loader.ts` owns canonical
  instruction profile loading from Kiln filesystem config.
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

Instruction profiles, agents, and skills are canonical filesystem config, not
inline YAML fields. Global definitions live under `~/.kiln/instructions/`,
`~/.kiln/agents/`, and `~/.kiln/skills/`; project definitions live under
`.kiln/instructions/`, `.kiln/agents/`, and `.kiln/skills/`. Native harness
agent and skill files remain generated projections, and `AGENTS.md` may project
active instruction profile ids and canonical file paths for direct harness use.

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

## Project Roots And Repo Shims

Global native projections and repo-local instruction shims are different target
families.

Global native projections write into harness-owned user config locations such as
Claude Code, Codex, and OpenCode config, agent, and skill directories. They make
direct standalone harness use see Kiln's canonical operator doctrine and agent
roster.

Repo shims write into a specific project root, such as generated `AGENTS.md` and
generated `CLAUDE.md`. They are scoped project entrypoints for harnesses that
load repository guidance before Kiln runtime exists. Repo shims must be derived
from the merged canonical config for that project: global config, global
instruction profiles, global agents, global skills, project `kiln.yaml`, and
project `.kiln/instructions|agents|skills`.

Repo-shim projection must resolve the project root before writing. The durable
resolution order is:

1. explicit CLI path such as `--project` or `--cwd`
2. nearest ancestor containing `.kiln/kiln.yaml`
3. nearest repository root when it can be treated as a Kiln project root

If the root is ambiguous or lacks enough Kiln project identity for a repo-local
shim, sync must fail closed instead of writing generated instructions into an
incidental current working directory. Running sync from a subdirectory of the
same project must resolve the same repo-shim target paths.

`kiln sync --repo-shims` generates repo instruction entrypoints. `AGENTS.md` is
the shared repo shim for Codex CLI and OpenCode. `CLAUDE.md` is the repo shim
for Claude Code. Future harness-specific repo entrypoints must be added to the
same projection pipeline instead of creating another source of truth. The
projection may summarize canonical doctrine and link profile ids, but it must
not become a second source of truth for identity, workflow, agent profiles,
skills, route policy, or permissions.

Repo context adoption may use a managed agent and a dedicated repo-context skill
to synthesize project guidance from real repository evidence. That agent output
is advisory until Kiln validates it against the project-context schema and the
operator approves adoption. Deterministic commands own root resolution, stack
and script detection, generated-file signatures, install-state records, drift
detection, backups, and projection writes.

`kiln project scout` exposes deterministic repository evidence. `kiln project
adopt` writes `.kiln/project-context.md` as canonical project context and blocks
when existing context differs unless the operator explicitly forces replacement.
Generated repo shims may project `.kiln/project-context.md`, but they must not
own its content. Project context, project instruction profiles, project agents,
and project skills are canonical repo config and should be versionable; runtime
state under `.kiln/` remains ignored.

Generated repo shims must contain a stable Kiln signature and projection
metadata: target kind, project root identity, source profile ids, generator
version, and content hash. Sync uses that metadata to block unmanaged files and
drifted managed files unless `--force` is explicit; forced overwrites are backed
up under `.kiln/backups/repo-shims/`. Config/status surfaces use the same
metadata to classify each repo guidance file as current managed projection,
stale managed projection, managed file with drift, unmanaged existing guidance,
missing projection, or blocked by ambiguous root. Unmanaged files are never
overwritten silently; Kiln may recommend adoption or backup, but the adoption
command must make the source and target explicit.

Configuration inspection uses the same canonical status contract across
operator surfaces. `KilnConfigStatusSnapshot` reports resolved project root,
global config status, project config status, adopted project-context status,
effective config availability, repo-shim projection status, native projection
install-state status, and harness integration capabilities. CLI commands,
future runtime tools, GUI/TUI setup screens, SDK/widget descriptors, and audit
events must consume that shared contract instead of re-reading YAML or native
files independently. The model-callable `kiln_config.read` tool is a read-only
projection of this contract; it may inspect effective config and status but
must not mutate configuration or native provider files.

Configuration mutation starts with structured proposals, not patches. A
proposal records operation id, normalized payload, affected canonical paths,
native projection effects, authority impact, validation diagnostics, preview
diff, and rollback hint. Skill and agent profile proposals validate against the
same `SKILL.md` and Kiln agent-profile parsers used by runtime discovery.

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
- Repo-local generated shims require an explicitly resolved project root; the
  command's current working directory is not a sufficient architecture contract.
- Generated repo shims must be self-identifying through Kiln projection
  metadata so status surfaces can explain whether a file is managed, stale,
  drifted, unmanaged, or missing.
- Managed-agent route projection is governed config, not assistant preference.
- `routing.routes` is the default managed-agent route source; explicit
  `managedAgents.routes` is an allowlist override, not a second routing graph to
  keep in sync.
- Instruction profile, agent, and skill definitions are canonical only under
  Kiln-owned directories, never in native harness folders.
