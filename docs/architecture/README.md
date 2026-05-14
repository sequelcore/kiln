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
  Coordination model, allocation, task registry, chain control, role
  activation, and shared-state coordination.

- `managed-agents.md`
  Provider-neutral managed child invocation, admission, authority profiles,
  write evidence, live adapter proofs, terminal events, and replay invariants.

- `tool-execution.md`
  Tool policy, execution flow, timeout/retry/fallback behavior, and command
  safety boundaries.

- `engineering-standards.md`
  Canonical implementation standards: no dead code, no redundancy, explicit
  ports, Clean Architecture boundaries, surface parity, and verification rules.

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
  Runtime provider availability, model discovery, operator diagnostics, and
  provider/model selection invariants.

- `multimodal-transport.md`
  Canonical multimodal artifact transport, capability-aware route admission,
  governed transforms, managed capability delegation, provider serialization
  constraints, cross-surface projection, and replay evidence.

- `provider-credential-pools.md`
  Provider credential rotation, cooldown, runtime credential sources,
  cross-process reload, health snapshots, and secret-free observability.

- `runtime-surfaces.md`
  Canonical taxonomy for App Gateway, Operator Gateway, Studio Dev Server,
  CLI, GUI, TUI, SDK/widget, and MCP boundaries.

- `config-projection.md`
  Canonical global config, native harness projection, install-state, drift detection,
  sync/uninstall/import-native behavior, engine enablement removal, and
  managed-agent route projection.

- `harness-integration-capabilities.md`
  Canonical capability model for Claude Code, Codex, and OpenCode integration:
  runtime config injection, native projection, native config import, MCP
  runtime tools, hooks, and proof requirements.

- `operator-surfaces.md`
  Canonical human operator surface model: GUI, CLI, TUI, IDE, remote, future
  desktop wrapper, supervision evidence, and surface ownership rules.

- `benchmark-validation.md`
  Canonical benchmark validation contract: benchmark-facing profiles, internal
  baseline gates, external track gates, and reproducible reporting.

- `adaptation.md`
  Operational modes, allostatic load, predictive regulation, adaptation, and
  anti-drift rules.

- `invariants.md`
  Architectural laws, invariants, naming rules, and what is not Kiln.

## Temporary State During Refactor

`docs/architecture.md` remains present during extraction. It is temporary.

During Slice 2:

- new architecture docs become the target canonical structure
- the monolith is reduced only after modular coverage is complete
- no new doctrine should be added outside this directory
