# TUI Maintenance

## Purpose

This guide defines the current maintenance policy for `kiln tui`.

The TUI remains in the repository as a frozen terminal operator surface. The GUI
is the primary surface for interactive local work, but the TUI is retained for
terminal-first workflows, fallback use, and future reassessment if concrete
operator demand returns.

## Maintenance Policy

Allowed changes:

- crash fixes
- data-loss fixes
- security fixes
- compatibility fixes needed after shared runtime, gateway, provider, or tool
  contract changes
- documentation corrections
- small test repairs that preserve the frozen behavior

Not allowed without a new decision:

- new feature areas
- new UI frameworks or rendering abstractions
- TUI-only runtime behavior
- TUI-only provider, memory, tool, or authority paths
- new dependencies that do not directly support maintenance
- divergence from GUI/runtime session semantics

## Shared-Contract Rules

The TUI is a consumer of shared contracts:

- runtime session registry
- provider/model routing
- gateway frames
- tool execution bridge
- cost and telemetry events
- approval frames
- canonical session history

If the TUI needs behavior that another surface also needs, implement the
behavior in the shared runtime, gateway contracts, core, or CLI layer first.
The TUI should only render or map the shared behavior.

## Verification For TUI Changes

Minimum verification for TUI maintenance patches:

1. Focused tests for the changed package or contract.
2. `bun run typecheck`.
3. Relevant CLI/runtime tests when gateway or session behavior changes.
4. Manual `kiln tui` smoke run when rendering, input, or startup changes.

For broad shared-contract changes, also run the GUI checks that cover the same
contract. The TUI must not be fixed by regressing the primary GUI surface.

## Reassessment Criteria

Reopen TUI product investment only if there is concrete evidence that terminal
operation needs more than the CLI and frozen TUI provide.

Examples of valid evidence:

- repeated real operator use where GUI cannot serve the workflow
- SSH-only or remote environments where a browser-based GUI is not acceptable
- accessibility or performance evidence specific to the terminal surface
- external user demand with named workflows and acceptance criteria

Until then, GUI-first remains the product direction.

## Related Docs

- `docs/guides/tui.md`
- `docs/guides/gui.md`
- `docs/guides/gui-parity.md`
- `docs/architecture/runtime-surfaces.md`
- `docs/architecture/session-model.md`
