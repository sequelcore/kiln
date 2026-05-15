# FAQ

## What is Kiln?

Kiln is a biocybernetic control plane for governed AI work. It regulates work
admission, context exposure, coordination, safety, memory, provider routing,
tool authority, and evidence closeout across operator surfaces.

In practical terms, Kiln is for running governed local or remote agent sessions
with explicit policy, bounded context, auditable tools, memory evidence, and
operator-facing control surfaces.

## Is Kiln 2.0 published?

Not yet. The repo is prepared for a `2.0.0` public baseline, but the supported
`@kilnai/*` npm package line starts only after the `v2.0.0` tag is published.
Build and verify from source until then.

## Where should a new contributor start?

Start with [Getting Started](getting-started.md), run the source verification
commands, then read the architecture index and operator surface guide:

- [Architecture](architecture/README.md)
- [Operator Surfaces](guides/operator-surfaces.md)
- [Roadmap](roadmap/README.md)
- [Engineering Standards](architecture/engineering-standards.md)
- [Contributing](../CONTRIBUTING.md)

## What package manager does the repo use?

Use Bun from the repo root:

```bash
bun install
bun run typecheck
bun run test
bun run build
```

The workspace packages are under `packages/*`.

## What are the main packages?

- `@kilnai/gateway-contracts`: shared gateway, projection, and operator-surface
  contracts.
- `@kilnai/core`: control-plane contracts, policy, safety, memory, routing, and
  evaluation primitives.
- `@kilnai/runtime`: runtime surfaces, sessions, channels, triggers, and
  execution plumbing.
- `@kilnai/cli`: local CLI, GUI/TUI launchers, config projection, and MCP
  tooling.
- `@kilnai/gui`: rich private web operator surface.
- `@kilnai/native`: Electron-backed native operator surface experiments and
  projections.
- `@kilnai/tui`: interactive terminal operator surface.

## Which operator surface should I use?

Use the surface that matches the operating context. GUI is best for rich local
or remote browser supervision, native is best for desktop-specific capability,
TUI is best for SSH and terminal-first operation, CLI is best for automation,
and gateway integrations are best for Discord, Slack, webhooks, and product
channels. See [Operator Surfaces](guides/operator-surfaces.md).

## How is roadmap work tracked?

Active and deferred execution tracks live under `docs/roadmap/`. Completed
roadmap work is promoted into architecture, guide, or changelog documentation
instead of being archived as stale roadmap files.

## How are release notes different from the changelog?

`docs/changelog.md` tracks supported public changes from the 2.0 baseline.
Curated release notes live under `docs/releases/`.

## How does configuration work?

Runtime app configuration is YAML-based. Use:

- [App YAML](configuration/app-yaml.md)
- [Gateway YAML](configuration/gateway-yaml.md)
- [Global Config](guides/global-config.md)

Repo shims such as `AGENTS.md` and `CLAUDE.md` are generated projections. Update
the canonical Kiln config or project context, then regenerate the shims instead
of editing generated guidance by hand.

## How does governed memory work?

Kiln stores memory as governed records with layer, provenance, revisions,
relations, lifecycle evidence, and context-admission evidence. Reads use bounded
`kiln://memory/...` resources; writes go through governed mutation services or
the `memory_save` tool subject to memory authority. See [Memory](guides/memory.md)
and [Architecture: Memory](architecture/memory.md).
