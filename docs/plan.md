# Slice 7L Plan - Parent Interruption Cancels Managed Children

## Objective

Route parent turn interruption through the existing runtime cancellation plane so
active managed child invocations terminate as canonical `cancelled` records and
late child output cannot become parent-visible transcript or view-state content.

## Non-Goals

- Do not add a public `interrupted` managed-agent lifecycle state.
- Do not add surface-local managed-agent stores, filters, or replay heuristics.
- Do not preserve legacy `kiln run --workers` behavior as a second control
  plane.
- Do not broaden dirty-worktree or conflict semantics beyond the cancellation
  boundary needed for parent interruption.

## Scout Map

- CLI signal ownership: `packages/cli/src/commands/run.ts` installs SIGINT and
  SIGTERM handlers for normal runs but currently only performs cleanup/exit.
- CLI session execution: `packages/cli/src/application/run-session.ts` calls
  `session.run(...)` without a parent abort signal even though provider sessions
  already accept `SessionRunOptions.abortSignal`.
- Direct-provider runtime surface:
  `packages/cli/src/wrapper/provider-session.ts` creates per-call runtime tool
  config but does not carry the parent abort signal into the orchestrator.
- Runtime tool context:
  `packages/runtime/src/session/runtime-session-orchestrator-tool-executor.ts`
  builds builtin tool execution context without the per-turn abort signal.
- Managed invocation service:
  `packages/runtime/src/agents/managed-invocation/index.ts` already owns
  cancellation, abort propagation to adapters, terminal record merging, and late
  adapter-result suppression after cancellation.
- Managed invocation tools:
  `packages/runtime/src/agents/managed-invocation/runtime-tool.ts` start/invoke
  children through the shared service and should pass parent abort ownership
  rather than implementing local cleanup.

## Implementation Steps

1. Add red runtime coverage proving an external parent abort signal cancels a
   running managed invocation and suppresses a later adapter success.
2. Add red CLI coverage proving SIGINT aborts the session signal before cleanup
   and that duplicate signals do not create duplicate aborts.
3. Thread `AbortSignal` through `RunSessionOptions`, `session.run(...)`,
   direct-provider per-call config, and runtime builtin tool context.
4. Extend `RuntimeManagedAgentInvocationService.start/invoke` with optional
   parent abort signal binding that calls the existing `cancel(...)` path once
   and detaches at terminal completion.
5. Pass `context.abortSignal` from `managed_agent.invoke` and
   `managed_agent.start` into the service.

## Verification

```bash
bunx vitest run packages/runtime/tests/managed-agent/invocation-service.test.ts --maxWorkers=1
bunx vitest run packages/runtime/tests/gateway/managed-invocation-tool.test.ts --maxWorkers=1
bunx vitest run packages/cli/tests/commands/run-builtin-tools.test.ts --maxWorkers=1
bun run typecheck
bun run --filter @kilnai/runtime test
bun run --filter @kilnai/cli test
```

## Residual Risk

This slice proves parent interruption for runtime-owned CLI/direct-provider
managed child paths. Harness-specific provider process cancellation remains
covered by the adapter abort contract and existing cancellation tests.
