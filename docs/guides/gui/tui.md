# TUI

> The TUI is Kiln's interactive terminal operator surface. It remains a
> projection of shared runtime and gateway contracts. Terminal-specific feature
> work is valid when it does not create private target, memory, tool,
> authority, or session semantics.

## Overview

`kiln tui` is Kiln's terminal chat interface. The TUI package is the rendering layer: it owns layout, input handling, theme application, and WebSocket frame mapping, while orchestration lives outside the renderer. The default runtime flow is TUI -> local gateway on port `4801` by default -> runtime `SessionRegistry` -> selected target through Kiln's runtime pipeline. That keeps the same session, safety, memory, routing, and cost machinery in the path instead of duplicating agent-loop logic in the terminal client.

Sources: `packages/tui/src/app.tsx`, `packages/tui/src/theme.ts`, `packages/tui/src/gateway-session.ts`, `packages/tui/src/ws-client.ts`, `packages/tui/src/index.ts`, `packages/cli/src/commands/tui.ts`, `packages/runtime/src/gateway/tui-gateway.ts`

## Starting the TUI

The current repository is source-only. From the repository root, start the TUI
through the source CLI:

```bash
bun packages/cli/src/index.ts tui
```

The workspace resolves `@kilnai/tui`, `@kilnai/runtime`, `@kilnai/core`, and the
shared gateway contracts locally. There is no supported global package install
for this repository state.

The `kiln tui` command currently accepts these flags from `packages/cli/src/commands/tui.ts`:

| Flag | Purpose |
|------|---------|
| `--theme <name>` | Select a named TUI theme. |
| `--port <number>` | Override the local TUI gateway port when gateway transport is used. |
| `--plan` | Start the gateway session with plan mode enabled. |

There is no `--resume` flag in `tui.ts`. Continuation is explicit inside the
TUI: `/continue` focuses the session browser, and Enter confirms the selected
history row only while that continuation mode is active. Empty Enter outside
that mode is a no-op. The TUI does not silently load a persisted resume cursor
at startup.

Examples:

```bash
bun packages/cli/src/index.ts tui
```

```bash
bun packages/cli/src/index.ts tui --theme vesper
```

```bash
bun packages/cli/src/index.ts tui --port 4900 --plan
```

Transport note: `tui.ts` now resolves startup transport to `gateway` by default. The direct bootstrap path still exists for debugging and explicit opt-in, and is enabled only when `KILN_TUI_TRANSPORT=direct` is set.

TUI startup resolves `ui.targetSelection.targetId` when present, then
`targetRouting.defaultTargetId`. It does not accept a one-off target flag.
Change the next-turn target interactively with `/target`; `--target` is the
launch selector for `kiln run` and `kiln plan`, not GUI or TUI.

## Themes

The TUI exports `KilnTheme`, `defaultTheme`, and the named `themes` map from `packages/tui/src/theme.ts`. The default theme is `phosphor`.

The current build ships these built-in theme names:

- `phosphor`
- `vesper`
- `sequel`
- `automata`

Use any of them with `--theme <name>`.

This list is not TUI-owned. GUI and TUI consume the shared operator theme
catalog from `@kilnai/operator-appearance`, so any admitted built-in theme must
be rendered by both surfaces. System behavior is an appearance mode, not a
theme. Because terminal processes do not expose a dependable OS color-scheme
signal, TUI startup resolves `system` through the documented dark fallback.

The shared contract is authored as semantic OKLCH roles. `theme.ts` is a TUI
renderer adapter: it converts those roles to terminal-safe sRGB hex and maps
them onto the compact `KilnTheme` interface below. It must not define a second
palette or tune colors independently from the operator-theme contract.

Executable providers connected through the TUI gateway can call
`operator_set_theme` to request a live theme change. The gateway sends an
`operator_theme_set` frame to the TUI, the TUI applies the theme, and it returns
an `operator_theme_set_result` acknowledgement. The change is session-only.
The tool cannot write `~/.kiln/config.yaml`; use the human settings/config path
for a durable `ui.appearance` change. Plain CLI has no visual surface and
returns an explicit capability error.

`KilnTheme` exposes these semantic color tokens:

- `background`
- `backgroundPanel`
- `backgroundElement`
- `border`
- `borderActive`
- `text`
- `textMuted`
- `accent`
- `primary`
- `success`
- `error`
- `warning`
- `info`
- `userFg`
- `userBg`
- `userBorder`
- `assistantBg`
- `toolFg`
- `thinkingFg`
- `cursorFg`

## Layout and Key Bindings

The main screen is a two-column layout: a `chatArea` on the left and a `sidebar` on the right, separated by a divider. The sidebar renders target status with derived provider/model evidence, cost, current working directory, turns and token counts, field status, approvals, file changes, resume hints, and session history. When the terminal width drops below `100` columns, the sidebar auto-collapses.

The existing turns/tokens line also renders shared context evidence: exact
values and percentage when available, `partial` when qualified, and `Context
usage unavailable` otherwise. Restored canonical events keep their historical
source and observation rather than appearing live. TUI does not calculate its
own ratio or infer authority from surface selection state.

Key bindings and input behavior come from `packages/tui/src/app.tsx`:

Slash command discovery is not TUI-owned. The TUI projects
`listOperatorCommands("tui")` from `@kilnai/gateway-contracts`, so commands
shared with GUI or CLI must be added to
`packages/gateway-contracts/src/operator-commands.ts` first. The current shared
interactive commands include `/clear`, `/theme`, `/target`, `/deliberation`,
`/authority`, `/continue`, `/plan`, `/exec`, `/setup`, and `/goal`.

- `Ctrl+C` exits immediately.
- `Ctrl+V` pastes from the system clipboard.
- `Enter` submits the current prompt when the session is idle.
- Empty `Enter` is a no-op unless `/continue` opened continuation mode.
- `Enter` in continuation mode continues the selected session from the session list.
- `/clear` clears the active session.
- `/plan` enables plan mode in the TUI state.
- `/target` opens the execution-target picker.
- `/deliberation` cycles the selected target's derived provider default and
  model's advertised levels.
- `/theme` opens the theme picker.
- `/continue` focuses the session browser in the sidebar.
- `/goal` focuses the canonical goal/work projection in the sidebar. Lifecycle
  mutations use the same persisted core transitions exposed by
  `kiln goal pause|resume|edit|cancel`.
- Arrow keys or `j` / `k` navigate the theme picker, execution-target picker,
  slash popover, and session list depending on the current UI state.

Printable-first key routing means normal printable characters are appended to the input before most special-case handlers run. That keeps typing responsive and reserves command handling for explicit control keys and slash commands instead of intercepting ordinary text entry.

## Execution target selection

The target picker is populated from the gateway's target catalog projection.
It retains every configured target, including targets that are currently
unavailable, with its label, availability, reason codes, and repair actions.
The picker sends target ID as the selection intent.
It does not select a provider, raw model ID, or credential.

Provider and model labels are derived execution evidence. A provider
authentication action remains provider-scoped because it repairs the account
evidence behind a target; it does not change target authority. TUI marks an
unavailable target that can be repaired by sign-in, and `r` refreshes the
catalog. After successful authentication, the Gateway returns fresh evidence
before the operator retries selection.

For an automatic target with eligible account aliases, choosing the target opens
an account step with `Automatic (Kiln)` and the eligible aliases. `Automatic
(Kiln)` leaves account choice to the target's configured economic/pressure
policy; an alias narrows that same target for the next turn. Exact targets skip
this step. The picker never transports or displays a credential ID.

Selecting a target sends the internal `execution_route` frame with the target's
resolved Runtime route ID and, for an automatic target, an eligible account
override when selected. The
gateway re-admits that intent and acknowledges it with
`execution_route_changed`; provider, model, account, and credential evidence
are derived by Runtime.

On the CLI side, the session manager keeps a canonical Kiln continuation target
only after explicit resume intent and tracks provider-native thread IDs only as
provider-scoped metadata. Target selection chooses the execution target for the
next turn; it does not move the operator into a provider-owned session namespace.

Important distinction:

- `execution_route_changed` acknowledges the admitted target's internal route for the next turn.
- The assistant execution label in chat is finalized from the gateway `done` frame's
  derived `routedProvider` and `routedModel` evidence.

That means the header shown above an assistant message reflects the
provider/model that actually handled the turn, not only the derived evidence
shown when the target was selected.

## Deliberation

The TUI consumes provider-model discovery only as evidence for the selected
target. When that target's derived provider/model advertises deliberation
capabilities, the sidebar appends an explicitly selected level next to the
model label, for example
`gpt-5.6-terra · medium`.

At startup, the TUI may display cached provider-model discovery as `stale`
diagnostics. Stale evidence does not make a target selectable;
Runtime refreshes target availability before prompt admission or managed
invocation execution proceeds.

Use `/deliberation` to cycle from the selected target's derived provider default
through the advertised values. Kiln does not turn an advertised default into an
explicit override. If the derived model advertises no levels, the command
reports that deliberation controls are unavailable.

The selected level is sent as a fixed deliberation intent with the next user
turn. It is per-turn execution state, not a persisted TUI theme or target
preference.

## Session Commands

### `/clear`

`GatewaySession.clear()` sends `{ type: "clear" }` over the WebSocket connection and waits for `{ type: "cleared" }`. The timeout is `5_000ms`. In the gateway, the `onClear` callback is invoked before the acknowledgement is sent. In the CLI command, that callback detaches the active runtime conversation so the next turn starts from a fresh Kiln conversation state without deleting persisted session history.

### `/plan`

`/plan` sets the TUI's local planning indicator and adds a status message in the
chat pane. The next gateway turn sends `executionMode: "plan"` on the shared
message frame. Gateway welcome frames carry `executionMode`, and execution-mode
changes use `{ type: "execution_mode_transition", toMode: "execute" }` followed
by `{ type: "execution_mode_transitioned", executionMode: "execute" }`.

The local `planMode` flag is UI state only. The runtime contract is
`executionMode`, shared with GUI and other operator consumers.

### `/target`

`/target` opens the target picker. Choosing a target sends
`execution_route` and awaits either
`execution_route_changed` or `execution_route_change_failed`. The acknowledgement
may carry derived provider/model evidence for presentation, but the configured
target remains the selected authority. Automatic targets with eligible aliases
show the `Automatic (Kiln)`/alias choice before this request; exact targets do not.

## Session Persistence

Session persistence lives outside the TUI renderer.

In the default gateway path, continuity is runtime-owned:

- `TuiWsClient` connects with a stable `userId` query param.
- `startTuiGateway()` uses runtime `SessionRegistry.getOrCreate(...)` keyed by app, tenant, and that `userId`.
- Multi-turn history therefore stays in one `RuntimeSession` instead of creating a fresh session per turn.
- Reconnects reuse the same `userId`, so the gateway can reattach to the same runtime session state.
- Runtime tools, approvals, changed files, cost updates, and assistant deltas
  are delivered as canonical `session_event` frames with `kilnSessionId` and,
  when available, `turnId`.
- `activity_phase` frames are progress-only and are also scoped by
  `kilnSessionId`.
- The TUI must ignore late operational frames whose `kilnSessionId` does not
  match the active runtime session.

The CLI wrapper persists canonical Kiln session records and stores
provider-native thread IDs as nested provider-thread metadata. The TUI sidebar
browses Kiln sessions, not provider-specific session namespaces.

Kiln stores:

- the bound private project's `sessions/sessions.jsonl` as the canonical
  deduplicated session index
- `sessions/<sessionId>/meta.json` for per-session metadata in that private
  namespace
- `sessions/<sessionId>/transcript.jsonl` for the transcript stream in that
  private namespace

At startup, `makeMultiProviderSessionFactory()` starts without a hidden active
continuation target. Once the operator explicitly continues a canonical session,
Kiln may pass a matching provider-native thread ID to the provider derived from
the next target. If that provider has never participated in the session, Kiln
continues through its own transcript/context continuity without fabricating a
native provider thread.

Gateway-backed operator surfaces also pass a transcript rehydration hook to the
runtime pipeline. If the in-memory runtime session expired while the transcript
remained selected, the next admitted turn reconstructs bounded user/assistant
conversation history from the canonical transcript before model execution.

The sidebar session browser is populated from the canonical session index.
`/continue` opens explicit continuation mode; Enter on the selected row then
marks that Kiln session as the active continuation target. Empty Enter outside
that mode does not continue a selected row. Clear detaches the active runtime
conversation but leaves canonical session records and transcripts available for
later selection.

## Operational Event Scoping

The TUI renders a terminal-specific projection of the same operator event stream
used by the GUI. It may show compact sidebar counters instead of a full activity
timeline, but the underlying identity is still the canonical Kiln session.

Rules:

- Tool-use and tool-result activity must retain the event's `sessionId` and
  `turnId`.
- File changes must be stored with the session/turn that produced them.
- Pending approvals are resolved by session ID.
- Cost updates belong to the current active session and provider attribution,
  not to a provider-owned history namespace.
- Legacy unscoped `activity` frames are kept only for older direct session
  projections; new gateway activity should use `session_event` plus
  session-scoped `activity_phase`.

The explicit direct transport path still uses this wrapper-managed resume
state. The default gateway path adds runtime-side continuity on top of it.

## In-Process Gateway

`startTuiGateway()` in `packages/runtime/src/gateway/tui-gateway.ts` starts a local WebSocket gateway on port `4801` by default and returns the `ws://localhost:<port>/tui/ws` endpoint used by `GatewaySession`. GUI and TUI use the same Runtime-owned `OperatorActivityStreamer`, so both surfaces receive identical durable event identities for session, approval, tool, and completion progress.

The CLI `tui` command now passes the prepared Kiln system prompt from `SessionManager.prepare(...)` into both gateway and direct bootstrap. That keeps TUI behavior aligned with the rest of the wrapper pipeline instead of falling back to a generic placeholder identity prompt.

The TUI WebSocket adapter handles:

- `message` frames for new user turns
- `clear` frames with an `onClear` callback and `cleared` acknowledgement
- `execution_route` frames with `execution_route_changed` acknowledgement
- `refresh_execution_routes` frames with `execution_routes_refreshed` acknowledgement
- `approve` and `reject` frames for approval flow
- `exec` frames for plan-mode execution confirmation
- `welcome`, `thinking`, `activity`, `done`, and `error` inbound frames

The `done` frame also carries:

- `routedProvider` and `routedModel` for the actual target resolution used on the turn
- `runtimeContinuity` sidebar metadata for the current turn

For local-write verification, trust the routed provider/model evidence shown in
the header and the file-change events emitted by the runtime. Harness, OAuth,
and direct API providers converge through Kiln's shared tool surface when they
advertise runtime-owned tool execution; the runtime remains the authority for
approval, execution, telemetry, and file-change evidence.

This path keeps the same safety, session, runtime-summary, and cost-tracking machinery in place instead of adding a second terminal-only orchestration loop.

## Startup Profiling

Use the repo-level startup profiler before changing TUI startup behavior:

```bash
bun run profile:startup -- --surface tui --cwd . --port 4974
```

The profiler emits structured JSON with commit SHA, OS, Bun/Node versions,
cache state, CLI/gateway phase markers, and `firstUsableFrameMs`. The TUI
reports the first frame through an explicit renderer lifecycle callback; normal
`kiln tui` startup does not print profiling logs unless `KILN_STARTUP_PROFILE`
is enabled by the profiler.

## Session Model Reference

The canonical session rules are documented in
`docs/architecture/core/session-model.md`. In short: target selection is
next-turn routing state; provider/model are derived turn evidence, while the
Kiln session owns transcript, tools, approvals, cost, changed files, and replay.

## Architecture Note

The TUI owns no orchestration logic by design. ADR-002 formalizes the
cross-surface operator gateway model: terminal clients, GUI, native, CLI, IDE,
and remote surfaces are projections over gateway-owned session state and
execution, so memory, safety, approvals, routing, and provider handling are
implemented once and reused consistently.

See [ADR-002](../../adr/ADR-002-operator-surface-gateway.md).
