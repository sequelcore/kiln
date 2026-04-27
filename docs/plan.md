# Slice 1 Plan: CLI Consumer Migration to Core ContextGovernor

Date: 2026-04-27
Owner: `docs/plan.md`

## Objective

Migrate only the CLI consumer path to instantiate the core `ContextGovernor`
from `@kilnai/core` while preserving current projected-context behavior.
This slice is limited to the consumer seam in `SessionManager.prepare()`.

## Scope Guardrails

- Keep scope to Slice 1 of `docs/roadmap/05-context-governor-unification.md`.
- Do not delete `packages/cli/src/application/context-governor.ts` in this
  slice. Its removal remains Slice 2 unless later work proves it is dead.
- Do not move runtime consumers, public wrapper exports, or other surface
  packages in this slice.
- Do not revert unrelated changes in the worktree.

## Exact Files

### Implementation target

- `packages/cli/src/wrapper/session-manager.ts`

### Tests to add first

- `packages/cli/src/wrapper/__tests__/session-manager-context-governor.test.ts`

### Reference-only files

- `packages/core/src/context/governor.ts`
- `packages/core/src/context/projected-context.ts`
- `packages/cli/src/application/session-ledger.ts`
- `packages/cli/src/application/context-governor.ts`
- `packages/cli/src/wrapper/index.ts`

## Delegation Assignments

- `Dewey` (`context-scout`): confirm `packages/cli/src/wrapper/session-manager.ts`
  is the only live CLI instantiation site for `DefaultContextGovernor`, and
  confirm `packages/cli/src/wrapper/index.ts` remains out of scope for Slice 1.
- `Malcolm` (`tdd-guide`): add failing regression tests in
  `packages/cli/src/wrapper/__tests__/session-manager-context-governor.test.ts`
  before any source edit.
- `Reese` (`coder`): update `packages/cli/src/wrapper/session-manager.ts` to
  instantiate the core governor and translate the existing CLI inputs to the
  core contract without changing behavior.
- `Ida` (`ddd-validator`): verify the result keeps contract ownership in
  `@kilnai/core` and leaves CLI as a consumer only.
- `Lois` (`code-reviewer`): block the slice if the migration changes behavior,
  broadens scope, or deletes the legacy CLI governor early.

## TDD Tests To Add

1. Add a `prepare()` regression that proves the CLI now uses the core governor
   path.
   - Mock or spy on `DefaultContextGovernor` from `@kilnai/core`.
   - Assert `SessionManager.prepare()` forwards:
     `artifactCache`, `sessionLedger`, `renderLedger`, `tokenBudget`,
     `preferredSources`, `summaryAggressiveness`, and the translated
     `aggressivenessPolicy`.
   - Assert `ctx.projectedContext` is the projection returned by the mocked
     core governor.

2. Add a `prepare()` regression that preserves summary-aggressiveness behavior
   under a tight turn budget.
   - Seed `InMemoryContextArtifactCache` with cached summaries.
   - Configure `kilnYaml.contextGovernance.summaryAggressiveness = "high"` and
     a constrained `turnBudget`.
   - Assert the selected blocks still favor summaries over comparable artifact
     blocks the same way the current CLI governor does.

3. Add a `prepare()` regression that preserves ledger and replay artifact
   assembly during resume.
   - Provide `resumeSessionId` and `resumedMeta`.
   - Assert the projected context still contains the rendered ledger block and
     the required replay artifacts/worktree hint after the core migration.

## Implementation Steps

1. Add the failing tests in
  `packages/cli/src/wrapper/__tests__/session-manager-context-governor.test.ts`.

2. In `packages/cli/src/wrapper/session-manager.ts`, replace the import of the
   CLI-local `DefaultContextGovernor` with the core `DefaultContextGovernor`
   from `@kilnai/core`.

3. Import `renderSessionLedger` from
   `packages/cli/src/application/session-ledger.ts` and pass it to the core
   governor through `renderLedger`.

4. Add a Slice 1 adapter constant in
   `packages/cli/src/wrapper/session-manager.ts` that reproduces the current
   CLI summary-aggressiveness behavior exactly:
   - `low`: `summaryBonus = -0.08`, `artifactPenalty = 0`
   - `medium`: `summaryBonus = 0`, `artifactPenalty = 0`
   - `high`: `summaryBonus = 0.12`, `artifactPenalty = 0.08`

   Note: the legacy CLI governor stores the high artifact adjustment as `-0.08`,
   but the core governor subtracts `artifactPenalty` internally. The adapter
   must pass the positive magnitude `0.08` to preserve behavior.

5. Adapt the `project()` input mapping in
   `packages/cli/src/wrapper/session-manager.ts`:
   - `cache` -> `artifactCache`
   - pass `sessionLedger` and `renderLedger: renderSessionLedger`
   - preserve `memorySnapshot`
   - preserve `exactArtifacts`
   - preserve `moduleArtifactKeys`
   - preserve `projectArtifactKey`
   - preserve `planArtifactKey`
   - preserve `sessionArtifactKey`
   - preserve `tokenBudget`
   - preserve `preferredSources`
   - preserve `summaryAggressiveness`
   - pass the translated `aggressivenessPolicy`

6. Leave `packages/cli/src/application/context-governor.ts` in place and do
   not repoint `packages/cli/src/wrapper/index.ts` exports in this slice unless
   a compile-only type mismatch forces a no-behavior import harmonization.

## Verification Criteria

- `bun run typecheck` passes after the migration.
- `bun run test` passes after the migration.
- `packages/cli/src/wrapper/__tests__/session-manager-context-governor.test.ts` covers:
  core governor wiring, summary-aggressiveness preservation, and resume ledger
  / replay artifact preservation.
- `packages/cli/src/wrapper/session-manager.ts` no longer imports
  `../application/context-governor.js`.
- `packages/cli/src/application/context-governor.ts` still exists after Slice 1.
- No source or test files outside the paths listed above are required for the
  slice to land.

## Primary Risk

The highest regression risk is the `artifactPenalty` sign convention mismatch
between the legacy CLI governor and the core governor. If the old negative
value is passed through unchanged, high summary aggressiveness will reward
artifacts instead of penalizing them.
