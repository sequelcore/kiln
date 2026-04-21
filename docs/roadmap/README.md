# Roadmap

This directory is the canonical roadmap set for active execution tracks and
deferred benchmark work.

## Canonical File Set

The roadmap uses numbered files only for active execution tracks. The number
indicates the default read order, not necessarily the active work priority.

### Architecture references

- `docs/architecture/flows.md`
  Canonical runtime and tool-flow sequencing after ingress admission.
- `docs/architecture/subsystems.md`
  Canonical subsystem boundaries, owned responsibilities, and failure modes.
- `docs/architecture/coordination.md`
  Canonical coordination primitives and their current vocabulary.
- `docs/architecture/invariants.md`
  Architectural laws and non-negotiable rules.
- `docs/architecture/context-governance.md`
  Canonical context-assembly ownership and budget doctrine.
- `docs/architecture/tool-execution.md`
  Canonical tool authority, execution, and safety boundaries.

### Active roadmaps

- `01-gui-phase-1-parity-checklist.md`
  Phase I GUI parity checklist. The deletion gate for `packages/tui/`.

### Deferred work

- `02-external-benchmark-validation.md`
  Deferred public benchmark milestone after architecture and product work
  stabilize.

## Read Order

1. Read the relevant architecture docs in `docs/architecture/` before
   sequencing code refactors, especially `flows.md`, `subsystems.md`,
   `coordination.md`, `invariants.md`, `context-governance.md`, and
   `tool-execution.md`.
2. Read `01-gui-phase-1-parity-checklist.md` when planning or verifying GUI
   parity work.
3. Read `02-external-benchmark-validation.md` only when benchmark work becomes
   active.

## Current Execution Priority

This is the delivery queue. It is the only priority order in this index.

1. Finish the remaining rows in `01-gui-phase-1-parity-checklist.md` so TUI
   deletion can proceed without preserving architectural drift.
2. Write and accept the config and registries surface ADR before broader config
   and registry UI work starts.
3. Keep `02-external-benchmark-validation.md` deferred until the product
   surface stabilizes.

## Current Status

As of 2026-04-21:

- the taxonomy freeze and module mapping slices are closed
- bounded-context doctrine now lives only in the stable architecture docs,
  not in a standalone pseudo-roadmap matrix
- orchestrator cleanup, admitted-turn convergence, execution-boundary cleanup,
  and authority/audit convergence are complete for the current runtime stop
  point
- that doctrine now lives in `docs/architecture/flows.md`,
  `docs/architecture/subsystems.md`, `docs/architecture/context-governance.md`,
  `docs/architecture/tool-execution.md`, `docs/architecture/coordination.md`,
  and `docs/architecture/invariants.md`
- GUI parity work is active in `01-gui-phase-1-parity-checklist.md`
- parity status is 29/51 rows complete
- external benchmark validation remains deferred

## Rules

- Do not add new conceptual roadmap docs when an existing numbered file can be
  expanded instead.
- Do not split one concern across multiple near-duplicate plan files.
- Delete superseded roadmap docs once their stable doctrine is absorbed into
  canonical architecture or guide documentation.
