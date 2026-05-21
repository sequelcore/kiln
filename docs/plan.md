## Objective

Start Slice 2 of `docs/roadmap/01-background-parallel-agent-surface.md` by
adding the runtime-owned nonblocking managed-agent invocation lifecycle that the
future `managed_agent.start/status/join/cancel/list` tools will share.

## Non-Goals

- Do not expose new model-callable tool names in this first cut.
- Do not add cancellation until adapters can receive a cancellation signal and
  the runtime can suppress late child output with evidence.
- Do not add cross-process persistence, worktree leases, or sandbox leases yet.
- Do not change the public behavior of foreground `managed_agent.invoke`.

## Scout Summary

Owning bounded context:

- Runtime managed-agent service:
  `packages/runtime/src/agents/managed-invocation/index.ts`
- Foreground managed-agent tool executor:
  `packages/runtime/src/agents/managed-invocation/runtime-tool.ts`
- Attached runtime tool surface:
  `packages/runtime/src/gateway/attached-runtime-tool-surface.ts`

Current facts:

- `RuntimeManagedAgentInvocationService.invoke` evaluates admission and awaits
  the adapter in one foreground path.
- There is no runtime registry for in-flight child invocations, so `status`,
  `list`, and `join` cannot observe background workers yet.
- `runtime-tool.ts` owns request parsing and session event persistence for
  `managed_agent.invoke`; the shared lifecycle primitive must land below that
  tool surface first to avoid duplicating lifecycle semantics per tool.

## First Cut

1. Add service-level `start`, `status`, `list`, and `join` methods.
2. `start` evaluates admission, records an admitted invocation as `running`,
   launches the adapter promise, and returns before the adapter resolves.
3. Denied starts return the same denied decision shape and do not enter the
   runtime registry.
4. `join` is the only blocking wait primitive and returns the same completed
   result shape used by foreground invocation.
5. Reimplement `invoke` through `start` plus `join` so foreground and
   background paths share one lifecycle.

## Test Plan

Focused red tests first:

```bash
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts
```

Verification for this cut:

```bash
bun run --filter @kilnai/runtime typecheck
bun run --filter @kilnai/runtime test -- tests/managed-agent/invocation-service.test.ts
git diff --check
```

## Risks

- The registry must not fabricate terminal records before an adapter returns
  canonical child evidence.
- `start` must not create observable background entries for denied admissions.
- Foreground `invoke` must remain behavior-compatible while internally sharing
  the nonblocking lifecycle path.
- Completed and failed entries remain in memory until the later cleanup/cancel
  slice defines eviction semantics.
