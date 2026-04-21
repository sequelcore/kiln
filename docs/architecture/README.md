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

- `bounded-context-decisions.md`
  Canonical bounded-context keep/split/merge/rename/delete decisions for major
  packages and modules.

- `flows.md`
  Canonical end-to-end flows and their gates, state transitions, and
  fail-closed or recovery behavior.

- `memory.md`
  Layered memory model, retention policy, reconsolidation, forgetting, and
  current/future-state memory design.

- `context-governance.md`
  Context assembly, budget enforcement, attention bottleneck, and context
  policy.

- `safety.md`
  Safety doctrine, layered threat detection, escalation, and threat memory.

- `coordination.md`
  Coordination model, allocation, task registry, chain control, role
  activation, and shared-state coordination.

- `tool-execution.md`
  Tool policy, execution flow, timeout/retry/fallback behavior, and command
  safety boundaries.

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
