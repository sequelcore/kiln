# Slice 7U Plan - Deterministic Real Git Worktree Fixture Guard

## Objective

Harden the existing real-git dirty worktree proof in
`packages/runtime/tests/managed-agent/invocation-service.test.ts` so it still
exercises `ManagedGitWorktreeLeaseManager`, but no longer depends on immediate
Windows filesystem timing or ad hoc path checks. The slice should add a
test-local helper that performs bounded pre/post path-state assertions while
leaving real git failures visible.

## Non-Goals

- Do not widen Slice 7U beyond the existing real-git proof already added in
  `packages/runtime/tests/managed-agent/invocation-service.test.ts`.
- Do not introduce shared test utilities or new fixture files for one runtime
  proof.
- Do not change runtime production code unless the hardened test exposes a real
  lease-manager integration bug.
- Do not touch gateway, GUI, or recovery code in this slice. Update the roadmap
  only after verification, as the standard Slice 7 closeout step.

## Affected Files

- `docs/plan.md` - replace Slice 7T planning notes with Slice 7U.
- `packages/runtime/tests/managed-agent/invocation-service.test.ts` - tighten
  the existing real-git dirty-worktree test with a local fixture/helper.
- `packages/runtime/src/agents/managed-invocation/index.ts` - patch only if the
  hardened failing test proves the runtime mishandles real worktree cleanup.
- `docs/roadmap/01-background-parallel-agent-surface.md` - update after the
  helper hardening is verified.

## Test-First Steps

1. Start from the existing real-git proof at
   `packages/runtime/tests/managed-agent/invocation-service.test.ts:3162`.
2. Replace the direct pre-join and post-join `access(...)` assertions with a
   failing test-local helper that waits for a bounded, explicit path state
   instead of assuming immediate Windows visibility.
3. Assert fixture materialization before `join`: the isolated worktree root
   exists, the tracked proof file exists at the exact admitted path, and the
   helper verifies only paths declared by the fixture.
4. Assert preserved review state after `join`: the worktree root still exists,
   the tracked file still exists with dirty content, and the runtime still
   reports leaked/failed cleanup plus review-required diagnostics.
5. Only if the hardened test reveals a real runtime defect, patch production
   code and keep the same test as the regression proof.

## Fixture And Helper Shape

- Keep the temporary repo fixture inline in
  `packages/runtime/tests/managed-agent/invocation-service.test.ts`.
- Add one test-local helper beside the real-git test that:
  - accepts one explicit path, an operator-readable label, and the expected node
    type (`directory` or `file`),
  - retries only `ENOENT` for a short fixed window because missing-path
    visibility can lag on Windows,
  - fails immediately for permission errors, wrong node types, malformed paths,
    or other hard filesystem failures,
  - confirms the path type twice with a short settle interval before returning,
  - does not catch or reinterpret git command failures from fixture setup or
    `ManagedGitWorktreeLeaseManager`.
- Keep path expectations derived from the real temp fixture paths used by the
  invocation request.

## Production Patch Criteria

- Preferred outcome: no production patch.
- Patch `packages/runtime/src/agents/managed-invocation/index.ts` only if the
  hardened test proves `RuntimeManagedAgentInvocationService.join` or lease
  release logic is actually wrong under the real manager.
- Preserve current `resourceLease`, `worktreeReview`, and canonical artifact
  URI shapes. Slice 7U is about deterministic proof quality, not contract
  redesign.

## Acceptance Criteria

- The real-git test still uses `ManagedGitWorktreeLeaseManager` and a temporary
  local repository.
- Pre/post cleanup assertions no longer rely on immediate one-shot filesystem
  checks.
- The helper remains test-local, bounded, and narrow to declared fixture paths.
- Dirty worktree cleanup failures still surface as real test failures; the new
  helper must not mask git or runtime errors.
- The test continues to prove terminal `completed` plus leaked/failed
  cleanup evidence and preserved dirty checkout for review.

## Verification

```bash
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts
bun run typecheck
```
