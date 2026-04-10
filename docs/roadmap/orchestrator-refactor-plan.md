# Orchestrator Refactor Plan

This document is the first code-refactor execution plan.

Scope:

- `packages/core/src/orchestrator`

Its purpose is to convert the old orchestrator directory into an explicit,
bounded, control-plane-aligned refactor sequence.

## Objective

Refactor `packages/core/src/orchestrator` so it stops acting as a dumping ground
for:

- execution flow
- phase logic
- chain logic
- allocation logic
- checkpointing
- swarm-era mechanism experiments

and instead becomes a controlled migration path toward:

- `IngressGovernor`
- `DemandAllocator`
- `ChainGovernor`
- governed execution flow support

## Current Progress

Status snapshot as of 2026-04-10:

- Slice O1: completed
- Slice O2: completed
- Slice O3: not started
- Slice O4: completed
- Slice O5: started

Progress recorded:

- directory inventory reviewed
- file-level decisions defined
- atomic implementation plan for O1 written
- O1.A checkpoint extraction implemented
- O1.B interrupt extraction implemented
- O1.C dev-tool execution support extraction implemented
- O1.D memory sync support extraction implemented
- O1.E verification support extraction implemented
- O1.F constructor and field cleanup implemented
- O2.B chain-governor migration completed
- O2.C task-registry migration completed
- O2 demand-allocator migration completed
- O4 strategy-ownership review completed
- O4 plan written in `docs/roadmap/orchestrator-o4-plan.md`
- O4.A team-composer deletion completed
- O4.B swarm strategy surface demoted
- O4.C swarm mode removed from `TeamMode` and orchestrator strategies
- O5.A public export cleanup removed swarm strategy APIs from `orchestrator/index.ts`
- O5.B final export sweep completed for the current orchestrator stop point
- typecheck passed after the current O1, O2, O4, and O5 slices

## Constraints

- no dead compatibility layer kept alive without a concrete migration need
- no mass rename without first isolating ownership
- no speculative abstraction added "just in case"
- each slice must leave the tree in a compilable state once implementation starts

## Current File Inventory

Top-level files:

- `orchestrator.ts`
- `phase-machine.ts`
- `demand-allocator.ts`
- `chain-governor.ts`
- `task-registry.ts`
- `demand-signal.ts`
- `guardrails.ts`
- `interrupt.ts`
- `checkpoint-store.ts`
- `checkpoint-types.ts`
- `sqlite-checkpoint-store.ts`
- `schemas.ts`
- `index.ts`
- `strategies/`

## File-Level Decisions

| File or area | Decision | Target direction | Notes |
|--------------|----------|------------------|-------|
| `orchestrator.ts` | `split`, `rename` | Decompose into execution coordinator, admission/control boundaries, and support services | Currently too large and cross-cutting |
| `phase-machine.ts` | `keep`, `split` | Keep if phase control remains real; isolate as governed flow state rather than orchestrator identity | Needs relationship clarified with future `ModeController` |
| `demand-allocator.ts` | `rename`, `split` | Preserve useful scoring/allocation logic under `DemandAllocator`; remove the obsolete allocator naming | Old biological name should not survive |
| `chain-governor.ts` | `rename`, `split` | Preserve bounded continuation logic under `ChainGovernor`; remove cascade framing | Old name should not survive |
| `task-registry.ts` | `split`, `merge`, `rename` | Move valid shared task-state mechanics into task-registry logic | Current name and framing are now aligned |
| `team-composer.ts` | `split`, `delete` | Keep only if role-template logic still has a concrete runtime use; otherwise delete | High risk of framework residue |
| `demand-signal.ts` | `keep`, `merge`, `rename` | Keep if it remains useful as signal normalization for `DemandAllocator` | Rename around demand or admission vocabulary |
| `guardrails.ts` | `merge` | Rehome under safety/tool-execution or flow validation if still needed | Does not belong as orchestrator-owned concept long term |
| `interrupt.ts` | `keep`, `merge` | Keep interrupt model; likely move nearer execution/session lifecycle ownership | Useful but misplaced long term |
| `checkpoint-store.ts` | `keep`, `merge` | Preserve persistence contract; likely move to execution/session persistence area | Infra contract, not orchestrator identity |
| `checkpoint-types.ts` | `keep`, `merge` | Keep with checkpointing boundary | Same as above |
| `sqlite-checkpoint-store.ts` | `keep`, `merge` | Keep as infrastructure implementation | Likely moves with checkpoint store |
| `schemas.ts` | `split`, `merge`, `delete` | Keep only schemas still tied to surviving flows; delete old architect-plan specific residue if superseded | Needs narrow review during implementation |
| `index.ts` | `rewrite` | Export only surviving or transitional APIs | Must stop re-exporting obsolete public names once replacements land |
| `strategies/` | `split`, `rename`, `keep` | Retain only strategies that map cleanly to governed execution flows | Current naming likely carries old mode assumptions |

## Strategic Calls

### 1. Do not start with mass renames

Broad renaming across multiple mechanism files at once would create noise
without reducing coupling. First isolate ownership, then replace obsolete names
one boundary at a time.

### 2. `orchestrator.ts` is the first cut

The main class currently mixes:

- session lifecycle
- phase control
- cost tracking
- tree ownership
- tool execution
- provider registry
- memory sync
- checkpointing
- interrupts

That is too much authority for one class and is the clearest signal of
architectural drift.

### 3. Mechanism names should disappear only after replacement exists

`DemandAllocator`, `ChainGovernor`, and `TaskRegistry` should remain only
until their replacement boundaries are in place. Once the new boundaries exist,
the old names should be removed rather than aliased permanently.

## Execution Slices

### Slice O1 - Stabilize the main class boundary

Status: completed.

Progress recorded:

- O1 plan created in `docs/roadmap/orchestrator-o1-plan.md`
- O1.A checkpointing extracted into `orchestrator-checkpoint-support.ts`
- O1.B interrupts extracted into `orchestrator-interrupt-support.ts`
- O1.C dev-tool execution support extracted into `orchestrator-dev-tool-support.ts`
- O1.D memory sync extracted into `orchestrator-memory-sync-support.ts`
- O1.E verification extracted into `orchestrator-verification-support.ts`
- `orchestrator.ts` now delegates checkpointing, interrupts, dev-tool execution, memory sync, and verification
- `orchestrator.ts` constructor and field cleanup completed
- verification command run: `bun run typecheck` -> passed

Goal:
Reduce `orchestrator.ts` into smaller internal responsibilities without yet
changing public product terminology.

Focus:

- identify cohesive responsibility clusters
- extract helper services or submodules
- reduce constructor and method sprawl

Expected result:

- smaller `orchestrator.ts`
- clearer boundaries around checkpointing, interrupts, dev-tool execution, and
  verification

### Slice O2 - Separate execution flow from mechanism experiments

Status: completed.

Goal:
Split stable execution-flow support from old swarm-era or biologically named
mechanism files.

Focus:

- separate phase/flow mechanics
- isolate mechanism-specific files
- identify what belongs to future governors versus what is pure residue

Expected result:

- stable execution-flow core
- explicit list of files ready for rename or deletion

### Slice O3 - Introduce target vocabulary internally

Status: not started.

Goal:
Begin replacing old mechanism framing with canonical architecture language in
the code structure.

Focus:

- `demand-allocator` -> demand/allocation boundary
- `chain-governor` -> chain-governance boundary
- `task-registry` -> task-registry boundary

Expected result:

- transitional internal structure that matches the roadmap terminology

### Slice O4 - Resolve strategy ownership

Status: completed.

Goal:
Review `strategies/` and keep only strategy patterns that still make sense under
governed execution.

Focus:

- determine which strategies remain valid
- remove or demote swarm-era assumptions
- ensure strategy selection does not redefine architecture

Expected result:

- strategy layer reduced to a narrow execution concern

Current atomic progress:

- O4.A Team composer removal: completed
- O4.B Strategy narrowing: completed
- O4.C Swarm strategy ownership review: completed

### Slice O5 - Clean public exports

Status: started.

Goal:
Rewrite `index.ts` and any public exports so obsolete names are not kept alive
after replacements land.

Focus:

- export only surviving APIs
- remove old names once migration is complete

Expected result:

- public surface matches the new architecture direction

Current atomic progress:

- O5.A Remove swarm strategy APIs from `orchestrator/index.ts`: completed
- O5.B Final export sweep after strategy-mode decision: completed

## Atomic Work Units

When implementation begins, each worker task should stay atomic. Good atomic
examples for this refactor:

1. Extract checkpointing concerns out of `orchestrator.ts`
2. Extract interrupt concerns out of `orchestrator.ts`
3. Isolate dev-tool execution concerns out of `orchestrator.ts`
4. Rehome `demand-allocator.ts` into a demand-allocation boundary
5. Rehome `chain-governor.ts` into a chain-governance boundary
6. Reclassify `task-registry.ts` into task-registry logic

Bad atomic task examples:

- refactor the whole orchestrator directory
- rename all swarm files and update everything
- migrate orchestrator and session together

## Risks

- `orchestrator.ts` may be a de facto public integration point in more places
  than expected
- `strategies/` may encode assumptions that leak into CLI/runtime behavior
- renaming exported types too early could create broad compile fallout
- task/tree/checkpoint logic may be more tightly coupled than the current file
  boundaries suggest

## Definition Of Done

The orchestrator refactor is not done when files merely have better names. It
is done when:

- execution-flow ownership is clear
- mechanism experiments no longer define directory identity
- obsolete names are removed after replacement
- public exports stop teaching the old architecture
- the remaining directory can be explained in canonical control-plane terms
