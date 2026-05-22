# Plan: Slice 3E Runtime Environment Binding Leases

## Objective

Continue Slice 3 by adding runtime-owned environment binding leases to managed
invocations. Environment values must be allocated inside the managed invocation
lifecycle, passed to child adapters, and represented as redacted URI evidence
in the existing terminal `resourceLease` record.

## Scope

- Add a `ManagedAgentEnvironmentLeaseManager` port to
  `RuntimeManagedAgentInvocationService`.
- Add a runtime environment binding manager that can bind static values and
  dev-server port lease values without leaking values into resource URIs.
- Acquire environment bindings after worktree, artifact-directory, and
  dev-server port leases, then release them before earlier resource stages.
- Pass acquired environment bindings through `ManagedAgentRuntimeInvocationInput`.
- Forward managed environment bindings to CLI harness sessions.
- Validate environment lease manager output with the same invocation-scoped URI
  boundary as existing runtime leases.
- Export the public runtime types and implementation.

## Out Of Scope

- Credential material injection.
- Persistent environment lease discovery after runtime restart.
- Sandbox and credential-route leases.
- Daemonized cleanup scheduling.
- Rebase of `kiln run --workers`.

## Affected Files

- `packages/runtime/src/agents/managed-invocation/index.ts`
- `packages/runtime/src/agents/managed-invocation/cli-harness-adapter.ts`
- `packages/runtime/src/execution/cli-session-contract.ts`
- `packages/runtime/tests/managed-agent/invocation-service.test.ts`
- `packages/runtime/tests/managed-agent/opencode-cli-harness-adapter.test.ts`
- `packages/runtime/src/index.ts`
- `docs/roadmap/01-background-parallel-agent-surface.md`
- `docs/roadmap/README.md`

## TDD Targets

1. Runtime acquires environment bindings after dev-server port leases and
   passes the environment to the adapter before execution.
2. Runtime rejects environment lease manager resource URIs outside the
   invocation namespace.
3. The concrete environment binding manager derives a port value from the
   existing dev-server port lease evidence without exposing that value in
   lifecycle URIs.
4. CLI harness sessions receive managed environment bindings through
   `session.run`.
5. Environment cleanup evidence is released before the dev-server port cleanup
   stage.

## Verification

```bash
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts
bun run --cwd packages/runtime test -- tests/managed-agent/opencode-cli-harness-adapter.test.ts
bun run --filter @kilnai/runtime test
bun run typecheck
bun run --filter "*" build
git diff --check
```

## Risks

- Environment binding values must not appear in resource or diagnostic URIs.
- Environment names must be validated at the runtime boundary to avoid shell
  injection and cross-platform case-collision surprises.
- Direct-provider children currently do not spawn a subprocess, so this slice
  only passes environment through the runtime adapter contract and proves CLI
  harness forwarding.
