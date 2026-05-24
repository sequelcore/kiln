# Slice 5N CLI Adoption-Gate Parity Plan

## Objective

Bring the CLI `managed-agent` cockpit into parity with the shared
runtime/gateway/TUI/native adoption-gate projection. The CLI must pass through
runtime-projected work-item adoption snapshots and render the resulting shared
`invocation.adoptionGate` state without computing adoption locally.

## Scope

- Retain `work_item_updated`, `work_item_execution_started`, and
  `work_item_execution_finished` transcript events only when they carry an
  existing `managedOrchestrationAdoptionGate` snapshot.
- Keep `projectOperatorCockpitReadOnlyView` as the single projection path.
- Show adoption-gate status in `list` and detailed adoption-gate fields in
  `status`.
- Keep `resources` backed by shared `evidenceResourceUris`; JSON output keeps
  the shared invocation projection shape.

## File Plan

- `packages/cli/src/commands/managed-agent.test.ts`
  - Add failing tests for transcript work-item snapshot retention, list/status
    rendering, JSON projection, and mismatched child fail-closed behavior.
- `packages/cli/src/commands/managed-agent.ts`
  - Pass through only snapshot-bearing work-item events.
  - Render `invocation.adoptionGate` status, adopted-by/at, blocking evidence,
    and rejection detail from shared projection data.
- `docs/roadmap/01-background-parallel-agent-surface.md`
  - Mark Slice 5N complete only after verification.

## Verification

- `bun run --cwd packages/cli test -- src/commands/managed-agent.test.ts`
- `bun run typecheck`
- `bun run test`

## Risks

- The CLI must not infer adoption status from raw `workItem` payloads.
- Work-item snapshots without matching child ids must fail closed through the
  shared projection.
- CLI output must stay limited to adoption-gate state and avoid governed review
  summary semantics until that contract exists.
