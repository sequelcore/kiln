# Getting Started

This document is the shortest safe entry into Kiln's current repository and
documentation.

Kiln is a biocybernetic control plane for governed AI work.

## Current Baseline

Kiln `2.1.0` is the current supported public package line for the
biocybernetic control-plane architecture. Kiln `2.0.0` remains the first
supported public baseline. The repo can be built and tested from source.

Use this guide for public package installation, source checkout, verification,
and contribution. Do not treat older `@kilnai/*` npm versions as the supported
public baseline.

## Install

For normal use from any project or machine, install the public CLI package:

```bash
bun add -g @kilnai/cli@2.1.0
kiln auth codex login
kiln gui
```

The global CLI installation includes the official CLI, GUI static assets, TUI,
runtime, and gateway contracts. `kiln gui` uses the installed `@kilnai/gui`
package by default; source-tree GUI development requires an explicit `--dev`
run from this repository.

For source development:

```bash
git clone https://github.com/sequelcore/kiln.git
cd kiln
bun install
```

## First Verification Path

The first successful experience should prove the repo is coherent before
running any operator surface:

```bash
bun run typecheck
bun run test
bun run build
```

## Verify The Workspace

Run the same baseline checks before claiming work is complete:

```bash
bun run typecheck
bun run test
bun run build
```

For GUI-only work, also use:

```bash
bun run --cwd packages/gui lint
```

## Run A Surface From Source

Use the CLI source entry point when working inside the repository:

```bash
bun --cwd packages/cli src/index.ts tui
bun --cwd packages/cli src/index.ts gui
bun --cwd packages/cli src/index.ts run "Inspect this repository"
```

Choose the surface by workflow:

| Workflow | Surface |
|---|---|
| Terminal-first supervision | TUI |
| Rich local or remote browser supervision | GUI |
| Automation, scripting, setup, and one-shot runs | CLI |
| Gateway, channels, and remote attach patterns | Runtime and gateway contracts |
| Desktop-specific capability experiments | Native, from source only in this release |

See [Operator Surfaces](guides/ops/operator-surfaces.md).

## Read This First

Read the doctrine in this order:

1. [Architecture Index](architecture/README.md)
2. [Identity](architecture/core/identity.md)
3. [Control Model](architecture/core/control-model.md)
4. [Invariants](architecture/core/invariants.md)
5. [Research Synthesis](research/foundations/01-kiln-research-synthesis.md)

Then continue with the subsystem and flow docs:

- [Subsystems](architecture/core/subsystems.md)
- [Flows](architecture/core/flows.md)
- [Safety](architecture/safety/safety.md)
- [Coordination](architecture/coordination/coordination.md)
- [Memory](architecture/context/memory.md)
- [Context Governance](architecture/context/context-governance.md)
- [Adaptation](architecture/core/adaptation.md)

## What To Understand First

Before touching code, keep these points fixed:

- Kiln regulates work; it does not merely dispatch prompts.
- Context is governed, budgeted, and safety-bounded.
- Coordination is explicit and stateful, not magical prompt inheritance.
- Safety defaults to fail-closed on ambiguous dangerous work.
- Memory is layered and revision-aware.
- Biological metaphors may explain mechanisms, but cybernetics is the governing framework.

## Current Documentation State

The architecture docs under [`docs/architecture/`](architecture/README.md) are
the source of truth for current system behavior. Research records rationale and
evidence; it does not define active contracts.

Operational guides under `docs/guides/` complement those docs with
configuration, workflow, and runtime details. If a guide and an architecture
doc overlap, the architecture doc defines doctrine and the guide defines usage.

Release notes and the changelog start at the supported `2.0` baseline. Older
published artifacts were experimental and are not the current public contract.

## Where To Go Next

- If you need doctrine: [Architecture](architecture/README.md)
- If you need operator/team standards setup: [Operator Doctrine](guides/ops/operator-doctrine.md)
- If you need rationale: [Research](research/README.md)
- If you need sequencing: [Roadmap](roadmap/README.md)
- If you need surface selection: [Operator Surfaces](guides/ops/operator-surfaces.md)
- If you need runtime configuration details: [Configuration](configuration/app-yaml.md)
- If you need release status: [Changelog](changelog.md)
