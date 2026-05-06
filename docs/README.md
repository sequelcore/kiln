# Kiln Documentation

## Entry Points

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

- [Roadmap](roadmap/README.md)
  Refactor policy, execution sequence, and taxonomy freeze.

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
- [Channels](guides/channels.md)
- [Knowledge](guides/knowledge.md)
- [Tool Use](guides/tool-use.md)
- [Observability](guides/observability.md)
- [TUI](guides/tui.md)
- [TUI Maintenance](guides/tui-maintenance.md)

## SDK

- [React Hooks](sdk/react-hooks.md)
- [Studio](sdk/studio.md)

## ADR

Architecture decisions live under `docs/adr/` as the normalized decision log.

## Other

- [FAQ](faq.md)
- [Changelog](changelog.md)
- [Contributing](../CONTRIBUTING.md)
