# GUI Parity

## Status

GUI Phase 1 parity is closed as of 2026-04-30.

This document is a validation record for the GUI reaching the former TUI
baseline. It is not a product policy that freezes the TUI or makes one surface
the permanent owner of operator work.

## Policy

- `kiln gui` is the rich web operator surface.
- `kiln tui` is the interactive terminal operator surface.
- Shared runtime, session, provider, tool, and gateway contracts must remain
  surface-neutral.
- New operator-facing capabilities should be implemented in shared contracts
  first when more than one surface can use them.
- Surface-specific UX belongs in the surface package that needs it.

## Completed Parity Scope

The GUI satisfies the non-deferred Phase 1 parity categories:

- session lifecycle
- provider and model selection
- cost and telemetry
- input and keyboard ergonomics
- theming and visual behavior
- gateway transport behavior
- CLI invocation and startup flags
- governed workspace browsing and read-only file previews

The old direct in-process TUI transport is not a GUI requirement. GUI Phase 1
standardizes on the local gateway path.

## Validation

The parity record is supported by:

- dedicated Playwright parity coverage under `packages/gui/tests/parity/`
- GUI unit and component tests
- CLI integration coverage for `kiln gui` flags and launch behavior
- root typecheck, test, and build verification from the parity closeout period
- live GUI usage as the current operator path

Use `docs/guides/gui-parity-walkthrough.md` as the manual validation script
when a release or large operator-surface refactor needs renewed proof.

## Operating Model

The GUI and TUI are clients over shared runtime and gateway contracts. Neither
surface owns provider sessions, tool execution, authority, memory, or runtime
state.

The GUI may add richer panels, previews, and supervision UX, but those features
must project from shared runtime contracts instead of creating GUI-only control
paths.

The TUI may continue to expose terminal-specific ergonomics, but it must not
become the source of truth for behavior that belongs in core, runtime, gateway
contracts, or shared guides.

## Related Docs

- `docs/guides/gui.md`
- `docs/guides/gui-parity-walkthrough.md`
- `docs/guides/tui.md`
- `docs/guides/operator-surfaces.md`
- `docs/architecture/runtime-surfaces.md`
- `docs/architecture/session-model.md`
