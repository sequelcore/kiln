# Slice 6B Managed Handoff Evidence Plan

## Objective

Continue the background-agent roadmap without reopening Slice 5. Slice 6B
enforces substantive managed-orchestration result handoff evidence before a
governed child work item can complete.

## Decision

Slice 5 remains closed after Slice 5P. The next clean cut is Slice 6B because
the remaining work is governed handoff/adoption, not cockpit projection.

## Scope

- Add a structured managed-orchestration result handoff to core work items.
- Treat raw `managed-orchestration:result-handoff` strings as insufficient for
  managed child completion and goal closeout.
- Require matching work item, orchestration id, child id, summary, timestamp,
  and resource pointers for structured handoff satisfaction.
- Pass structured handoff through `work_item.execution.finish`.
- Update roadmap status after verification.

## Non-Goals

- No resource content reads or artifact pagination.
- No runtime storage coupling in core work governance.
- No conflict-state, review-gate, or repair-work-item expansion in this slice.

## Verification

- `bun run --cwd packages/core test -- tests/work-governance/goal-execution.test.ts tests/work-governance/work-item-materializer.test.ts`
- `bun run --cwd packages/cli test -- src/application/work-governance-tool.test.ts`
- `bun run typecheck`
- `bun run test`
- DDD/Clean Architecture review
- Code review
