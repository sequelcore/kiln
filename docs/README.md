# Kiln Documentation

## Getting Started

- [Getting Started](getting-started.md) -- Installation, wizard walkthrough, first app
- [Core Concepts](concepts.md) -- Primitives, composites, team modes, runtime modes
- [FAQ](faq.md) -- Common questions and answers

## Configuration

- [App YAML](configuration/app-yaml.md) -- Complete `app.yaml` field reference
- [Gateway YAML](configuration/gateway-yaml.md) -- Gateway config, Mode A/B, billing, triggers

## Guides

| Guide | Scope |
|-------|-------|
| [Channels](guides/channels.md) | 8 channel adapters (CLI, Web, WhatsApp, Instagram, Messenger, Slack, Email, API) |
| [Knowledge](guides/knowledge.md) | RAG pipeline, vector stores, STT, contact memory |
| [Tool Use](guides/tool-use.md) | Tool execution, authorization, webhook/integration tools, native developer tools, and MCP exposure |
| [Multi-Agent Routing](guides/multi-agent.md) | Multiple agents per tenant, 3-tier routing, handoff briefs |
| [Model Routing](guides/model-routing.md) | Per-request model selection, complexity scoring, rules |
| [Enrichment](guides/enrichment.md) | Post-conversation analytics (effort score, sentiment, CSAT) |
| [Observability](guides/observability.md) | OTel spans, Prometheus metrics, cost tracking |
| [Multi-Tenant](guides/multi-tenant.md) | Tenant isolation, registry, per-tenant config |
| [Memory](guides/memory.md) | 5 scopes, decay curves, compaction, git sync |
| [Safety](guides/safety.md) | PII detection, content classification, policy rails |
| [Triggers](guides/triggers.md) | Webhooks, event listeners, cron scheduler |
| [Domains](guides/domains.md) | Domain kits, detection patterns, quality gates |
| [Eval](guides/eval.md) | Scorers, datasets, experiments, comparator |
| [Eval Benchmarking](guides/eval-benchmarking.md) | Scorer-to-research mapping, predictive metrics, industry standards |
| [Delegation](guides/delegation.md) | Cross-app delegation, A2A protocol |
| [CLI Wrapper](guides/cli-wrapper.md) | IKilnSession, harness backends, direct API backends via ProviderSession, permission policy, session resume, and config sync |
| [Hooks](guides/hooks.md) | HookRegistry, lifecycle events, modes, kiln.yaml config |
| [Skills](guides/skills.md) | SKILL.md format, registry, capture pipeline, CLI commands |
| [Plan Mode](guides/plan-mode.md) | `kiln plan` command, 3-phase workflow, execution boundaries |

## SDK

- [React Hooks](sdk/react-hooks.md) -- `@kilnai/react` hooks reference
- [Studio](sdk/studio.md) -- Dev UI: graph, playground, timeline, memory, eval

## Architecture Decision Records

| ADR | Status | Topic |
|-----|--------|-------|
| [ADR-001](adr/ADR-001-neural-field-orchestration.md) | Deferred | Neural Field Orchestration — FieldStore as coordination primitive |
| [ADR-002](adr/ADR-002-subprocess-integration.md) | Accepted | Subprocess Integration -- 5 limitations and architectural solutions |
| [ADR-002 TUI](adr/ADR-002-tui-gateway-architecture.md) | Accepted | TUI Gateway Architecture -- thin TUI over gateway-owned orchestration |
| [ADR-003](adr/ADR-003-meta-orchestrator-model.md) | Accepted | Meta-Orchestrator Model -- why Kiln orchestrates CLIs, not plugins |
| [ADR-004](adr/ADR-004-budgeted-sufficient-context-orchestration.md) | Proposed | Budgeted Sufficient Context Orchestration -- virtual context window and projected working set |

## Contributing

- [Architecture](architecture.md) -- Bounded contexts, dependency rules, internal design
- [Contributing](../CONTRIBUTING.md) -- Development setup, code standards, PR checklist
- [Changelog](changelog.md) -- Version history
