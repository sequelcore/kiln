## Objective

Continue Slice 2 of `docs/roadmap/01-background-parallel-agent-surface.md` by
adding governed cancellation to the nonblocking managed-agent lifecycle.

## Non-Goals

- Do not add cross-process persistence, worktree leases, sandbox leases, or
  cleanup eviction in this cut.
- Do not add surface-local cancellation state.
- Do not treat cancellation as a cosmetic status update; cancellation must
  signal the adapter and suppress late child output.
- Do not change foreground `managed_agent.invoke` behavior except to pass the
  same runtime cancellation signal through the shared service path.

## Scout Summary

Owning bounded context:

- Runtime lifecycle service:
  `packages/runtime/src/agents/managed-invocation/index.ts`
- Runtime tool definitions and executors:
  `packages/runtime/src/agents/managed-invocation/runtime-tool.ts`
- Session lifecycle events:
  `packages/runtime/src/agents/managed-invocation/session-events.ts`
- Adapter cancellation propagation:
  `packages/runtime/src/agents/managed-invocation/direct-runtime-adapter.ts`
  and `packages/runtime/src/agents/managed-invocation/cli-harness-adapter.ts`
- Attached cross-surface registration:
  `packages/runtime/src/gateway/attached-runtime-tool-surface.ts`

Current facts:

- `managed_agent.start/status/list/join` are exposed and backed by one runtime
  invocation service.
- Adapter descriptors already require `cancellation.supported` for admission.
- Runtime adapters do not yet receive a service-owned cancellation signal.
- `join` emits terminal lifecycle evidence exactly once.

## This Cut

1. Add a service-owned abort controller per admitted invocation.
2. Add `RuntimeManagedAgentInvocationService.cancel`.
3. Pass an `AbortSignal` to runtime adapters.
4. Make cancellation resolve the runtime terminal handle with a canonical
   `cancelled` record and suppress any later adapter output.
5. Add `managed_agent.cancel` with current-session scoping.
6. Emit one `agent_invocation_cancelled` event through the existing terminal
   session-event path.
7. Keep plan mode from exposing `cancel`.

## Test Plan

Focused red tests first:

```bash
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts tests/gateway/managed-invocation-tool.test.ts
```

Verification for this cut:

```bash
bun run --filter @kilnai/runtime typecheck
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts tests/gateway/managed-invocation-tool.test.ts tests/session/managed-invocation-session-events.test.ts
git diff --check
```

Broader check before commit:

```bash
bun run --filter @kilnai/runtime test
bun run typecheck
```

## Risks

- Cancel must not leak another session's invocation id.
- Cancel must not emit duplicate terminal events if cancel and join are both
  called.
- A late adapter completion after cancel must not overwrite the cancelled
  record.
- Adapters must receive a real abort signal so provider work has a stop path.
