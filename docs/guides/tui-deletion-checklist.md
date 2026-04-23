# TUI Deletion Checklist

## Purpose

This guide is the execution checklist for removing the frozen TUI after GUI
Phase 1 parity sign-off. It satisfies verification protocol item 5 from
`docs/roadmap/01-gui-phase-1-parity-checklist.md`.

The point is not merely to delete `packages/tui/`. The point is to remove the
entire obsolete surface cleanly: workspace wiring, CLI entry points, runtime
gateway glue, tests, and documentation.

## Preconditions

Do not start the deletion PR until all of these are true:

1. `docs/roadmap/01-gui-phase-1-parity-checklist.md` shows all blocking rows
   closed.
2. The walkthrough in `docs/guides/gui-parity-walkthrough.md` has been
   recorded and signed off.
3. The dedicated parity suite under `packages/gui/tests/parity/` is passing.
4. Ricardo explicitly approves removal of the TUI surface.

## Current removal points

These are the source-level integration points that still keep the TUI alive as
of 2026-04-21.

### Workspace and root package surface

- `package.json`
  Remove `@kilnai/tui` from root dependencies.
- `package.json`
  Remove `@opentui/core` and `@opentui/react` from root dependencies if no
  other package still requires them.
- `package.json`
  Remove `packages/tui` from root `typecheck` and `test` scripts.
- Lockfile
  Refresh the lockfile after dependency removal.

### Package surface

- `packages/tui/`
  Delete the package directory once all imports are gone.
- `packages/tui/package.json`
  Removed as part of package deletion.

### CLI surface

- `packages/cli/src/index.ts`
  Remove the `tui` command from help text, command dispatch, and default
  operator language.
- `packages/cli/src/commands/tui.ts`
  Delete the TUI command implementation.
- `packages/cli/package.json`
  Remove `@kilnai/tui` from peer dependencies once no CLI code imports it.
- `packages/cli/tests/commands/tui-session-persistence.test.ts`
  Delete or replace with GUI-owned persistence coverage if any behavior still
  matters after TUI removal.

### Runtime surface

- `packages/runtime/src/gateway/tui-gateway.ts`
  Delete the dedicated TUI gateway.
- `packages/runtime/src/index.ts`
  Remove `startTuiGateway` and TUI gateway type exports.
- `packages/runtime/tests/gateway/tui-gateway-clear.test.ts`
  Delete.
- `packages/runtime/tests/gateway/tui-gateway-authority.test.ts`
  Delete.

### Documentation surface

- `docs/guides/tui.md`
  Remove the frozen TUI guide once the command and package are gone.
- `docs/README.md`
  Remove the TUI guide from high-use entry points.
- `docs/roadmap/01-gui-phase-1-parity-checklist.md`
  Update the progress log to record deletion completion.
- `docs/roadmap/README.md`
  Shift the execution priority away from deletion prep once removal is merged.
- `docs/adr/ADR-005-freeze-tui-prioritize-gui.md`
  Re-read for any wording that still describes deletion as pending and update
  only if the ADR language becomes misleading after completion.

## Decision rule for runtime cleanup

Delete `packages/runtime/src/gateway/tui-gateway.ts` if and only if there is no
remaining non-GUI consumer.

Current state on 2026-04-21:

- The GUI uses `startGuiGateway`, not `startTuiGateway`.
- The CLI still dispatches `kiln tui`.
- The runtime package still exports `startTuiGateway` only because the frozen
  TUI path still exists.

That means the TUI gateway should be removed in the same PR as the CLI TUI
command unless a new consumer is intentionally introduced, which would require
an explicit architectural decision rather than accidental preservation.

## PR execution order

Use this sequence in the deletion PR:

1. Remove CLI dispatch/help and the TUI command implementation.
2. Remove runtime TUI gateway code and exports.
3. Remove TUI-specific tests.
4. Remove `packages/tui/` and package/dependency wiring.
5. Remove or rewrite documentation that still points operators at `kiln tui`.
6. Update roadmap docs to mark deletion complete.

## Verification after deletion

Minimum gate after the removal patch:

1. `bun run typecheck`
2. `bun run build`
3. `bun run test`
4. `bun x playwright test` from `packages/gui/`
5. A final `kiln gui` smoke run proving the operator path still launches and
   exits cleanly

Do not call the deletion complete if the repo still compiles only because of a
stale dist artifact or a leftover dependency entry.

## Related docs

- `docs/guides/gui.md`
- `docs/guides/gui-parity-walkthrough.md`
- `docs/roadmap/01-gui-phase-1-parity-checklist.md`
