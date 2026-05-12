# Slice 2 Closure Plan

Objective: close Slice 2 of `docs/roadmap/00.5-plan-goal-workflow-control.md`
by making submitted plans fully structured, event-replayable, and renderable
from canonical data before Slice 3 advances.

Scope:

- `packages/core/src/tools/infrastructure/plan-state-store.ts`
- `packages/core/tests/tools/infrastructure/plan-state-store.test.ts`
- `packages/core/src/events/session-event.ts`
- `packages/runtime/src/session/runtime-session-event-ledger.ts`
- `packages/runtime/src/gateway/message-pipeline.ts`
- `packages/runtime/src/gateway/attached-runtime-tool-surface.ts`
- `packages/runtime/tests/gateway/message-pipeline.test.ts`
- `packages/runtime/tests/gateway/attached-runtime-tool-surface.test.ts`
- `docs/guides/plan-mode.md`
- `docs/architecture/session-model.md`
- `docs/roadmap/00.5-plan-goal-workflow-control.md`

Work items:

1. Add focused tests proving high-control plans fail closed without operator
   decisions, approval boundaries, rollback notes, and residual risks.
2. Add runtime tests proving successful `submit_plan` output and metadata carry
   the same structured plan content as the stored resource.
3. Add session event tests proving `plan_submitted` preserves proposed work
   items, not just a count, so fallback surfaces can replay the canonical plan.
4. Implement only the missing event/output projection needed for those tests.
5. Update canonical docs and mark Slice 2 complete only after verification.

Verification:

- `bun test packages/core/tests/tools/infrastructure/plan-state-store.test.ts`
- `bun test packages/runtime/tests/gateway/attached-runtime-tool-surface.test.ts`
- `bun test packages/runtime/tests/gateway/message-pipeline.test.ts`
- `bun run --filter @kilnai/core build`
- `bun run --filter @kilnai/runtime build`
- `bun run typecheck`
