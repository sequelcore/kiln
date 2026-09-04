<p align="center">
  <img src="docs/assets/logo.svg" alt="Kiln" width="150" />
</p>

<h1 align="center">Kiln</h1>

<p align="center">
  A governed agent runtime and operator workspace for bounded AI work.
</p>

<p align="center">
  <a href="https://github.com/sequelcore/kiln/actions/workflows/ci.yml"><img src="https://github.com/sequelcore/kiln/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="Apache 2.0 license" /></a>
</p>

> [!IMPORTANT]
> Kiln is under active development and currently supported only from source.
> There is no supported installable release for this repository state. The
> project name and `@kilnai/*` package coordinates are provisional and are
> expected to change before the next public release. The supported source
> baseline is branch `dev` on Windows 11 x64; closed issue
> [#103](https://github.com/sequelcore/kiln/issues/103) records its exact commit.

Kiln executes bounded AI work through its first-party Runtime and gives
operators and applications one place to decide what may run, which target and
account may execute it, what context and tools it may receive, and what
evidence must remain afterward.

Kiln combines a Runtime-owned model-and-tool loop with the wider control plane
that governs authority, routing, evidence, recovery, and completion. Codex,
Claude Code, and OpenCode can also attach as optional execution adapters. They
retain their own interfaces and internal agent loops; Kiln governs the admitted
invocation boundary and the evidence it accepts from them.

## What Kiln provides

- **First-party governed execution.** Kiln Runtime can run bounded
  model-and-tool sessions directly through admitted providers and Kiln-owned
  tools, without requiring an external coding harness.
- **Canonical execution routing.** Operator surfaces and managed workers select
  governed execution targets instead of copying provider, model, account, and
  fallback policy into every client.
- **Optional harness integration.** The local Model Gateway and harness
  adapters expose admitted routes to Codex, Claude Code, and OpenCode while
  preserving each harness's own tools, permissions, and session model.
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
Operator Workspace / CLI / TUI
Applications / channels
              |
              v
     Kiln Runtime / Gateway
              |
      admitted execution
              |
     +--------+--------+
     |                 |
     v                 v
 First-party      External harness
  execution          invocation
     |                 |
     v                 v
Kiln agent loop   Harness-owned loop
     |                 |
     v                 v
Provider +        Codex / Claude Code /
Kiln tools        OpenCode
```

The first-party path is independently useful and does not require an external
harness. When an external harness is selected, Kiln admits and supervises the
invocation without claiming control over the harness's hidden provider calls,
tools, retries, subagents, or scheduling.

## Project state

`kiln init` binds the canonical project root to an operator-private namespace
under `~/.kiln/projects/<krp_sha256>/`. The namespace contains the project
`config.yaml`, identity-only `adoption.json`, context, profiles, skills,
sessions, runtime state, caches, evidence, and backups. The repository is not a
mutable Kiln state root; `AGENTS.md` and `CLAUDE.md` are project-owned guidance
reviewed and versioned with the code. Relocating a project creates a new identity and requires
explicit re-adoption. Kiln does not read or migrate a repository-local `.kiln/`
tree.

## Evaluate Kiln from source

The supported baseline requires Windows 11 x64,
[Git](https://git-scm.com/), and [Bun 1.4.0](https://bun.sh/docs/installation).
macOS, Linux, remote GUI exposure, and installable package or tag workflows are
not part of this source baseline.

```bash
git clone --branch dev https://github.com/sequelcore/kiln.git
cd kiln
git rev-parse HEAD
bun install --frozen-lockfile
bun packages/cli/src/index.ts --help
bun run typecheck
```

Compare the printed commit with the exact baseline recorded in closed issue
#103; do not rely on the repository's default branch. The help command is the
safest first execution: it does not require provider
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
