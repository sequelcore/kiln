# Slice 3 Closure Plan

Objective: close Slice 3 of `docs/roadmap/00.5-plan-goal-workflow-control.md`
by making plan/spec analysis block approval, preserve finding lifecycle
history, and replay analysis details from canonical session events before Slice
4 advances.

Scope:

- `packages/core/src/tools/infrastructure/analysis-state-store.ts`
- `packages/core/tests/tools/infrastructure/analysis-state-store.test.ts`
- `packages/core/src/events/session-event.ts`
- `packages/core/src/events/index.ts`
- `packages/core/tests/events/session-event.test.ts`
- `packages/runtime/src/session/runtime-session-event-ledger.ts`
- `packages/runtime/src/gateway/message-pipeline.ts`
- `packages/runtime/src/gateway/attached-runtime-tool-surface.ts`
- `packages/runtime/src/gateway/plan-approval-transition.ts`
- `packages/runtime/tests/session/runtime-session-specification-events.test.ts`
- `packages/runtime/tests/gateway/message-pipeline.test.ts`
- `packages/runtime/tests/gateway/plan-approval-transition.test.ts`
- `docs/guides/plan-mode.md`
- `docs/architecture/session-model.md`
- `docs/changelog.md`
- `docs/roadmap/00.5-plan-goal-workflow-control.md`

Work items:

1. Add analyzer tests for blocked, closed, and superseded finding lifecycle
   states plus evidence mismatch detection.
2. Add approval-transition tests proving execution approval fails without a
   plan analysis report and while blocking findings remain.
3. Add canonical event tests proving `plan_analysis_reported` carries
   replayable finding details.
4. Implement only the missing analyzer, event, metadata, and approval-gate
   behavior needed for those tests.
5. Update canonical docs and mark Slice 3 complete only after verification.

Verification:

- `bun test packages/core/tests/tools/infrastructure/analysis-state-store.test.ts`
- `bun test packages/runtime/tests/gateway/plan-approval-transition.test.ts`
- `bun test packages/runtime/tests/gateway/message-pipeline.test.ts`
- `bun test packages/runtime/tests/gateway/attached-runtime-tool-surface.test.ts`
- `bun test packages/runtime/tests/session/runtime-session-specification-events.test.ts`
- `bun test packages/core/tests/events/session-event.test.ts`
- `bun run --filter @kilnai/core build`
- `bun run --filter @kilnai/runtime build`
- `bun run typecheck`
