# @kilnai/gateway-contracts

Shared HTTP and WebSocket frame contracts for the Kiln operator gateway.

Both the runtime gateway (`@kilnai/runtime`) and the operator clients (`@kilnai/gui`, `@kilnai/tui`) depend on this package so that frame shapes and shared operator projections are defined once and consumed by every surface. Neither side defines its own copy of these types; any shape change is made here and takes effect on the next build for all consumers.

## Operator Event Presentation

Canonical `session_event` frames carry structured `payload` data for durable
runtime facts. Operator surfaces must keep that structure for state derivation,
but normal GUI/TUI rendering should not serialize the payload as raw JSON.

`src/operator-event-presentation.ts` owns the shared projection from canonical
operator events to display-safe presentation:

- `presentOperatorSessionEvent(event)` maps an event to `title`, `summary`,
  `tone`, `details`, and `compactText`.
- `presentOperatorEventPayload(kind, payload)` supports projections when the
  consumer already has the event kind and payload separated.
- `formatOperatorEventValue(value)` is the compact scalar formatter for inline
  previews. Nested objects become `Structured value` instead of JSON text.

GUI and TUI may render those projections differently, but they should consume
this shared presenter instead of duplicating event-specific display logic.

## Operator Themes

The shared operator theme catalog lives in `src/operator-themes.ts`.
`OPERATOR_THEME_NAMES`, labels, palettes, and validation helpers are consumed by
the GUI, TUI, CLI config parsing, and runtime operator-surface tools. Add or
remove operator themes here first, then update each renderer to consume the
same contract instead of maintaining a private list.

`system-follow` is part of the contract for config parity. GUI resolves it
against the browser/OS color preference; TUI accepts it but maps it to a
terminal-safe dark palette.
