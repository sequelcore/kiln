# @kilnai/gateway-contracts

Shared HTTP and WebSocket frame contracts for the Kiln operator gateway.

Both the runtime gateway (`@kilnai/runtime`) and the GUI client (`@kilnai/gui`) depend on this package so that frame shapes are defined once and consumed by both sides. Neither side defines its own copy of these types; any shape change is made here and takes effect on the next build for all consumers.

## Operator Themes

The shared operator theme catalog lives in `src/operator-themes.ts`.
`OPERATOR_THEME_NAMES`, labels, palettes, and validation helpers are consumed by
the GUI, TUI, CLI config parsing, and runtime operator-surface tools. Add or
remove operator themes here first, then update each renderer to consume the
same contract instead of maintaining a private list.

`system-follow` is part of the contract for config parity. GUI resolves it
against the browser/OS color preference; TUI accepts it but maps it to a
terminal-safe dark palette.
