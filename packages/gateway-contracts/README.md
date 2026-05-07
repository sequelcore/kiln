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

Managed child invocation events carry an operator-facing
`OperatorManagedAgentCapabilitySnapshot`. The snapshot records the admitted
route id/health, provider-model proof, adapter/execution mode, authority
profile, context mode, resource-plane availability, and child identity. SDK,
widget, GUI, TUI, CLI, and future consumers should display or audit this
snapshot instead of recomputing provider health or model capability from live
configuration after the fact.

### Presentation Intent

`src/presentation-intent.ts` defines the closed semantic display contract for
model/tool-proposed rich output. A tool may include `metadata.presentationIntent`
or an equivalent structured envelope field, but the shared presenter validates it
before any operator surface sees it as `toolPresentation.presentationIntent`.

Allowed intent kinds are intentionally small:

- `summary`
- `comparison_table`
- `risk_matrix`
- `timeline`
- `resource_bundle`
- `diagnostic_report`

Invalid or unsupported intents are ignored and the tool falls back to normal
typed output projection. Presentation intent never grants authority, never
selects arbitrary UI components, and never accepts HTML/CSS/JS/JSX/SVG payloads.
GUI, TUI, CLI, SDK/widget, and future surfaces receive the same validated data
and degrade to `formatPresentationIntentAsText()` when a native rich renderer is
not available.

## Operator Empty State Copy

The shared operator empty-state phrase catalog lives in
`src/operator-empty-state.ts`. GUI uses it for the empty transcript rotation;
TUI uses the same copy for its idle input placeholder because the terminal
surface has no separate empty transcript canvas.

Keep this copy short, command-oriented, and Kiln-native. It may lean cyberpunk
in tone, but it must stay original and avoid copying exact lines or named
character voice from external games.

## Operator Workspace Explorer

The shared read-only workspace explorer contract lives in `src/workspace.ts`.
It defines governed directory snapshots, file-preview snapshots, VCS status, and
typed workspace errors for all operator surfaces.

Consumers should treat this as navigation and preview state only:

- `OperatorWorkspaceDirectorySnapshot` is a bounded directory listing rooted at
  the active working directory.
- `OperatorWorkspaceTreeEntry` may carry optional `vcs` status so GUI, TUI, CLI,
  and future surfaces can render working-tree state consistently.
- `OperatorWorkspaceFileSnapshot` carries conservative previews for text/code,
  Markdown, JSON, supported web images, or explicit unsupported/binary states.
- Workspace previews must not create session events, approval requests,
  provider tool calls, changed-file entries, or working-tree mutations.

VCS status is the current working tree. It is deliberately separate from
session-scoped `Changed files`, which is durable runtime evidence emitted by
tools and session events.

## Operator Themes

The shared operator theme catalog lives in `src/operator-themes.ts`.
`OPERATOR_THEME_NAMES`, labels, palettes, and validation helpers are consumed by
the GUI, TUI, CLI config parsing, and runtime operator-surface tools. Add or
remove operator themes here first, then update each renderer to consume the
same contract instead of maintaining a private list.

`system-follow` is part of the contract for config parity. GUI resolves it
against the browser/OS color preference; TUI accepts it but maps it to a
terminal-safe dark palette.
