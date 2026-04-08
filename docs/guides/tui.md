# TUI

## Overview

`kiln tui` is Kiln's terminal chat interface. The TUI package is the rendering layer: it owns layout, input handling, theme application, and WebSocket frame mapping, while orchestration lives outside the renderer. In gateway mode, the runtime flow is TUI -> local gateway on port `4801` by default -> `SessionRegistry` -> provider session execution through Kiln's runtime pipeline. That keeps the same session, safety, memory, and cost machinery in the path instead of duplicating agent-loop logic in the terminal client.

Sources: `packages/tui/src/app.tsx`, `packages/tui/src/theme.ts`, `packages/tui/src/gateway-session.ts`, `packages/tui/src/ws-client.ts`, `packages/tui/src/index.ts`, `packages/cli/src/commands/tui.ts`, `packages/runtime/src/gateway/tui-gateway.ts`

## Starting the TUI

The `kiln tui` command currently accepts these flags from `packages/cli/src/commands/tui.ts`:

| Flag | Purpose |
|------|---------|
| `--provider <name>` | Select the initial provider. Supported values are `claude`, `codex`, `opencode`, `anthropic`, `openai`, `deepseek`, `openrouter`, and `ollama`. |
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

Transport note: `tui.ts` currently resolves startup transport to `direct` by default. The in-process gateway path is enabled when `KILN_TUI_TRANSPORT=gateway` is set.

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
- `/theme` opens the theme picker.
- `/resume` focuses the session browser in the sidebar.
- Arrow keys or `j` / `k` navigate the theme picker, provider picker, slash popover, and session list depending on the current UI state.

Printable-first key routing means normal printable characters are appended to the input before most special-case handlers run. That keeps typing responsive and reserves command handling for explicit control keys and slash commands instead of intercepting ordinary text entry.

## Provider Selection

The provider picker is split into two sections:

- `Harness`: `claude`, `codex`, `opencode`
- `Direct API`: `anthropic`, `openai`, `deepseek`, `openrouter`, `ollama`

Selecting a provider in the picker sends a `{ type: "provider", provider, model? }` frame through the WebSocket session. The gateway updates the injected session manager with `setProvider()` and, when present, `setModel()`, then acknowledges with `{ type: "provider_changed", provider }`.

On the CLI side, the multi-provider session manager keeps per-provider resume state and passes the active provider into the wrapper `SessionRegistry`. That is the point where Kiln maps the TUI selection onto either a harness-backed session or a direct-provider session.

## Session Commands

### `/clear`

`GatewaySession.clear()` sends `{ type: "clear" }` over the WebSocket connection and waits for `{ type: "cleared" }`. The timeout is `5_000ms`. In the gateway, the `onClear` callback is invoked before the acknowledgement is sent. In the CLI command, that callback clears the last persisted session record for the active provider so the next turn starts from a fresh conversation state.

### `/plan`

`/plan` sets the TUI's local `planMode` state and adds a status message in the chat pane. In gateway mode, the welcome frame also carries an initial `planMode` value, and the gateway accepts an `{ type: "exec" }` frame to confirm execution mode transitions.

### `/provider`

`/provider` opens the provider picker. Closing the picker with a selection updates `currentProvider`, optionally updates the selected model, refreshes the sidebar, and asks the session object to switch providers if that capability is available.

## Session Persistence

Session persistence lives in the CLI wrapper, not in the TUI renderer.

Kiln stores:

- `.kiln/sessions.jsonl` as the append-only session index
- `.kiln/sessions/<sessionId>/meta.json` for per-session metadata
- `.kiln/sessions/<sessionId>/transcript.jsonl` for the transcript stream

At startup, `makeMultiProviderSessionFactory()` loads the last persisted record for each provider. The sidebar session browser is populated from the session index, and `/resume` or an empty-input `Enter` on a selected row marks a stored session as the resume target. Clear removes the last matching provider record from the JSONL index through `SessionStore.clearLast()`.

## In-Process Gateway

`startTuiGateway()` in `packages/runtime/src/gateway/tui-gateway.ts` starts a local WebSocket gateway on port `4801` by default and returns the `ws://localhost:<port>/tui/ws` endpoint used by `GatewaySession`. The gateway builds a `ModeBOrchestrator`, `SessionRegistry`, `ApprovalGateRegistry`, and a `TuiActivityStreamer` so the TUI can reuse the same runtime-side session, approval, activity, and completion flow as the rest of Kiln.

The TUI WebSocket adapter handles:

- `message` frames for new user turns
- `clear` frames with an `onClear` callback and `cleared` acknowledgement
- `provider` frames with `provider_changed` acknowledgement
- `approve` and `reject` frames for approval flow
- `exec` frames for plan-mode execution confirmation
- `welcome`, `thinking`, `activity`, `done`, and `error` inbound frames

This path keeps the same safety, session, runtime-summary, and cost-tracking machinery in place instead of adding a second terminal-only orchestration loop.

## Architecture Note

The TUI owns no orchestration logic by design. ADR-002 TUI formalizes the reason: the terminal client should stay a thin rendering surface over gateway-owned session state and execution, so memory, safety, approvals, routing, and provider handling are implemented once and reused consistently across clients.

See [ADR-002 TUI](../adr/ADR-002-tui-gateway-architecture.md).
