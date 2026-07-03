# GUI Guide

## Overview

`kiln gui` is Kiln's rich web operator surface. In local operator mode, it
starts the local GUI Operator Gateway, serves the web UI, and launches the
interface in a managed app-mode browser window so the Kiln process can shut
down cleanly when the window closes.

This is intentionally different from `kiln dev --playground` or manually opening a URL in an arbitrary browser tab. `kiln gui` owns the operator session lifecycle.

This local Operator Gateway is not the deployable App Gateway that loads
`gateway.yaml` and bound `app.yaml` files. The canonical path for operating YAML
apps is GUI attach mode against an existing App Gateway, not a second app
runtime. See
[`docs/architecture/runtime-surfaces.md`](../architecture/runtime-surfaces.md).

## Usage

Install the public CLI package when operating Kiln from another repository,
local machine, or VPS:

```bash
bun add -g @kilnai/cli@2.1.0
kiln gui
```

The installed CLI carries the public `@kilnai/gui` static asset package through
the runtime. A normal `kiln gui` run serves those assets in production mode from
any working directory.

```bash
kiln gui
```

By default, the command:

1. Starts the local GUI Operator Gateway on port `4810`
2. Serves the installed `@kilnai/gui` static build
3. Opens the UI in a managed app-mode window using Microsoft Edge, Google Chrome, or Chromium
4. Shuts down the gateway when that window closes

Use `--dev` only when developing this repository's GUI source. Dev mode expects
the `packages/gui` workspace to exist in the current Kiln source checkout.

### App Gateway Attach Mode

For a deployable repo such as `kiln-gateway`, the App Gateway should be started
from its versioned `gateway.yaml` and own app sessions, tenant state, memory,
safety, channels, events, and MCP exposure. The GUI should attach to that
gateway over the operator HTTP/WS contract when operating those apps.

Canonical topology:

```bash
kiln gateway --config ./gateway.yaml --port 3800
kiln gui --connect http://localhost:3800
```

`--connect` is the canonical product contract for App Gateway attach mode. In
attach mode, the CLI does not start a local GUI Operator Gateway and does not
shut down the App Gateway when the GUI window closes.

Implementation status: attach mode opens the App Gateway GUI URL, the App
Gateway exposes the GUI dashboard/session-list contract, and `/gui/ws` routes
messages to the selected runtime-capable YAML app. The dashboard publishes
runtime-capable apps, enabled tenants, active app/tenant selection, and
`operatorWorkspaceHome`; the GUI renders compact app/tenant selectors, sends
target-bound operator actions with `gatewayTargetId`, and prefers the
gateway-published Operator Workspace home projection for workspace
summary/attention state before falling back to local reconstruction. Global
control-plane frames such as provider switching, clear, provider auth, theme
results, and voice synthesis remain targetless because they operate on the
connected operator surface, provider catalog, UI preference, or source message.

## Flags

| Flag | Description |
|------|-------------|
| `--provider <name>` | Initial provider selection |
| `--theme <name>` | Initial GUI theme from the shared operator theme catalog |
| `--plan` | Start with plan mode enabled |
| `--cwd <path>` | Working directory used by the session |
| `--connect <url>` | Attach to an existing App Gateway instead of starting the local GUI Operator Gateway |
| `--port <number>` | Override the gateway port |
| `--gui-port <number>` | Override the Vite dev server port in dev mode |
| `--dev` | Use the source-tree Vite dev server from `packages/gui` |
| `--prod` | Use the installed public GUI static build |
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

GUI theme preference is stored in `~/.kiln/config.yaml` under the shared
`ui.theme` key. If `ui.theme` is absent, Kiln falls back to `kiln-dark`.

GUI and TUI use the same operator theme catalog from
`@kilnai/gateway-contracts`: `kiln-dark`, `kiln-graphite`, `kiln-light`, and
`system-follow`. `kiln-dark` is the Obsidian default, `kiln-graphite` is a
slightly lifted dark surface, and `kiln-light` is the Paper light variant.
`system-follow` follows the OS color preference in the GUI; in the TUI it
resolves to the terminal-safe dark palette because there is no reliable
cross-terminal OS theme bridge.

Connected executable providers can call the runtime `operator_set_theme` tool
to request a live GUI theme change. The request is acknowledged over the same
operator WebSocket as other GUI control frames. `scope: "session"` applies only
to the live window; `scope: "persisted"` also saves `ui.theme`. The CLI exposes
the same operator tool contract for parity, but because it has no live visual
surface it only accepts persisted theme changes and writes the shared operator
default.

## Command Palette

The GUI command palette projects `listOperatorCommands("gui")` from
`@kilnai/gateway-contracts`. Shared commands must be added to
`packages/gateway-contracts/src/operator-commands.ts`; do not add GUI-only
duplicates for governed operator controls.

The shared GUI catalog includes `goal`, `plan`, `exec`, `provider`, `theme`,
`effort`, `authority`, `resume`, `setup`, and `clear`. `goal` opens the governed
work/goal surface, and `plan`/`exec` toggle the same planning state used by the
composer controls.

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
formatting, and a subtle active continuation rail. Selecting a row previews the
canonical transcript only; it does not silently resume that session. Empty
submit on the selected row or an explicit resume affordance marks the visible
continuation target. Typing a prompt from preview starts a fresh session unless
that resume intent was set. It intentionally avoids card stacks and
provider-owned history buckets.

## Operator Layout

The GUI shell uses a supervision layout rather than a dashboard layout:

- a narrow left rail owns operator modes such as Sessions, Workspace, Changed
  files, Approvals, Activity, Memory, and Setup
- the expanded mode panel owns the selected mode's list or navigation content
- the main chat column owns conversation, turn composition, and active-turn
  controls such as provider/model route and app target selection
- the Activity mode owns runtime evidence such as routing, tool calls, cost
  updates, continuity, and turn completion details
- the Setup mode owns durable configuration diagnostics, projection status, and
  operator preferences such as theme

The chat surface intentionally does not keep a persistent summary top bar. Tabs
and the composer remain focused on active work; diagnostics and preferences
move to their canonical modes. Regression coverage locks this behavior:
turns/tokens/cost and field telemetry are not rendered as always-visible chrome,
and theme selection is available through Setup.

Activity details must be projections of the canonical session timeline. Do not
maintain separate GUI-only caches for changed files, continuity, approval
state, cost, or routing when the same facts already exist in `session_event`
history.

Operator Workspace summary follows the same rule. When the dashboard publishes
`operatorWorkspaceHome`, the GUI must consume that shared projection before
deriving local summaries from raw session events. Local reconstruction is only
an availability fallback for older or unavailable gateway projections.

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

### Sidebar Navigation

The desktop sidebar is one continuous operator-navigation surface. It combines
primary surface navigation and canonical session history without placing a
secondary panel inside the sidebar.

The sidebar shell owns collapse behavior, mobile drawer handoff, and surface
selection. Session history owns search, temporal grouping, keyboard traversal,
selection state, and compact row presentation. Do not introduce another
responsive sidebar abstraction unless it replaces the existing shell owner
rather than duplicating its state.

Session rows are dense navigation items, not cards. Each row reserves stable
space for the conversation title, relative age, selected state, and exceptional
runtime state. Provider summaries, tags, count footers, and descriptive
metadata belong in session detail or activity surfaces, not in the navigation
list. Secondary actions should appear only when they are useful for the current
interaction.

Search is progressive from the history heading. An empty search state should
explain the result and provide a clear recovery path without changing session
selection. The same radius, spacing, hover, focus, and selected-state language
must be shared by primary surface navigation and session history so the sidebar
reads as one system.

The sidebar uses installed shadcn/Base UI primitives such as `Button`, `Input`,
`Popover`, `Separator`, and `Tooltip` for focus behavior and interaction
semantics. Visual styling remains Kiln-owned through the theme tokens defined
in `packages/gui/src/styles.css`.

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

## Transcript Navigation

The GUI transcript composes the official shadcn `MessageScroller` primitives
over Kiln's shared conversation-turn projection. Kiln owns message, event, and
tool evidence; the scroller owns viewport behavior only.

User messages are stable turn anchors. Opening saved history restores the last
anchored turn instead of dropping the reader at the absolute bottom, and a new
turn keeps a small part of the previous row visible for context. Streaming
follows only while the reader remains at the live edge. Wheel, touch, keyboard,
or explicit message navigation releases that follow state, allowing new output
to arrive offscreen without moving the current reading position.

Every projected transcript row has a stable message identity so prepended
history and late layout changes preserve the visible row. The jump-to-latest
control appears only when more content exists below; using it returns to the
live edge and resumes following. The control is icon-only so it remains usable
when inspector or browser docks narrow the transcript, while its accessible
name distinguishes normal history from live activity arriving below.

The viewport is keyboard-focusable and the transcript content is a polite log.
Rows use content visibility and intrinsic sizing hints to keep long histories
responsive. Do not reintroduce direct `scrollTop` mutation, unconditional
bottom pinning, or a second GUI-owned scroll state machine.

Markdown tables in assistant output are transcript content, not shared table
primitive behavior. The transcript renderer owns the horizontal scroll
container for Markdown tables so long evidence tables remain inspectable in
narrow chat layouts without changing the global shadcn `Table` component used
by product UI.

Tool execution is operational evidence, not assistant prose. GUI renders each
execution as a standalone row correlated by canonical `toolCallId`; interleaved
calls remain distinct, and terminal evidence replaces progress for that
execution without hiding unrelated calls. Active rows use text, icon, and state
attributes. The decorative border beam is supplemental and all descendant
animation is disabled under `prefers-reduced-motion: reduce`.

Structured tool results select bounded renderers from the shared presentation
contract. JSON, source, Markdown, diffs, tables, images, trees, and resource
bundles remain inside the transcript width and expose readable fallback text
when intent validation fails. Raw payloads remain inspector evidence rather
than normal conversation content.

The semantic navigation rail indexes projected user turns, assistant replies,
tool executions, and failures. Keyboard or pointer activation scrolls to the
selected canonical anchor; return-to-latest targets the final anchor. The rail
is hidden on compact viewports where it would compete with conversation width.
Saved-session batches and live reconnect delivery deduplicate by `eventId`, so
restore cannot duplicate rows or revive terminal executions.

## Resource Reads

GUI resource previews read through the shared `OperatorResourceReadResult`
contract. GUI sends `OperatorResourceReadRequest` to
`/gui/api/resources/read` with the selected `gatewayTargetId`, app, tenant,
session, and resource identity when those fields are known. The runtime passes
that target through the shared resource-read options before projecting the
result back to the GUI, so providers resolve target-specific resources without
labels, selected ports, or local instance strings.

When a resource result includes `summary`, the GUI preserves the whole read
result as JSON in the preview data URL and includes the shared
`projectOperatorResourceReadPresentation` projection so browser presentation
can render provider-owned counts, facets, metadata, and content state without
reparsing payload text.

Current summarized aggregate reads include the tool catalog, session work
items, session goals, workspace trees, artifact namespaces, memory graph
snapshots, managed-agent invocation indexes, and external-engagement artifact
indexes. GUI-specific inspector layouts consume the shared presentation
projection; provider summaries remain the source of truth.

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

Turn authority in the composer has two parts: the operator request and the
gateway admission result. The authority selector sends the requested limit
(`auto`, `read_only`, `audited`, or `destructive`) with the next turn, while the
provider status chip displays the latest admitted authority projected by the
runtime (`requested -> admitted`, sandbox, and completeness). Do not infer write
capability from the selected provider alone; managed-agent writes require an
explicit write-capable route in global config.

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

At startup, the GUI may render cached provider discovery immediately. Cached
entries are `stale` diagnostics and remain unavailable until background runtime
discovery refreshes them. The GUI must not enable model selection, provider
switching, prompt execution, or managed invocation execution from stale
metadata.

Selecting a session from the rail loads that session's transcript into the main
chat as a preview. It does not silently mark the session as the active
continuation target. Empty submit on the selected session or an explicit resume
affordance marks the visible continuation target for the next turn. Typing a
normal prompt from a historical preview starts a fresh session unless that
resume intent was set.

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
history, and type a normal prompt. The expected result is a fresh session, not
hidden continuation. Then select the first conversation again and use the
explicit resume action; the expected result is that the runtime logs show the
first canonical Kiln session ID and the assistant has the selected
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

For authority validation, select `Auto`, send a turn, and verify the composer
status shows the admitted authority and sandbox. If the task delegates
implementation to a managed child, the child must use
`foundation-apply-approved-writes` and route health must show a configured
write-capable harness route; read-only direct routes should continue to fail
closed for edits.

See `docs/architecture/session-model.md` for the canonical rules.

## Notes

- `kiln gui --no-open` is useful for debugging or when you want to connect manually to the served URL.
- The GUI still talks to Kiln through the local gateway; there is no parallel control plane.
- Closing the managed GUI window is the expected Phase 1 shutdown path for the GUI surface.
- GUI parity status lives in `docs/guides/gui-parity.md`; the manual validation
  script lives in `docs/guides/gui-parity-walkthrough.md`.

## Startup Profiling

Use the repo-level startup profiler before changing GUI or operator-gateway
startup behavior:

```bash
bun run profile:startup -- --mode dev --cwd C:\Proyectos\Sequel\kiln --no-open
```

For a cold Vite dependency cache run, clear only the GUI Vite optimizer cache:

```bash
bun run profile:startup -- --mode dev --cwd C:\Proyectos\Sequel\kiln --clear-vite-cache --no-open
```

The profiler emits JSON with the commit SHA, OS, Bun/Node/Vite/React versions,
cache state, command line, and measured milestones for gateway health,
dashboard readiness, Vite readiness when dev mode reports it, and GUI URL
readiness. Browser launch and first usable paint are separate evidence points;
do not infer them from Vite's `ready in` line or from gateway health alone.

To measure the first usable GUI interaction, enable browser automation:

```bash
bun run profile:startup -- --mode dev --cwd C:\Proyectos\Sequel\kiln --measure-first-paint --no-open
```

This launches a headless browser in an isolated Node subprocess and waits until
the composer accepts input and the send control is visible. The probe does not
send a message. It also records a redacted `browserResourceSummary` with the
slowest initial browser resource requests so Vite dependency optimization and
lazy-loading decisions can be tied to module evidence. Normal `kiln gui`
startup does not load Playwright or pay this measurement cost.

Current measured dev-mode optimizations:

- `@tanstack/router-devtools` is lazy-loaded from the root route so devtools do
  not compete with first usable GUI interaction.
- `@kilnai/gateway-contracts` is included in Vite `optimizeDeps` because warm
  profiling showed many linked-workspace `/@fs/` contract modules on the
  initial resource path. The targeted pre-bundle collapses that graph into a
  single optimized dependency request.
- Production builds keep Vite's 560 kB chunk warning gate active. Large,
  stable dependency families are split by ownership in `packages/gui/vite.config.ts`:
  React/router/UI runtime, query runtime, shared Kiln contracts, validators,
  markdown/syntax rendering, inspectors, icons, state, and pure style utilities.
  Do not raise the warning limit to hide bundle regressions; either preserve
  these stable chunk boundaries or add a measured lazy boundary for optional GUI
  surfaces.

Reference profile on Windows 11, Bun `1.3.8`, Node `24.3.0`, with the working
tree based on commit `38dd7c9a`: warm dev startup after the optimization
reported Vite ready in `1241 ms`, GUI URL ready at `3782 ms`, first usable
interaction at `5305 ms`, and `1523 ms` from GUI URL readiness to first usable
interaction. Treat these as machine-local evidence, not a public performance
guarantee.
