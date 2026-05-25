# Slice 7N Plan - Codex OAuth Direct Approved-Write Live Proof

## Objective

Prove the subscription-backed `codex-oauth` direct-provider managed route can
read a governed fixture, perform one bounded approved workspace mutation
through Kiln builtin tool authority, and emit canonical managed invocation
write evidence.

## Non-Goals

- Do not add a second lifecycle store, route shim, or surface-local write
  evidence path.
- Do not change direct-provider write admission semantics unless the live proof
  exposes a real gap.
- Do not add live cancellation or long-running provider timing assertions in
  this slice.
- Do not expose raw diffs or patch text as write evidence.

## Scout Map

- `packages/runtime/tests/managed-agent/direct-runtime-adapter.test.ts`
  already proves direct-provider approved writes and canonical write evidence
  with a mocked provider.
- `packages/runtime/tests/managed-agent/codex-oauth-direct-live-proof.live.test.ts`
  already proves subscription-backed `codex-oauth` direct-provider read-only
  tool execution through the CLI direct adapter factory.
- `packages/cli/src/config/managed-agent-direct-adapters.ts` already attaches
  live-proven direct write authority when a direct route allows writes or uses
  a write-capable profile.
- `packages/runtime/src/agents/managed-invocation/direct-runtime-adapter.ts`
  remains the runtime-owned direct provider adapter and should not need a
  surface-local write-evidence path.
- `packages/runtime/tests/managed-agent/managed-agent-live-test-harness.ts`
  already owns isolated fixture workspaces and canonical write-evidence
  assertions shared by harness live proofs.

## Implementation Steps

1. Add a separately gated `codex-oauth` direct-provider live test that
   configures `foundation-apply-approved-writes`, updates a single fixture file
   through the builtin `read` and `edit` tools, and asserts canonical write
   evidence plus runtime credential-route lease evidence.
2. Reuse `createManagedDirectProviderAdapterFactory`,
   `createSessionBuiltinToolOptions`, `RuntimeManagedAgentInvocationService`,
   and the shared live fixture harness; do not add a test-only adapter path.
3. Keep managed invocation lifecycle code unchanged. If provider stream
   behavior exposes a real adapter translation gap, fix it in the provider
   adapter without adding a subscription-specific lifecycle path; stalled
   completed streamed function-call/text turns must normalize at the provider
   boundary.
4. Update the roadmap with Slice 7N after verification.

## Verification

```bash
bunx vitest run packages/runtime/tests/managed-agent/direct-runtime-adapter.test.ts --maxWorkers=1
bunx vitest run packages/core/src/agents/infrastructure/__tests__/codex-oauth.test.ts --maxWorkers=1
bunx vitest run packages/runtime/tests/managed-agent/codex-oauth-direct-live-proof.live.test.ts --maxWorkers=1
bun run typecheck
bun run --filter @kilnai/core test
bun run --filter @kilnai/runtime test
```

## Residual Risk

The new write proof is gated by `KILN_LIVE_MANAGED_AGENT_TESTS=1` and
`KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS=1`, so normal CI and the read-only
Codex OAuth direct live proof still skip write-capable provider execution
unless subscription credentials and write proof opt-in are explicit. Live
cancellation remains a later Slice 7 hardening target because deterministic
real-provider abort timing needs a separate proof design.
