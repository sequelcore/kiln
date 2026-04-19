# Roadmap

This directory contains planning and execution documents for Kiln documentation
and architecture alignment work.

## Active Documents

- `documentation-refactor-plan.md`
  Policy document for the documentation refactor: target structure,
  principles, file disposition, and acceptance criteria.

- `architecture-refactor-plan.md`
  Execution sequence for the documentation refactor: slices, dependencies,
  review gates, deletion gates, audits, and definition of done.

- `taxonomy-freeze.md`
  Slice 1 artifact: canonical terminology, target doc map, and explicit
  disposition for active repository Markdown documents.

- `current-module-mapping.md`
  Translation layer from the existing package/module structure to the canonical
  control-plane architecture. Use this before planning code refactors.

- `bounded-context-decision-table.md`
  Explicit keep/split/merge/rename/delete decisions for the major packages and
  modules. Use this to sequence the first real code refactors.

- `orchestrator-refactor-plan.md`
  The first code-refactor execution plan. Breaks `packages/core/src/orchestrator`
  into file-level decisions, execution slices, and atomic work units.

- `orchestrator-o1-plan.md`
  Atomic implementation plan for Slice O1, focused on shrinking
  `orchestrator.ts` by extracting support concerns before any broad renaming.

- `orchestrator-o2-plan.md`
  Atomic implementation plan for Slice O2, focused on replacing the remaining
  swarm-era mechanism names with control-plane vocabulary.

- `orchestrator-o4-plan.md`
  Execution plan for Slice O4, focused on deciding which orchestrator
  strategies and team-composition surfaces still survive after O2.

- `external-benchmark-validation.md`
  Deferred milestone for public benchmark work after the remaining
  architecture and product work reaches stability.

## Usage

- Read `documentation-refactor-plan.md` first to understand the rules.
- Read `architecture-refactor-plan.md` second to understand the execution
  order.
- Use `taxonomy-freeze.md` as the working inventory and destination map during
  execution.
- Use `current-module-mapping.md` before package or subsystem refactors so code
  changes stay anchored to the frozen taxonomy.
- Use `bounded-context-decision-table.md` to decide which areas are being
  preserved, renamed, consolidated, or removed before implementation begins.
- Use `orchestrator-refactor-plan.md` when starting the first code refactor in
  `packages/core/src/orchestrator`.
- Use `orchestrator-o1-plan.md` when executing the first extraction tasks inside
  `packages/core/src/orchestrator/orchestrator.ts`.
- Use `orchestrator-o2-plan.md` when executing the first naming and boundary
  replacement tasks inside `packages/core/src/orchestrator`.
- Use `orchestrator-o4-plan.md` when deciding which strategy and team-composer
  surfaces are kept, shrunk, or deleted.

## Current Status

As of 2026-04-10:

- documentation refactor planning and major root/modular docs work are in place
- guide/config cleanup is in progress
- module mapping and bounded-context decision artifacts are complete
- first code-refactor planning package is complete for `packages/core/src/orchestrator`
- orchestrator O1 support extractions completed:
  - O1.A checkpoint extraction
  - O1.B interrupt extraction
  - O1.C dev-tool execution support extraction
  - O1.D memory sync support extraction
  - O1.E verification support extraction
  - O1.F constructor and field cleanup
  - verification run: `bun run typecheck` passed
- orchestrator O1 slice is complete
- orchestrator O2 completed; demand-allocator, chain-governor, and task-registry migrations completed
- orchestrator O4 in progress:
  - O4.A team-composer deletion completed
  - O4.B swarm strategy demoted from the public strategy barrel
  - O4.C swarm mode removed from active orchestrator support
- orchestrator O5 started:
  - public orchestrator exports no longer expose swarm strategy APIs
  - final export cleanup completed for the current orchestrator stop point
- external benchmark validation is now tracked as a deferred strategic
  milestone in `external-benchmark-validation.md`, not as an active ADR or
  implementation slice

## Rules

- Do not add new conceptual docs outside the approved taxonomy.
- Do not keep old and new doctrine alive in parallel.
- Replace and delete superseded docs once their content is absorbed.
