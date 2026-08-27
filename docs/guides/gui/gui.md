# GUI Guide

## Overview

`kiln gui` is Kiln's rich web operator surface. In local operator mode, it
starts the local GUI Operator Gateway, serves the web UI, and launches the
interface in a managed app-mode browser window so the Kiln process can shut
down cleanly when the window closes.

`kiln gui` owns the local operator session lifecycle. `kiln dev --open` instead
starts the canonical App Gateway for YAML apps and opens the same GUI at
`/gui/`; it does not create a separate development interface.

This local Operator Gateway is not the deployable App Gateway that loads
`gateway.yaml` and bound `app.yaml` files. The canonical path for operating YAML
apps is GUI attach mode against an existing App Gateway, not a second app
runtime. See
[`docs/architecture/surfaces/runtime-surfaces.md`](../../architecture/surfaces/runtime-surfaces.md).

## Usage

The current repository is source-only. To develop the GUI, run this command
from the repository root:

```bash
bun packages/cli/src/index.ts gui --dev
```

The command starts the source-tree Vite server and the local GUI Operator
Gateway. It requires a Chromium-family browser unless you pass `--no-open`.
Both local listeners bind explicitly to `127.0.0.1`. The gateway admits only
its exact bundled-GUI origin or the exact loopback Vite origin selected by this
startup. It never exposes a wildcard listener or wildcard CORS policy.

GUI reuses the machine-global Operator Runtime. Closing the GUI does not stop
that shared process, so a source rebuild does not replace Runtime code already
loaded in memory. Follow the
[Operator Runtime runbook](../../operations/operator-runtime.md) after rebuilding
CLI, Runtime, Core, gateway-contract, or provider-adapter code.

To exercise built production assets instead, build the workspace first:

```bash
bun run build
bun packages/cli/src/index.ts gui --prod
```

By default, the command:

1. Starts the local GUI Operator Gateway on port `4810`
2. Serves either the source Vite application or the built GUI assets
3. Opens the UI in a managed app-mode window using Microsoft Edge, Google Chrome, or Chromium
4. Shuts down the gateway when that window closes

Use `--dev` when developing this repository's GUI source. Dev mode expects
the `packages/gui` workspace to exist in the current Kiln source checkout. Vite
owns GUI assets in this mode, while the local gateway exposes only the operator
API and WebSocket contract; a prebuilt `packages/gui/dist` bundle is not a dev
startup prerequisite. Kiln waits for Vite readiness before opening the managed
browser window, tracks the actual DevTools page target rather than a short-lived
Windows launcher process, keeps that target identity across client-side route
changes such as Settings, confirms target absence across a bounded grace period
so development reloads are not mistaken for closure, and terminates the complete
Vite child tree when the window closes. Shutdown asks the dedicated browser to
close through DevTools, waits for that browser connection to close, and only then
removes its temporary profile.

### App Gateway Attach Mode

For a deployable repo such as `kiln-gateway`, the App Gateway should be started
from its versioned `gateway.yaml` and own app sessions, tenant state, memory,
safety, channels, events, and MCP exposure. The GUI should attach to that
gateway over the operator HTTP/WS contract when operating those apps.

Canonical topology:

```bash
kiln gateway start --config ./gateway.yaml --port 3800
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
 control-plane frames such as target selection and target-catalog evidence
 refresh, provider authentication, clear, theme results, and voice synthesis
 remain targetless because they operate on the connected operator surface,
 target catalog, UI preference, or source message.

## Flags

| Flag | Description |
|------|-------------|
| `--theme <name>` | Initial GUI theme from the shared operator theme catalog |
| `--plan` | Start with plan mode enabled |
| `--cwd <path>` | Working directory used by the session |
| `--connect <url>` | Attach to an existing App Gateway instead of starting the local GUI Operator Gateway |
| `--port <number>` | Override the gateway port |
| `--gui-port <number>` | Override the Vite dev server port in dev mode |
| `--dev` | Use the source-tree Vite dev server from `packages/gui` |
| `--prod` | Use the built GUI static assets |
| `--open` | Launch the managed GUI window |
| `--no-open` | Start the gateway without opening a window |

`--port` and `--gui-port` select ports only. They cannot change the listener
host or admit a non-loopback browser origin. Remote access is not a mode of
`kiln gui`; it is governed by the separate Kiln Connect roadmap.

## Managed Window Host

Phase 1 uses a managed Chromium-family app window rather than a bespoke desktop shell. Kiln currently looks for these hosts in priority order:

- Microsoft Edge
- Google Chrome
- Chromium

Kiln launches the window with a temporary browser profile and app-mode flags. That keeps the GUI process lifecycle tied to the launched window instead of delegating to an existing browser tab.

If no supported browser host is available, `kiln gui` fails closed and tells you to either install one of the supported hosts or rerun with `--no-open`.

## Appearance

The Appearance settings page controls the atomic `ui.appearance` preference in
`~/.kiln/config.yaml`: `mode` is `system`, `light`, or `dark`, and
`themeByScheme` retains one explicit selection for each scheme. The GUI follows
OS changes while mode is `system`. Its versioned localStorage value is only a
startup cache; the settings snapshot remains authoritative.

GUI and TUI consume the pure `@kilnai/operator-appearance` catalog. The built-in
themes are `phosphor`, `sequel`, `tesota`, `vesper`, and `automata`. Tesota has
light and dark variants and is the default for both schemes; system behavior is
a mode, not a theme identity. Connected executable providers may call `operator_set_theme`
for a live session override. That tool cannot persist configuration. Durable
changes require the human Settings page or `kiln config set --global`.

Obsolete appearance configuration has no compatibility or migration path; the
single operator-owned canonical document is replaced in place.

## Command Palette

The GUI command palette projects `listOperatorCommands("gui")` from
`@kilnai/gateway-contracts`. Shared commands must be added to
`packages/gateway-contracts/src/operator-commands.ts`; do not add GUI-only
duplicates for governed operator controls.

The shared GUI catalog includes `goal`, `plan`, `exec`, `target`, `theme`,
`deliberation`, `authority`, `continue`, `setup`, `clear`, and `terminal`.
`target` opens target controls, `goal` opens the governed work/goal
surface, and `plan`/`exec` toggle the same planning state used by the composer
controls.

## Active Goal Dock

When a session owns a non-terminal foreground goal, the GUI renders a compact
goal dock immediately above the composer. The collapsed dock keeps the
canonical objective, active elapsed time, work-item count, and attributed file
count visible. Its keyboard-accessible popover expands the ordered work items
and exact file/line changes. Pause, resume, objective edit, and audited
cancellation send typed `goal_control` frames; they never become model prompts.
Cancellation is confirmed and preserves the terminal goal record rather than
deleting evidence.

## Design System

The GUI uses shadcn with Base UI primitives as its component baseline. The
source-owned component files live under `packages/gui/src/components/ui/`, and
imports use the `@/` alias rooted at `packages/gui/src`.

Kiln's visual tokens remain canonical. shadcn contract tokens such as
`--background`, `--card`, `--secondary`, `--border`, `--ring`, and sidebar
tokens are aliases over the semantic operator-theme projection. The canonical
OKLCH palette lives in `@kilnai/operator-appearance`; GUI startup and live theme
changes project it through `packages/gui/src/lib/operator-theme-projection.ts`.
`packages/gui/src/styles.css` owns stable component aliases and layout effects,
not palette literals. Do not introduce a parallel palette or raw provider/state
colors for normal UI state.

Use the narrowest semantic role that describes the UI responsibility:
surface roles for elevation and selection, border roles for separation and
focus, action roles for controls, and the complete status triplet for success,
warning, danger, or information surfaces. Terminal, canvas, and WebGL widgets
must use the renderer-safe hex projection instead of parsing CSS `oklch()` or
carrying fallback colors. This keeps Tesota, Phosphor, Sequel, Vesper, Automata, and system-mode
resolution coherent across native DOM and non-DOM renderers.

AI Elements are source-owned composition primitives in this repository, not a
second runtime authority. Kiln reconciles upstream component improvements
selectively while retaining canonical task, tool, terminal, context, replay,
and accessibility contracts. Do not overwrite the local set with a registry
bulk install or introduce AI SDK estimates where the runtime already projects
authoritative usage.

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
  controls such as execution-target and app-target selection
- the Activity mode owns runtime evidence such as routing, tool calls, cost
  updates, continuity, and turn completion details
- the Setup mode owns durable configuration diagnostics, projection status, and
  operator preferences such as theme

The chat surface intentionally does not keep a persistent summary top bar. Tabs
and the composer remain focused on active work; diagnostics and preferences
move to their canonical modes. Regression coverage locks this behavior:
turns/tokens/cost and field telemetry are not rendered as always-visible chrome,
and theme selection is available through Setup.

## Composer Context Usage

The composer rail renders the shared per-turn context projection. A percentage
appears only when Runtime supplied a compatible numerator and denominator; `P`
marks partial evidence, an em dash is unavailable, and `H` marks restored
historical evidence. The focusable control has a matching accessible name and
tooltip. It is not transcript length or a derived provider probe. GUI validates
the Gateway DTO but does not change state, freshness, or authority locally.

Selecting an execution target affects the next turn only. A completed or
restored context observation remains bound to the target execution that produced it;
incompatible new target evidence is rejected by Runtime rather than displayed as
a retained percentage.

Initial selection is target-configured: a persisted
`ui.targetSelection.targetId` takes precedence over
`targetRouting.defaultTargetId`. GUI has no one-off `--target` startup flag.
The in-surface picker changes the next-turn selection only after Runtime
acknowledges the target intent.

Target selection is an anchored, non-modal composer surface. The picker renders
the runtime target-catalog projection: configured target labels, availability,
reason codes, and repair actions. Target ID is the sole selection
input. Provider and model labels are derived execution evidence for recognition
and diagnostics; they do not become alternate selection keys. A configured
target remains visible when unavailable so its repair action is actionable.

A target may expose eligible account aliases from its policy as an optional
override. Those aliases narrow that target's configured account policy; they
never expose or select credential IDs. A one-account policy has no useful
override to offer.
Provider authentication remains a provider-scoped repair action for a target
diagnostic, not a second target-selection mechanism.

Unavailable targets render the repair actions supplied by the catalog. GUI
offers `Authenticate <provider>` for `authenticate-provider` and `Refresh
model catalog` for `refresh-model-catalog`. Authentication uses the
target's derived provider only to repair account evidence. On success, the
Gateway returns fresh target evidence and GUI replaces the picker
catalog; the operator must still select an admitted target for a later turn.

Manual target refresh is an in-place picker operation after bootstrap.
It preserves the workspace and current target state while Runtime refreshes
availability evidence. Refresh failure is reported beside the initiating
control and does not return the application to its startup gate; bootstrap
state is reserved for initial connection and explicit runtime recovery.

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

The expanded hierarchy keeps frequent work surfaces (`Chat`, `Work`, and
`Agents`) above session history and anchors inspection/configuration surfaces
(`Activity`, `Memory`, and `Setup`) below it. `New session` remains a distinct
action rather than a navigation destination. The collapsed sidebar preserves
the same order, and the narrow-layout surface selector exposes the same two
semantic groups without adding more header controls.

At phone widths, the narrow header keeps new-session, drawer, surface, and
terminal controls in its first row and gives an available gateway target a
second full-width row so target identity is never hidden or reduced to an
ambiguous icon. The Kiln mark yields that constrained space and returns at the
tablet breakpoint. Icon-only controls retain explicit accessible names and
titles; coarse-pointer targets expand to 44 px while fine-pointer layouts keep
the denser desktop-derived sizing.

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

Canonical runtime evidence determines the history hierarchy. Running and
detached sessions appear first under `Active`, with detached work described to
operators as `Background`. Paused and failed sessions follow under
`Needs attention`; completed and cancelled sessions remain in chronological
history because they do not require operator action. Exceptional states use a
short visible text label as well as an icon. The sidebar must not infer approval,
input, provider, or continuation state that is absent from the session and
continuity contracts. Keyboard traversal follows this visual order.

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
derived provider/model evidence, phase, turns, tokens, or cost; those belong to the main
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
session, target state, approval state, changed-file events, or working tree.
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

Verification observations have one specialized renderer for formal, static,
artifact-quality, and inferential evidence. The GUI maps the canonical engine
identity to a local visual mark without adding asset paths or branding fields to
the shared gateway contract. Dafny and Gentle AI use attributed upstream marks;
Oxlint uses a Kiln-owned static-analysis pictogram because Oxc's official asset
license is not suitable for unrestricted Kiln distribution. Unknown engines use
a neutral monogram while retaining their exact text identity. A logo never
changes the observation's authority: every card keeps the candidate digest,
outcome, engine version, evidence details, and separate Assurance boundary.

### Verification card demo

Start the source GUI with `bun packages/cli/src/index.ts gui --dev`, open a new
chat in the Kiln repository, and ask the agent to inspect the deferred verifier
catalog before invoking the applicable producers. For example:

> Find the configured verification tools. Run `static_analyze` and
> `quality_analyze` on `packages/gui/src/components/verification-evidence.tsx`,
> then explain the observations without treating either result as acceptance.

For Dafny, name a repository-relative `.dfy` candidate and request
`formal_verify`. `gentle_review` additionally requires a configured exact Gentle
AI executable and an already-existing workspace-overlay candidate identified by
its Git base tree and target SHA-256; it observes that review and does not start
one. The tools are deferred rather than always-on, so a compliant agent resolves
them through `tool_catalog_search` when their schemas are not already projected.

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
plan, target, and send affordances. Avoid large detached input cards, duplicate
status headers, or controls that push the transcript out of view.

During a turn, the composer exposes the canonical activity phase as visible
text paired with a compact Thinking Orb: solving for thinking, working for tool
execution, and composing for streamed response. Awaiting approval pauses the
orb. The containing Border Beam remains a low-strength monochrome pulse during
work and uses a short controlled ember completion signal. Neither effect may
infer provider state, replace event evidence, or bypass reduced-motion support.

Target selection and deliberation live in the composer action rail
because they shape the next submitted turn. The deliberation control appears
only when the selected target's derived model evidence advertises ordered levels.
It remains at the provider default until the operator explicitly selects a
level; that selection is sent as a fixed intent with the next message and is
not a global GUI preference.

Turn authority in the composer has two parts: the operator request and the
gateway admission result. The authority selector sends the requested limit
(`auto`, `read_only`, `audited`, or `destructive`) with the next turn, while the
execution status chip displays the latest admitted authority projected by the
runtime (`requested -> admitted`, sandbox, and completeness). Do not infer
write capability from a target's derived provider/model alone; managed-agent
writes require a write-capable authority profile in global config.

When a selected target's derived provider is Codex OAuth, Runtime discovers model
capabilities from the authenticated Codex endpoint. Reasoning levels are
derived from that evidence, including the object-shaped
`supported_reasoning_levels` response returned by ChatGPT-backed Codex models.
Do not add a static reasoning fallback in the GUI; if discovery does not
advertise levels, the control stays hidden.

The Codex provider-authentication repair flow uses browser OAuth with PKCE and a
short-lived loopback callback owned by the Kiln runtime. It exposes the provider
authorization URL but never displays or transports access or refresh tokens.
Device-code login is reserved for CLI/TUI and headless use; the GUI must not
project it as its default browser sign-in path.

## Session Model

The GUI session rail shows canonical Kiln sessions. It is not filtered by the
selected target or its derived provider.

Target selection controls the next turn. A single Kiln session can
contain turns resolved through multiple targets, and the GUI keeps that session
visible while the operator changes targets. Provider-native thread IDs, when
available, are provider-scoped metadata under the Kiln session and are used only
by the matching provider.

At startup, the GUI may render cached provider-model discovery as diagnostic
evidence. Cached entries are `stale` and do not make a target selectable;
Runtime must refresh target availability before prompt execution or managed
invocation execution proceeds.

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
conversation's prior context. Target selection should still produce
one continued Kiln conversation with derived provider telemetry attribution, not
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

For reasoning validation, select a target whose derived provider/model is Codex
OAuth and advertises reasoning levels, choose a non-default effort from the
composer control, and send a turn. The request should complete through the same
runtime session and the selected effort should apply only to that turn.

For authority validation, select `Auto`, send a turn, and verify the composer
status shows the admitted authority and sandbox. If the task delegates
implementation to a managed child, the child must reference a configured
write-capable authority profile and target health must show an admitted target;
read-only authority profiles should continue to fail closed for edits.

See `docs/architecture/core/session-model.md` for the canonical rules.

## Notes

- `kiln gui --no-open` is useful for debugging or when you want to connect manually to the served URL.
- Normal startup prints only operator-facing status and warning-or-higher
  runtime traces. Use `KILN_LOG_LEVEL=info` temporarily when diagnosing
  per-request runtime behavior; use `KILN_LOG_FORMAT=json` when a log collector
  needs JSON Lines trace records.
- The GUI still talks to Kiln through the local gateway; there is no parallel control plane.
- Closing the managed GUI window is the expected Phase 1 shutdown path for the GUI surface.
- GUI parity status lives in `docs/guides/gui-parity.md`; the manual validation
  script lives in `docs/guides/gui-parity-walkthrough.md`.

## Startup Profiling

Use the repo-level startup profiler before changing GUI or operator-gateway
startup behavior:

```bash
bun run profile:startup -- --mode dev --cwd . --no-open
```

For a cold Vite dependency cache run, clear only the GUI Vite optimizer cache:

```bash
bun run profile:startup -- --mode dev --cwd . --clear-vite-cache --no-open
```

The profiler emits JSON with the commit SHA, OS, Bun/Node/Vite/React versions,
cache state, command line, and measured milestones for gateway health,
dashboard readiness, Vite readiness when dev mode reports it, and GUI URL
readiness. Browser launch and first usable paint are separate evidence points;
do not infer them from Vite's `ready in` line or from gateway health alone.

To measure the first usable GUI interaction, enable browser automation:

```bash
bun run profile:startup -- --mode dev --cwd . --measure-first-paint --no-open
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
- `@kilnai/gateway-contracts` is excluded from Vite `optimizeDeps` so the dev
  server resolves the linked workspace package directly instead of serving a
  stale pre-bundled contract after a workspace rebuild.
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
