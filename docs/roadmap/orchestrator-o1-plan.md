# Orchestrator O1 Plan

This is the atomic implementation plan for Slice O1 of the orchestrator
refactor.

Scope:

- `packages/core/src/orchestrator/orchestrator.ts`

## Objective

Reduce `orchestrator.ts` into smaller responsibilities without changing the
external behavior or starting broad terminology renames yet.

This slice is about boundary stabilization, not conceptual completion.

## Current Progress

Status snapshot as of 2026-04-10:

- O1.A Checkpointing: completed
- O1.B Interrupt handling: completed
- O1.C Dev-tool execution support: completed
- O1.D Memory sync support: completed
- O1.E Verification support: completed
- O1.F Constructor and field cleanup: completed

Progress recorded:

- added `packages/core/src/orchestrator/orchestrator-checkpoint-support.ts`
- added `packages/core/src/orchestrator/orchestrator-interrupt-support.ts`
- added `packages/core/src/orchestrator/orchestrator-dev-tool-support.ts`
- added `packages/core/src/orchestrator/orchestrator-memory-sync-support.ts`
- added `packages/core/src/orchestrator/orchestrator-verification-support.ts`
- delegated checkpoint store attachment, checkpoint, resume, fork, and replay from `orchestrator.ts`
- delegated interrupt state and resume flow from `orchestrator.ts`
- delegated sandbox and dev-tool execution support from `orchestrator.ts`
- delegated memory sync lifecycle from `orchestrator.ts`
- delegated verification state and verification loop execution from `orchestrator.ts`
- removed dead `_traceContext` state from `orchestrator.ts`
- simplified constructor wiring and field grouping in `orchestrator.ts`
- preserved public `Orchestrator` method names and behavior intent
- verification command run: `bun run typecheck` -> passed

## Current Responsibility Clusters

`orchestrator.ts` currently mixes these concerns:

1. Session lifecycle and phase state
2. Verification loop execution
3. Sandbox, provider, and dev-tool registration/setup
4. Dev-tool execution eventing and authorization
5. Memory sync lifecycle
6. Task-tree and implementation-loop orchestration
7. Checkpoint persistence and replay
8. Interrupt persistence and resume flow
9. Trace and cost/event plumbing

## O1 Extraction Targets

These are the first internal boundaries to extract.

### O1.A Checkpointing

Status: completed.

Current methods:

- `attachCheckpointStore()`
- `checkpoint()`
- `resume()`
- `fork()`
- `replay()`

Target:

- extract into a checkpoint-support component owned by execution persistence

Why first:

- cohesive concern
- low naming risk
- high size reduction for the main class

### O1.B Interrupt handling

Status: completed.

Current methods/state:

- `_interruptState`
- `interruptState`
- `interrupt()`
- `resumeInterrupt()`

Target:

- extract into an interrupt-support component that depends on checkpointing but
  no longer lives inline in the main class

Why second:

- tightly related to checkpoint lifecycle
- clean atomic extraction

### O1.C Dev-tool execution support

Status: completed.

Current methods/state:

- `_devToolRegistry`
- `_devToolExecutionBridge`
- `_sandboxPolicies`
- `initSandbox()`
- `getSandboxPolicy()`
- `sandboxEnabled`
- `devToolRegistry`
- `registerDevTool()`
- `executeDevTool()`

Target:

- extract to a dedicated execution-support component for tool execution and
  sandbox-backed authorization

Why third:

- large method with event emission and authorization logic
- strong internal cohesion
- independent enough from checkpointing

### O1.D Memory sync support

Status: completed.

Current methods/state:

- `_gitSync`
- `initMemorySync()`
- `memorySyncStatus()`
- `flushMemory()`

Target:

- extract to a small memory-sync support component

Why fourth:

- small, cohesive, easy win

### O1.E Verification support

Status: completed.

Current methods/state:

- `_lastVerificationResult`
- `verificationResult`
- `runVerification()`

Target:

- extract verification orchestration into a support component or service

Why fifth:

- coherent but lower priority than checkpointing/tool execution

## Keep In Main Class For O1

These concerns should remain inside `Orchestrator` during O1:

- `start()`
- `advancePhase()`
- `approve()`
- `reject()`
- `cancel()`
- `setTeam()`
- `loadPlan()`
- `runImplementLoop()`
- `evaluateResult()`

Reason:

- these methods are still part of the visible execution-flow story
- extracting them before the support concerns would create premature structural churn

## Proposed Internal Shape After O1

After O1, `Orchestrator` should look more like a coordinator over support
services instead of a giant owner of everything.

Target shape:

- lifecycle and phase coordination remain in `Orchestrator`
- support concerns are delegated to helper services/components
- constructor wiring becomes simpler

## Atomic Implementation Tasks

These are the worker-sized tasks that should be used when implementation starts.

1. Extract checkpoint support from `orchestrator.ts` into a dedicated internal module.
2. Extract interrupt support from `orchestrator.ts` into a dedicated internal module.
3. Extract dev-tool execution support from `orchestrator.ts` into a dedicated internal module.
4. Extract memory-sync support from `orchestrator.ts` into a dedicated internal module.
5. Extract verification support from `orchestrator.ts` into a dedicated internal module.
6. Simplify `Orchestrator` constructor and fields after the extractions.

Current state:

1. Completed
2. Completed
3. Completed
4. Completed
5. Completed
6. Completed

## Required Guardrails

Each implementation task must:

- preserve compile correctness
- preserve current event emission behavior unless intentionally documented
- avoid public renames in O1
- avoid changing checkpoint semantics in the same task as a structural extraction

## Non-Goals For O1

Do not do these in O1:

- rename `ThresholdAllocator`
- rename `CascadeController`
- rename `TaskChannel`
- rewrite `strategies/`
- merge with `packages/runtime/src/session`
- redesign phase semantics

Those belong to later orchestrator slices.

## Done Condition

O1 is complete when:

- `orchestrator.ts` is materially smaller
- checkpointing, interrupts, tool execution, memory sync, and verification are
  no longer owned inline
- the main class reads as an execution coordinator rather than a catch-all
