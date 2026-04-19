# Roadmap

This directory is the canonical roadmap set for documentation cleanup, codebase
realignment, GUI parity, and deferred benchmark work.

## Canonical File Set

The roadmap now uses numbered files. The number indicates the default read
order, not necessarily the active work priority.

### Foundation and references

- `01-bounded-context-decisions.md`
  Explicit keep, split, merge, rename, and delete decisions for major modules.

### Execution roadmaps

- `02-orchestrator-refactor-roadmap.md`
  Canonical orchestrator roadmap. Merges the former overview plus O1, O2, and
  O4 slice-plan documents.
- `03-gui-phase-1-parity-checklist.md`
  Phase I GUI parity checklist. The deletion gate for `packages/tui/`.

### Deferred work

- `04-external-benchmark-validation.md`
  Deferred public benchmark milestone after architecture and product work
  stabilize.

## Read Order

1. Read `01-bounded-context-decisions.md` before sequencing code refactors.
2. Read `02-orchestrator-refactor-roadmap.md` for the first code refactor track.
3. Read `03-gui-phase-1-parity-checklist.md` when planning or verifying GUI
   parity work.
4. Read `04-external-benchmark-validation.md` only when benchmark work becomes
   active.

## Current Execution Priority

This is the delivery queue. It is the only priority order in this index.

1. Finish the remaining work in `02-orchestrator-refactor-roadmap.md`,
   specifically the unresolved export and ownership cleanup after the O4 cuts.
2. Finish the remaining rows in `03-gui-phase-1-parity-checklist.md` so TUI
   deletion can proceed.
3. Write and accept the config and registries surface ADR before broader config
   and registry UI work starts.
4. Build GUI orchestrator surfaces only after the orchestrator cleanup and the
   config ADR land.
5. Keep `04-external-benchmark-validation.md` deferred until the product
   surface stabilizes.

## Current Status

As of 2026-04-19:

- the taxonomy freeze and module mapping slices are closed
- bounded-context decisions now lead the roadmap sequence
- `packages/runtime/src/session` Slice 3 (support-helper extraction) is complete
- `packages/runtime/src/session` Slice 4 (internal orchestrator decomposition) is complete
- `packages/runtime/src/session` Slice 5 (runtime session vocabulary rename) is complete
- the orchestrator roadmap has been consolidated into one canonical file
- GUI parity work is active in `03-gui-phase-1-parity-checklist.md`
- parity status is 29/51 rows complete
- external benchmark validation remains deferred

## Rules

- Do not add new conceptual roadmap docs when an existing numbered file can be
  expanded instead.
- Do not split one concern across multiple near-duplicate plan files.
- Delete superseded roadmap docs when their content is absorbed.
