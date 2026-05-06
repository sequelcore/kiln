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

- `memory.md`
  Layered memory model, retention policy, reconsolidation, forgetting, and
  current/future-state memory design.

- `context-governance.md`
  Context assembly, budget enforcement, attention bottleneck, and context
  policy.

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

- `developer-tools.md`
  Canonical builtin developer-tool surface: command, file, search, patch,
  stat/tree, image/OCR, controlled web tools, verbosity, metadata, and shared
  consumer projection.

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

- `provider-credential-pools.md`
  Provider credential rotation, cooldown, runtime credential sources,
  cross-process reload, health snapshots, and secret-free observability.

- `runtime-surfaces.md`
  Canonical taxonomy for App Gateway, Operator Gateway, Studio Dev Server,
  CLI, GUI, TUI, SDK/widget, and MCP boundaries.

- `operator-surfaces.md`
  Canonical human operator surface model: GUI, CLI, TUI, IDE, remote, future
  desktop wrapper, supervision evidence, and surface ownership rules.

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
