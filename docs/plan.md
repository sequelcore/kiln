# Slice 6D - Code-Writing Adoption Readiness

## Objective

Continue the background-agent roadmap without reopening Slice 5. Slice 5 is
closed after 5P; Slice 6A-C are complete. Slice 6D implements the next narrow
Slice 6 cut: code-writing managed orchestration children must pass core-owned
diff, verification, review, and adoption readiness before
`managed-orchestration:adoption-gate` can close.

## Decision

5.5 xhigh selected a core-owned adoption-readiness contract. Core already owns
managed orchestration adoption truth and goal closeout consumes that
projection. Runtime and CLI may pass evidence through, but they must not create
surface-local adoption truth.

## Non-Goals

- Do not reopen Slice 5 cockpit projection work.
- Do not implement conflict states for worktree-backed children in this cut.
- Do not implement feedback/repair work items in this cut.
- Do not inline diffs into session events; adoption evidence remains
  resource-pointer based.

## Surface Map

- Core work-governance domain:
  - `packages/core/src/work-governance/work-item.ts`
  - `packages/core/src/work-governance/work-item-materializer.ts`
  - `packages/core/src/work-governance/index.ts`
- Core tests:
  - `packages/core/tests/work-governance/work-item-materializer.test.ts`
  - `packages/core/tests/work-governance/goal-execution.test.ts`
- CLI adapter pass-through tests if existing tool contracts need shape updates:
  - `packages/cli/src/application/work-governance-tool.test.ts`
- Roadmap status:
  - `docs/roadmap/01-background-parallel-agent-surface.md`
  - `docs/roadmap/README.md`

## Expected Behavior

- Adoption-required write-capable managed orchestration work items materialize
  explicit readiness evidence and gates for diff, verification, review, and
  final adoption.
- A structured adoption resolution alone is not sufficient for code-writing
  children. Diff evidence must be present and verification/review readiness
  gates must pass.
- Failed or skipped readiness gates do not satisfy adoption readiness.
- Goal closeout counts `managed-orchestration:adoption-gate` only when the
  core adoption projection is `adopted`.

## Verification

- Focused core tests for materialization and adoption closeout.
- Focused CLI test only if the tool adapter needs contract changes.
- `bun run --cwd packages/core test -- tests/work-governance/work-item-materializer.test.ts tests/work-governance/goal-execution.test.ts`
- `bun run typecheck`
- `bun run test`
- DDD/Clean Architecture review.
- Code review.
