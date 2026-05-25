# Slice 7M Plan - Direct-Provider Abort Bridge Proof

## Objective

Lock the direct-provider parent-abort bridge with focused regression coverage:
`SessionRunOptions.abortSignal` must become runtime per-call tool config, and
runtime per-call tool config must become `RuntimeBuiltinToolExecutionContext`
for builtin tools such as `managed_agent.invoke/start`.

## Non-Goals

- Do not add a public `interrupted` managed-agent lifecycle state.
- Do not add surface-local managed-agent stores, filters, or replay heuristics.
- Do not change managed invocation cancellation semantics from Slice 7L.
- Do not add a parallel direct-provider lifecycle or test-only bridge.
- Do not broaden live provider credentials or route discovery behavior.

## Scout Map

- `packages/cli/src/wrapper/provider-session.ts` already builds
  `PerCallToolConfig` for kiln-executable direct-provider turns.
- `packages/cli/tests/wrapper/provider-session.test.ts` mocks the runtime
  orchestrator and can verify `ProviderSession.run(...)` passes the same parent
  abort signal into per-call config.
- `packages/runtime/src/session/runtime-session-orchestrator.ts` forwards
  per-call config into `RuntimeSessionToolExecutor`.
- `packages/runtime/src/session/runtime-session-orchestrator-tool-executor.ts`
  creates `RuntimeBuiltinToolExecutionContext` for builtin tools.
- `packages/runtime/tests/session/runtime-session-orchestrator-tools.test.ts`
  already owns per-call tool-config behavior and can prove the abort signal is
  visible to builtin tools without introducing managed-agent-specific test
  doubles.

## Implementation Steps

1. Add focused provider-session coverage proving the exact `AbortSignal`
   supplied to `ProviderSession.run(...)` is passed to
   `RuntimeSessionOrchestrator.processMessage(...)` as per-call config.
2. Add focused runtime tool-executor coverage proving per-call `abortSignal`
   reaches builtin tool execution context.
3. Keep production code unchanged unless the new regression tests expose a real
   bridge gap.
4. Update the roadmap with Slice 7M after verification.

## Verification

```bash
bunx vitest run packages/cli/tests/wrapper/provider-session.test.ts --maxWorkers=1
bunx vitest run packages/runtime/tests/session/runtime-session-orchestrator-tools.test.ts --maxWorkers=1
bun run typecheck
bun run --filter @kilnai/runtime test
bun run --filter @kilnai/cli test
```

## Residual Risk

This slice is regression-proofing for the direct-provider bridge. It does not
exercise live external providers; live route proof remains gated by the existing
explicit live-test environment flags.
