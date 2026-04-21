# Roadmap

This directory is the canonical roadmap set for documentation cleanup, codebase
realignment, GUI parity, and deferred benchmark work.

## Canonical File Set

The roadmap now uses numbered files. The number indicates the default read
order, not necessarily the active work priority.

### Foundation and references

- `01-bounded-context-decisions.md`
  Explicit keep, split, merge, rename, and delete decisions for major modules.

### Execution roadmaps

- `02-orchestrator-refactor-roadmap.md`
  Canonical orchestrator roadmap. Merges the former overview plus O1, O2, and
  O4 slice-plan documents.
- `03-gui-phase-1-parity-checklist.md`
  Phase I GUI parity checklist. The deletion gate for `packages/tui/`.

### Deferred work

- `04-external-benchmark-validation.md`
  Deferred public benchmark milestone after architecture and product work
  stabilize.

## Read Order

1. Read `01-bounded-context-decisions.md` before sequencing code refactors.
2. Read `02-orchestrator-refactor-roadmap.md` for the first code refactor track.
3. Read `03-gui-phase-1-parity-checklist.md` when planning or verifying GUI
   parity work.
4. Read `04-external-benchmark-validation.md` only when benchmark work becomes
   active.

## Current Execution Priority

This is the delivery queue. It is the only priority order in this index.

1. Finish the remaining rows in `03-gui-phase-1-parity-checklist.md` so TUI
   deletion can proceed without preserving architectural drift.
2. Continue `02-orchestrator-refactor-roadmap.md` with the remaining O5 public
   export cleanup and any later control-plane follow-up, now that T1-T5 are
   closed for the current runtime stop point.
3. Write and accept the config and registries surface ADR before broader config
   and registry UI work starts.
4. Keep `04-external-benchmark-validation.md` deferred until the product
   surface stabilizes.

## Current Status

As of 2026-04-21:

- the taxonomy freeze and module mapping slices are closed
- bounded-context decisions now lead the roadmap sequence
- `packages/runtime/src/session` Slice 3 (support-helper extraction) is complete
- `packages/runtime/src/session` Slice 4 (internal orchestrator decomposition) is complete
- `packages/runtime/src/session` Slice 5 (runtime session vocabulary rename) is complete
- `packages/core/src/engine/gateway` runtime-mode config/loader rename is complete
- `packages/runtime/src/gateway` provider-adapter route terminology cleanup is complete
- the orchestrator roadmap has been consolidated into one canonical file
- 2026-04-21: T1.A completed in `02-orchestrator-refactor-roadmap.md`; admitted
  TUI and GUI turns now route through the shared `processAdmittedTurn(...)`
  handoff instead of maintaining duplicated local turn-processing sequences
- 2026-04-21: T1.B completed in `02-orchestrator-refactor-roadmap.md`;
  provider-adapter route preparation was reduced so auto knowledge retrieval
  and tenant agent/tool resolution now happen inside the shared runtime
  handoff instead of the route handler
- 2026-04-21: T1.C/T1.D completed in `02-orchestrator-refactor-roadmap.md`;
  the admitted-turn boundary rename landed and tenant route setup now resolves
  inside `processAdmittedTurn(...)` instead of the route layer
- 2026-04-21: T2 completed in `02-orchestrator-refactor-roadmap.md`; TUI and
  GUI now use the canonical admitted-turn handoff and the focused surface test
  suite passed
- 2026-04-21: T1 closed fully in `02-orchestrator-refactor-roadmap.md`; the
  tier-enforcement decision was resolved in favor of ingress admission instead
  of moving commercial plan gating into `processAdmittedTurn(...)`
- 2026-04-21: T3 completed for the current runtime stop point in
  `02-orchestrator-refactor-roadmap.md`; admitted-turn context projection,
  runtime turn system-prompt assembly, and runtime continuity presentation now
  converge on explicit runtime-owned seams instead of route-local or
  turn-record-local formatting paths
- 2026-04-21: T4 is partially complete in
  `02-orchestrator-refactor-roadmap.md`; dead execution wrappers
  `api-executor.ts` and `model-executor.ts` were deleted and
  `cli-subscription-executor.ts` was narrowed by extracting serializer,
  response-assembly, and session-contract ownership into dedicated files
- 2026-04-21: T5 is partially complete in
  `02-orchestrator-refactor-roadmap.md`; GUI and TUI turn capture now preserve
  `authorityDecisions` in the canonical admitted-turn result, leaving
  dangerous-command outcome evidence as the next runtime audit-convergence cut
- 2026-04-21: the next T5 slice landed in
  `02-orchestrator-refactor-roadmap.md`; dangerous-command `ask` and `deny`
  outcomes now persist as dedicated canonical turn-record evidence instead of
  remaining implicit in generic blocked tool summaries
- 2026-04-21: focused T3 validation passed with
  `tests/gateway/message-pipeline.test.ts`,
  `tests/gateway/message-pipeline-grounding.test.ts`,
  `tests/session/runtime-session-orchestrator.test.ts`, and
  `tests/session/runtime-turn-record.test.ts`; full workspace `bun run test`
  remains blocked by the pre-existing
  `runtime-session-orchestrator-tools.test.ts` failure
- 2026-04-21: focused T4/T5 validation passed with
  `tests/execution/cli-subscription-executor.test.ts`,
  `tests/gateway/gui-gateway-authority.test.ts`,
  `tests/gateway/tui-gateway-authority.test.ts`, and `bun run typecheck`
- 2026-04-21: focused dangerous-command evidence validation passed with
  `tests/session/runtime-turn-record.test.ts`,
  `tests/gateway/message-pipeline.test.ts`, and `bun run typecheck`; the
  broader `tests/session/runtime-session-orchestrator-tools.test.ts` file still
  failed at that stop point on the structured `fileChanges` assertion
- 2026-04-21: the next T5 parity cleanup slice fixed the runtime
  `fileChanges` extraction drift; `tests/session/runtime-session-orchestrator.test.ts`,
  `tests/session/runtime-session-orchestrator-tools.test.ts`, and
  `bun run typecheck` now pass from the current stop point
- 2026-04-21: focused T4 closeout validation passed with
  `tests/execution/cli-subscription-executor.test.ts`,
  `tests/gateway/tui-gateway.test.ts`,
  `tests/gateway/tui-gateway-authority.test.ts`,
  `tests/gateway/gui-gateway.test.ts`, and
  `tests/gateway/provider-adapter-routes.test.ts`; the surviving
  `cli-subscription-executor.ts` boundary is now considered a valid transport
  adapter rather than an execution-policy leak
- 2026-04-21: focused T5 closeout validation passed with
  `tests/session/runtime-turn-record.test.ts`,
  `tests/gateway/message-pipeline.test.ts`,
  `tests/gateway/tui-gateway-authority.test.ts`,
  `tests/gateway/gui-gateway-authority.test.ts`, and `bun run typecheck`; T5
  is closed for the current runtime stop point
- GUI parity work is active in `03-gui-phase-1-parity-checklist.md`
- parity status is 29/51 rows complete
- external benchmark validation remains deferred

## Rules

- Do not add new conceptual roadmap docs when an existing numbered file can be
  expanded instead.
- Do not split one concern across multiple near-duplicate plan files.
- Delete superseded roadmap docs when their content is absorbed.
