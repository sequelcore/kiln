# Slice 7W Plan - OpenCode Live Write Capability Gate

## Objective

Close the residual Slice 7 OpenCode live proof gap without inventing runtime
evidence. Default OpenCode live coverage must keep passing for the proven
`opencode/minimax-m2.5-free` route, while write-denial and approved-write live
proofs run only when the operator explicitly declares a write-capable OpenCode
model for that proof.

## Non-Goals

- Do not synthesize `write-authority-denied`, `write-proposal-approved`, or
  `write-attempt-completed` from prompt intent.
- Do not change runtime evidence contracts, the OpenCode wrapper event bridge,
  or managed invocation lifecycle semantics unless a real emitted event is being
  dropped.
- Do not weaken deterministic write-boundary, live-write bridge, or CLI harness
  adapter tests.
- Do not claim default OpenCode write capability for a model that completes
  without attempting or applying fixture writes.

## Affected Files

- `packages/runtime/tests/managed-agent/managed-agent-live-test-harness.ts` -
  add a provider-specific opt-in write-proof environment flag.
- `packages/runtime/tests/managed-agent/opencode-live-proof.live.test.ts` -
  move the write-denial and approved-write live cases behind the new gate while
  leaving cancellation under the default OpenCode live gate.
- `docs/architecture/managed-agents.md` - clarify the live OpenCode write proof
  is separately gated by model capability.
- `docs/roadmap/01-background-parallel-agent-surface.md` - update after
  verification and review.

## Test-First Evidence

The residual failing tests were reproduced before implementation:

```bash
KILN_LIVE_MANAGED_AGENT_TESTS=1 KILN_LIVE_OPENCODE_TESTS=1 bunx vitest run packages/runtime/tests/managed-agent/opencode-live-proof.live.test.ts --maxWorkers=1 -t "denies a real OpenCode write attempt"
KILN_LIVE_MANAGED_AGENT_TESTS=1 KILN_LIVE_OPENCODE_TESTS=1 bunx vitest run packages/runtime/tests/managed-agent/opencode-live-proof.live.test.ts --maxWorkers=1 -t "records a real OpenCode approved fixture write"
```

Observed behavior: the default OpenCode model completed without emitting a
write denial, a file diff, or a fixture file change. That is a provider/model
capability gap, not a runtime evidence gap.

## Implementation Steps

1. Add `KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS` to the live harness constants.
2. Gate OpenCode write-denial and approved-write live cases under that explicit
   write-proof flag.
3. Fail fast when the write-proof flag is enabled without an explicit
   `KILN_LIVE_OPENCODE_MODEL`, so the default model cannot be accidentally
   treated as write-capable.
4. Keep strict assertions inside the write-proof gate so a declared
   write-capable model still fails loudly if it emits no denial/change evidence.
5. Keep the cancellation proof under the default `KILN_LIVE_OPENCODE_TESTS`
   gate.
6. Replace the single cancellation settle sample with a bounded stability poll
   over repeated `join` calls and fixture reads.
7. Update architecture and roadmap docs with the separated gate semantics.

## Verification

```bash
KILN_LIVE_MANAGED_AGENT_TESTS=1 KILN_LIVE_OPENCODE_TESTS=1 bunx vitest run packages/runtime/tests/managed-agent/opencode-live-proof.live.test.ts --maxWorkers=1
bunx vitest run packages/cli/tests/wrapper/opencode-session.test.ts packages/runtime/tests/managed-agent/opencode-cli-harness-adapter.test.ts packages/runtime/tests/managed-agent/live-write-event-bridge.test.ts packages/runtime/tests/managed-agent/write-boundary.test.ts packages/runtime/tests/managed-agent/direct-runtime-adapter.test.ts --maxWorkers=1
bun run typecheck
git diff --check
```

Optional write-capable live proof:

```bash
KILN_LIVE_MANAGED_AGENT_TESTS=1 KILN_LIVE_OPENCODE_TESTS=1 KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS=1 KILN_LIVE_OPENCODE_MODEL=<known-write-capable-model> bunx vitest run packages/runtime/tests/managed-agent/opencode-live-proof.live.test.ts --maxWorkers=1
```

## Residual Risk

The write-proof gate depends on an operator-selected OpenCode model that
actually attempts and applies native write tools. If the selected model does
not, the gated proof should fail as provider/model capability evidence rather
than silently passing. Cancellation late-output suppression is still bounded by
the live proof's stability window rather than direct access to the provider
process internals.
