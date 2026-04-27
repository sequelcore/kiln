# Context Governor Unification

## Purpose

Close the gap between `docs/architecture/context-governance.md` and the code.
The architecture doc declares a single `ContextGovernor` as the canonical owner
of context assembly, budget allocation, ranking, and truncation. The code
today has parallel owners across `cli`, `runtime`, and the memory/knowledge
surface, and procedural memory (skills) plus cross-agent coordination state
are not ranked under the same policy.

This roadmap closes that gap. It does not introduce new doctrine. It migrates
the existing code to the doctrine already written.

## Non-Goals

- No new architecture doctrine. `context-governance.md` and `memory.md` remain
  the source of truth.
- No ADR. This is a refactor to match existing doctrine, not a decision that
  needs justification.
- No behavior change visible to end users in the first slice. The first slice
  is a contract move and consumer migration; observable behavior must be
  preserved.
- No context-window size extension, summarization model change, or retrieval
  algorithm replacement. Those are separate concerns.

## Current State

- `packages/cli/src/application/context-governor.ts` still exists as a
  CLI-scoped governor pending Slice 2 deletion, but the live CLI
  `SessionManager.prepare()` consumer path now instantiates the core
  governor contract from `@kilnai/core`.
- `packages/runtime/src/session/support/` holds parallel assembly seams:
  `context-artifact-summary.ts`, `context-artifact-cache.ts`,
  `context-summarizer.ts`, and `trace-context.ts`. These make admission
  decisions without going through the CLI governor.
- `packages/core/src/memory/context-budget.ts` defines a budget shape but no
  governor contract consumes it uniformly.
- Procedural memory (skills) is loaded through its own retrieval path and
  does not participate in the turn-budget ranking.
- Cross-agent coordination state (swarm primitives, cross-agent memory) uses
  its own scope and naming conventions and is not ranked against episodic or
  semantic memory when the budget is tight.

## Target State

- `@kilnai/core` owns the `ContextGovernor` contract, the `ContextBudget`
  shape, the ranking policy interface, the truncation policy interface, and
  the audit trail format.
- `@kilnai/runtime`, `@kilnai/cli`, `@kilnai/gui` (via runtime), and future
  `@kilnai/sdk` / `@kilnai/widget` consumers all assemble context through
  that one governor. No surface package owns assembly policy.
- Episodic memory, semantic memory, procedural memory, and coordination
  state all expose a common ranking interface so the governor can rank and
  truncate them on equal footing under one budget.
- Every assembled turn emits a single audit trail entry describing which
  blocks were admitted, which were truncated, and why. One format. One owner.

## Slices

### Slice 1: Core contract move

- Define `ContextGovernor`, `ContextBudget`, `RankingPolicy`,
  `TruncationPolicy`, and `ContextAuditEntry` in `packages/core`.
- Keep the existing CLI and runtime implementations working by adapting them
  to the new contract without moving logic yet.
- Add unit tests for the contract in `packages/core/tests/`.
- No observable behavior change.

**Current status (2026-04-27):** CLI consumer migration landed.

- Landed: the core context surface exists in `packages/core/src/context/` and
  core tests cover the generic governor contract.
- Landed: `packages/cli/src/wrapper/session-manager.ts` instantiates the core
  `DefaultContextGovernor`, maps the CLI artifact cache to `artifactCache`,
  passes `renderSessionLedger`, preserves the legacy `medium` default for
  missing summary aggressiveness, and translates the CLI aggressiveness policy
  to the core contract.
- Landed: `packages/cli/src/wrapper/__tests__/session-manager-context-governor.test.ts`
  covers the core governor wiring, core input shape, policy translation, legacy
  default behavior, and resume ledger rendering.
- The deletion of `packages/cli/src/application/context-governor.ts` remains a
  Slice 2 responsibility; do not treat owner deletion as part of Slice 1.

**Verification (2026-04-27):**

- `bun run typecheck` passed.
- Targeted CLI regression passed:
  `bun run test -- src\wrapper\__tests__\session-manager-context-governor.test.ts`.
- Full `bun run test` is not clean because of unrelated pre-existing runtime
  and TUI persistence failures outside this slice.

### Slice 2: Runtime migration and owner deletion

- Migrate `context-artifact-summary.ts`, `context-artifact-cache.ts`,
  `context-summarizer.ts`, and `trace-context.ts` to consume the core
  governor.
- Delete the parallel CLI-scoped governor in
  `packages/cli/src/application/context-governor.ts` once its responsibilities
  are absorbed. No legacy compatibility wrapper. No deprecation window.
- GUI, TUI (until deleted), and CLI surfaces all receive governed context
  from the runtime via the existing gateway and wrapper contracts.
- Audit trail format is unified. Remove surface-local audit logging.

### Slice 3: Skills and coordination under one policy

- Define a ranking adapter for procedural memory so skills compete for the
  turn budget under the same policy as episodic and semantic blocks.
- Define a ranking adapter for cross-agent coordination state so it presents
  as a governed memory layer (scope, salience, recency, decay) rather than a
  parallel fetch. Retrieval failure is explicit, per `memory.md` invariants.
- Remove any skill or coordination fetch path that bypasses the governor.

## Verification

- `bun run typecheck` clean across the monorepo after each slice.
- `bun run test` clean. New tests cover: budget overflow truncation order,
  safety-critical preservation, audit trail format stability, ranking across
  all four memory kinds.
- No surface package imports context-assembly internals after Slice 2. Grep
  for `context-artifact-*` or surface-local budget code should show only
  consumer usage through the core contract.
- No dead code. Parallel owners are deleted, not left behind as compatibility
  shims.

## Standards

- DDD and Clean Architecture. `@kilnai/core` owns the contract; surfaces and
  runtime are consumers.
- No backwards-compat shims. If a consumer needs to change, change the
  consumer.
- No silent fail-open. Retrieval failure, budget overflow, and truncation
  decisions are all explicit and audited.
- TDD for the core contract. Failing tests before implementation per
  ADR-020 equivalent discipline.
