# GUI Guide

## Overview

`kiln gui` is the primary operator surface for Kiln Phase 1. It starts the local GUI gateway, serves the web UI, and launches the interface in a managed app-mode browser window so the Kiln process can shut down cleanly when the window closes.

This is intentionally different from `kiln dev --playground` or manually opening a URL in an arbitrary browser tab. `kiln gui` owns the operator session lifecycle.

## Usage

```bash
kiln gui
```

By default, the command:

1. Starts the local GUI gateway on port `4810`
2. Serves the GUI in dev mode or built mode, depending on whether `packages/gui/dist/index.html` exists
3. Opens the UI in a managed app-mode window using Microsoft Edge, Google Chrome, or Chromium
4. Shuts down the gateway when that window closes

## Flags

| Flag | Description |
|------|-------------|
| `--provider <name>` | Initial provider selection |
| `--theme <name>` | Initial GUI theme (`kiln-dark`, `kiln-light`, `system-follow`) |
| `--plan` | Start with plan mode enabled |
| `--cwd <path>` | Working directory used by the session |
| `--port <number>` | Override the gateway port |
| `--gui-port <number>` | Override the Vite dev server port in dev mode |
| `--dev` | Force Vite dev mode |
| `--prod` | Force built/static mode |
| `--open` | Launch the managed GUI window |
| `--no-open` | Start the gateway without opening a window |

## Managed Window Host

Phase 1 uses a managed Chromium-family app window rather than a bespoke desktop shell. Kiln currently looks for these hosts in priority order:

- Microsoft Edge
- Google Chrome
- Chromium

Kiln launches the window with a temporary browser profile and app-mode flags. That keeps the GUI process lifecycle tied to the launched window instead of delegating to an existing browser tab.

If no supported browser host is available, `kiln gui` fails closed and tells you to either install one of the supported hosts or rerun with `--no-open`.

## Theme Persistence

GUI theme preference is stored in `~/.kiln/config.yaml` under `gui.theme`. If `gui.theme` is absent, Kiln falls back to `tui.theme` during the transition period, then to `kiln-dark`.

## Design System

The GUI uses shadcn with Base UI primitives as its component baseline. The
source-owned component files live under `packages/gui/src/components/ui/`, and
imports use the `@/` alias rooted at `packages/gui/src`.

Kiln's visual tokens remain canonical. shadcn contract tokens such as
`--background`, `--card`, `--secondary`, `--border`, `--ring`, and sidebar
tokens are mapped onto the existing Kiln theme variables in
`packages/gui/src/styles.css`. Do not introduce a parallel palette or raw
provider colors for normal UI state.

The current session rail follows a dense operator-console pattern: grouped
canonical sessions, hairline separators, compact provider glyphs, stable cost
formatting, and a subtle active continuation rail. It intentionally avoids
card stacks and provider-owned history buckets.

## Session Model

The GUI session rail shows canonical Kiln sessions. It is not filtered by the
active provider.

Provider/model selection controls the next turn's execution route. A single
Kiln session can contain turns from multiple providers, and the GUI should keep
that session visible while the operator switches providers. Provider-native
thread IDs, when available, are stored as provider-thread metadata under the
Kiln session and are used only for the matching provider.

Selecting a session from the rail loads that session's transcript into the main
chat and makes it the active continuation target. There is no separate
"preview" or "set resume target" step in the GUI: if the selected conversation
is visible in chat, the next message continues that conversation.

`New Session` detaches the current runtime conversation and clears the visible
chat for a new conversation. It does not delete stored history.

GUI history lists only sessions that have canonical transcript metadata. Kiln
does not show ledger-only rows as fallback history, because they are not
loadable conversations.

For live validation, create two conversations, select the first one from
history, and send another message. The expected result is that the runtime logs
show the first canonical Kiln session ID and the assistant has the selected
conversation's prior context. Provider switching should still produce one
continued Kiln conversation with per-provider telemetry attribution, not
separate provider-owned histories.

See `docs/architecture/session-model.md` for the canonical rules.

## Notes

- `kiln gui --no-open` is useful for debugging or when you want to connect manually to the served URL.
- The GUI still talks to Kiln through the local gateway; there is no parallel control plane.
- Closing the managed GUI window is the expected Phase 1 shutdown path for the GUI surface.
- The final manual sign-off script for TUI replacement lives in `docs/guides/gui-parity-walkthrough.md`.
