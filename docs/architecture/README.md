# Kiln Architecture

This directory is the modular architecture source of truth for Kiln.

Kiln is a biocybernetic control plane for autonomous agent sessions. Its
contracts are expressed through cybernetic control structures, and its
architecture is informed by biological and neural regulation. The architecture
is documented by concern, not as a single monolith.

## Documents

- `identity.md`
  Canonical identity, purpose, operating model, and terminology.

- `control-model.md`
  Cybernetic control model, sensors, controllers, actuators, feedback loops,
  regulation horizons, and stability risks.

- `subsystems.md`
  Major architectural subsystems, responsibilities, owned state, invariants,
  and failure modes.

- `flows.md`
  Canonical end-to-end flows and their gates, state transitions, and
  fail-closed or recovery behavior.

- `work-governance.md`
  Canonical work lifecycle, orchestration preference, direct-execution
  envelope, evidence expectations, verifier-backed work, and cross-surface
  work-policy projection.

- `memory.md`
  Layered memory model, retention policy, reconsolidation, forgetting, and
  current/future-state memory design.

- `context-governance.md`
  Context assembly, budget enforcement, attention bottleneck, and context
  policy.

- `agent-context.md`
  Canonical operator identity, instruction profiles, agent profiles, skills,
  managed child context, precedence, admission, and surface parity.

- `session-model.md`
  Canonical provider-agnostic session identity, provider-thread metadata,
  resume semantics, and cross-surface invariants.

- `safety.md`
  Safety doctrine, layered threat detection, escalation, and threat memory.

- `coordination.md`
  Deterministic topology selection, governed work graphs, bounded runtime
  scheduling, role intent, failure semantics, and cross-surface projection.

- `managed-agents.md`
  Provider-neutral managed child invocation, admission, authority profiles,
  lifecycle tools, parallel orchestration, leases, resource projection, remote
  harness routes, write evidence, terminal events, and replay invariants.

- `lifecycle-attribution.md`
  Provider-neutral token and cost attribution over canonical session events:
  source classes, reconciliation, replay, request neutrality, managed-route
  usage capability gaps, and benchmark evidence.

- `context-usage-projection.md`
  Per-turn context-usage authority states, adapter cache semantics, runtime
  normalization, Gateway mapping, persistence/replay, and surface rules.

- `verified-efficiency-control-plane.md`
  Progressive loading promotion, typed lossless reduction, reversible context
  projection, protected evidence retention, retrieval audits, and canonical
  evidence gates.

- `session-feedback-pipeline.md`
  Local-first operator feedback, redaction, evidence selection, issue draft,
  repair work item, and draft pull-request governance.

- `tool-execution.md`
  Tool policy, execution flow, timeout/retry/fallback behavior, and command
  safety boundaries.

- `engineering-standards.md`
  Canonical implementation standards: no dead code, no redundancy, explicit
  ports, Clean Architecture boundaries, surface parity, native acceleration
  boundaries, and verification rules.

- `developer-tools.md`
  Canonical builtin developer-tool surface: command, file, search, patch,
  stat/tree, image/OCR, controlled web tools, interactive browser/computer
  automation, verbosity, metadata, and shared consumer projection.

- `controlled-web-research.md`
  Canonical governed web knowledge model: web primitives, provider adapters,
  diagnostics, extraction/research capability boundaries, and deferred
  OS-pack packaging concerns.

- `shared-tooling-intelligence.md`
  Canonical shared builtin-tool intelligence contracts: structured outputs,
  catalog discovery, code intelligence, bulk reads, monitors, task state,
  elicitation, and initial resources.

- `context-resource-plane.md`
  Canonical read-only resource plane: pagination, workspace resources,
  artifact namespaces, notifications, high-volume resource links, resource
  tools, and consumer projection.

- `provider-model-discovery.md`
  Runtime provider/model evidence, catalog normalization, canonical
  eligibility, operator diagnostics, and provider/model selection invariants.

- `multimodal-transport.md`
  Canonical multimodal artifact transport, capability-aware route admission,
  governed transforms, managed capability delegation, provider serialization
  constraints, cross-surface projection, and replay evidence.

- `voice-capability.md`
  Canonical voice capability contract for STT input, TTS output, app-level
  surface policy, artifact retention, cross-surface projection, and evidence.

- `agent-qa-showcase-recorder.md`
  Canonical recorder architecture for governed QA/showcase capture manifests,
  browser/computer capture evidence, auto-edit tracks, voice/audio, external
  editor handoff, and recorder security invariants.

- `provider-credential-pools.md`
  Provider credential rotation, cooldown, runtime credential sources,
  cross-process reload, health snapshots, and secret-free observability.

- `credential-governance.md`
  Provider-agnostic `SecretRef` boundary, env-backed source contract,
  rotation/refresh metadata, and secret-free diagnostics.

- `external-engagement.md`
  Governed external community-signal boundary, bounded discovery, evidence
  intake, future action proposal/approval/execution authority, and X as the
  first adapter.

- `runtime-surfaces.md`
  Canonical taxonomy for App Gateway, Operator Gateway, Studio Dev Server,
  CLI, GUI, native, TUI, SDK/widget, and MCP boundaries.

- `execution-surfaces.md`
  Canonical product and architecture contract for Kiln Operator Workspace,
  Kiln Gateway as app AI runtime, harnesses as adapters, and contract-first
  surface convergence.

- `operator-workspace.md`
  Canonical human workspace contract: shared home projection ownership, target
  switcher rules, resource inspector boundary, and surface parity rules.

- `app-gateway-runtime.md`
  Canonical App Gateway runtime contract for app/tenant/session/tool/MCP
  ownership and operator attachment.

  Guide projection: `../guides/gateway-app-runtime.md`.

- `config-projection.md`
  Canonical global config, native harness projection, install-state, drift detection,
  sync/uninstall/import-native behavior, engine enablement removal, and
  managed-agent route projection.

- `harness-integration-capabilities.md`
  Canonical capability model for Claude Code, Codex, and OpenCode integration:
  runtime config injection, native projection, native config import, MCP
  runtime tools, hooks, and proof requirements.

- `operator-surfaces.md`
  Canonical human operator surface model: GUI, native, CLI, TUI, IDE, remote,
  supervision evidence, embedded browser host boundaries, and surface ownership
  rules.

- `inspectable-agent-work.md`
  Canonical cross-surface and cross-harness inspectability contract for agent
  work: work identity, authority, lifecycle, evidence, resources, attention
  state, long-running visibility, and external observability normalization.

- `native-operator-surface.md`
  Contract-only architecture for native operator surface projection:
  precondition gates, explicit instance/session targets, benchmark fixtures,
  and Rust hot-path boundaries.

- `benchmark-validation.md`
  Canonical benchmark validation contract: benchmark-facing profiles, eval
  output contracts, internal baseline gates, external track gates, and
  reproducible reporting.

- `adaptation.md`
  Operational modes, allostatic load, predictive regulation, adaptation, and
  anti-drift rules.

- `invariants.md`
  Architectural laws, invariants, naming rules, and what is not Kiln.
