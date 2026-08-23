# Kiln documentation

Use this index to find the shortest path for your task. Kiln is under active
development and currently supported only from source; there is no supported
installable release for the current repository state.

## Start here

| Your goal | Read this first |
| --- | --- |
| Build and verify Kiln from source | [Getting started from source](getting-started.md) |
| Understand what Kiln governs | [Core concepts](concepts.md) |
| Decide which operator surface to use | [Operator surfaces](guides/ops/operator-surfaces.md) |
| Configure providers, accounts, and routes | [Model routing](guides/config/model-routing.md) |
| Connect Codex, Claude Code, or OpenCode | [Model Gateway operations](operations/model-gateway.md) |
| Build an application or integration | [Examples](examples/README.md) |
| Contribute code | [Contributing](../CONTRIBUTING.md) |
| Contribute documentation | [Documentation guide](contributing/documentation.md) |
| Understand architectural boundaries | [Architecture](architecture/README.md) |
| See unfinished work and blockers | [Roadmap](roadmap/README.md) |

## Documentation model

Each collection answers a different kind of question:

| Collection | Use it when you need... | Authority |
| --- | --- | --- |
| [Guides](#guides) | Steps for an operator or contributor task | Current procedures |
| [Configuration](#configuration-reference) | Exact application or gateway fields | Current configuration contract |
| [Architecture](#architecture) | Boundaries, invariants, ownership, and rationale | Current system doctrine |
| [ADRs](adr/README.md) | The record of an accepted structural decision | Decision history |
| [Research](research/README.md) | Evidence or an unresolved investigation | Rationale, not current behavior |
| [Evaluations](evaluations/README.md) | Dated experiments and observed results | Bounded evidence only |
| [Roadmap](roadmap/README.md) | Admitted work that is not complete | Work status |
| [Changelog](changelog.md) and [release notes](releases/README.md) | Historical public changes and publication evidence | Release history |

If pages conflict, architecture defines system boundaries, configuration
reference defines accepted fields, and guides define procedures. Research,
evaluations, and roadmap files never override current implementation contracts.

## Guides

Guides are grouped by the task or surface they support.

### Configure Kiln

[Browse all configuration guides](guides/config/README.md).

- [Global configuration](guides/config/global-config.md)
- [Model routing](guides/config/model-routing.md)
- [Provider credentials](guides/config/provider-credentials.md)
- [Multi-tenant operation](guides/config/multi-tenant.md)
- [Domains](guides/config/domains.md)

### Work with agents

[Browse all agent guides](guides/agents/README.md).

- [Multi-agent and role routing](guides/agents/multi-agent.md)
- [Delegation](guides/agents/delegation.md)
- [Coordination](guides/agents/coordination-intelligence.md)
- [Skills](guides/agents/skills.md)
- [Plan mode](guides/agents/plan-mode.md)

### Connect channels and tools

[Browse all channel and tool guides](guides/channels/README.md).

- [Channels](guides/channels/channels.md)
- [Canonical MCP](guides/channels/mcp.md)
- [Tool use](guides/channels/tool-use.md)
- [Triggers](guides/channels/triggers.md)
- [Hooks](guides/channels/hooks.md)
- [Gateway application runtime](guides/channels/gateway-app-runtime.md)

### Use operator surfaces

[Browse all operator interface guides](guides/gui/README.md).

- [GUI](guides/gui/gui.md)
- [GUI parity](guides/gui/gui-parity.md)
- [GUI parity walkthrough](guides/gui/gui-parity-walkthrough.md)
- [TUI](guides/gui/tui.md)
- [React SDK](guides/gui/react-sdk.md)
- [CLI wrapper](guides/gui/cli-wrapper.md)

### Work with context and evaluation

[Browse the context and evaluation guides](guides/knowledge/README.md).

- [Memory](guides/knowledge/memory.md)
- [Evaluation](guides/knowledge/eval.md)
- [Evaluation benchmarking](guides/knowledge/eval-benchmarking.md)

### Operate and maintain Kiln

[Browse all operations guides](guides/ops/README.md).

- [Operator surfaces](guides/ops/operator-surfaces.md)
- [Operator doctrine](guides/ops/operator-doctrine.md)
- [Operator workspace](guides/ops/operator-workspace.md)
- [Observability](guides/ops/observability.md)
- [Safety](guides/ops/safety.md)
- [Repository hygiene](guides/ops/repo-hygiene.md)
- [Voice](guides/ops/voice.md)
- [Governed external engagement](guides/ops/external-engagement.md)

## Configuration reference

- [Application YAML](configuration/app-yaml.md)
- [Gateway YAML](configuration/gateway-yaml.md)
- [Global configuration](guides/config/global-config.md)

The global configuration guide currently combines procedures and field
reference. Treat the parser and tests as authoritative if a field description
is ambiguous, and report the documentation gap.

## Architecture

Start with the [architecture index](architecture/README.md). These pages provide
the shortest conceptual path:

1. [Identity](architecture/core/identity.md)
2. [Control model](architecture/core/control-model.md)
3. [System invariants](architecture/core/invariants.md)
4. [Subsystems](architecture/core/subsystems.md)
5. [Runtime flows](architecture/core/flows.md)

Continue by concern:

- [Context governance](architecture/context/context-governance.md)
- [Memory](architecture/context/memory.md)
- [Safety](architecture/safety/safety.md)
- [Coordination](architecture/coordination/coordination.md)
- [Agent Tasks and Agent Runs](architecture/coordination/agent-tasks.md)
- [Tool execution](architecture/tooling/tool-execution.md)
- [Operator surfaces](architecture/surfaces/operator-surfaces.md)
- [Model Gateway](architecture/providers/model-gateway.md)
- [Adaptation](architecture/core/adaptation.md)

## Project evidence and status

- [Roadmap](roadmap/README.md) — unfinished work and admission boundaries
- [Research](research/README.md) — foundations and active investigations
- [Evaluations](evaluations/README.md) — dated smoke, route, and benchmark evidence
- [ADRs](adr/README.md) — accepted architectural decisions
- [Changelog](changelog.md) — unreleased source changes and historical public changes
- [Release notes](releases/README.md) — historical publication and prerelease records
- [Release runbook](operations/release.md) — publication procedure, not evidence that a release exists

## Documentation status

The documentation set is being renewed for a future rebranded release. During
this transition:

- current source behavior must not be described as a supported package release;
- the existing project and package names are provisional;
- old release records remain historical evidence;
- operator-specific paths, credentials, and incident payloads must never be
  committed; and
- documentation defects should be reported like code defects, with the page,
  conflicting evidence, and expected reader outcome.

See the [documentation guide](contributing/documentation.md) for content types,
style, accessibility, commands, examples, and review requirements.

## Other resources

- [FAQ](faq.md)
- [Examples](examples/README.md)
- [Contributing](../CONTRIBUTING.md)
- [Apache 2.0 license](../LICENSE)
