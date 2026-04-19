# Orchestrator Refactor Roadmap

This document is the canonical roadmap for `packages/core/src/orchestrator`.
It replaces the former split between an overview file and separate O1, O2, and
O4 slice-plan documents.

## Scope

- `packages/core/src/orchestrator`

## Objective

Refactor the orchestrator directory so it stops acting as a dumping ground for:

- execution flow
- phase logic
- chain logic
- allocation logic
- checkpointing
- swarm-era residue

and instead becomes a bounded migration path toward:

- `IngressGovernor`
- `DemandAllocator`
- `ChainGovernor`
- governed execution-flow support

## Current Status

As of 2026-04-18:

- O1 completed
- O2 completed
- O3 retired as redundant with completed O2 naming work
- O4 completed
- O5 in progress

Progress recorded:

- checkpointing, interrupts, dev-tool execution, memory sync, and verification
  extracted from `orchestrator.ts`
- demand allocator, chain governor, and task registry vocabulary migrations
  completed
- `team-composer.ts` removed
- `swarm-strategy.ts` deleted
- swarm mode removed from supported strategy selection
- public exports no longer expose swarm strategy APIs
- typecheck passed after the current O1, O2, O4, and O5 cuts

## Constraints

- no dead compatibility layer kept alive without a concrete migration need
- no mass rename before ownership is isolated
- no speculative abstraction added "just in case"
- each slice must leave the tree in a compilable state

## File-Level Decisions

| File or area | Decision | Target direction | Notes |
|--------------|----------|------------------|-------|
| `orchestrator.ts` | `split`, `rename` | Decompose into execution coordinator, admission boundaries, and support services | Currently too large and cross-cutting |
| `phase-machine.ts` | `keep`, `split` | Keep if phase control remains real; isolate as governed flow state rather than orchestrator identity | Relationship to future `ModeController` still needs clarification |
| `demand-allocator.ts` | `keep`, `split` | Preserve useful allocation logic under `DemandAllocator` | Naming migration already landed |
| `chain-governor.ts` | `keep`, `split` | Preserve bounded continuation logic under `ChainGovernor` | Naming migration already landed |
| `task-registry.ts` | `split`, `merge` | Move valid shared task-state mechanics into task-registry ownership | Current name is aligned |
| `demand-signal.ts` | `keep`, `merge`, `rename` | Keep if useful as signal normalization for allocation or admission | Still under naming pressure |
| `guardrails.ts` | `merge` | Rehome under safety or flow validation if still needed | Should not remain orchestrator-owned long term |
| `interrupt.ts` | `keep`, `merge` | Keep interrupt model nearer execution or session lifecycle ownership | Useful but misplaced long term |
| `checkpoint-store.ts` | `keep`, `merge` | Preserve persistence contract and move nearer execution persistence | Infra contract, not orchestrator identity |
| `checkpoint-types.ts` | `keep`, `merge` | Keep with checkpoint boundary | Same as above |
| `sqlite-checkpoint-store.ts` | `keep`, `merge` | Keep as infrastructure implementation | Likely moves with checkpoint store |
| `schemas.ts` | `split`, `merge`, `delete` | Keep only schemas still tied to surviving flows | Needs narrow follow-up review |
| `index.ts` | `rewrite` | Export only surviving or transitional APIs | Must stop teaching obsolete architecture |
| `strategies/` | `split`, `keep` | Retain only strategies that map cleanly to governed execution flows | Swarm residue already demoted |

## Strategic Calls

### Do not start with mass renames

Broad renaming across mechanism files creates noise without reducing coupling.
Isolate ownership first, then replace obsolete names one boundary at a time.

### `orchestrator.ts` was the correct first cut

The main class mixed session lifecycle, phase control, cost tracking, tool
execution, provider registry, memory sync, checkpointing, and interrupts. That
authority concentration was the clearest sign of architectural drift.

### Replacement must remove the old path

`DemandAllocator`, `ChainGovernor`, and `TaskRegistry` should survive only as
real boundaries. Old names should not remain as permanent aliases.

## Slice Summary

### O1: Stabilize the main class boundary

Status: completed.

Goal:

- shrink `orchestrator.ts`
- extract cohesive support concerns without public renames

Completed work:

- checkpoint support extracted to `orchestrator-checkpoint-support.ts`
- interrupt support extracted to `orchestrator-interrupt-support.ts`
- dev-tool execution support extracted to
  `orchestrator-dev-tool-support.ts`
- memory sync support extracted to `orchestrator-memory-sync-support.ts`
- verification support extracted to `orchestrator-verification-support.ts`
- constructor wiring and field grouping simplified

### O2: Land target vocabulary where ownership was already clear

Status: completed.

Goal:

- replace the highest-pressure swarm-era mechanism names without redesigning
  behavior

Completed work:

- `threshold-allocator.ts` -> `demand-allocator.ts`
- `ThresholdAllocator` -> `DemandAllocator`
- `cascade-controller.ts` -> `chain-governor.ts`
- `CascadeController` -> `ChainGovernor`
- `TaskChannel` -> `TaskRegistry`

### O3: Retired

Status: retired.

Reason:

- the intended naming work already landed in O2
- keeping O3 as a separate future slice creates stale roadmap noise

### O4: Resolve strategy ownership

Status: completed.

Goal:

- keep only strategy surfaces that still make sense under governed execution

Completed work:

- `team-composer.ts` removed
- swarm strategy removed from the public strategy barrel
- swarm mode removed from supported strategy selection
- `swarm-strategy.ts` deleted

Current surviving strategy posture:

- `SequentialStrategy`: keep
- `SupervisorStrategy`: keep
- `SwarmStrategy`: deleted

### O5: Clean public exports

Status: in progress.

Goal:

- stop exposing obsolete public names once replacement boundaries exist

Completed work:

- O5.A public export cleanup removed swarm strategy APIs from `index.ts`
- O5.B final export sweep completed for the current stop point

Remaining intent:

- keep reviewing export surfaces as later control-plane refactors land

## Atomic Work Units

Good worker-sized tasks:

1. Extract one cohesive support concern from `orchestrator.ts`.
2. Rehome one boundary file into a clearer ownership zone.
3. Narrow one public export surface after a replacement lands.
4. Delete one isolated residue file once no real caller remains.

Bad task shapes:

- refactor the whole orchestrator directory
- rename every swarm-era file in one pass
- migrate orchestrator and runtime session together

## Risks

- `orchestrator.ts` may still be a de facto public integration point in more
  places than expected
- strategy assumptions may still leak into CLI or runtime behavior
- export cleanup can create broad compile fallout if done before callers are
  narrowed
- task, tree, and checkpoint logic may be more tightly coupled than the file
  boundaries suggest

## Definition Of Done

This roadmap is complete only when:

- execution-flow ownership is clear
- mechanism residue no longer defines directory identity
- obsolete names are removed after replacement
- public exports stop teaching the old architecture
- the remaining directory can be explained in canonical control-plane terms
