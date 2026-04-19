# Roadmap

This directory is the canonical roadmap set for documentation cleanup, codebase
realignment, GUI parity, and deferred benchmark work.

## Canonical File Set

The roadmap now uses numbered files. The number indicates the default read
order, not necessarily the active work priority.

### Foundation and references

- `01-taxonomy-freeze.md`
  Canonical terminology, target doc map, and Markdown file disposition.
- `02-module-mapping.md`
  Translation layer from the current package tree to the target architecture.
- `03-bounded-context-decisions.md`
  Explicit keep, split, merge, rename, and delete decisions for major modules.

### Execution roadmaps

- `04-orchestrator-refactor-roadmap.md`
  Canonical orchestrator roadmap. Merges the former overview plus O1, O2, and
  O4 slice-plan documents.
- `05-gui-phase-1-parity-checklist.md`
  Phase I GUI parity checklist. The deletion gate for `packages/tui/`.

### Deferred work

- `06-external-benchmark-validation.md`
  Deferred public benchmark milestone after architecture and product work
  stabilize.

## Read Order

1. Read `01-taxonomy-freeze.md` for canonical naming and file disposition.
2. Read `02-module-mapping.md` before package or subsystem refactors.
3. Read `03-bounded-context-decisions.md` before sequencing code refactors.
4. Read `04-orchestrator-refactor-roadmap.md` for the first code refactor track.
5. Read `05-gui-phase-1-parity-checklist.md` when planning or verifying GUI
   parity work.
6. Read `06-external-benchmark-validation.md` only when benchmark work becomes
   active.

## Current Execution Priority

This is the delivery queue. It is the only priority order in this index.

1. Finish the remaining work in `04-orchestrator-refactor-roadmap.md`,
   specifically the unresolved export and ownership cleanup after the O4 cuts.
2. Finish the remaining rows in `05-gui-phase-1-parity-checklist.md` so TUI
   deletion can proceed.
3. Write and accept the config and registries surface ADR before broader config
   and registry UI work starts.
4. Build GUI orchestrator surfaces only after the orchestrator cleanup and the
   config ADR land.
5. Keep `06-external-benchmark-validation.md` deferred until the product
   surface stabilizes.

## Current Status

As of 2026-04-18:

- the taxonomy freeze, module mapping, and bounded-context decisions are in
  place
- the orchestrator roadmap has been consolidated into one canonical file
- GUI parity work is active in `05-gui-phase-1-parity-checklist.md`
- parity status is 29/51 rows complete
- external benchmark validation remains deferred

## Rules

- Do not add new conceptual roadmap docs when an existing numbered file can be
  expanded instead.
- Do not split one concern across multiple near-duplicate plan files.
- Delete superseded roadmap docs when their content is absorbed.
