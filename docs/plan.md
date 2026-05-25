## Slice 7J - Immediate Cancellation Terminal Evidence

## Objective

Continue Slice 7 by making managed-agent cancellation publish runtime-owned
terminal evidence without waiting for a child adapter to settle after abort.

## Decision

Treat operator cancellation as a runtime terminal decision. Once cancellation
is accepted, the runtime must abort the adapter, release already-acquired
runtime leases, resolve `join` with a cancelled record, and suppress later
adapter success or failure from changing the terminal lifecycle. If the adapter
later returns cancellation-specific cleanup evidence, the runtime may merge
that evidence into the stored cancelled record, but operator control and
session-event replay must not depend on the adapter returning.

This follows the 5.5 xhigh debate: parent interruption remains larger than
this slice. Slice 7J hardens the central late-output invariant first.

## Non-Goals

- Do not introduce a public `interrupted` lifecycle state.
- Do not implement parent SIGINT/SIGTERM cascade semantics.
- Do not add CLI, GUI, TUI, or native surface-local cancellation stores.
- Do not add compatibility shims for older cancellation metadata.
- Do not remove the existing adapter cleanup-evidence merge path.

## Surface Map

- Runtime managed invocation service:
  - `packages/runtime/src/agents/managed-invocation/index.ts`
  - `packages/runtime/tests/managed-agent/invocation-service.test.ts`
- Runtime managed-agent tool surface:
  - `packages/runtime/src/agents/managed-invocation/runtime-tool.ts`
  - `packages/runtime/tests/gateway/managed-invocation-tool.test.ts`
- GUI gateway managed-agent control:
  - `packages/runtime/src/gateway/gui-gateway.ts`
  - `packages/runtime/tests/gateway/gui-gateway.test.ts`
- Roadmap:
  - `docs/roadmap/01-background-parallel-agent-surface.md`

## Expected Behavior

- `RuntimeManagedAgentInvocationService.cancel` resolves terminal cancellation
  evidence without waiting for adapter terminal output.
- `managed_agent.cancel` returns and appends one cancellation session event
  even when the adapter never resolves after abort.
- Gateway `managed_agent_control` cancel acknowledges and streams the
  cancellation event without waiting for late child output.
- Late adapter success or failure after cancellation cannot replace the
  cancelled lifecycle, cannot append a completed/failed terminal event, and
  cannot leak late output into operator presentation.
- Runtime lease cleanup still happens at the runtime boundary before terminal
  evidence is published.

## Verification

- Add failing focused tests first.
- Run `bun run --filter @kilnai/runtime test -- tests/managed-agent/invocation-service.test.ts`.
- Run `bun run --filter @kilnai/runtime test -- tests/gateway/managed-invocation-tool.test.ts`.
- Run `bun run --filter @kilnai/runtime test -- tests/gateway/gui-gateway.test.ts`.
- Run `bun run typecheck`.
- Run `bun run build`.
- Run `bun run test`.
- Run `git diff --check`.
- Run code review after implementation and before commit.
- Update the roadmap after code verification.
