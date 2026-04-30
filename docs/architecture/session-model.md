# Session Model

Kiln session identity is provider-agnostic.

A Kiln session is the control-plane conversation/work unit that owns transcript
continuity, approvals, tool evidence, cost accounting, runtime continuity,
changed files, and replay/audit metadata. A provider is only the execution route
selected for a turn.

## Canonical Rule

Provider, model, billing mode, and provider-native thread IDs are execution
metadata. They must not define the Kiln session identity.

Correct shape:

```text
Kiln session
  -> turns
  -> providers used
  -> last provider/model
  -> provider threads:
       codex -> native thread/session id
       opencode -> native thread/session id
       claude-code -> native thread/session id
  -> transcript, cost, approvals, tools, files, replay
```

Incorrect shape:

```text
provider session
  -> owns Kiln transcript
  -> owns GUI/TUI history
  -> owns resume target
```

## Resume Semantics

Resume starts from a canonical Kiln session ID.

When an operator selects a prior session, Kiln makes that canonical session ID
the active runtime conversation. The next user turn is processed against that
selected Kiln session, not against whatever live provider/session happened to
be active before the sidebar selection.

When a turn runs, Kiln may additionally pass a provider-native resume/thread ID
only if the selected provider has matching provider-thread metadata for that
Kiln session. If the selected provider has never participated in that session,
Kiln still resumes the canonical conversation through its own
transcript/context continuity, but it does not fabricate a provider-native
thread.

Provider switching therefore changes the next execution route; it does not
switch the operator into a different session namespace.

## Surface Semantics

All operator surfaces share the same model:

- GUI session history lists Kiln sessions, not provider-specific sessions.
- GUI session selection loads the selected transcript into the main chat and
  makes that session the active continuation target automatically.
- TUI session history lists Kiln sessions, not provider-specific sessions.
- CLI persistence stores provider-native IDs as nested provider-thread
  metadata.
- Clear/new-session operations detach the active runtime conversation. They do
  not delete stored session history.
- Telemetry is attributed per provider/turn inside the session, while the
  session itself remains canonical.

## Operator Session Events

Runtime activity is part of the session model. Tools, approvals, changed files,
diff previews, cost updates, provider routing, assistant deltas, continuity
decisions, and turn completion are emitted as canonical operator session
events.

The shared transport contract is:

```text
session_event
  -> event.eventId
  -> event.kilnSessionId
  -> event.sequence
  -> event.timestamp
  -> event.kind
  -> event.turnId? 
  -> event.source?
  -> event.payload
```

Live progress frames use the same identity boundary:

```text
activity_phase
  -> kilnSessionId
  -> turnId?
  -> phase
  -> toolName?
  -> details?
```

`activity_phase` is only a lightweight progress projection. It must never be
the source of truth for tool evidence, approvals, changed files, diffs, or cost.
Those facts belong in `session_event` history and are projected by each
operator surface.

This contract applies to GUI, TUI, and CLI-backed operator flows. A consumer may
render different UI for the same event stream, but it must not invent a
surface-local session namespace.

Operator presentation is a shared contract concern, not a surface-local fallback.
Consumers may keep `event.payload` for derivation and diagnostics, but normal
operator UI must render the shared presentation projection from
`@kilnai/gateway-contracts` instead of serializing payloads as raw JSON. This
keeps GUI and TUI minimal while preserving the canonical structured evidence.

Shared presentation also owns operator visibility. Each presented event declares
the surfaces it targets:

- `conversation_inline` for live comprehension in the main transcript.
- `activity_panel` for audit timelines, side panels, and terminal sidebars.
- `inspector` for expandable detail, resource viewers, and diagnostics.

Tool starts, tool completions, approval requests/resolutions, agent invocation
state, and recorded errors are inline conversation events because they explain
why the operator is waiting and what authority or external action is involved.
Provider routing, continuity decisions, cost updates, changed files, and turn
completion remain activity/inspector events unless a future product decision
explicitly promotes them. Large payloads must be summarized inline and linked to
resources or inspector details; raw tool JSON must not be pasted into the
conversation surface.

Tool completion presentation is typed. `tool_call_completed` projections may
include `toolPresentation`, a shared `@kilnai/gateway-contracts` view model with
an `outputKind`, title, summary, fields, bounded preview, resource links, and
raw-output availability. Consumers must render that presentation before falling
back to generic detail rows.

Canonical tool-result output kinds:

- `diff` for `patch`, `edit`, `write`, and file-result metadata with
  `diffPreview`. Inline views show file/change counts and bounded hunks; full
  diffs belong in the inspector or linked resource.
- `resource_links` for high-volume outputs such as `read_many` when full output
  is stored behind `kiln://artifacts/...`. Inline views show counts and links,
  not the raw packet.
- `tree` for directory tree results. Inline views show entry counts and bounded
  tree previews.
- `command` for `bash` and `git`. Inline views show command, cwd, exit/timeout,
  elapsed time, and bounded stdout/stderr preview.
- `markdown`, `text`, `code`, `table`, `image`, `form`, and `empty` for
  remaining typed previews as tools become more semantic.

This is a presentation projection over canonical evidence, not a replacement
for `event.payload`. The payload remains the audit source, while normal
operator UI uses the typed projection so GUI, TUI, CLI, IDE, SDK, and remote
surfaces do not duplicate ad hoc JSON parsing rules.

## Consumer Scoping Rules

Every operator consumer must treat `kilnSessionId` as the routing key for live
operational state.

- GUI activity panels, changed files, approvals, diffs, and tool logs are
  projections of the visible session timeline.
- TUI sidebars and activity state are projections of the active runtime
  session/turn.
- CLI transcript persistence stores canonical event identity and may project
  the same facts into text output.
- GUI, TUI, CLI, IDE, SDK, and remote operator surfaces must use the shared
  presentation surface targets before deciding whether an event appears inline,
  in an activity/audit view, or only inside an inspector.
- Late frames from an old or different session must not mutate the visible
  session's operational state.
- Session selection must clear or replace visible operational projections before
  the selected transcript finishes loading.
- Legacy activity frames without session identity are not valid for new runtime
  activity contracts.

## Transcript Persistence

The session ledger is not the transcript source of truth.

GUI history must list only sessions that have canonical transcript metadata
under `.kiln/sessions/<encoded-session-id>/meta.json`. This is intentional:
ledger-only rows are not loadable conversations and must not appear in the
operator history as compatibility fallbacks.

On Windows, canonical session IDs can contain characters such as `:` that are
invalid in directory names. Kiln therefore encodes the session ID only at the
filesystem path boundary. The persisted metadata still stores the original
canonical `kilnSessionId`.

## Invariants

- No UI surface may key session history by active provider.
- No persisted top-level field may treat a provider-native ID as the Kiln
  session ID.
- No GUI history row may be shown unless it can load canonical transcript
  metadata.
- Provider-native thread metadata is optional and scoped to the provider that
  produced it.
- Provider/model selection is next-turn routing state.
- Transcript, approvals, tool evidence, changed files, and replay belong to the
  Kiln session.
- Runtime activity frames that affect visible operator state must include the
  owning `kilnSessionId`.
- Turn-scoped live activity should include `turnId` when the runtime has one.
- No consumer may apply a tool, approval, file, diff, or cost update to the
  currently visible session unless the event belongs to that session.

## Live Validation

A valid live test proves:

- a session can include turns from multiple providers
- switching providers does not hide or replace the session history
- selecting a previous session loads its transcript into chat, and sending a
  new message continues that selected runtime session
- provider-native resume is used only when matching provider-thread metadata
  exists
- cost/token telemetry remains attributed by provider inside the same Kiln
  session
- switching sessions does not leave stale tool activity, approvals, changed
  files, or diff previews visible from the previous session
- late events from a previous session are ignored or parked outside the visible
  session projection
