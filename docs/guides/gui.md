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
| `--theme <name>` | Initial GUI theme from the shared operator theme catalog |
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

GUI theme preference is stored in `~/.kiln/config.yaml` under `gui.theme`. If
`gui.theme` is absent, Kiln falls back to `tui.theme` during the transition
period, then to `kiln-dark`.

GUI and TUI use the same operator theme catalog from
`@kilnai/gateway-contracts`: `kiln-dark`, `kiln-light`, `system-follow`,
`dracula`, `catppuccin-mocha`, `nord`, `tokyo-night`, `gruvbox-dark`,
`rose-pine`, `kanagawa-wave`, `everforest-dark`, `ayu-dark`, `one-dark`, and
`night-owl`. `system-follow` follows the OS color preference in the GUI; in the
TUI it resolves to the terminal-safe dark palette because there is no reliable
cross-terminal OS theme bridge.

Connected executable providers can call the runtime `operator_set_theme` tool
to request a live GUI theme change. The request is acknowledged over the same
operator WebSocket as other GUI control frames. `scope: "session"` applies only
to the live window; `scope: "persisted"` also saves `gui.theme`. The CLI exposes
the same operator tool contract for parity, but because it has no live visual
surface it only accepts persisted theme changes and writes the shared GUI/TUI
defaults.

## Design System

The GUI uses shadcn with Base UI primitives as its component baseline. The
source-owned component files live under `packages/gui/src/components/ui/`, and
imports use the `@/` alias rooted at `packages/gui/src`.

Kiln's visual tokens remain canonical. shadcn contract tokens such as
`--background`, `--card`, `--secondary`, `--border`, `--ring`, and sidebar
tokens are mapped onto the existing Kiln theme variables in
`packages/gui/src/styles.css`. Do not introduce a parallel palette or raw
provider colors for normal UI state.

Workspace document previews use the same token discipline. Viewer-specific
surfaces are exposed as `--workspace-viewer`, `--workspace-viewer-panel`, and
`--workspace-viewer-gutter`, derived from the active Kiln theme instead of
hard-coded light or dark colors. Use those tokens for file-preview backgrounds,
code gutters, Markdown code blocks, and document-tab surfaces so future themes
inherit a coherent editor-like surface automatically.

The current session rail follows a dense operator-console pattern: grouped
canonical sessions, hairline separators, compact provider glyphs, stable cost
formatting, and a subtle active continuation rail. It intentionally avoids
card stacks and provider-owned history buckets.

## Operator Layout

The GUI shell uses a supervision layout rather than a dashboard layout:

- a narrow left rail owns operator modes such as Sessions, Workspace, Changed
  files, and Approvals
- the expanded mode panel owns the selected mode's list or navigation content
- the main chat column owns conversation, turn composition, and top-level
  session state
- the inspector owns deeper runtime details that are useful for diagnosis but
  should not compete with the chat header

The main chat top bar is the summary layer. It should show the active session
title/state, turns, tokens, current cost, provider/model route, and connection
state. Do not duplicate those same summary metrics in the inspector.
Regression coverage now explicitly locks this behavior: turns/tokens/cost stay
in the top bar and are not duplicated in `SessionTelemetry`.

The inspector is the detail layer. It should focus on continuity decisions,
field state, and future event-backed diagnostics. It is collapsed by default so
the operator can keep the transcript in focus.

Those inspector sections must be projections of the canonical session
timeline. Do not maintain separate GUI-only caches for changed files,
continuity, or approval state when the same facts already exist in
`session_event` history.

Live runtime progress follows the same rule. The GUI accepts `session_event`
frames for durable operational evidence and `activity_phase` frames for
lightweight progress, but both are scoped by `kilnSessionId`. When the operator
selects another session, the visible activity, changed files, approvals, diffs,
and tool log projections are cleared or replaced by the selected session's
timeline. Late frames from a different session must not update the visible
session.

Current mode status:

- `Sessions` is live and loads canonical Kiln conversations into chat
- `Changed files` is live and renders session-scoped file-change events from
  the canonical timeline with per-file review, canonical line deltas, and an
  explicit "diff hunks not emitted yet" state
- `Workspace` is live and renders the active working directory through the
  shared governed workspace explorer contract
- `Approvals` remains gated until a dedicated event-backed panel is built on
  top of canonical approval events

## Workspace Explorer

The Workspace rail panel is a read-only navigation projection of the active
working directory. It uses the shared `OperatorWorkspaceExplorer` contract from
`@kilnai/gateway-contracts`, so future operator surfaces can consume the same
directory and file-preview model instead of inventing GUI-only workspace state.
It must not duplicate session summary fields such as domain, session ID,
provider/model route, phase, turns, tokens, or cost; those belong to the main
session header and inspector surfaces.

The local GUI gateway exposes that contract through:

- `GET /gui/api/workspace/tree?path=<path>` for lazy directory loading
- `GET /gui/api/workspace/file?path=<path>` for read-only file preview

The first dashboard snapshot seeds the root directory so the panel can render
immediately. Expanding a directory loads only that directory, capped at 250
entries, sorted with directories first. Paths are resolved against the active
working directory and rejected if they escape that root.

The panel may show the current workspace root and an active worktree path when
it differs from the root. Full session metadata stays outside Workspace.

Workspace entries may also carry canonical VCS status from the shared contract.
The local GUI explorer currently projects Git working-tree state with a short
cache, in-flight deduplication, and a bounded status probe so startup is not
blocked by slow repositories. The status probe is normalized into an indexed
map before rendering: each changed path also marks its ancestor directories, so
top-level folders such as `packages` show a Git marker when any nested file is
modified. File-tree rendering then performs constant-time VCS lookups instead
of rescanning the full Git status output for every visible row.

Files and directories render compact Git markers for modified, added, deleted,
renamed, untracked, and conflicted states; the shared contract also reserves an
ignored state for surfaces that opt into ignored-file projection. This is
distinct from `Changed files`: VCS status is the current working tree, while
`Changed files` is session evidence emitted by runtime/tool events.

Selecting a file opens it in the main layout as a document tab next to the Chat
tab. The sidebar remains tree navigation; it does not own file-preview tabs.
The preview surface uses theme-derived workspace viewer tokens so code,
Markdown, images, and unsupported-file states remain visually distinct from the
chat transcript without creating a separate color system.

File preview support is intentionally conservative:

- text/code files render as UTF-8 text with line numbers and are capped at 256
  KiB; supported languages use syntax highlighting derived from the active
  Kiln theme tokens. The syntax highlighter is lazy-loaded so normal GUI
  startup does not pay the code-preview bundle cost.
- JSON files are parsed and pretty-printed when valid; invalid JSON falls back
  to raw text with an explicit notice
- Markdown files render through the GUI's safe Markdown renderer with GFM
  enabled and raw HTML skipped
- common web images (`png`, `jpg`, `jpeg`, `gif`, `svg`, `webp`) render inline
  when they are 1 MiB or smaller
- binary or unsupported files show metadata and an explicit unsupported-preview
  state

Document tabs are local presentation state. They do not mutate the runtime
session, provider route, approval state, changed-file events, or working tree.
Editing, save semantics, structured diff viewing, and provider tool invocation
remain outside this read-only workspace slice.

## Commands and Composer

`Ctrl+K` or `Cmd+K` opens the global command palette as a centered dialog.

Typing `/` in an empty composer, or pressing the `/command` affordance in the
composer rail, opens a composer-attached command surface above the input. That
surface is intentionally not the global modal; slash commands are part of the
message composition flow. Regression coverage locks this separation through the
`placement="composer"` path versus the global palette path.

Composer command placement remains a non-modal inline dialog path; it is not a
fallback into the centered global modal.

The composer should remain a compact framed control with internal padding, a
transparent textarea, and a bottom action rail for command, file, approval,
plan, route, and send affordances. Avoid large detached input cards, duplicate
status headers, or controls that push the transcript out of view.

Provider/model selection and reasoning effort live in the composer action rail
because they shape the next submitted turn. The reasoning control appears only
when the active discovered model advertises `supportedReasoningEfforts`; it
defaults to the model's advertised `defaultReasoningEffort` when present. The
selected effort is sent with the next message frame and is not a global GUI
preference.

For Codex OAuth, the model catalog is discovered from the authenticated Codex
model endpoint. Reasoning levels are derived from that catalog, including the
object-shaped `supported_reasoning_levels` response returned by ChatGPT-backed
Codex models. Do not add a static reasoning fallback in the GUI; if discovery
does not advertise levels, the control must stay hidden.

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

Operational panels are session-scoped:

- `Activity` renders event entries from the visible session timeline.
- `Changed files` renders file-change events owned by the visible session.
- `Approvals` resolves pending requests by canonical session identity.
- Tool calls and cost updates are derived from `session_event` history.
- `activity_phase` updates only apply when the frame's `kilnSessionId` matches
  the live or visible session.

For live validation, create two conversations, select the first one from
history, and send another message. The expected result is that the runtime logs
show the first canonical Kiln session ID and the assistant has the selected
conversation's prior context. Provider switching should still produce one
continued Kiln conversation with per-provider telemetry attribution, not
separate provider-owned histories.

For session-scoping validation, start a turn that uses a tool, switch to another
session, then return. The second session must not show the first session's tool
activity, changed files, approvals, or diff previews. Returning to the first
session should restore those facts from its own canonical timeline.

For workspace validation, open the Workspace rail mode, expand a nested
directory, open a text file, then open a JSON or Markdown file if one exists.
The expected result is a lazy tree with read-only document tabs in the main
layout. The Chat tab remains available beside the opened files. Opening files
must not create session events, approvals, changed-file entries, or provider
tool calls.

For reasoning validation, select a Codex OAuth model that advertises reasoning
levels, choose a non-default effort from the composer control, and send a turn.
The request should complete through the same runtime session and the selected
effort should apply only to that turn.

See `docs/architecture/session-model.md` for the canonical rules.

## Notes

- `kiln gui --no-open` is useful for debugging or when you want to connect manually to the served URL.
- The GUI still talks to Kiln through the local gateway; there is no parallel control plane.
- Closing the managed GUI window is the expected Phase 1 shutdown path for the GUI surface.
- The final manual sign-off script for TUI replacement lives in `docs/guides/gui-parity-walkthrough.md`.
