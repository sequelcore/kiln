# Slice 6E - Governed Worktree Conflict States

## Objective

Continue Slice 6 without reopening Slice 5. Slice 6E implements governed
conflict states for worktree-backed managed children so same-checkout and
isolated-worktree write conflicts are denied with shared evidence instead of a
runtime-only exception string.

## Decision

Use the existing managed resource lease evidence path. A worktree write
conflict is a failed resource lease admission outcome, so the structured state
belongs under `ManagedAgentResourceLeaseEvidence.worktreeConflict` and is
projected through session events, cockpit projections, CLI output, and event
presentation.

## Non-Goals

- Do not implement feedback or repair work items in this cut.
- Do not add compatibility aliases or legacy conflict strings as contract.
- Do not create a second top-level denial evidence model outside managed
  invocation lifecycle evidence.
- Do not change disjoint approved workspace scope behavior.

## Surface Map

- Core managed invocation contract:
  - `packages/core/src/agents/managed-invocation/index.ts`
  - `packages/core/src/events/session-event.ts`
- Runtime managed invocation:
  - `packages/runtime/src/agents/managed-invocation/index.ts`
  - `packages/runtime/src/agents/managed-invocation/session-events.ts`
  - `packages/runtime/src/agents/managed-invocation/resource-provider.ts`
  - `packages/runtime/src/agents/managed-invocation/runtime-tool.ts`
- Gateway/operator projections:
  - `packages/gateway-contracts/src/frames.ts`
  - `packages/gateway-contracts/src/operator-cockpit-projection.ts`
  - `packages/gateway-contracts/src/operator-cockpit-view-state.ts`
  - `packages/gateway-contracts/src/operator-event-presentation.ts`
- CLI surface:
  - `packages/cli/src/commands/managed-agent.ts`
- Tests:
  - `packages/runtime/tests/managed-agent/invocation-service.test.ts`
  - `packages/runtime/tests/session/managed-invocation-session-events.test.ts`
  - `packages/runtime/tests/gateway/managed-invocation-tool.test.ts`
  - `packages/gateway-contracts/tests/operator-cockpit-projection.test.ts`
  - `packages/gateway-contracts/tests/operator-cockpit-view-state.test.ts`
  - `packages/gateway-contracts/tests/operator-event-presentation.test.ts`
  - `packages/cli/src/commands/managed-agent.test.ts`

## Expected Behavior

- Active same-checkout write collisions and same-path isolated-worktree
  collisions return denied managed admission decisions with
  `worktreeConflict.status === "blocked"`.
- Conflict evidence identifies the active invocation, requested invocation,
  working directory mode/path, policy id, and retry-after invocation ids.
- Denied managed invocation session events carry
  `managedInvocationEvidence.lifecycle.resourceLease.worktreeConflict`.
- Cockpit, event presentation, and CLI surfaces render the conflict through the
  shared resource lease projection.

## Verification

- Add failing tests first for runtime denial evidence and cross-surface
  projection.
- Run focused package tests for runtime, gateway contracts, and CLI.
- Run `bun run typecheck`.
- Run broader package tests if focused checks pass.
- Update the roadmap document at the end.
