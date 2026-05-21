## Objective

Continue Slice 2 of `docs/roadmap/01-background-parallel-agent-surface.md` by
exposing the nonblocking managed-agent lifecycle through model-callable runtime
tools backed by the single runtime invocation service.

## Non-Goals

- Do not expose `managed_agent.cancel` until adapters can receive a
  cancellation signal and the runtime can suppress late child output with
  evidence.
- Do not add cross-process persistence, worktree leases, sandbox leases, or
  cleanup eviction in this cut.
- Do not duplicate request admission or lifecycle semantics between
  `managed_agent.invoke` and `managed_agent.start`.
- Do not add surface-local lifecycle stores.

## Scout Summary

Owning bounded context:

- Tool definitions and executors:
  `packages/runtime/src/agents/managed-invocation/runtime-tool.ts`
- Runtime lifecycle service:
  `packages/runtime/src/agents/managed-invocation/index.ts`
- Session lifecycle events:
  `packages/runtime/src/agents/managed-invocation/session-events.ts`
- Attached cross-surface tool registration:
  `packages/runtime/src/gateway/attached-runtime-tool-surface.ts`

Current facts:

- `RuntimeManagedAgentInvocationService` now owns `start`, `status`, `list`,
  `join`, and foreground `invoke` via start/join.
- `runtime-tool.ts` still exposes only `managed_agent.invoke`.
- `attached-runtime-tool-surface.ts` registers only the foreground tool and its
  capability/authority/metadata resolver.
- `appendManagedInvocationSessionEvents` currently emits requested, started,
  and terminal events in one foreground call; nonblocking start/join need start
  and terminal event appends without duplicating requested/started events.

## This Cut

1. Add `managed_agent.start`, `managed_agent.status`, `managed_agent.list`, and
   `managed_agent.join`.
2. Make `start` return after admission and service registration, before adapter
   terminal completion.
3. Publish requested and started session events on `start`.
4. Make `join` the only blocking wait primitive and publish exactly one
   terminal session event for the invocation.
5. Scope status, list, and join to the current runtime session.
6. Keep `managed_agent.invoke` behavior-compatible while sharing the same
   request-building and terminal-result formatting helpers.

## Test Plan

Focused red tests first:

```bash
bun run --cwd packages/runtime test -- tests/gateway/managed-invocation-tool.test.ts
```

Verification for this cut:

```bash
bun run --filter @kilnai/runtime typecheck
bun run --filter @kilnai/runtime test -- tests/gateway/managed-invocation-tool.test.ts
git diff --check
```

Broader check before commit:

```bash
bun run --filter @kilnai/runtime test
```

## Risks

- `start` and `invoke` must not diverge in route selection, authority
  admission, context resolution, or request shape.
- `join` must not emit duplicate terminal events when called repeatedly.
- Status/list/join must not expose invocations from another runtime session.
- Cancellation remains intentionally absent until the adapter contract can stop
  provider work and prove late-output suppression.
