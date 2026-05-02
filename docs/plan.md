# Slice 2 Plan - Provider Credential Pool Adapter Wrapper

## Objective

Implement the core `PooledProviderAdapter` wrapper for `ProviderAdapter`
without introducing runtime IO or provider-specific integration code.

## Scope

- `packages/core/src/agents/credential-pool/pooled-adapter.ts`
- `packages/core/src/agents/credential-pool/index.ts`
- `packages/core/src/agents/index.ts`
- `packages/core/tests/agents/credential-pool.test.ts`

## Design

- The wrapper receives a `CredentialPool<TAuth>`, an adapter factory, an
  `ErrorOutcomeMapper`, and optional retry config.
- It creates provider adapters from leased auth values and handles
  acquire -> call -> report -> retry.
- Retry is allowed only for retryable `CredentialOutcome` values.
- Auth and unknown errors are reported, then propagated.
- Streaming retry buffers events per attempt. Failed stream attempts do not
  yield partial output. Only the successful attempt is yielded to callers.
- The wrapper stays in `@kilnai/core`; runtime credential loading remains out
  of scope.

## TDD

- single-credential exhaustion wraps as `AllCredentialsExhaustedError`
- two-credential retry rotates from first credential to second credential
- auth failure propagates without retry
- unknown error propagates without retry
- stream retry discards failed partial output and reruns the full stream

## Verification

- `cmd.exe /c bun x vitest run packages/core/tests/agents/credential-pool.test.ts`
- `cmd.exe /c bun run --filter @kilnai/core test`
- `cmd.exe /c bun run typecheck`
