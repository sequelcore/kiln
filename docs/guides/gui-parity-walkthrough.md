# GUI Parity Walkthrough

## Purpose

This guide is the manual sign-off script for GUI Phase 1 parity. It satisfies
the manual validation path for the canonical parity status in
`docs/guides/gui-parity.md`.

Use this guide when recording operator-facing proof that `kiln gui` satisfies
the completed Phase 1 parity capabilities.

## Recording metadata

Fill these fields before or immediately after recording:

- Date:
- Operator:
- Commit SHA:
- OS:
- Browser host:
- Evidence artifact:
- Notes:

## Preconditions

Before recording:

1. Use the current `main` build or the exact release-candidate branch head.
2. Confirm `docs/guides/gui-parity.md` still reflects the intended GUI/TUI
   policy.
3. Confirm automated parity coverage is green:
   `bun x playwright test` from `packages/gui/`
4. Confirm shared verification is green:
   `bun run test`, `bun run typecheck`, and `bun run build`
5. Launch the app through the real operator entry point:
   `kiln gui`
6. Record the full screen or app window with enough resolution that provider
   labels, telemetry values, and transcript headers are readable.

## Walkthrough script

Record the categories in this order. Keep the recording continuous if
possible.

### 1. Session lifecycle

Show:

- Launch from `kiln gui` into a ready GUI with no blank-screen failure.
- A new user turn from the composer and a streamed assistant response.
- `New Session` from the visible control, proving the visible chat is reset
  without deleting stored history.
- Selection of a previous Kiln session from history, proving its transcript
  loads into the main chat.
- A new turn after selecting that prior session, proving the selected runtime
  session is continued rather than the previous live session.
- Plan mode enabled, visible in the status surface, then disabled back to
  normal execution mode.
- Clean shutdown by closing the managed GUI window.

Pass condition:

- The gateway is ready on launch, streaming works, `New Session` starts a clean
  visible conversation without deleting history, session selection loads and
  continues the selected conversation, plan mode is visible and reversible, and
  close exits without leaving the GUI surface hanging.

### 2. Provider and model selection

Show:

- Provider picker with all grouped providers visible.
- Provider switch acknowledgement in the GUI status/header.
- Model selection for at least one provider with visible model label.
- Reasoning effort control visible beside model selection for a model that
  advertises supported reasoning levels, such as Codex OAuth.
- One turn submitted with a non-default reasoning effort.
- A turn whose route status changes to `responding`.
- The final assistant message header showing the routed provider and model.
- A single session that contains turns from at least two providers without the
  session disappearing from history when the active provider changes.

Pass condition:

- Provider choice, model choice, route status, and final assistant route label
  are all visible and coherent.
- Reasoning effort is discoverability-driven: visible when supported by the
  active model, hidden when unsupported, and applied to the next turn only.
- Provider switching changes the next execution route only; it does not create
  or reveal a provider-owned session namespace.

### 3. Cost and telemetry

Show:

- Session cost surface.
- Per-provider attribution after using at least two providers in one session.
- Turn and token counters after one or more completed turns.
- Field telemetry block with status, dominant regions, saturation, and entropy.
- Resume/runtime continuity card with the full 7-field block.
- Changed-files list after a turn that emits file-change activity.
- Approval queue with approve or reject action.
- Tool call log with transcript evidence and occurrence counts.
- Activity phase indicator while a turn is running.

Pass condition:

- Telemetry is not decorative. It must update from real session activity and
  remain readable while operating the GUI.
- Cost/token attribution is per provider inside the same Kiln session.

### 4. Input and keyboard ergonomics

Show:

- Multi-line compose behavior with wrapped text.
- Clipboard paste with normalized line endings.
- Slash command palette opened by `/` in an empty composer.
- Global command palette opened by `Ctrl/Cmd+K`.
- Enter submitting while idle.
- Session selection loading the selected conversation directly into the main
  chat; no sidebar-only preview or separate resume confirmation should be
  required.
- Arrow-key navigation through the provider picker, command palette, and
  session list.

Pass condition:

- The GUI supports the keyboard-first operator path without requiring active
  TUI development.
- Session history navigation operates over Kiln sessions, not the active
  provider's private history.

### 5. Theming and visual behavior

Show:

- Theme switcher from both settings and the command palette.
- `kiln-dark`, `kiln-light`, and `system-follow`.
- Distinct user, assistant, tool, and error message treatment.
- Markdown output with headings, inline code, and fenced code blocks.
- Auto-scroll behavior at the bottom, then stability when manually scrolled up.
- Narrow-window behavior where the session rail collapses into a drawer.

Pass condition:

- Theme persistence, message role distinction, markdown rendering, transcript
  scrolling, and responsive drawer behavior all match the intended GUI
  operator surface.

### 6. Workspace and file previews

Show:

- Workspace rail mode opened from the left rail.
- Root tree rendered from the active working directory.
- A top-level directory marked with Git status because a nested file changed.
- Expanding that directory without losing the parent marker.
- Opening a JSON file into the main layout as a document tab beside Chat.
- Opening a code file and showing line numbers plus syntax highlighting.
- Opening a Markdown file and showing safe rendered Markdown.
- Returning to the Chat tab without closing the file tabs.

Pass condition:

- Workspace is a governed read-only navigator, not a sidebar metadata card.
- Git markers propagate to ancestor directories from the root tree.
- File previews stay in main-layout document tabs and do not create session
  events, approval requests, changed-file entries, provider tool calls, or
  working-tree mutations.

### 7. Gateway transport behavior

Show:

- GUI connected to the local gateway and able to complete a turn.
- A reconnect-capable flow if practical during recording, or at minimum the
  stable session behavior after a transient reconnect drill.
- A visible error state if the gateway is intentionally made unavailable before
  launch.

Pass condition:

- The GUI clearly depends on the local gateway transport, handles readiness,
  and preserves continuity instead of failing silently.

### 8. CLI integration and invocation

Show:

- `kiln gui --provider <name>`
- `kiln gui --theme <name>`
- `kiln gui --plan`
- `kiln gui --cwd <path>`
- `kiln gui --port <number>` if a non-default port is used for the walkthrough
- The visible domain label and working directory in the GUI status surface.
- Closing the managed window and the CLI exiting cleanly.

Pass condition:

- `kiln gui` is the real operator entry point, not a secondary dev-only path.

## Sign-off

Mark complete only when all conditions below are true:

- The recording covers categories 1 through 7 in a way another engineer can
  verify later.
- The recorded build matches the commit listed in the metadata section.
- No capability failure is hand-waved as "already covered by tests" if it is
  part of the manual operator flow.
- Any deviation from the walkthrough is documented in the recording notes.

## Related docs

- `docs/guides/gui.md`
- `docs/architecture/session-model.md`
- `docs/guides/gui-parity.md`
- `docs/guides/tui-maintenance.md`
