# Session Model

Kiln session identity is provider-agnostic.

A Kiln session is the control-plane conversation/work unit that owns transcript
continuity, approvals, tool evidence, cost accounting, runtime continuity,
changed files, and replay/audit metadata. A provider is only the execution route
selected for a turn.

Completed turns may carry a canonical `context_usage_observed` event. Its
provider/model/turn identity belongs to the request that produced the evidence;
replay retains that observation as historical rather than recomputing it. The
full authority contract is [Context Usage Projection](../context/context-usage-projection.md).

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
  -> owns continuation target
```

## Resume Semantics

Resume starts from a canonical Kiln session ID.

When an operator opens a prior session in an interactive chat surface, Kiln
loads that canonical transcript as the active conversation. The next non-empty
user turn continues that selected session. Fresh work is explicit: New Session,
clear/new-session commands, or CLI fresh-session flags detach the visible
conversation before admitting the next turn.

When a turn runs, Kiln may additionally pass a provider-native resume/thread ID
only if the selected provider has matching provider-thread metadata for that
Kiln session. If the selected provider has never participated in that session,
Kiln still resumes the canonical conversation through its own
transcript/context continuity, but it does not fabricate a provider-native
thread.

Provider switching therefore changes the next execution route; it does not
switch the operator into a different session namespace.

Runtime cache-first continuity follows the same namespace boundary. Thread,
handoff, context, and tool-summary artifacts are keyed by the logical session
identity in addition to app, tenant, channel, provider, and task shape as
applicable. A fresh session with a similar prompt cannot inherit another
session's goal, work-item, attempt, invocation, approval, or execution state.
Cached support within a resumed session is explicitly non-authoritative and
must be reconciled with canonical transcript, tools, and resources. Historical
cross-session feedback is limited to aggregate continuity measurements; it does
not carry raw tool outcomes into the model context.

### Resume Target Persistence

Session history and resume intent are separate persistence concerns.

The bound private project's `sessions/sessions.jsonl` is the canonical session
index for completed Kiln session records. It is keyed by Kiln session id: later
turns for the same session update the canonical row instead of creating
duplicate rows in operator history. Clear/new-session operations must not
delete the index and must not treat it as a disposable "last session" pointer.

The bound private project's `sessions/continuation-targets.json` is an advisory
operator cursor. Surfaces may use it to display continuation hints or support
explicit continuation commands, but they must not
load it as hidden active continuation state at startup.
Provider-specific cursors may record the last session used by a provider, but
they are still references to canonical Kiln sessions, not provider-owned
session history.

Clear/new-session operations clear visible resume intent and detach live
runtime state. They do not delete session history, transcript metadata, event
history, or provider-thread metadata. Selecting a prior session in a chat
surface makes that session the visible continuation target; persisted cursors
remain advisory and must not auto-select hidden startup continuation state.

When an operator surface resumes a persisted session whose live runtime object
has expired or is absent, it must rehydrate the runtime conversation from the
canonical transcript before admitting the next turn. Visual transcript loading
and model-visible conversational continuity are the same product contract; a
surface may not show old messages while sending the next turn to an empty
runtime session.

## Surface Semantics

All operator surfaces share the same model:

- GUI session history lists Kiln sessions, not provider-specific sessions.
- GUI session selection loads the selected transcript into the main chat as the
  active continuation target. Sending a non-empty prompt continues that session.
- TUI session history lists Kiln sessions, not provider-specific sessions.
- CLI persistence stores provider-native IDs as nested provider-thread
  metadata.
- Clear/new-session operations detach the active runtime conversation. They do
  not delete stored session history.
- Telemetry is attributed per provider/turn inside the session, while the
  session itself remains canonical.

### Shared History Projection

Operator surfaces consume one `OperatorSessionSummary` contract from
`@kilnai/gateway-contracts`. It is a read projection over canonical transcript,
ledger, and runtime-event evidence; it is not a GUI-owned session model. The
projection carries the Kiln session ID, title and optional summary, tags,
providers used, latest evidenced provider/model route, latest terminal turn
outcome, update time, accumulated cost, and an optional Runtime-owned live
lifecycle observation. `liveLifecycle` is process-local evidence with an
explicit monotonic revision, `observedAt`, and `validUntil`; consumers resolve
an observation after `validUntil` to `unknown` rather than retaining a stale
`running` label. `running` means at least one exact Runtime turn is unsettled,
while `idle` means none are unsettled at observation time. It is not serialized
as durable Session state, so restart begins with fresh `idle` evidence rather
than inferring activity from historical events.

Route identity is atomic evidence. A provider from one observation must never
be combined with a model from an older observation, and a surface must not
substitute its current provider or infer a model from tags or token usage.
Ledger cost is accumulated session cost and takes precedence over transcript
cost; the two values are never summed.

HTTP consumers load history from the dedicated `GET /operator/api/sessions`
resource. The GUI dashboard does not duplicate session history. Local CLI GUI,
App Gateway GUI, and TUI adapters all project their persistence or runtime
evidence into the same contract. Until sequenced history invalidation exists,
GUI consumers poll this resource independently of locally initiated turns. A
loaded history list does not select or
continue a session: selection and continuation require an explicit operator
action. If the selected session disappears from a refreshed list, surfaces
must clear its loaded detail rather than display orphaned transcript state.

## Terminal Turn Outcome

Runtime is the single owner of terminal turn outcome. Every execution session,
including direct providers and native Claude, Codex, and OpenCode harnesses,
emits exactly one terminal `outcome`: `completed`, `failed`, `paused`, or
`cancelled`. Intermediate error and failed-tool events remain audit evidence;
they do not permanently fail a turn that the runtime later recovers and closes
successfully.

CLI, TUI, GUI, replay, and managed-child adapters persist and present that
terminal value without re-deriving it from tool names, event order, or a local
`isError` boolean. A missing terminal outcome fails closed at the surface
boundary. Session lifecycle remains separate: a host stream can finish cleanly
while its canonical turn outcome is failed or paused.

Every terminal transport carries the same value. In particular, WebSocket
`done` frames require `outcome`; gateway adapters must not reduce a runtime
result to content and token counts. Operator surfaces present `completed` as
success, `failed` as error, `paused` as an action-required warning, and
`cancelled` as a neutral cancellation. Reaching the end of a stream is not
evidence that the turn succeeded.

## Operator Session Events

Runtime activity is part of the session model. Tools, approvals, changed files,
diff previews, cost updates, provider routing, assistant deltas, continuity
decisions, governed work items, and turn completion are emitted as canonical
operator session events.

`@kilnai/gateway-contracts` owns canonical event reduction as well as event
presentation. The reducer deduplicates by immutable `eventId`, orders by
`sequence` and `eventId`, and projects canonical approval IDs, scoped tool-call
identity, file changes, cost and token evidence, routes, continuity, goals,
work items, and terminal outcome. Incremental live delivery and batch replay
consume that same reducer. GUI Zustand and TUI state are replaceable view
caches: they translate the shared projection into surface layout and
interaction state but do not own event meaning or execution truth.

Approvals have their own canonical identity. `approval_requested` creates an
`approvalId`; `approval_resolved` and all operator response frames must carry
that same `approvalId`. `kilnSessionId` and `sessionId` remain routing,
display, and audit context only. They must not be used as the approval decision
key because a session can contain multiple approval gates across turns and
surfaces.

Assistant text does not create approval state. When a response says work needs
approval but no `approval_requested` event exists in the session, surfaces must
treat it as a blocked explanation, not as a pending approval. Runtime prompts
and governed context must steer agents to request real approval-capable tools or
report the missing authority route.

Plan approval is a specialized workflow approval. `plan_approved` records the
approved `planId`, approval identity, immutable plan hash, approval timestamp,
and `plan -> execute` transition. Execution-mode transition acknowledgements
project the same identifiers so GUI, TUI, and CLI-backed consumers can render
the same decision instead of trusting surface-local Plan button state.

Managed child invocations use the same event stream. The
`agent_invocation_requested`, `agent_invocation_started`,
`agent_invocation_completed`, `agent_invocation_failed`, and
`agent_invocation_cancelled` events carry canonical child identity plus the
admission-time `ManagedAgentCapabilitySnapshot` when the invocation was
admitted. Replay and audit must use that snapshot rather than recomputing route
health, provider proof, adapter descriptor, resource-plane availability, or
child identity from mutable runtime state.

Governed work items also use the same event stream. `work_item.update` and
standalone `work_item.complete` emit typed tool metadata that the runtime ledger
projects into `work_item_updated` events. Goal-bound execution results also
carry the latest goal snapshot and project canonical `goal.*` events. Operator
surfaces render work-item status,
expected evidence, provided evidence, verification gates, and blocked closeout
state from those events. The live resource snapshot
`kiln://session/work-items` is a model-readable view over the same session
state; it is not a second source of truth.

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

Conversation tool activity uses trace framing, not panel framing. A routine
tool call is one compact, unframed disclosure row with a semantic action title,
state icon, bounded summary, and optional timestamp. Consecutive routine calls
may share one unframed disclosure group. Cards and stronger visual boundaries
are reserved for decisions, approvals, workflow state, failures that require
attention, and rich evidence after the operator explicitly opens details. The
technical tool identifier remains available in canonical details, but it must
not replace the semantic action title on conversation surfaces.

Surface consumers must decide visibility from the canonical
`OperatorSessionEvent` presentation. They must not call
`presentOperatorEventPayload` again with reduced timeline or view-model details;
doing so creates a second authority and can change surface routing. Timeline
entries provide ordering and display data, while session events provide the
canonical visibility decision.

Tool completion presentation is typed. `tool_call_completed` projections may
include `toolPresentation`, a shared `@kilnai/gateway-contracts` view model with
an `outputKind`, title, summary, fields, bounded preview, resource links, and
raw-output availability. Consumers must render that presentation before falling
back to generic detail rows.

`toolPresentation.presentationIntent` is the only canonical path for agent or
tool authored rich display requests. It is a validated, closed semantic contract
defined in `@kilnai/gateway-contracts`, not a GUI component request. The runtime
and gateway may store the raw tool result, but normal surfaces consume only the
validated intent. Invalid intents fail closed to the existing typed fallback and
must not block access to the raw audit payload.

Initial presentation-intent kinds are `summary`, `comparison_table`,
`risk_matrix`, `timeline`, `resource_bundle`, and `diagnostic_report`. Surfaces
that cannot render a rich intent must use the shared deterministic text
formatter instead of raw JSON. No intent may carry HTML, CSS, JavaScript, JSX,
SVG, component names, tool authority, memory authority, filesystem authority, or
network authority.

Canonical tool-result output kinds:

- `diff` for `patch`, `edit`, `write`, and file-result metadata with
  `diffPreview`. Inline views show file/change counts and bounded hunks; full
  diffs belong in the inspector or linked resource.
- `resource_links` for high-volume outputs such as `read_many` when full output
  is stored behind `kiln://artifacts/...`. Inline views show counts and links,
  not the raw packet.
- Interactive screenshots are also resource-linked: transcripts keep the
  `kiln://artifacts/.../content` URI and presentation metadata, while the image
  payload lives in the session artifact store.
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

## Conversation Turn Projection

Transcript layout is also shared projection, not a GUI-only rendering rule.

`@kilnai/gateway-contracts` owns the conversation-turn projection used to place
assistant messages, tool activity, and operator events into a stable transcript
sequence. Consumers choose whether tool events remain grouped with their owning
assistant turn or render as standalone operational rows; both modes consume the
same projection and canonical identities. A surface must not infer grouping,
execution identity, or completion from tool name or presentation order.

One tool execution is correlated by the composite identity
`(toolCallScopeId, toolCallId)` from start through success, failure,
interruption, replay, and restore. Provider call IDs are only unique inside the
model response that produced them. The runtime owns `toolCallScopeId` creation
at that response boundary and every downstream event, persistence adapter, and
projection must preserve it unchanged.

`eventId` identifies each immutable session event and deduplicates repeated
persisted or live delivery; it is not a tool-call correlation fallback.
Persistence and replay reject tool lifecycle records without either part of the
composite identity. They must not infer identity from event order, tool name,
turn position, or an event ID. Transcripts written before this contract are
incompatible input rather than candidates for compatibility repair. Restored
and live projections must therefore produce the same row identity, ordering,
and terminal evidence without manufacturing repair events.

Completed tool-start rows may collapse into their matching completion event so
normal transcript surfaces show the final evidence instead of duplicated
progress chrome. Raw payloads, debug envelopes, and full event objects remain
available only to inspector/raw surfaces.

This projection applies to GUI and TUI. The GUI is the first rich consumer, but
it must not become the reference implementation for transcript semantics.

## Execution Mode

Execution mode is canonical session-turn state, not a GUI-specific toggle.

Gateway-backed operator consumers send `executionMode: "plan" | "execute"` on
message frames. They request mode changes with `execution_mode_transition` and
receive `execution_mode_transitioned` acknowledgements. Local names such as
`planMode` may exist inside a renderer for button or badge state, but they must
not define a new wire contract.

The execution-mode contract is intentionally modeled as a named mode instead of
a boolean so future governed modes can add their own tool surface, rules,
permissions, events, and presentation without introducing new consumer-specific
flags. The only supported modes today are `execute` and `plan`.

In plan mode the runtime narrows the tool surface to read-only capabilities and
runtime-owned planning tools (`submit_specification`, `record_clarification`,
`submit_plan`). `submit_plan` is a typed artifact contract linked to a source
specification and clarification records, not free-form text. Its successful
result, resource projection, and canonical `plan_submitted` event carry the
full governed artifact, including each proposed work item, so a replayed
session can recover the same structured fallback plan without provider-native
state. Successful planning-tool calls append canonical
`specification_submitted`, `clarification_recorded`, `plan_submitted`, and
`plan_analysis_reported` events to the session stream. Analysis events carry
the report status plus replayable finding details, including lifecycle status,
so approval and reconnecting surfaces can distinguish open, blocked, closed,
and superseded findings without consulting provider-native state. Execution
approval requires a latest analysis report for the selected plan and fails
closed while that report has blocking findings.
Clarification records are not parallel notes: for recognized affected sections,
runtime merges the answer back into the canonical specification, recomputes
validation status, rejects contradictory repeated answers, and keeps planning
closed while required fields remain unresolved.
Presentation of those events is owned by `@kilnai/gateway-contracts` so GUI,
TUI, CLI, IDE, SDK, and remote operator surfaces project the same planning
evidence.

## Consumer Scoping Rules

Every operator consumer must treat `kilnSessionId` as the routing key for live
operational state.

- GUI activity panels, changed files, approvals, diffs, and tool logs are
  projections of the visible session timeline.
- TUI sidebars and activity state are projections of the active runtime
  session/turn.
- Approval decision actions must target the pending `approvalId`, never a
  session-level fallback.
- CLI transcript persistence stores canonical event identity and may project
  the same facts into text output.
- GUI, TUI, CLI, IDE, SDK, and remote operator surfaces must use the shared
  presentation surface targets before deciding whether an event appears inline,
  in an activity/audit view, or only inside an inspector.
- Late frames from an old or different session must not mutate the visible
  session's operational state.
- Session selection must clear or replace visible operational projections before
  the selected transcript finishes loading.
- Activity frames without session identity are not valid for runtime activity
  contracts.

## Transcript Persistence

The session ledger is not the transcript source of truth.

GUI history must list only sessions that have canonical transcript metadata
under the bound private project's
`sessions/<encoded-session-id>/meta.json`. This is intentional:
ledger-only rows are not loadable conversations and must not appear in the
operator history as compatibility fallbacks.

The shared operator Runtime commits each completed or failed canonical turn-event
batch through one durable persistence port before reporting the turn as committed.
The CLI adapter for that port is the sole projection owner for local GUI and TUI:
it appends the canonical transcript, derives `meta.json` from the complete
idempotent event stream, and updates the completed-session index without changing
the operator's explicit continuation target. Surfaces may stream or render the
same events, but they do not own a second persistence path.

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
- Continuation intent is visible per-surface operator state; session history is
  append-only audit/history state. Persisted cursors must not become hidden
  startup continuation targets.
- Clear/new-session operations must not delete persisted sessions.
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
- selecting a previous session loads its transcript into chat without sending
  hidden resume state, and explicit resume continues that selected runtime
  session
- provider-native resume is used only when matching provider-thread metadata
  exists
- cost/token telemetry remains attributed by provider inside the same Kiln
  session
- switching sessions does not leave stale tool activity, approvals, changed
  files, or diff previews visible from the previous session
- late events from a previous session are ignored or parked outside the visible
  session projection
