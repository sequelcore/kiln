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

## Consumer Scoping Rules

Every operator consumer must treat `kilnSessionId` as the routing key for live
operational state.

- GUI activity panels, changed files, approvals, diffs, and tool logs are
  projections of the visible session timeline.
- TUI sidebars and activity state are projections of the active runtime
  session/turn.
- CLI transcript persistence stores canonical event identity and may project
  the same facts into text output.
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
