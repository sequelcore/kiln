# Slice 2 Audit Plan: Unified Context Audit Trail

Date: 2026-04-27
Owner: `docs/plan.md`

## Objective

Finish the remaining Slice 2 audit-contract work for
`docs/roadmap/05-context-governor-unification.md`. Runtime admitted-turn
projection and CLI owner deletion are already done; this pass makes the core
governor emit the single context audit shape and has consumers use that shape
instead of local deferred-reason inference.

## Scope Guardrails

- Keep this pass to the audit shape and its immediate consumer handoff.
- Do not move skills, procedural memory, or cross-agent coordination into the
  governor yet; those remain Slice 3.
- Do not redesign summarization, retrieval, runtime persistence, provider
  credential pooling, or event schemas.
- Do not revert unrelated dirty worktree changes.

## Exact Files

### Core audit contract

- `packages/core/src/context/projected-context.ts`
- `packages/core/src/context/governor.ts`
- `packages/core/src/context/index.ts`
- `packages/core/tests/context/governor.test.ts`

### Runtime audit handoff

- `packages/runtime/src/gateway/message-pipeline.ts`
- `packages/runtime/tests/gateway/message-pipeline.test.ts`

### CLI audit consumption

- `packages/cli/src/application/context-types.ts`
- `packages/cli/src/application/session-report.ts`
- `packages/cli/src/application/__tests__/session-report.test.ts`

### Documentation

- `docs/roadmap/05-context-governor-unification.md`
- `docs/plan.md`

## Delegation Assignments

- `Dewey` (`context-scout`): already mapped the Slice 2 runtime and CLI seams.
- `Hal` (`planner`): identified the missing core audit surface as the remaining
  Slice 2 contract gap.
- Orchestrator: add the audit contract, wire runtime result exposure, update
  CLI summary consumption, update docs, and verify.
- `Lois` (`code-reviewer`): review this audit pass before commit.

## Status

- Done: core `ProjectedContext` includes `auditTrail`.
- Done: core `ContextAuditEntry` captures admitted block ids, deferred block
  ids, required/preserved required ids, selected/required tokens, token budget,
  overflow reason, per-block decision, per-block reason, and effective score.
- Done: runtime admitted-turn results expose the latest core context audit
  entry as `contextAudit`.
- Done: CLI context governance summary uses audit deferred reasons when the
  core audit entry is present.
- Remaining after this pass: Slice 3 ranking adapters for procedural memory
  and cross-agent coordination state.

## Verification

- `bun run build` from `packages/core`
- `bun run typecheck`
- `bun run test -- tests\context\governor.test.ts` from `packages/core`
- `bun run test -- tests\gateway\message-pipeline.test.ts` from
  `packages/runtime`
- `bun run test -- src\application\__tests__\session-report.test.ts` from
  `packages/cli`
