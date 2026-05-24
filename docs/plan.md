# Slice 7A - Subscription Direct Live Route Proof

## Objective

Start Slice 7 live hardening by adding the missing subscription-backed direct
provider live proof and removing ad hoc live-test gating from individual
managed-agent live tests.

## Decision

Use the existing managed invocation runtime service, direct-provider adapter
factory, builtin tool surface, and fixture workspace harness. Add one shared
provider live-test gate so each route family is enabled by the global live flag
plus its provider-specific opt-in flag.

## Non-Goals

- Do not introduce a new managed-agent lifecycle store or worker plane.
- Do not special-case subscription routes outside the direct-provider adapter
  path.
- Do not run live tests by default.
- Do not add compatibility aliases or legacy env fallbacks.

## Surface Map

- Live harness:
  - `packages/runtime/tests/managed-agent/managed-agent-live-test-harness.ts`
- Live tests:
  - `packages/runtime/tests/managed-agent/live-test-harness.test.ts`
  - `packages/runtime/tests/managed-agent/openai-direct-live-proof.live.test.ts`
  - `packages/runtime/tests/managed-agent/codex-live-proof.live.test.ts`
  - `packages/runtime/tests/managed-agent/opencode-live-proof.live.test.ts`
  - `packages/runtime/tests/managed-agent/codex-oauth-direct-live-proof.live.test.ts`
- Direct provider factory:
  - `packages/cli/src/config/managed-agent-direct-adapters.ts`
- Roadmap:
  - `docs/roadmap/01-background-parallel-agent-surface.md`

## Expected Behavior

- Live tests remain disabled unless `KILN_LIVE_MANAGED_AGENT_TESTS=1`.
- Provider-family live tests also require their explicit provider opt-in flag.
- Codex OAuth subscription direct live proof executes through the same
  managed direct-provider adapter and runtime service as configured routes.
- The subscription direct live proof reads the fixture through Kiln builtin
  tool authority and records a canonical completed managed invocation.

## Verification

- Add failing tests first for provider-specific live-test gating.
- Run `bun run --cwd packages/runtime test -- tests/managed-agent/live-test-harness.test.ts`.
- Run focused managed-agent live test files with default env to prove they
  remain skipped.
- Run `bun run --cwd packages/cli test -- tests/config/managed-agent-direct-adapters.test.ts`.
- Run `bun run --cwd packages/runtime test -- tests/managed-agent/direct-runtime-adapter.test.ts`.
- Run `bun run typecheck`.
- Update the roadmap after code verification.
