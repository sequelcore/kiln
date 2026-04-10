# Orchestrator O4 Plan

This is the execution plan for Slice O4 of the orchestrator refactor.

Scope:

- `packages/core/src/orchestrator/strategies/index.ts`
- `packages/core/src/orchestrator/strategies/sequential-strategy.ts`
- `packages/core/src/orchestrator/strategies/supervisor-strategy.ts`
- `packages/core/src/orchestrator/strategies/swarm-strategy.ts`

## Objective

Resolve strategy ownership now that the swarm-era mechanism files have been
renamed into stable boundaries.

This slice is not about new naming. It is about deciding which strategy
surfaces are still real execution concerns and which are framework residue.

## Current Read

Current strategy surface:

- `SequentialStrategy`
- `SupervisorStrategy`
- `SwarmStrategy`

Observed facts:

- `SequentialStrategy` is the lowest-risk execution baseline.
- `SupervisorStrategy` is self-contained and still maps to a real review or
  delegation control pattern.
- `SwarmStrategy` is the only remaining owner of the renamed mechanism
  boundaries.
- `SwarmStrategy` is only referenced from orchestrator exports and strategy
  wiring.

Progress:

- `team-composer.ts` removed as isolated residue
- O4.A completed
- `SwarmStrategy` removed from the public strategy barrel
- swarm strategy comments softened to internal/demoted framing
- swarm mode removed from `TeamMode`
- `swarm-strategy.ts` deleted

## File Decisions

### `sequential-strategy.ts`

Decision:

- `keep`

Why:

- it is the simplest execution baseline
- it still matches a legitimate governed execution mode

### `supervisor-strategy.ts`

Decision:

- `keep`
- `shrink` later if manager delegation should move elsewhere

Why:

- it still represents a concrete managed-execution pattern
- it is not tightly coupled to the swarm-era mechanism files

### `swarm-strategy.ts`

Decision:

- `split`
- `demote`
- possible `delete`

Why:

- it is the last strategy still defined by handoff-chain assumptions
- it owns the renamed demand/chain/task boundaries, but that does not prove it
  should remain the long-term architecture surface
- it should stop defining product identity

## Execution Order

1. narrow `strategies/index.ts` to surviving strategy contracts
2. review whether `SwarmStrategy` remains a valid supported mode or should be
  demoted behind an internal-only surface

## First Atomic Target

O4.A:

- remove isolated `team-composer` residue
- keep the tree compiling
- do not rewrite strategy semantics in the same task

Status: completed.

O4.B:

- demote `SwarmStrategy` from public strategy exports while keeping
  `createStrategy("swarm")` functional

Status: completed.

O4.C:

- remove `swarm` from `TeamMode` and delete `swarm-strategy.ts` now that it no
  longer has a justified supported surface

Status: completed.

## Guardrails

- no fake compatibility layer for dead strategy surfaces
- do not rewrite all strategies in one pass
- delete isolated residue when there is no real caller
- each cut must end with typecheck passing
