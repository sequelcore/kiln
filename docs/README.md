# Kiln Documentation

## Entry Points

- [Architecture](architecture/README.md)
  Canonical architecture doctrine for Kiln as a cybernetic control plane.

- [Research](research/README.md)
  Canonical research foundations, mechanism mapping, and implementation gap
  analysis.

- [Configuration](configuration/app-yaml.md)
  Runtime configuration reference.

- [Guides](guides/channels.md)
  Operational and usage documentation. During refactor, guides are still being
  cleaned to remove doctrinal overlap.

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
- [Tool Execution](architecture/tool-execution.md)
- [Adaptation](architecture/adaptation.md)
- [Invariants](architecture/invariants.md)

## Configuration

- [App YAML](configuration/app-yaml.md)
- [Gateway YAML](configuration/gateway-yaml.md)

## Guides

Current operational guides remain under `docs/guides/` and are being aligned to
the new architecture and terminology.

High-use guides today:

- [Channels](guides/channels.md)
- [Knowledge](guides/knowledge.md)
- [Tool Use](guides/tool-use.md)
- [Observability](guides/observability.md)
- [TUI](guides/tui.md)

## SDK

- [React Hooks](sdk/react-hooks.md)
- [Studio](sdk/studio.md)

## ADR

Architecture decisions remain under `docs/adr/` and are scheduled for cleanup
and renumbering during the documentation refactor.

## Other

- [FAQ](faq.md)
- [Changelog](changelog.md)
- [Contributing](../CONTRIBUTING.md)
