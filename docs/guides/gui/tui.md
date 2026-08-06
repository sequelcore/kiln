# TUI

> The TUI is Kiln's interactive terminal operator surface. It remains a
> projection of shared runtime and gateway contracts. Terminal-specific feature
> work is valid when it does not create private provider, memory, tool,
> authority, or session semantics.

## Overview

`kiln tui` is Kiln's terminal chat interface. The TUI package is the rendering layer: it owns layout, input handling, theme application, and WebSocket frame mapping, while orchestration lives outside the renderer. The default runtime flow is TUI -> local gateway on port `4801` by default -> runtime `SessionRegistry` -> provider session execution through Kiln's runtime pipeline. That keeps the same session, safety, memory, routing, and cost machinery in the path instead of duplicating agent-loop logic in the terminal client.

Sources: `packages/tui/src/app.tsx`, `packages/tui/src/theme.ts`, `packages/tui/src/gateway-session.ts`, `packages/tui/src/ws-client.ts`, `packages/tui/src/index.ts`, `packages/cli/src/commands/tui.ts`, `packages/runtime/src/gateway/tui-gateway.ts`

## Starting the TUI

Install the public CLI package when operating Kiln from another repository,
local machine, or remote shell:

```bash
bun add -g @kilnai/cli@2.1.0
kiln tui
```

The global CLI installation includes `@kilnai/tui`, `@kilnai/runtime`,
`@kilnai/core`, and the shared gateway contracts, so the terminal surface can be
started from any project directory.

The `kiln tui` command currently accepts these flags from `packages/cli/src/commands/tui.ts`:

| Flag | Purpose |
|------|---------|
| `--provider <name>` | Select the initial provider. Supported values are `claude`, `codex`, `opencode`, `codex-oauth`, `anthropic`, `openai`, `deepseek`, `openrouter`, and `ollama`. |
| `--model <name>` | Select the initial model for providers that require model selection. |
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
kiln tui
```

```bash
kiln tui --provider codex --theme kiln-graphite
```

```bash
kiln tui --provider openai --theme kiln-light
```

```bash
kiln tui --provider claude --port 4900 --plan
```

Transport note: `tui.ts` now resolves startup transport to `gateway` by default. The direct bootstrap path still exists for debugging and explicit opt-in, and is enabled only when `KILN_TUI_TRANSPORT=direct` is set.

## Themes

The TUI exports `KilnTheme`, `defaultTheme`, and the named `themes` map from `packages/tui/src/theme.ts`. The default theme is `kiln-dark`.

The current build ships these built-in theme names:

- `kiln-dark`
- `kiln-graphite`
- `kiln-light`
- `system-follow`

Use any of them with `--theme <name>`.

This list is not TUI-owned. GUI and TUI consume the shared operator theme
catalog from `@kilnai/gateway-contracts`, so any theme added to the contract
must be rendered by both surfaces. `system-follow` is accepted for config parity
with the GUI; the terminal renderer maps it to `kiln-dark` because terminal
processes do not expose a dependable OS color-scheme signal.

The shared contract is authored as semantic OKLCH roles. `theme.ts` is a TUI
renderer adapter: it converts those roles to terminal-safe sRGB hex and maps
them onto the compact `KilnTheme` interface below. It must not define a second
palette or tune colors independently from the operator-theme contract.

Executable providers connected through the TUI gateway can call
`operator_set_theme` to request a live theme change. The gateway sends an
`operator_theme_set` frame to the TUI, the TUI applies the theme, and it returns
an `operator_theme_set_result` acknowledgement. `scope: "session"` changes only
the current TUI process; `scope: "persisted"` also writes `ui.theme` in
`~/.kiln/config.yaml` when the standard CLI wrapper owns the session. The plain
CLI exposes the same tool contract for executable direct-provider sessions, but
it has no live visual surface, so it rejects session-scoped changes and accepts
persisted changes by writing the shared operator theme default.

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

The main screen is a two-column layout: a `chatArea` on the left and a `sidebar` on the right, separated by a divider. The sidebar renders provider status, cost, current working directory, turns and token counts, field status, approvals, file changes, resume hints, and session history. When the terminal width drops below `100` columns, the sidebar auto-collapses.

The existing turns/tokens line also renders shared context evidence: exact
values and percentage when available, `partial` when qualified, and `Context
usage unavailable` otherwise. Restored canonical events keep their historical
source and observation rather than appearing live. TUI does not calculate its
own ratio or infer authority from selected-provider state.

Key bindings and input behavior come from `packages/tui/src/app.tsx`:

Slash command discovery is not TUI-owned. The TUI projects
`listOperatorCommands("tui")` from `@kilnai/gateway-contracts`, so commands
shared with GUI or CLI must be added to
`packages/gateway-contracts/src/operator-commands.ts` first. The current shared
interactive commands include `/clear`, `/theme`, `/provider`, `/deliberation`,
`/authority`, `/continue`, `/plan`, `/exec`, `/setup`, and `/goal`.

- `Ctrl+C` exits immediately.
- `Ctrl+V` pastes from the system clipboard.
- `Enter` submits the current prompt when the session is idle.
- Empty `Enter` is a no-op unless `/continue` opened continuation mode.
- `Enter` in continuation mode continues the selected session from the session list.
- `/clear` clears the active session.
- `/plan` enables plan mode in the TUI state.
- `/provider` opens the provider picker.
- `/deliberation` cycles provider default and the active model's advertised levels.
- `/theme` opens the theme picker.
- `/continue` focuses the session browser in the sidebar.
- `/goal` focuses the canonical goal/work projection in the sidebar. Lifecycle
  mutations use the same persisted core transitions exposed by
  `kiln goal pause|resume|edit|cancel`.
- Arrow keys or `j` / `k` navigate the theme picker, provider picker, slash popover, and session list depending on the current UI state.

Printable-first key routing means normal printable characters are appended to the input before most special-case handlers run. That keeps typing responsive and reserves command handling for explicit control keys and slash commands instead of intercepting ordinary text entry.

## Provider Selection

The provider picker is split into two sections:

- `Harness`: `claude`, `codex`, `opencode`
- `Direct API`: `codex-oauth`, `opencode-go`, `opencode-zen`,
  `anthropic`, `openai`, `deepseek`, `openrouter`, `ollama`, `lmstudio`

`codex-oauth` is still selected from the direct-provider family, but it is no
longer text-only. Kiln now routes it through an executable direct-provider
session, so local tool execution, approvals, and file-change telemetry come
from Kiln's own runtime rather than from an external harness process.

OpenCode appears in both sections with different model namespaces. The harness
provider `opencode` uses `opencode models` and keeps prefixed model IDs such as
`opencode/minimax-m2.5-free`. Direct providers `opencode-go` and
`opencode-zen` use Kiln's tiered OpenCode credential pool and select unprefixed
tier model IDs such as `minimax-m2.5-free`.

Selecting a provider in the picker sends a `{ type: "provider", provider, model? }` frame through the WebSocket session. The gateway updates the injected session manager with `setProvider()` and, when present, `setModel()`, then acknowledges with `{ type: "provider_changed", provider }`.

On the CLI side, the multi-provider session manager keeps a canonical Kiln
continuation target only after explicit resume intent and tracks provider-native
thread IDs only as provider-scoped metadata. Provider selection chooses the route
for the next turn; it does not move the operator into a provider-owned session
namespace.

Important distinction:

- `provider_changed` acknowledges the selected provider and model for the next turn.
- The assistant route label in chat is finalized from the gateway `done` frame's `routedProvider` and `routedModel`.

That means the header shown above an assistant message reflects the provider/model that actually handled the turn, not just the provider that happened to be selected when the turn started.

## Deliberation

The TUI consumes the same provider discovery result as the GUI. When the active
provider/model advertises deliberation capabilities, the sidebar appends an
explicitly selected level next to the model label, for example
`gpt-5.6-terra · medium`.

At startup, the TUI may display cached provider discovery as `stale`
diagnostics. Stale entries are unavailable until background runtime discovery
refreshes them. Provider switching, prompt admission, model execution, and
managed invocation execution must use fresh runtime discovery, not stale cache
metadata.

Use `/deliberation` to cycle from provider default through the advertised
values. Kiln does not turn an advertised default into an explicit override. If
the active model advertises no levels, the command reports that deliberation
controls are unavailable.

The selected level is sent as a fixed deliberation intent with the next user
turn. It is per-turn execution state, not a persisted TUI theme or provider
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

### `/provider`

`/provider` opens the provider picker. Closing the picker with a selection updates `currentProvider`, optionally updates the selected model, refreshes the sidebar, and asks the session object to switch providers if that capability is available.

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

- `.kiln/sessions.jsonl` as the canonical deduplicated session index
- `.kiln/sessions/<sessionId>/meta.json` for per-session metadata
- `.kiln/sessions/<sessionId>/transcript.jsonl` for the transcript stream

At startup, `makeMultiProviderSessionFactory()` starts without a hidden active
continuation target. Once the operator explicitly continues a canonical session,
Kiln may pass a matching provider-native thread ID to the selected provider. If
the provider has never participated in that session, Kiln continues through its
own transcript/context continuity without fabricating a native provider thread.

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

`startTuiGateway()` in `packages/runtime/src/gateway/tui-gateway.ts` starts a local WebSocket gateway on port `4801` by default and returns the `ws://localhost:<port>/tui/ws` endpoint used by `GatewaySession`. The gateway builds a `RuntimeSessionOrchestrator`, `SessionRegistry`, `ApprovalGateRegistry`, and a `TuiActivityStreamer` so the TUI can reuse the same runtime-side session, approval, activity, and completion flow as the rest of Kiln.

The CLI `tui` command now passes the prepared Kiln system prompt from `SessionManager.prepare(...)` into both gateway and direct bootstrap. That keeps TUI behavior aligned with the rest of the wrapper pipeline instead of falling back to a generic placeholder identity prompt.

The TUI WebSocket adapter handles:

- `message` frames for new user turns
- `clear` frames with an `onClear` callback and `cleared` acknowledgement
- `provider` frames with `provider_changed` acknowledgement
- `approve` and `reject` frames for approval flow
- `exec` frames for plan-mode execution confirmation
- `welcome`, `thinking`, `activity`, `done`, and `error` inbound frames

The `done` frame also carries:

- `routedProvider` and `routedModel` for the actual execution route used on the turn
- `runtimeContinuity` sidebar metadata for the current turn

For local-write verification, trust the routed provider shown in the header and
the file-change events emitted by the runtime. Harness, OAuth, and direct API
providers now converge through Kiln's shared tool surface when they advertise
runtime-owned tool execution; the runtime remains the authority for approval,
execution, telemetry, and file-change evidence.

This path keeps the same safety, session, runtime-summary, and cost-tracking machinery in place instead of adding a second terminal-only orchestration loop.

## Startup Profiling

Use the repo-level startup profiler before changing TUI startup behavior:

```bash
bun run profile:startup -- --surface tui --cwd . --provider claude --port 4974
```

The profiler emits structured JSON with commit SHA, OS, Bun/Node versions,
cache state, CLI/gateway phase markers, and `firstUsableFrameMs`. The TUI
reports the first frame through an explicit renderer lifecycle callback; normal
`kiln tui` startup does not print profiling logs unless `KILN_STARTUP_PROFILE`
is enabled by the profiler.

## Session Model Reference

The canonical session rules are documented in
`docs/architecture/session-model.md`. In short: provider/model selection is
next-turn routing state; the Kiln session owns transcript, tools, approvals,
cost, changed files, and replay.

## Architecture Note

The TUI owns no orchestration logic by design. ADR-002 formalizes the
cross-surface operator gateway model: terminal clients, GUI, native, CLI, IDE,
and remote surfaces are projections over gateway-owned session state and
execution, so memory, safety, approvals, routing, and provider handling are
implemented once and reused consistently.

See [ADR-002](../../adr/ADR-002-operator-surface-gateway.md).
