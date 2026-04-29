# TUI

> **⚠ EXPERIMENTAL — Frozen surface.** Per [ADR-005](../adr/ADR-005-freeze-tui-prioritize-gui.md),
> the TUI is in maintenance mode. No new features; only critical bug fixes (crashes, data
> loss, security). The primary operator surface going forward is the GUI (see Phase G in
> `STRATEGY.md`). Scheduled for deletion in Phase I once GUI reaches parity.
> 6-month review checkpoint: 2026-10-17.
>
> Deletion execution is tracked in `docs/guides/tui-deletion-checklist.md`.

## Overview

`kiln tui` is Kiln's terminal chat interface. The TUI package is the rendering layer: it owns layout, input handling, theme application, and WebSocket frame mapping, while orchestration lives outside the renderer. The default runtime flow is TUI -> local gateway on port `4801` by default -> runtime `SessionRegistry` -> provider session execution through Kiln's runtime pipeline. That keeps the same session, safety, memory, routing, and cost machinery in the path instead of duplicating agent-loop logic in the terminal client.

Sources: `packages/tui/src/app.tsx`, `packages/tui/src/theme.ts`, `packages/tui/src/gateway-session.ts`, `packages/tui/src/ws-client.ts`, `packages/tui/src/index.ts`, `packages/cli/src/commands/tui.ts`, `packages/runtime/src/gateway/tui-gateway.ts`

## Starting the TUI

The `kiln tui` command currently accepts these flags from `packages/cli/src/commands/tui.ts`:

| Flag | Purpose |
|------|---------|
| `--provider <name>` | Select the initial provider. Supported values are `claude`, `codex`, `opencode`, `codex-oauth`, `anthropic`, `openai`, `deepseek`, `openrouter`, and `ollama`. |
| `--model <name>` | Select the initial model for providers that require model selection. |
| `--theme <name>` | Select a named TUI theme. |
| `--port <number>` | Override the local TUI gateway port when gateway transport is used. |
| `--plan` | Start the gateway session with plan mode enabled. |

There is no `--resume` flag in `tui.ts`. Resume is handled from persisted session state inside the TUI.

Examples:

```bash
kiln tui
```

```bash
kiln tui --provider codex --theme nord
```

```bash
kiln tui --provider openai --theme tokyo-night
```

```bash
kiln tui --provider claude --port 4900 --plan
```

Transport note: `tui.ts` now resolves startup transport to `gateway` by default. The direct bootstrap path still exists for debugging and explicit opt-in, and is enabled only when `KILN_TUI_TRANSPORT=direct` is set.

## Themes

The TUI exports `KilnTheme`, `defaultTheme`, and the named `themes` map from `packages/tui/src/theme.ts`. The default theme is `kiln-dark`.

The current build ships these built-in theme names:

- `kiln-dark`
- `dracula`
- `catppuccin-mocha`
- `nord`
- `tokyo-night`
- `gruvbox-dark`
- `rose-pine`
- `kanagawa-wave`
- `everforest-dark`
- `ayu-dark`
- `one-dark`
- `night-owl`

Use any of them with `--theme <name>`.

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

Key bindings and input behavior come from `packages/tui/src/app.tsx`:

- `Ctrl+C` exits immediately.
- `Ctrl+V` pastes from the system clipboard.
- `Enter` submits the current prompt when the session is idle.
- `Enter` with an empty input resumes the selected session from the session list.
- `/clear` clears the active session.
- `/plan` enables plan mode in the TUI state.
- `/provider` opens the provider picker.
- `/effort` cycles the active model's advertised reasoning effort options.
- `/theme` opens the theme picker.
- `/resume` focuses the session browser in the sidebar.
- Arrow keys or `j` / `k` navigate the theme picker, provider picker, slash popover, and session list depending on the current UI state.

Printable-first key routing means normal printable characters are appended to the input before most special-case handlers run. That keeps typing responsive and reserves command handling for explicit control keys and slash commands instead of intercepting ordinary text entry.

## Provider Selection

The provider picker is split into two sections:

- `Harness`: `claude`, `codex`, `opencode`
- `Direct API`: `codex-oauth`, `anthropic`, `openai`, `deepseek`, `openrouter`, `ollama`

`codex-oauth` is still selected from the direct-provider family, but it is no
longer text-only. Kiln now routes it through an executable direct-provider
session, so local tool execution, approvals, and file-change telemetry come
from Kiln's own runtime rather than from an external harness process.

Selecting a provider in the picker sends a `{ type: "provider", provider, model? }` frame through the WebSocket session. The gateway updates the injected session manager with `setProvider()` and, when present, `setModel()`, then acknowledges with `{ type: "provider_changed", provider }`.

On the CLI side, the multi-provider session manager keeps one canonical Kiln
continuation target and tracks provider-native thread IDs only as provider-scoped
metadata. Provider selection chooses the route for the next turn; it does not
move the operator into a provider-owned session namespace.

Important distinction:

- `provider_changed` acknowledges the selected provider and model for the next turn.
- The assistant route label in chat is finalized from the gateway `done` frame's `routedProvider` and `routedModel`.

That means the header shown above an assistant message reflects the provider/model that actually handled the turn, not just the provider that happened to be selected when the turn started.

## Reasoning Effort

The TUI consumes the same provider discovery result as the GUI. When the active
provider/model advertises `supportedReasoningEfforts`, the sidebar appends the
current effort next to the model label, for example `gpt-5.4 · medium`.

Use `/effort` to cycle through the advertised values. The initial value is the
model's `defaultReasoningEffort` when present, otherwise the first advertised
supported effort. If the active model does not advertise effort options,
`/effort` reports that no reasoning effort options are available.

The selected reasoning effort is sent with the next user turn through the
gateway message frame. It is per-turn execution state, not a persisted TUI
theme or provider preference.

## Session Commands

### `/clear`

`GatewaySession.clear()` sends `{ type: "clear" }` over the WebSocket connection and waits for `{ type: "cleared" }`. The timeout is `5_000ms`. In the gateway, the `onClear` callback is invoked before the acknowledgement is sent. In the CLI command, that callback detaches the active runtime conversation so the next turn starts from a fresh Kiln conversation state without deleting persisted session history.

### `/plan`

`/plan` sets the TUI's local `planMode` state and adds a status message in the chat pane. In gateway mode, the welcome frame also carries an initial `planMode` value, and the gateway accepts an `{ type: "exec" }` frame to confirm execution mode transitions.

### `/provider`

`/provider` opens the provider picker. Closing the picker with a selection updates `currentProvider`, optionally updates the selected model, refreshes the sidebar, and asks the session object to switch providers if that capability is available.

## Session Persistence

Session persistence lives outside the TUI renderer.

In the default gateway path, continuity is runtime-owned:

- `TuiWsClient` connects with a stable `userId` query param.
- `startTuiGateway()` uses runtime `SessionRegistry.getOrCreate(...)` keyed by app, tenant, and that `userId`.
- Multi-turn history therefore stays in one `RuntimeSession` instead of creating a fresh session per turn.
- Reconnects reuse the same `userId`, so the gateway can reattach to the same runtime session state.

The CLI wrapper persists canonical Kiln session records and stores
provider-native thread IDs as nested provider-thread metadata. The TUI sidebar
browses Kiln sessions, not provider-specific session namespaces.

Kiln stores:

- `.kiln/sessions.jsonl` as the append-only session index
- `.kiln/sessions/<sessionId>/meta.json` for per-session metadata
- `.kiln/sessions/<sessionId>/transcript.jsonl` for the transcript stream

At startup, `makeMultiProviderSessionFactory()` loads the latest canonical
persisted Kiln session record and makes it available to every provider route.
If that record contains provider-thread metadata for the selected provider,
Kiln may pass the matching provider-native thread ID to that provider. If not,
Kiln resumes through its own transcript/context continuity without fabricating
a native provider thread.

The sidebar session browser is populated from the canonical session index.
`/resume` or an empty-input `Enter` on a selected row marks that Kiln session as
the active continuation target. Clear detaches the active runtime conversation
but leaves canonical session records and transcripts available for later
selection.

The direct fallback path still uses this wrapper-managed resume state. The
default gateway path adds runtime-side continuity on top of it.

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

## Session Model Reference

The canonical session rules are documented in
`docs/architecture/session-model.md`. In short: provider/model selection is
next-turn routing state; the Kiln session owns transcript, tools, approvals,
cost, changed files, and replay.

## Architecture Note

The TUI owns no orchestration logic by design. ADR-002 TUI formalizes the reason: the terminal client should stay a thin rendering surface over gateway-owned session state and execution, so memory, safety, approvals, routing, and provider handling are implemented once and reused consistently across clients.

See [ADR-007 TUI](../adr/ADR-007-tui-gateway-architecture.md).
