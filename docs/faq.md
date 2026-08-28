# FAQ

## What is Kiln?

Kiln is a biocybernetic control plane for governed AI work. It regulates work
admission, context exposure, coordination, safety, memory, provider routing,
tool authority, and evidence closeout across operator surfaces.

In practical terms, Kiln is for running governed local or remote agent sessions
with explicit policy, bounded context, auditable tools, memory evidence, and
operator-facing control surfaces.

## Is Kiln published?

Historical `2.x` packages were published, but the current repository state has
no supported installable release. Evaluate and contribute to it from source.
The current project name and `@kilnai/*` package coordinates are provisional
and are expected to change before the next public release.

## Where should a new contributor start?

Start with [Getting Started](getting-started.md), run the source verification
commands, then read the architecture index and operator surface guide:

- [Architecture](architecture/README.md)
- [Operator Surfaces](guides/ops/operator-surfaces.md)
- [Roadmap](roadmap/README.md)
- [Engineering Standards](architecture/core/engineering-standards.md)
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

These are current workspace identities, not promised future package names:

- `@kilnai/gateway-contracts`: shared gateway, projection, and operator-surface
  contracts.
- `@kilnai/core`: control-plane contracts, policy, safety, memory, routing, and
  evaluation primitives.
- `@kilnai/runtime`: runtime surfaces, sessions, channels, triggers, and
  execution plumbing.
- `@kilnai/cli`: local CLI, GUI/TUI launchers, config projection, and MCP
  tooling.
- `@kilnai/gui`: public web operator surface served by the runtime.
- `@kilnai/tui`: interactive terminal operator surface.

## Which operator surface should I use?

Use the surface that matches the operating context. GUI is best for rich local
or remote browser supervision, native is best for desktop-specific capability,
TUI is best for SSH and terminal-first operation, CLI is best for automation,
and gateway integrations are best for Discord, Slack, webhooks, and product
channels. See [Operator Surfaces](guides/ops/operator-surfaces.md).

## Is the Model Gateway a proxy?

Yes, in a narrow and deliberate sense. It is a local, authenticated gateway
that accepts supported Codex, Claude Code, and OpenCode model requests. Native
Codex requests are forwarded to Codex; Kiln virtual model IDs resolve to
canonical execution targets owned by Kiln Runtime.

It is not a general-purpose network proxy and does not replace provider terms,
credentials, or entitlement checks. See
[Operate the Model Gateway](operations/model-gateway.md).

## Can every harness use every other harness's models?

Not automatically. Supported harnesses can receive a shared catalog of
Kiln-admitted virtual models when a compatible ingress, principal, execution
route, and provider entitlement are configured. Codex and OpenCode use the
OpenAI Responses ingress; Claude Code uses Anthropic Messages.

The harnesses share model access, not their agent loops. Each still owns its
tools, prompts, permissions, session behavior, and native capabilities. A
model appearing in a picker proves configuration discovery; only a real,
bounded turn proves that the provider route and entitlement work.

## How is roadmap work tracked?

Active and deferred execution tracks live under `docs/roadmap/`. Completed
roadmap work is promoted into architecture, guide, or changelog documentation
instead of being archived as stale roadmap files.

## How are release notes different from the changelog?

`docs/changelog.md` separates current unreleased source changes from historical
public changes. Curated historical release and prerelease records live under
`docs/releases/`. Neither surface proves that the current repository state is
published.

## How does configuration work?

Runtime app configuration is YAML-based. Use:

- [App YAML](configuration/app-yaml.md)
- [Gateway YAML](configuration/gateway-yaml.md)
- [Global Config](guides/config/global-config.md)

Repository `AGENTS.md` and `CLAUDE.md` files are project-owned guidance, not
Kiln projections. Keep portable project invariants in `AGENTS.md`; a minimal
project-owned `CLAUDE.md` may import it and add only Claude-specific deltas.
Kiln configuration, permissions, routing, and private context remain in their
executable or private owners.

## How does governed memory work?

Kiln stores memory as governed records with layer, provenance, revisions,
relations, lifecycle evidence, and context-admission evidence. Reads use bounded
`memory_search` and `kiln://memory/...` resources; writes go through governed
mutation services or the `memory_save` tool subject to memory authority. See
[Memory](guides/knowledge/memory.md) and [Architecture: Memory](architecture/context/memory.md).
