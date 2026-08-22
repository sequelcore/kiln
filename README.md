<p align="center">
  <img src="docs/assets/logo.svg" alt="Kiln" width="150" />
</p>

<h1 align="center">Kiln</h1>

<p align="center">
  A control plane for governed AI work across agent harnesses and application surfaces.
</p>

<p align="center">
  <a href="https://github.com/sequelcore/kiln/actions/workflows/ci.yml"><img src="https://github.com/sequelcore/kiln/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="Apache 2.0 license" /></a>
</p>

> [!IMPORTANT]
> Kiln is under active development and currently supported only from source.
> There is no supported installable release for this repository state. The
> project name and `@kilnai/*` package coordinates are provisional and are
> expected to change before the next public release.

Kiln gives applications, operators, and native coding harnesses one place to
decide what AI work may run, which target and account may execute it, what
context and tools it may receive, and what evidence must remain afterward.

It is not another agent loop or a generic model proxy. Codex, Claude Code,
OpenCode, the Kiln CLI, and application gateways keep their own interfaces.
Kiln provides the shared execution and governance layer beneath them.

## What Kiln provides

- **Canonical execution routing.** Operator surfaces and managed workers select
  governed execution targets instead of copying provider, model, account, and
  fallback policy into every client.
- **Cross-harness model access.** The local Model Gateway exposes admitted
  virtual models to Codex, Claude Code, and OpenCode while preserving each
  harness's own tools, permissions, and session model.
- **Bounded authority.** Admission, approval, tool, credential, and action-effect
  boundaries fail closed when required evidence is missing or contradictory.
- **Coordinated work.** Goals, work items, managed children, dependencies, and
  independent review share an explicit lifecycle instead of relying on prompt
  convention.
- **Governed context and memory.** Context is selected under budget and trust
  rules; durable memory retains provenance, revision, and lifecycle evidence.
- **Recoverable native integration.** Generated Codex, Claude Code, and OpenCode
  configuration is owned, drift-aware, and restored before a dependent local
  service is removed.

## How the pieces fit

```text
Codex / Claude Code / OpenCode -- Model Gateway -+
CLI / TUI / GUI -------------- Operator Runtime -+-- Kiln Runtime
Apps / channels ------------------ App Gateway ---+        |
                                                          v
                                             admitted execution target
                                                          |
                                                          v
                                             provider + fenced account
```

The interfaces do not become interchangeable. They share Kiln's execution
target catalog, policy, capacity, and evidence while retaining their native agent
loops and capabilities.

## Evaluate Kiln from source

You need [Git](https://git-scm.com/) and
[Bun 1.3.14](https://bun.sh/docs/installation).

```bash
git clone https://github.com/sequelcore/kiln.git
cd kiln
bun install --frozen-lockfile
bun packages/cli/src/index.ts --help
bun run typecheck
```

The help command is the safest first execution: it does not require provider
credentials or native harness configuration. Run the broader repository gates
before submitting a change:

```bash
bun run test
bun run build
```

See [Getting started](docs/getting-started.md) for the complete source-first
path and the current platform boundaries.

## Choose your path

| If you want to... | Start here |
| --- | --- |
| Understand the product and its boundaries | [Core concepts](docs/concepts.md) |
| Build and inspect the repository | [Getting started](docs/getting-started.md) |
| Configure execution targets and providers | [Model routing](docs/guides/config/model-routing.md) |
| Search effective settings or reset one override | [Global configuration](docs/guides/config/global-config.md#inspect-and-change-settings) |
| Understand the cross-harness proxy | [Model Gateway](docs/architecture/providers/model-gateway.md) |
| Choose a CLI, TUI, GUI, or gateway surface | [Operator surfaces](docs/guides/ops/operator-surfaces.md) |
| Build an application on the runtime | [Examples](docs/examples/README.md) |
| Contribute code or documentation | [Contributing](CONTRIBUTING.md) |
| Study the system design | [Architecture](docs/architecture/README.md) |

The [documentation index](docs/README.md) maps tutorials, task guides,
reference material, architecture, research, evaluations, and project status.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `packages/gateway-contracts` | Shared HTTP, WebSocket, projection, and operator-surface contracts |
| `packages/core` | Pure control-plane policy, domain contracts, safety, memory, routing, and evaluation |
| `packages/runtime` | Runtime sessions, gateways, providers, channels, managed execution, and persistence |
| `packages/cli` | CLI commands, configuration, native projections, and local lifecycle control |
| `packages/gui` | Web operator surface |
| `packages/tui` | Terminal operator surface |
| `packages/sdk` | React client and hooks |
| `packages/widget` | Embeddable web component |
| `packages/native` | Experimental native desktop surface |
| `packages/tools*` | Governed developer-tool resolution and platform packages |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing code. Documentation
changes follow the public [documentation guide](docs/contributing/documentation.md).

## License

Kiln is licensed under the [Apache License 2.0](LICENSE).
