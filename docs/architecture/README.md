# Kiln Architecture

This directory is the modular architecture source of truth for Kiln.

Kiln is a biocybernetic control plane for autonomous agent sessions. Its
contracts are expressed through cybernetic control structures, and its
architecture is informed by biological and neural regulation. The architecture
is documented by concern, not as a single monolith, and grouped into
subfolders below so no single directory holds more than a handful of
unrelated documents.

## Core (`core/`)

Identity, control model, and the invariants everything else is built on.

- [`core/identity.md`](core/identity.md)
  Canonical identity, purpose, operating model, and terminology.
- [`core/control-model.md`](core/control-model.md)
  Cybernetic control model, sensors, controllers, actuators, feedback loops,
  regulation horizons, and stability risks.
- [`core/subsystems.md`](core/subsystems.md)
  Major architectural subsystems, responsibilities, owned state, invariants,
  and failure modes.
- [`core/flows.md`](core/flows.md)
  Canonical end-to-end flows and their gates, state transitions, and
  fail-closed or recovery behavior.
- [`core/work-governance.md`](core/work-governance.md)
  Canonical work lifecycle, topology selection, direct-execution
  envelope, evidence expectations, verifier-backed work, and cross-surface
  work-policy projection.
- [`core/governed-work-execution.md`](core/governed-work-execution.md)
  Governed work execution contract tying identity, coordination, and
  work-governance doctrine together.
- [`core/bounded-work-authority.md`](core/bounded-work-authority.md)
  Canonical bounded-work contract: immutable content-digested revisions, scope
  envelope, limits versus tripwires, admission and closeout decisions, and
  project-scoped reservation, settlement, and terminal truth.
- [`core/session-model.md`](core/session-model.md)
  Canonical provider-agnostic session identity, provider-thread metadata,
  resume semantics, and cross-surface invariants.
- [`core/adaptation.md`](core/adaptation.md)
  Operational modes, allostatic load, predictive regulation, adaptation, and
  anti-drift rules.
- [`core/invariants.md`](core/invariants.md)
  Architectural laws, invariants, naming rules, and what is not Kiln.
- [`core/engineering-standards.md`](core/engineering-standards.md)
  Canonical implementation standards: no dead code, no redundancy, explicit
  ports, Clean Architecture boundaries, surface parity, native acceleration
  boundaries, and verification rules.

## Context (`context/`)

Attention, memory, and context assembly.

- [`context/context-governance.md`](context/context-governance.md)
  Context assembly, budget enforcement, attention bottleneck, and context
  policy.
- [`context/communication-governance.md`](context/communication-governance.md)
  Provider-neutral response detail, interaction behavior, preservation
  obligations, final-request evidence, and native harness projection.
- [`context/agent-context.md`](context/agent-context.md)
  Canonical operator identity, instruction profiles, agent profiles, skills,
  managed child context, precedence, admission, and surface parity.
- [`context/context-resource-plane.md`](context/context-resource-plane.md)
  Canonical read-only resource plane: pagination, workspace resources,
  artifact namespaces, notifications, high-volume resource links, resource
  tools, and consumer projection.
- [`context/context-usage-projection.md`](context/context-usage-projection.md)
  Per-turn context-usage authority states, adapter cache semantics, runtime
  normalization, Gateway mapping, persistence/replay, and surface rules.
- [`context/verified-efficiency-control-plane.md`](context/verified-efficiency-control-plane.md)
  Progressive loading promotion, typed lossless reduction, reversible context
  projection, protected evidence retention, retrieval audits, and canonical
  evidence gates.
- [`context/memory.md`](context/memory.md)
  Layered memory model, retention policy, reconsolidation, forgetting, and
  current/future-state memory design.

## Safety (`safety/`)

Threat detection and credential trust boundaries.

- [`safety/safety.md`](safety/safety.md)
  Safety doctrine, layered threat detection, escalation, and threat memory.
- [`safety/credential-governance.md`](safety/credential-governance.md)
  Provider-agnostic `SecretRef` boundary, env-backed source contract,
  rotation/refresh metadata, and secret-free diagnostics.
- [`safety/provider-credential-pools.md`](safety/provider-credential-pools.md)
  Provider credential rotation, cooldown, runtime credential sources,
  cross-process reload, health snapshots, and secret-free observability.

## Coordination (`coordination/`)

Governed work graphs, managed children, and cost/lease accounting.

- [`coordination/coordination.md`](coordination/coordination.md)
  Deterministic topology selection, governed work graphs, bounded runtime
  scheduling, per-child route identity, dependency handoffs, independent
  review, failure semantics, and cross-surface projection.
- [`coordination/agent-tasks.md`](coordination/agent-tasks.md)
  Durable Agent Tasks and their single Agent Runs: admission, route and
  authority evidence, native-harness boundaries, recovery, MCP projection, and
  replay invariants.
- [`coordination/managed-account-leases.md`](coordination/managed-account-leases.md)
  Atomic managed economic commitment, account-backed and accountless capacity,
  dispatch fencing, recovery, reconciliation, and sanitized evidence.
- [`coordination/external-runtime-governance.md`](coordination/external-runtime-governance.md)
  Provider-neutral external-runtime attachment, authority, approval, failure,
  recovery, replay, terminal consistency, and cross-surface parity.
- [`coordination/lifecycle-attribution.md`](coordination/lifecycle-attribution.md)
  Provider-neutral token and cost attribution over canonical session events:
  source classes, reconciliation, replay, request neutrality, managed-route
  usage capability gaps, and benchmark evidence.
- [`coordination/session-feedback-pipeline.md`](coordination/session-feedback-pipeline.md)
  Local-first operator feedback, redaction, evidence selection, issue draft,
  repair work item, and draft pull-request governance.

## Tooling (`tooling/`)

Tool execution policy and the shared builtin-tool surface.

- [`tooling/tool-execution.md`](tooling/tool-execution.md)
  Tool policy, execution flow, timeout/retry/fallback behavior, and command
  safety boundaries.
- [`tooling/developer-tools.md`](tooling/developer-tools.md)
  Canonical builtin developer-tool surface: command, file, search, patch,
  stat/tree, image/OCR, controlled web tools, interactive browser/computer
  automation, verbosity, metadata, and shared consumer projection.
- [`tooling/controlled-web-research.md`](tooling/controlled-web-research.md)
  Canonical governed web knowledge model: web primitives, provider adapters,
  diagnostics, extraction/research capability boundaries, and deferred
  OS-pack packaging concerns.
- [`tooling/shared-tooling-intelligence.md`](tooling/shared-tooling-intelligence.md)
  Canonical shared builtin-tool intelligence contracts: structured outputs,
  catalog discovery, code intelligence, bulk reads, monitors, task state,
  elicitation, and initial resources.
- [`tooling/capability-catalog.md`](tooling/capability-catalog.md)
  Canonical provider-neutral capability identity, fail-closed catalog admission,
  sanitized decisions, and secret-free Runtime projection boundary.

## Surfaces (`surfaces/`)

Runtime, operator, and harness-facing surface contracts.

- [`surfaces/runtime-surfaces.md`](surfaces/runtime-surfaces.md)
  Canonical taxonomy for App Gateway, Operator Gateway, CLI, GUI, native, TUI,
  SDK/widget, and MCP boundaries.
- [`surfaces/execution-surfaces.md`](surfaces/execution-surfaces.md)
  Canonical product and architecture contract for Kiln Operator Workspace,
  Kiln Gateway as app AI runtime, harnesses as adapters, and contract-first
  surface convergence.
- [`surfaces/operator-workspace.md`](surfaces/operator-workspace.md)
  Canonical human workspace contract: shared home projection ownership, target
  switcher rules, resource inspector boundary, and surface parity rules.
- [`surfaces/operator-surfaces.md`](surfaces/operator-surfaces.md)
  Canonical human operator surface model: GUI, native, CLI, TUI, IDE, remote,
  supervision evidence, embedded browser host boundaries, and surface ownership
  rules.
- [`surfaces/app-gateway-runtime.md`](surfaces/app-gateway-runtime.md)
  Canonical App Gateway runtime contract for app/tenant/session/tool/MCP
  ownership and operator attachment.

  Guide projection: [`../guides/channels/gateway-app-runtime.md`](../guides/channels/gateway-app-runtime.md).

- [`surfaces/native-operator-surface.md`](surfaces/native-operator-surface.md)
  Contract-only architecture for native operator surface projection:
  precondition gates, explicit instance/session targets, benchmark fixtures,
  and Rust hot-path boundaries.
- [`surfaces/gui-execution-presentation.md`](surfaces/gui-execution-presentation.md)
  Canonical GUI execution-presentation contract for how governed work,
  evidence, and attention state render across the GUI surface.
- [`surfaces/harness-integration-capabilities.md`](surfaces/harness-integration-capabilities.md)
  Canonical capability model for Claude Code, Codex, and OpenCode integration:
  runtime config injection, native projection, native config import, MCP
  runtime tools, hooks, and proof requirements.
- [`surfaces/config-projection.md`](surfaces/config-projection.md)
  Canonical global config, native harness projection, install-state, drift detection,
  sync/uninstall/import-native behavior, engine enablement removal, and
  managed-agent target projection.
- [`surfaces/inspectable-agent-work.md`](surfaces/inspectable-agent-work.md)
  Canonical cross-surface and cross-harness inspectability contract for agent
  work: work identity, authority, lifecycle, evidence, resources, attention
  state, long-running visibility, and external observability normalization.

## Providers (`providers/`)

Model routing, provider discovery, and cross-modal transport.

- [`providers/model-gateway.md`](providers/model-gateway.md)
  Canonical cross-harness model ingress over the target catalog, account
  selection and credential fencing, native projection, and Codex composite
  routing.
- [`providers/provider-model-discovery.md`](providers/provider-model-discovery.md)
  Runtime provider/model evidence, catalog normalization, canonical
  eligibility, operator diagnostics, and provider/model selection invariants.
- [`providers/multimodal-transport.md`](providers/multimodal-transport.md)
  Canonical multimodal artifact transport, capability-aware route admission,
  governed transforms, managed capability delegation, provider serialization
  constraints, cross-surface projection, and replay evidence.
- [`providers/voice-capability.md`](providers/voice-capability.md)
  Canonical voice capability contract for STT input, TTS output, app-level
  surface policy, artifact retention, cross-surface projection, and evidence.

## Quality (`quality/`)

Benchmark and recorded-evidence contracts.

- [`quality/benchmark-validation.md`](quality/benchmark-validation.md)
  Canonical benchmark validation contract: benchmark-facing profiles, eval
  output contracts, internal baseline gates, external track gates, and
  reproducible reporting.
- [`quality/agent-qa-showcase-recorder.md`](quality/agent-qa-showcase-recorder.md)
  Canonical recorder architecture for governed QA/showcase capture manifests,
  browser/computer capture evidence, auto-edit tracks, voice/audio, external
  editor handoff, and recorder security invariants.

## External (`external/`)

- [`external/external-engagement.md`](external/external-engagement.md)
  Governed external community-signal boundary, bounded discovery, evidence
  intake, future action proposal/approval/execution authority, and X as the
  first adapter.
