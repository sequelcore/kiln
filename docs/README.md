# Kiln Documentation

## Entry Points

- [Getting Started](getting-started.md)
  Fast setup, source verification, surface selection, and documentation map for
  new contributors.

- [Architecture](architecture/README.md)
  Canonical architecture doctrine for Kiln as a biocybernetic control plane.

- [Research](research/README.md)
  Canonical research foundations, mechanism mapping, and implementation gap
  analysis.

- [Configuration](configuration/app-yaml.md)
  Runtime configuration reference.

- [Guides](guides/channels.md)
  Operational and usage documentation. Architecture doctrine lives under
  `docs/architecture/`; guides focus on configuration, workflows, and runtime
  behavior.

- [Repository Hygiene](guides/repo-hygiene.md)
  Versioned Kiln project files, ignored operator state, and gitignore guidance.

- [Roadmap](roadmap/README.md)
  Active, deferred, and completed implementation tracks.

- [Changelog](changelog.md)
  Supported public change log beginning with the 2.0 baseline.

- [Release Notes](releases/README.md)
  Curated notes for supported public releases.

## Public Baseline

Kiln is preparing a `2.0.0` public baseline. The repository is public and
source-buildable today, but the supported npm package line starts when the
`v2.0.0` tag is published. Use [Getting Started](getting-started.md) to verify
the repo from source and [Operator Surfaces](guides/operator-surfaces.md) to
choose the right runtime surface.

## Architecture

Start here for Kiln identity and system design:

- [Architecture Index](architecture/README.md)
- [Identity](architecture/identity.md)
- [Control Model](architecture/control-model.md)
- [Subsystems](architecture/subsystems.md)
- [Flows](architecture/flows.md)
- [Memory](architecture/memory.md)
- [Context Governance](architecture/context-governance.md)
- [Safety](architecture/safety.md)
- [Coordination](architecture/coordination.md)
- [Managed Agents](architecture/managed-agents.md)
- [Tool Execution](architecture/tool-execution.md)
- [Agent QA Showcase Recorder](architecture/agent-qa-showcase-recorder.md)
- [Adaptation](architecture/adaptation.md)
- [Invariants](architecture/invariants.md)

## Configuration

- [App YAML](configuration/app-yaml.md)
- [Gateway YAML](configuration/gateway-yaml.md)

## Guides

Current operational guides remain under `docs/guides/` and are aligned to the
current architecture and terminology. Use architecture docs for doctrine and
guides for operator-facing behavior.

High-use guides today:

- [GUI](guides/gui.md)
- [GUI Parity](guides/gui-parity.md)
- [GUI Parity Walkthrough](guides/gui-parity-walkthrough.md)
- [Operator Surfaces](guides/operator-surfaces.md)
- [Operator Doctrine](guides/operator-doctrine.md)
- [Channels](guides/channels.md)
- [Knowledge](guides/knowledge.md)
- [Tool Use](guides/tool-use.md)
- [Observability](guides/observability.md)
- [TUI](guides/tui.md)
- [Repository Hygiene](guides/repo-hygiene.md)

## SDK And Development Surfaces

- [React SDK](guides/react-sdk.md)
- [Studio](guides/studio.md)

## ADR

Architecture decisions live under [ADR](adr/README.md) as the normalized
decision log.

## Other

- [FAQ](faq.md)
- [Contributing](../CONTRIBUTING.md)
