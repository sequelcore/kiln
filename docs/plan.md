# Slice 2 Cleanup Plan: CLI Governor Owner Deletion

Date: 2026-04-27
Owner: `docs/plan.md`

## Objective

Finish the Slice 2 owner-deletion cleanup for
`docs/roadmap/05-context-governor-unification.md`. Runtime admitted-turn
projection is already governed by the core governor at `HEAD`; this cleanup
removes the remaining CLI-local governor owner and its wrapper export surface.

## Scope Guardrails

- Keep this cleanup to the CLI-local governor deletion and related docs.
- Do not add a compatibility wrapper or re-export a changed core generic shape
  through the CLI wrapper package.
- Do not move skills, procedural memory, or cross-agent coordination into the
  governor yet; those remain Slice 3.
- Do not redesign summarization, retrieval, runtime persistence, or provider
  credential pooling.
- Do not revert unrelated dirty worktree changes.

## Exact Files

### CLI owner deletion

- `packages/cli/src/application/context-governor.ts`
- `packages/cli/src/wrapper/index.ts`
- `packages/cli/src/wrapper/__tests__/session-manager-context-governor.test.ts`

### Documentation

- `docs/roadmap/05-context-governor-unification.md`
- `docs/plan.md`

## Delegation Assignments

- `Dewey` (`context-scout`): mapped runtime projection seams and confirmed the
  owner deletion target.
- `Hal` (`planner`): split Slice 2 into atomic concerns and identified the
  remaining audit-contract gap.
- Local LM Studio worker (`qwen/qwen3.5-9b`): smoke-tested local worker
  workflow with a read-only Slice 2 brief.
- Orchestrator: delete the CLI-local governor owner, remove its public wrapper
  exports, update docs, and verify.
- `Lois` (`code-reviewer`): reviewed the cleanup and blocked the first
  re-export approach; the fix removes the wrapper governor exports entirely.

## Status

- Done: runtime admitted-turn projection is governed by the core governor at
  `HEAD` and covered by `message-pipeline.test.ts`.
- Done: `packages/cli/src/application/context-governor.ts` is deleted.
- Done: `packages/cli/src/wrapper/index.ts` no longer re-exports
  `DefaultContextGovernor`, `ContextGovernor`, or `ProjectContextInput`.
- Done: CLI regression test guards against reintroducing the deleted local
  governor path or wrapper governor exports.
- Remaining: core audit trail contract is still not explicit enough for the
  full Slice 2 target. Treat that as the next atomic concern.

## Verification

- `bun run typecheck`
- `bun run test -- tests\context\governor.test.ts` from `packages/core`
- `bun run test -- tests\gateway\message-pipeline.test.ts` from
  `packages/runtime`
- `bun run test -- src\wrapper\__tests__\session-manager-context-governor.test.ts`
  from `packages/cli`

## Local Worker Workflow Notes

- `lms status` showed the LM Studio server running on port `1234`.
- `lms load qwen/qwen3.5-9b` loaded successfully.
- `lms chat qwen/qwen3.5-9b` responded to the Slice 2 brief but timed out and
  produced overly broad planning output.
- `lms unload qwen/qwen3.5-9b` unloaded the model after the smoke test.
- The workflow is viable for smoke testing, but implementation delegation needs
  stricter prompts and likely a non-reasoning profile before Kiln integration.
