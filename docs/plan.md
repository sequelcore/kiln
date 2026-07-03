# Tool Execution Continuity, Structured Output Visualizers, and Long-Thread Navigation

Status: Complete
Updated: 2026-07-03
Roadmap owner: `docs/roadmap/02-public-release-ui-debt.md`

## Objective

Make long-running GUI conversations trustworthy and navigable. Tool execution
must remain visible from invocation through completion, structured results must
render as bounded artifacts, and operators must be able to move through a long
thread without losing the live edge or their reading position.

## Non-Goals

- Do not change runtime tool semantics, authority, approval, or provider routing.
- Do not infer tool completion or identity from presentation order or tool name.
- Do not replace the canonical transcript/event contract with GUI-local state.
- Do not adopt a visualizer, animation, or scroller dependency without a product
  behavior and evidence gate.
- Do not redesign the complete workbench, composer, or inspector.
- Do not claim implementation complete from static mocks or component tests alone.

## Research and Evidence Basis

Slice 0 is complete as research and planning evidence only.

- Codex captures show tool usage embedded in assistant bubbles, active execution
  remaining visible while the response streams, completed output attached to the
  same execution identity, and a compact rail for moving among meaningful thread
  positions.
- The current GUI can lose visible activity when transient events are replaced or
  regrouped, and tool usage inside prose bubbles is harder to scan than a stable
  execution row.
- shadcn MessageScroller hooks are a behavioral reference for live-edge following,
  reader-intent preservation, and return-to-latest controls. They are not a new
  dependency requirement; Kiln keeps its existing official headless scroller
  integration unless evidence proves a gap.
- shadcn border beam examples are a visual reference for restrained active-state
  motion. They are not a dependency. Any equivalent effect must be local,
  compositor-friendly, non-semantic, and disabled under reduced motion.
- Existing JSON and static tree renderers prove the initial structured-output
  path, but do not establish continuity, interactive exploration, or long-thread
  navigation as complete.

## Decisions

1. `toolCallId` is the runtime identity for one tool execution across requested,
   active, succeeded, failed, interrupted, replayed, and restored states.
2. Runtime events remain canonical. The GUI may derive presentation state but may
   not manufacture lifecycle transitions or merge executions by tool name.
3. Active execution remains represented after surrounding assistant content
   changes; completion updates the same execution row instead of replacing it
   with an unrelated result card.
4. Active emphasis uses status, text, and iconography first. A subtle beam may
   supplement the state, never encode it alone, and is static when reduced motion
   is requested.
5. Structured output selection is contract-driven. Unknown or invalid payloads
   retain a readable raw fallback.
6. Visualizers remain bounded by the transcript column. Internal scrolling or
   vertical expansion must not widen the conversation layout.
7. The navigation rail indexes durable semantic anchors, not arbitrary pixel
   offsets. It preserves reader intent and offers an explicit return to latest.
8. Restored sessions must reconstruct the same execution identity, output
   classification, anchor order, and terminal state as the live session.

## Ownership

| Concern | Canonical owner | GUI responsibility |
| --- | --- | --- |
| Tool lifecycle and `toolCallId` | Runtime and shared event contracts | Project lifecycle into stable rows |
| Output presentation intent | Gateway/shared presentation contracts | Select and bound the renderer |
| Transcript following | Existing message-scroller integration | Preserve reader intent and live edge |
| Long-thread anchors | Shared transcript projection | Render rail, focus, and navigation |
| Motion preference | Browser/OS preference and GUI tokens | Disable active beam motion |
| Restore/replay fidelity | Runtime session persistence | Rehydrate without local identity repair |

## Delivery Slices

### Slice 1 - Tool Lifecycle Contract and Projection

Status: Complete

- Add failing contract and projection tests for lifecycle transitions keyed by
  `toolCallId`, including interleaved calls, failures, interruption, replay, and
  restore.
- Define the minimum canonical fields needed by every surface without adding a
  GUI-only lifecycle owner.
- Prove that activity cannot disappear because prose, grouping, or result events
  arrive later.

Gate: focused contract/runtime tests, replay fixture, typecheck, and contract
review pass before GUI lifecycle work begins.

Slice 1 evidence:

- Runtime event contracts now require `toolCallId` on `tool_called` and
  `tool_result` events.
- Runtime orchestration emits the provider/native tool call id through start,
  success, failure, cache-hit, denied, rate-limited, invalid-input, and
  blocked-result paths.
- Dev-tool execution preserves upstream tool call identity when a provider or
  harness supplies it, and generates a local identity only for internal calls
  without one.
- Dev-tool authorization denial and approval-required failures now emit a
  terminal `tool_result` before rethrowing, so native/dev-tool activity does not
  remain permanently active in operator surfaces.
- Dangerous-command blocks now emit terminal output and policy metadata on the
  same correlated `tool_result`.
- Canonical session projection fails fast when runtime tool events are missing
  `toolCallId`, so surfaces cannot silently rebuild identity from order or tool
  name.
- Canonical session projection no longer correlates results through FIFO queues
  keyed by tool name; interleaved same-name tool calls complete under their own
  originating `toolCallId`.
- Replay coverage proves persisted runtime events keep their original
  `toolCallId` through canonical projection.
- Work-item lifecycle projection preserves the same tool execution identity as
  the parent tool result.
- Focused runtime tests, `@kilnai/core` tests (272 files, 3443 tests),
  `@kilnai/runtime` tests (185 files, 2476 tests, 5 skipped live files),
  workspace typecheck, and `git diff --check` passed on 2026-07-02 before
  moving to Slice 2.

### Slice 2 - Continuous Tool Execution Rows

Status: Complete

- Render tool usage outside prose bubbles as stable transcript rows tied to the
  canonical lifecycle projection.
- Keep active, completed, failed, and interrupted states visible and accessible.
- Add the restrained active beam with a static reduced-motion treatment.

Gate: component tests cover concurrent and terminal states; browser validation
proves no disappearance, overlap, width growth, or motion-only semantics.

Slice 2 evidence:

- Shared transcript projection now supports `anchorToolEventsToAssistant: false`,
  preserving the existing default for consumers that still need assistant-owned
  grouping while allowing the GUI transcript to render tool events as first-class
  rows.
- GUI transcript rendering opts into standalone tool rows and no longer injects
  tool stacks into assistant prose bubbles or live activity bubbles.
- Completed starts collapse into their terminal execution row by canonical
  `toolCallId`; still-running calls remain visible as running rows.
- Running rows expose `data-state="running"`, status text, iconography, shimmer
  text, and a local active beam. The beam is supplemental and disables animation
  under `prefers-reduced-motion`.
- Focused gateway projection tests, focused GUI transcript tests, full
  `@kilnai/gui` tests, GUI build, GUI E2E, and workspace typecheck passed on
  2026-07-02 before moving to Slice 3.

### Slice 3 - Structured Output Classification

- Normalize JSON, source, markdown, tree, diff, table, image, resource bundle,
  unknown, and invalid payload intents before renderer selection.
- Preserve raw evidence and explicit fallback reasons.
- Keep classification provider-neutral and reusable by GUI, CLI, and TUI.
- Shared `ToolResultPresentation` now carries provider-neutral classification
  evidence with source, reason, confidence, and fallback reason where applicable.
- Valid presentation intents select table/resource-link render families from
  contract evidence; malformed intents fall back to readable text with recorded
  validation failure details instead of leaking raw envelopes.
- Focused operator-event presentation tests, full gateway-contract tests,
  focused GUI transcript tests, focused TUI gateway-session tests, and workspace
  typecheck passed on 2026-07-02 before moving to Slice 4.

Gate: contract fixtures cover each intent, malformed payloads, and unknown types;
cross-surface review confirms no GUI-owned semantic fork.

### Slice 4 - Bounded Output Visualizers

- Retain the maintained JSON inspector and static bounded tree renderer.
- Add or refine source, markdown, diff, table, image, and resource-bundle views
  only where the shared intent supplies sufficient evidence.
- Adopt an interactive tree/file dependency only if navigation, virtualization,
  keyboard traversal, lazy loading, or file actions are approved requirements.
- Adopted `border-beam` for active non-nested tool rows after validating the
  package is MIT-licensed, React-compatible, and production-build safe. The
  component degrades to a static bounded wrapper in environments without
  `window.matchMedia`; accessible state remains text, icon, and `data-state`.
- Structured output details now expose explicit bounded containers for
  transcript-column visualizers, including table overflow boundaries and JSON
  preview width constraints.
- No interactive tree/file dependency was added because Slice 4 does not require
  navigation, virtualization, keyboard traversal, lazy loading, or file actions.
- Focused transcript tests, full `@kilnai/gui` tests, GUI typecheck, GUI build,
  GUI E2E, and browser validation passed on 2026-07-02 before moving to Slice 5.

Gate: focused GUI tests, accessibility checks, representative large payloads,
horizontal-boundary tests, typecheck, build, and browser inspection pass.

### Slice 5 - Long-Thread Navigation Rail

Status: Complete

- Derive ordered semantic anchors for user turns, assistant turns, tool
  executions, failures, and other approved milestones.
- Add keyboard and pointer navigation, current-position feedback, and return to
  latest without stealing scroll position from a reader inspecting history.
- Keep the rail compact and responsive without covering transcript or composer.
- Initial GUI implementation derives rail anchors from the same canonical
  conversation projection that renders transcript rows, marks the current
  scroller-visible anchor through the official message-scroller visibility hook,
  and scrolls only on explicit operator action.
- Focused transcript tests, workspace typecheck, full `@kilnai/gui` tests, GUI
  build, focused Playwright visual coverage, and full GUI E2E passed on
  2026-07-03.

Gate: deterministic anchor tests and Playwright coverage for desktop, compact,
keyboard, live streaming, and reader-away-from-edge behavior pass.

### Slice 6 - Restore, Replay, and Interruption Continuity

- Rehydrate lifecycle rows, structured outputs, anchors, and live-edge state from
  persisted events using canonical identities.
- Cover reconnect, interrupted stream, delayed result, duplicate delivery, and
  session restore without duplicate rows or lost terminal states.
- The GUI canonicalizes persisted batches and rejects repeated live delivery by
  `eventId` before applying transcript, lifecycle, structured-output, approval,
  or telemetry projections. Restored and live timeline rows use the same
  `eventId`-derived identity. Delayed terminal evidence remains a distinct event
  and enriches the original execution through canonical `toolCallId`
  correlation.
- Focused GUI tests cover restored starts, delayed completion, repeated start and
  completion delivery, and restored interruption without reviving a terminal
  row. The runtime replay fixture preserves original event and tool-call
  identities.
- Chromium restore validation loads a persisted batch containing conflicting
  duplicate start and completion deliveries through the real GUI gateway detail
  endpoint, then verifies first-seen evidence, one terminal result, and canonical
  user, tool, and assistant ordering.

Gate: runtime/GUI integration fixtures and browser restore validation produce the
same visible identities and ordering as the original session.

### Slice 7 - Public-Release Validation and Promotion

Status: Complete

- Run focused tests, GUI typecheck, GUI build, relevant repository tests, and
  GUI E2E in that order.
- Perform operator validation on long live conversations, concurrent tools,
  interruption, restore, structured payloads, compact layout, and reduced motion.
- Promote stable behavior to architecture and GUI guides; update Roadmap 02 only
  from recorded evidence.
- Architecture, operator-surface, GUI-guide, changelog, and roadmap doctrine now
  record the validated `toolCallId` continuity model, bounded visualizer policy,
  reduced-motion treatment, `eventId` replay deduplication, and semantic
  long-thread navigation behavior.
- Browser-backed parity fixtures prove concurrent live tool rows stay distinct
  while completing out of order, reduced motion disables the active beam
  animation, keyboard and pointer navigation reach canonical anchors, return to
  latest targets the final anchor, and compact viewports hide the rail.
- Focused contract, runtime, GUI, and Playwright gates plus GUI test/build,
  workspace typecheck, `git diff --check`, and final review passed on
  2026-07-03.

Gate: review has no blocking findings, all required checks pass, residual risks
are recorded, and no implementation claim exceeds the captured evidence.

## Commit Sequence

1. `feat(events): preserve tool execution identity`
2. `feat(gui): render continuous tool execution rows`
3. `feat(events): classify structured tool output`
4. `feat(gui): render bounded structured tool output`
5. `feat(gui): add long-thread navigation rail`
6. `fix(gui): preserve execution continuity across restore`
7. `docs(gui): promote validated transcript behavior`

Each slice starts with failing tests, changes one concern, passes its focused
gate, and receives review before its commit. Only files for that slice are staged.

## Rollback

- Revert the affected slice commit; do not retain a shadow lifecycle, legacy
  renderer path, or duplicate navigation model.
- Contract changes roll back with their producers, consumers, fixtures, and
  projections as one atomic slice.
- If a visualizer or beam fails its gate, retain the readable fallback and status
  treatment while removing only the unvalidated enhancement.
- If the rail fails restore or reader-intent gates, remove the rail without
  changing the existing message-scroller behavior.

## Completion Criteria

- Every tool execution has one durable `toolCallId`-keyed presentation from
  invocation through terminal or interrupted state.
- Active activity remains visible, uses accessible semantics, and respects
  reduced motion.
- Every supported structured output selects a bounded contract-driven renderer;
  unknown and invalid payloads remain readable.
- The navigation rail moves through durable anchors, preserves reader intent,
  and returns explicitly to the live edge.
- Live, interrupted, replayed, and restored sessions produce equivalent identity,
  ordering, terminal state, and output presentation.
- Focused tests, typecheck, build, E2E, browser validation, and final review pass;
  stable doctrine is promoted before this Roadmap 02 subtrack is marked complete.
