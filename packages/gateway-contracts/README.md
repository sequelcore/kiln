# @kilnai/gateway-contracts

Shared HTTP and WebSocket frame contracts for the Kiln operator gateway.

> [!IMPORTANT]
> This is a provisional workspace package in a source-only development tree.
> There is no supported package installation for the current repository state,
> and the package coordinate is expected to change before the next release.

Both the runtime gateway (`@kilnai/runtime`) and the operator clients
(`@kilnai/gui`, `@kilnai/tui`, CLI, SDK, and widget) depend on
this package so that frame shapes and shared operator projections are
defined once and consumed by every surface. Neither side defines its own copy of
these types; any shape change is made here and takes effect on the next build
for all consumers.

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

### Tool Result Payloads

`src/operator-tool-result.ts` owns tool-result envelope parsing and the
operator-facing `tool_call_completed` payload. Runtime gateways, CLI transcript
persistence, and operator presentation consume:

- `parseOperatorToolResultEnvelope(value)` to unwrap bounded nested provider and
  tool envelopes while preserving metadata, presentation intent, and resource
  links.
- `buildOperatorToolResultPayload(input)` to produce one payload shape with
  stable output, summary, metadata, resources, usage, and status fields.

Error evidence is fail-closed: a typed runtime failure or an error reported by
the serialized envelope produces a failed result. Surfaces must not reparse or
rebuild this payload independently.

## Operator Surface Capabilities

`src/operator-surface-capability.ts` defines the shared surface vocabulary and
capability negotiation contract for CLI, TUI, GUI, IDE, SDK, widget,
gateway, and runtime consumers.

Capability snapshots advertise what a surface can support without granting
authority. Browser session projections use explicit transport labels such as
`snapshot-polling`, `cdp-screencast`, `webrtc`, and `hosted-url` so surfaces can
distinguish artifact monitors, frame streams, and remote live views without
inferring behavior from package names or local feature flags.

`src/operator-cockpit-target.ts`, `src/operator-cockpit-projection.ts`, and
`src/operator-cockpit-view-state.ts` define the active shared read-only operator
surface contract. GUI, TUI, CLI, runtime, and SDK consume the same
instance/session/timeline/invocation/tool/resource/cost projections, explicit
targets, action intents, and cancellation-request validation. The shared
read-only attach plan validates
explicit local, remote, team, cloud, CI, or simulated gateway URLs and records
planned HTTP/WebSocket connection intent without opening sockets. Resource
links are projected as target-aware read-only resources carrying
`resourceUri`, so surfaces can prepare open-resource affordances without
parsing raw tool payloads. Read-only action intents are target-checked plans
only; they do not dispatch gateway mutations and explicitly exclude
cancellation. `src/operator-cockpit-view-state.ts` derives read-only
focus/filter/replay cursor state from that same projection with explicit
`dispatch: not-dispatched` and `mutationDispatch: disabled` metadata, and
fails closed when targets do not resolve. Timeline filters use projected
targets such as `managedInvocationId`, `toolCallId`, and `resourceUri` rather
than raw event payload parsing. Session, managed-invocation, and tool-call
filters require their enclosing instance/session target. Synthetic high-volume
fixture generation belongs to tests until a current benchmark owner admits a
real runner and evidence contract.

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

## Operator Entry Prompt

The stable task-entry prompt shared by operator surfaces lives in
`src/operator-entry-prompt.ts`. GUI uses it as the new-session heading and TUI
uses it as the idle input placeholder.

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

Palette values are authored once as in-gamut OKLCH coordinates and organized
by stable surface responsibility: foundations, text, controls, conversation,
code, sidebar, toolbar, terminal, and semantic status sets. The contract owns
perceptual color; renderers own only representation. Browser surfaces project
the values to CSS `oklch()`, while terminal, canvas, and WebGL adapters project
the same values to sRGB hex. Contract tests enforce completeness, gamut, and
WCAG contrast invariants so a theme cannot be added as an unchecked collection
of literals or silently inherit another theme's missing roles.

The catalog is intentionally curated as Kiln identity, not a generic collection
of popular editor themes:

- `phosphor`: the default green-phosphor-on-black-glass control surface.
- `vesper`: a crisp black alternate with peppermint and apricot signals.
- `automata`: the parchment-and-ink light operating surface.
- `system-follow`: a polarity resolver for surfaces that can observe OS theme.

`system-follow` is part of the contract for config parity. GUI resolves it
against the browser/OS color preference; TUI accepts it but maps it to
Phosphor because terminal processes do not expose a dependable OS color signal.
