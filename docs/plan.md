# Slice 6C - Managed Child Failure Evidence

## Objective

Continue `docs/roadmap/01-background-parallel-agent-surface.md` without
reopening Slice 5. Slice 5 is closed after 5P; Slice 6A-B are complete. The
next implementation cut is Slice 6C: managed child terminal failures must be
recorded as governed missing evidence on the owning work item instead of
remaining runtime-only metadata or absent child handoff.

## Non-Goals

- Do not reopen Slice 5 cockpit projection work.
- Do not implement full diff/review/adoption gates for code-writing children in
  this cut.
- Do not add a second lifecycle store or surface-local failure model.
- Do not run live managed-agent provider tests as part of deterministic
  verification.

## Surface Map

- Core domain:
  - `packages/core/src/work-governance/work-item.ts`
  - `packages/core/src/work-governance/goal-execution.ts`
  - `packages/core/src/work-governance/index.ts`
- CLI tool adapter:
  - `packages/cli/src/application/work-governance-tool.ts`
  - `packages/cli/src/application/work-governance-tool.test.ts`
- Runtime/session event projection:
  - `packages/runtime/src/session/runtime-session-event-ledger.ts`
  - focused tests if metadata operation shape changes
- Existing evidence tests:
  - `packages/core/tests/work-governance/goal-execution.test.ts`

## Decision Point

Open design question sent to 5.5 xhigh before production edits:

- Prefer an explicit `work_item.execution.fail` path if the decision confirms
  failure is a distinct domain transition.
- Avoid overloading `work_item.execution.finish` unless the decision says the
  existing closeout semantics should own failed/cancelled child outcomes.

## Expected Behavior

- A managed-delegation attempt linked to a child invocation can be recorded as
  failed or cancelled with a bounded reason.
- Failed, unavailable, denied, timed-out, and cancelled children keep the work
  item blocked with the missing expected evidence visible on the attempt, item,
  metadata, and canonical session event.
- Goal state remains active and pauses at the blocked work item; child failure
  does not satisfy `managed-orchestration:result-handoff`,
  `managed-agent-review`, tests, typecheck, or residual-risk evidence.
- Replay reconstructs the blocked work item from the existing
  `work_item_execution_finished` event shape.

## Verification

- Focused core work-governance tests for failed/cancelled managed attempts.
- Focused CLI work-governance tool tests for the tool contract chosen by the
  5.5 decision.
- Runtime ledger focused tests only if metadata operation handling changes.
- `bun run typecheck`
- `bun run test`
- DDD/Clean Architecture review.
- Code review.
