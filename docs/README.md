# Kiln Documentation

## Entry Points

- [Getting Started](getting-started.md)
  Fast setup, source verification, surface selection, and documentation map for
  new contributors.

- [Architecture](architecture/README.md)
  Canonical architecture doctrine for Kiln as a biocybernetic control plane.

- [Coordination Guide](guides/agents/coordination-intelligence.md)
  Operator workflow for governed work graphs, specialist selection, dependency
  handoffs, and independent review.

- [Research](research/README.md)
  Canonical research foundations, mechanism mapping, and implementation gap
  analysis.

- [Configuration](configuration/app-yaml.md)
  Runtime configuration reference.

- [Examples](examples/README.md)
  Source-run examples for gateway apps, MCP tools, widgets, tenants, and
  channels.

- [Multi-Agent and Role Routing](guides/agents/multi-agent.md)
  When multiple roles are justified and how they remain subordinate to Kiln's
  control-plane contracts.

- [Guides](guides/channels/channels.md)
  Operational and usage documentation. Architecture doctrine lives under
  `docs/architecture/`; guides focus on configuration, workflows, and runtime
  behavior.

- [Repository Hygiene](guides/ops/repo-hygiene.md)
  Versioned Kiln project files, ignored operator state, and gitignore guidance.

- [Roadmap](roadmap/README.md)
  Canonical execution queue, track states, dependencies, and admission boundaries.

- [Changelog](changelog.md)
  Supported public change log beginning with the 2.0 baseline.

- [Release Notes](releases/README.md)
  Curated notes for supported public releases and clearly marked prerelease
  candidates.
- [Release Runbook](operations/release.md)
  Canonical package publication, verification, and recovery procedure.

## Public Baseline

Kiln `2.1.0` is the current supported public package line. Kiln `2.0.0`
remains the first supported public baseline for the current biocybernetic
control-plane architecture. The repository is public and source-buildable. Use
[Getting Started](getting-started.md) to install or verify the repo from source
and [Operator Surfaces](guides/ops/operator-surfaces.md) to choose the right runtime
surface.

## Architecture

Start here for Kiln identity and system design:

- [Architecture Index](architecture/README.md)
- [Identity](architecture/core/identity.md)
- [Control Model](architecture/core/control-model.md)
- [Subsystems](architecture/core/subsystems.md)
- [Flows](architecture/core/flows.md)
- [Memory](architecture/context/memory.md)
- [Context Governance](architecture/context/context-governance.md)
- [Safety](architecture/safety/safety.md)
- [Coordination](architecture/coordination/coordination.md)
- [Managed Agents](architecture/coordination/managed-agents.md)
- [Tool Execution](architecture/tooling/tool-execution.md)
- [Agent QA Showcase Recorder](architecture/quality/agent-qa-showcase-recorder.md)
- [Voice Capability](architecture/providers/voice-capability.md)
- [Adaptation](architecture/core/adaptation.md)
- [Invariants](architecture/core/invariants.md)

## Configuration

- [App YAML](configuration/app-yaml.md)
- [Gateway YAML](configuration/gateway-yaml.md)

## Guides

Operational guides live under `docs/guides/`, grouped by concern so no folder
mixes unrelated reader tasks. Use architecture docs for doctrine and guides
for operator-facing behavior.

- **`guides/gui/`** — GUI, GUI parity, TUI, CLI wrapper, Studio, React SDK
  ([GUI](guides/gui/gui.md), [GUI Parity](guides/gui/gui-parity.md),
  [GUI Parity Walkthrough](guides/gui/gui-parity-walkthrough.md),
  [TUI](guides/gui/tui.md), [Studio](guides/gui/studio.md),
  [React SDK](guides/gui/react-sdk.md), [CLI Wrapper](guides/gui/cli-wrapper.md))
- **`guides/config/`** — global config, model routing, provider credentials,
  multi-tenant, domains
  ([Global Config](guides/config/global-config.md),
  [Model Routing](guides/config/model-routing.md),
  [Provider Credentials](guides/config/provider-credentials.md),
  [Multi-Tenant](guides/config/multi-tenant.md),
  [Domains](guides/config/domains.md))
- **`guides/agents/`** — multi-agent routing, delegation, coordination, skills,
  plan mode
  ([Multi-Agent and Role Routing](guides/agents/multi-agent.md),
  [Delegation](guides/agents/delegation.md),
  [Coordination Guide](guides/agents/coordination-intelligence.md),
  [Skills](guides/agents/skills.md), [Plan Mode](guides/agents/plan-mode.md))
- **`guides/channels/`** — channels, MCP, tool use, triggers, hooks, gateway
  app runtime
  ([Channels](guides/channels/channels.md), [Canonical MCP](guides/channels/mcp.md),
  [Tool Use](guides/channels/tool-use.md), [Triggers](guides/channels/triggers.md),
  [Hooks](guides/channels/hooks.md),
  [Gateway App Runtime](guides/channels/gateway-app-runtime.md))
- **`guides/knowledge/`** — knowledge, memory, enrichment, eval
  ([Knowledge](guides/knowledge/knowledge.md), [Memory](guides/knowledge/memory.md),
  [Enrichment](guides/knowledge/enrichment.md), [Eval](guides/knowledge/eval.md),
  [Eval Benchmarking](guides/knowledge/eval-benchmarking.md))
- **`guides/ops/`** — observability, repository hygiene, operator doctrine and
  surfaces, safety, voice, external engagement
  ([Observability](guides/ops/observability.md),
  [Repository Hygiene](guides/ops/repo-hygiene.md),
  [Operator Doctrine](guides/ops/operator-doctrine.md),
  [Operator Surfaces](guides/ops/operator-surfaces.md),
  [Operator Workspace](guides/ops/operator-workspace.md),
  [Safety](guides/ops/safety.md), [Voice](guides/ops/voice.md),
  [Governed External Engagement](guides/ops/external-engagement.md))

## ADR

Architecture decisions live under [ADR](adr/README.md) as the normalized
decision log.

## Other

- [FAQ](faq.md)
- [Contributing](../CONTRIBUTING.md)
