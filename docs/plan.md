# Plan: Slice 3D Runtime Dev-Server Port Leases

## Objective

Continue Slice 3 by adding runtime-owned dev-server port leases to the managed
invocation lifecycle. Port allocation must reuse the existing resource lease
record, terminal cleanup evidence, and stale/cancel release pipeline so CLI,
TUI, GUI, gateway, native, and resource-plane projections continue to consume
one lifecycle truth.

## Scope

- Add a `ManagedAgentDevServerPortLeaseManager` port to
  `RuntimeManagedAgentInvocationService`.
- Add an in-memory dev-server port lease manager that allocates from an
  explicit configured port pool and rejects already-bound ports.
- Acquire dev-server port leases before adapter execution and release them on
  terminal completion, failure, cancellation, or stale recovery.
- Preserve port lease resource and cleanup URIs in terminal `resourceLease`
  evidence.
- Validate port lease manager output with the same invocation-scoped URI
  boundary as worktree and artifact leases.
- Export the public runtime types and implementation.

## Out Of Scope

- Passing allocated ports into child process environment variables.
- Persistent port lease discovery after runtime restart.
- Sandbox, environment-variable, and credential-route leases.
- Daemonized cleanup scheduling.
- Rebase of `kiln run --workers`.

## Affected Files

- `packages/runtime/src/agents/managed-invocation/index.ts`
- `packages/runtime/tests/managed-agent/invocation-service.test.ts`
- `packages/runtime/src/index.ts`
- `docs/roadmap/01-background-parallel-agent-surface.md`
- `docs/roadmap/README.md`

## TDD Targets

1. Runtime acquires a dev-server port lease before adapter execution and
   releases it as terminal lifecycle evidence.
2. Runtime rejects dev-server port manager resource URIs outside the invocation
   namespace.
3. The in-memory port manager allocates from a configured pool, blocks
   concurrent reuse, releases on terminal cleanup, and records release
   diagnostics.
4. The in-memory port manager fails closed when every configured port is already
   bound.
5. Concurrent starts cannot reuse a port while an availability probe is still
   in flight.
6. Port probe setup failures surface as configuration/probe errors instead of
   being flattened into capacity exhaustion.

## Verification

```bash
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts
bun run --filter @kilnai/runtime test
bun run typecheck
git diff --check
```

## Risks

- Port leases currently allocate and validate runtime availability, but do not
  yet inject the selected port into child environments.
- In-memory port reservations do not survive runtime restart; persistent stale
  lease discovery remains a later Slice 3 concern.
- The port manager must stay behind the managed invocation service boundary so
  surfaces never create their own lease store.
- Port probe concurrency must keep in-flight reservations distinct from active
  leases so a single runtime process never hands out the same port twice.
