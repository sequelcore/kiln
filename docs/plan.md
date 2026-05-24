# Slice 7C - CLI Managed-Agent View-State Parity

## Objective

Continue Slice 7 by moving CLI managed-agent list, status, and resources output
onto the same shared cockpit managed-agent view-state used by TUI, GUI, and
native surfaces.

## Decision

Keep projection construction in the CLI transcript adapter, then derive
operator-facing managed-child rows from `createOperatorCockpitReadOnlyViewState`
in `@kilnai/gateway-contracts`. The CLI must display shared attention state,
active and attention counts, cancel availability, and de-duplicated evidence
resources without reimplementing lifecycle rules locally.

## Non-Goals

- Do not change gateway cancellation or join control behavior.
- Do not change transcript persistence or session event schema.
- Do not add surface-local timeout, cancellation, or review inference.
- Do not introduce compatibility output paths for older CLI formatting.

## Surface Map

- CLI managed-agent command:
  - `packages/cli/src/commands/managed-agent.ts`
  - `packages/cli/tests/commands/managed-agent.test.ts`
- Shared view-state dependency:
  - `packages/gateway-contracts/src/operator-cockpit-view-state.ts`
- Roadmap:
  - `docs/roadmap/01-background-parallel-agent-surface.md`

## Expected Behavior

- `kiln managed-agent list` prints shared attention and active counts.
- CLI list rows include each child `attentionState`, terminal status,
  lifecycle state, route, resource count, and cancel-control status.
- `kiln managed-agent status <id>` prints the shared attention state and
  cancel-control reason alongside existing lifecycle, lease, and adoption
  details.
- `kiln managed-agent resources <id>` prints the shared de-duplicated resource
  list, not a surface-local resource projection.
- Timed-out and cancelled children remain distinct in CLI output while keeping
  their canonical lifecycle/status evidence.

## Verification

- Add failing CLI tests first from persisted transcript events.
- Run `bun run --cwd packages/cli test -- tests/commands/managed-agent.test.ts`.
- Run `bun run typecheck`.
- Run `bun run build`.
- Update the roadmap after code verification.
