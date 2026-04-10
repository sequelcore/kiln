# Orchestrator O2 Plan

This is the atomic implementation plan for Slice O2 of the orchestrator
refactor.

Scope:

- `packages/core/src/orchestrator`

## Objective

Replace the remaining swarm-era mechanism naming with control-plane-aligned
module names, starting with the demand-allocation boundary.

This slice is about boundary vocabulary and file ownership, not behavioral
redesign.

## Current Progress

Status snapshot as of 2026-04-10:

- O2.A Demand allocator rename: completed
- O2.B Chain governor migration: completed
- O2.C Task registry migration: completed

Progress recorded:

- `threshold-allocator.ts` replaced by `demand-allocator.ts`
- `ThresholdAllocator` renamed to `DemandAllocator`
- `cascade-controller.ts` replaced by `chain-governor.ts`
- `CascadeController` renamed to `ChainGovernor`
- `task-registry.ts` now owns the task registry boundary
- `TaskChannel` renamed to `TaskRegistry`
- orchestrator exports updated to the demand allocator boundary
- strategy and team-composer imports updated to the demand and chain-governor boundaries

## O2 Work

### O2.A Demand allocator rename

Status: completed.

Target:

- replace `ThresholdAllocator` with `DemandAllocator`
- replace the module name `threshold-allocator.ts` with `demand-allocator.ts`
- keep the allocation algorithm intact

### O2.B Chain governor migration

Status: completed.

Target:

- replace `CascadeController` framing with `ChainGovernor`

### O2.C Task registry migration

Status: completed.

Target:

- replace `TaskChannel` framing with `TaskRegistry`

## Guardrails

- no compatibility aliases
- no broad renames beyond the current slice
- preserve compile correctness after each atomic cut
