# 02 - Public Release UI Debt

Status: Active release debt
Execution: Ready - complete operator live validation and continue evidence-led component adoption.
Started: 2026-06-28

## Objective

Track release-blocking GUI debt that must be resolved before Kiln is presented
as a public product surface. This roadmap is intentionally narrow: it captures
unfinished product semantics discovered during live GUI validation, not broad
visual polish or completed execution-surface work.

## Goals

- Remove false or unavailable operator-facing states before public release.
- Preserve cross-surface truth for context usage, events, skills, tools, and
  managed-agent capability.
- Keep GUI components thin over shared contracts rather than inventing local
  product semantics.
- Promote stable release behavior into architecture and guide docs when closed.

## Scope

- Release-blocking GUI semantics discovered during live validation.
- Composer context usage, event density, structured tool output, skill
  diagnostics, and managed-agent/tool capability routing.
- Source-owned AI interaction components that make Kiln a clearer primary work
  surface, provided they consume canonical Kiln projections.
- Cross-surface contract or documentation changes required to keep GUI claims
  truthful.

## Non-Goals

- No broad visual polish track.
- No startup or benchmark work already promoted to architecture and guide docs.
- No GUI-only workaround for a runtime, route, skill, or gateway contract gap.
- No public-release claim before final operator live validation.

## Sequel Standards

- No fake context percentages or guessed authoritative state.
- No UI-only compatibility hacks for unavailable routes, skills, or tools.
- No visualizer dependency without a documented product behavior it replaces.
- No public release claim without live validation and focused test evidence.

## Research Basis

Research is required where the debt depends on harness behavior, skill
ecosystems, provider entitlements, or third-party visualizer dependencies. GUI
layout fixes alone do not require external research, but they still require
focused component, typecheck, build, and browser validation evidence.

## Progress Snapshot

Updated: 2026-07-14

The following GUI foundations have been implemented and verified. Their stable
behavior belongs in the canonical GUI and architecture documentation; this
roadmap retains them only as context for the remaining release blockers.

- Replaced transcript-owned scroll behavior with the official headless message
  scroller primitives. The transcript now preserves reader intent, supports
  live-edge following and return-to-latest behavior, and keeps streaming
  content inside a stable conversation column.
- Refactored the composer into focused components with a market-consistent
  control order, shared surface background, visible idle controls, accessible
  interaction states, and explicit continuity/authority presentation.
- Reworked desktop and compact navigation into one visual system. Canonical
  sidebar behavior is documented in `docs/guides/gui.md`.
- Replaced the right-side workspace, changed-files, and approvals panel shells
  with one full-width inspector composition and shared empty/detail patterns.
- Reduced transcript event duplication and introduced presentation-aware tool
  details that remain bounded by the transcript width.
- Added maintained JSON inspection through `react-json-view-lite` and a static
  hierarchical renderer for directory-tree output. Invalid JSON retains a
  readable fallback.
- Added deterministic Facehash-based operator avatars and corrected transcript
  row geometry so identity metadata is not vertically clipped.
- Added file-type-aware workspace icons through `react-file-icon`, isolated
  behind `WorkspaceFileIcon`; directories retain Lucide folder semantics and
  unknown files retain a deterministic fallback.
- Refactored Setup around operator decisions instead of raw filesystem state:
  purposeful health and repair cards, shadcn source/projection tables, semantic
  descriptions, quiet normal statuses, and workspace-backed previews for
  project-owned canonical files. Full paths remain available as explicit copy
  actions instead of dominating the page.
- Rendered the shared skill catalog in GUI and TUI Setup. Both surfaces now
  project configured/native origin, built-in/configured identity, admission and
  omission evidence, and native projection status directly from the shared
  setup snapshot. GUI makes paths explicit copy actions and states that
  `available` means Kiln may admit a skill, not that it is loaded into the
  active session.
- Split oversized app-shell and workbench responsibilities into focused
  runtime, frame, provider, command, navigation, surface, and action modules.
- Added cross-surface startup profiling and evidence-backed first-usable
  improvements for CLI, GUI dev mode, and TUI. Canonical profiling commands now
  live in `docs/guides/gui.md` and `docs/guides/tui.md`.
- Completed the provider-model eligibility plane. Raw catalog evidence,
  runtime adapter normalization, canonical interactive and managed-agent
  eligibility, Gateway projection, and GUI/TUI/CLI render-only operator
  selection are now canonical in
  `docs/architecture/provider-model-discovery.md`.

Current verification evidence:

- Focused component and contract tests pass for the transcript, composer,
  navigation, inspector panels, workspace tree, avatars, and event projection.
- GUI typecheck and focused lint checks pass for the implemented slices.
- GUI production builds pass without the previous large-chunk warning. The
  production bundle now uses stable Vite/Rollup chunks for React/router/UI,
  shared Kiln contracts, query runtime, validators, markdown/syntax rendering,
  inspectors, icons, state, and style utilities; the 560 kB warning gate remains
  active.
- Startup profiling tests, GUI tests, repository typecheck, and repository
  build pass for the measured startup slices.
- Final operator live validation remains pending and is required before this
  roadmap can close.

Still open before public release:

- Operator live validation of the implemented single-owner activity model and
  universal tool presentation across restored and long-running sessions.
- Continued staged adoption of useful AI Elements patterns as Kiln-owned Base
  UI components, with `Plan` and `Confirmation` admitted only after canonical
  Gateway consumers exist.
- Cross-surface event-density doctrine and parity verification for CLI/TUI.
- Public-release presentation of managed-agent/tool capability diagnostics
  across harnesses and provider entitlements, now consuming canonical
  provider-model eligibility rather than solving route admissibility locally.
- Skill catalog projection and admission parity across Codex, OpenCode, Claude
  Code, and GUI-managed invocations.
- Final live validation of long conversations, streaming interruptions,
  restored sessions, structured outputs, inspector modes, responsive sidebar,
  and workspace file-type icon coverage.

## Delivery Slices - Release-Blocking Debt

### Immediate In-Product Work Experience

Status: In progress; Slices 0-2 implemented, operator live validation pending

Objective:

- Make the GUI a calm, trustworthy place to perform real Kiln work. Every
  visible state must either help the operator act or preserve durable execution
  evidence; transient implementation state must not compete with the work.

Observed problems:

- The active composer simultaneously renders the animated border beam,
  `Thinking`, and the continuity label `Running`. These are three presentations
  of one fact and create noise without adding an operator decision.
- The transcript can render an empty assistant row with a green streaming
  cursor before any assistant text exists. The cursor then looks like a broken
  message and duplicates the composer's activity beam.
- Generic cards and raw execution envelopes make plans, tasks, tool calls,
  tests, terminal output, and artifacts harder to scan than their canonical
  Kiln data requires.

Activity ownership decisions:

- Exactly one aggregate surface owns passive activity emphasis at a time. The
  emphasis follows the most informative canonical state instead of remaining
  permanently attached to every active component.
- Use the composer's theme-aware rotate `border-beam` while the agent is
  preparing a response or working without a structured progress projection.
  This is the pre-output fallback, not a second execution timeline.
- When canonical work items or a plan exist, transfer aggregate emphasis to the
  visible `Task` or `Plan` card and use the quieter pulse treatment shown by the
  Border Beam working-state example. The composer beam becomes inactive; item
  indicators communicate pending, active, completed, and failed steps.
- Once visible assistant text is streaming, the incremental response is the
  activity signal. Do not keep an additional beam or cursor-only placeholder.
- Never put a beam around each tool row. A `Task` or `Plan` card may summarize
  structured work, while individual tool events retain their compact canonical
  lifecycle treatment.
- Rotate, pulse, and their static reduced-motion fallback must retain sufficient
  light/dark-theme contrast and cannot be the only accessible state evidence.
- Do not render visible `Thinking` or duplicate `Running` copy inside the
  composer while the beam is active. Preserve phase changes in a polite,
  screen-reader-only live region so activity is not communicated by motion
  alone.
- Do not move `Thinking` into the transcript. The transcript owns user and
  assistant content plus durable plan, task, tool, approval, failure, source,
  and artifact evidence; it does not own synthetic preparation messages.
- Do not use a spinner-only send button. The idle control sends. During an
  active turn it becomes a labelled Stop/Cancel action only after the Gateway
  exposes a real cancellable operation; otherwise it remains unavailable and
  the beam communicates passive activity.
- Keep exceptional continuity or governance states visible when they require a
  decision, including detached execution, approval requests, failures, and
  cancellation. Routine `Running` is not exceptional continuity.
- Do not render an assistant message or streaming cursor until the first
  visible assistant text delta exists. A streaming cursor may accompany actual
  streaming text, but must never be the only content in a transcript row.
- Tool execution remains visible as a stable transcript event keyed by the
  canonical `toolCallId`; aggregate pulse emphasis must not replace or decorate
  individual tool evidence.

AI component adoption boundary:

- AI Elements is a source registry, not a runtime design-system dependency.
  Add components only for an admitted Kiln consumer, keep their source under
  `packages/gui/src/components/ai-elements`, and own the result in this
  repository.
- Preserve each adopted component's useful composition, interaction,
  accessibility, and recognizable information hierarchy. Replace Radix or
  library-specific interactive primitives with Kiln's shadcn/Base UI
  primitives and adapt styling to Kiln's Tailwind 4 semantic tokens.
- Replace AI SDK types and lifecycle assumptions with canonical
  `@kilnai/gateway-contracts` projections. Components render state; they do not
  infer plans, tool transitions, permissions, or provider truth.
- Delete unused variants, imports, adapters, compatibility aliases, and demo
  behavior during adoption. Do not retain parallel legacy renderers after the
  migrated consumer and its tests are complete.
- Do not install the complete registry speculatively. The catalog below records
  useful families; each component is copied and converted only in the slice
  that gives it a real consumer.

Candidate families and order:

| Order | Kiln need | AI Elements patterns to evaluate | Admission condition |
| --- | --- | --- | --- |
| 1 | Governed work progress | `Task`, `Plan`, `Confirmation`, `Checkpoint`, `Queue` | Bind to canonical work items, approvals, checkpoints, or queued invocations; never synthesize progress from prose. |
| 2 | Execution evidence | `Tool`, `Terminal`, `Test Results`, `Stack Trace`, `Commit` | Preserve tool-call identity and render typed Gateway output without replacing readable raw evidence. |
| 3 | Conversation evidence | `Message`, `Sources`, `Inline Citation`, `Attachments`, `Reasoning` | Integrate only where they improve the existing transcript; reasoning means provider-approved summaries, never hidden chain of thought. |
| 4 | Artifacts and workspace output | `Artifact`, `Code Block`, `File Tree`, `Web Preview`, `JSX Preview`, `Image`, `Snippet` | Reuse the shared presentation intent and resource model; previews must remain sandboxed and bounded. |
| 5 | Operator configuration | `Agent`, `Context`, `Model Selector`, `Persona`, `Schema Display`, `Environment Variables` | Consume canonical route, context, setup, and schema diagnostics without inventing availability. |
| 6 | Optional media and graph surfaces | `Audio Player`, `Transcription`, `Voice Selector`, `Canvas`, `Node`, `Edge`, `Toolbar` | Admit only after an existing Kiln workflow needs the interaction and its accessibility/performance cost is justified. |

Explicit exclusions:

- Do not adopt `Prompt Input`, `Conversation`, or other shell-level components
  merely to restyle working Kiln-owned composer or scroller behavior.
- Do not expose a `Chain of Thought` surface. Kiln may render durable execution
  steps and provider-approved reasoning summaries, not private model reasoning.
- TUI parity is a later rendering slice. GUI and TUI should share canonical
  projections and state vocabulary, not React components or browser animation.

Delivery:

- Slice 0: remove visible `Thinking` and routine `Running` from the active
  composer, retain accessible phase announcements, and implement one-owner
  rotate/pulse activity emphasis with light/dark-theme and reduced-motion
  verification. Implemented 2026-07-14.
- Slice 1: suppress empty assistant streaming rows and cursor-only transcript
  output while preserving real text streaming and durable tool events.
  Implemented 2026-07-14.
- Slice 2: complete the source-owned `Task` vertical slice over canonical work
  items, including Base UI conversion, theme adaptation, tests, and deletion of
  the replaced local renderer. Implemented 2026-07-14.
- Slice 3: adopt `Plan` and `Confirmation` only after their Gateway projections
  and real consumers are mapped; keep approval authority outside the component.
- Slice 4: the universal execution-evidence anatomy is implemented. Every tool
  lifecycle state uses the same source-owned `Tool` header, status, disclosure,
  timing, and bounded content shell. Governed work-item output composes `Task`;
  structured error envelopes compose a shadcn diagnostic alert; existing diff,
  terminal, tree, search, table, resource, and source renderers remain content
  variants inside that shared anatomy. Continue adding variants only from real
  live-validation evidence.
- Slice 5: adopt artifact and conversation patterns only where focused browser
  evidence proves an improvement over the current Kiln component.
- Slice 6: complete desktop/compact, keyboard, screen-reader, light/dark,
  reduced-motion, interruption, restore, and long-session live validation.

Immediate acceptance criteria:

- One active turn has at most one passive aggregate emphasis: composer rotate,
  structured-work pulse, or the visible streaming response itself.
- The composer contains no simultaneous `Thinking` and routine `Running` text.
- The transcript contains no synthetic thinking message, empty assistant row,
  or cursor-only bubble.
- First text delta, active tool event, approval request, failure, cancellation,
  reconnect, and restored session each remain truthful and inspectable.
- Tests cover semantic state and accessible names rather than animation pixels;
  Playwright visual checks cover contrast, overflow, and reduced motion.
- Focused GUI tests, GUI typecheck, GUI build, relevant E2E, and operator live
  validation pass before the slice is closed.

Implementation evidence (2026-07-14):

- Removed the visible activity label from the composer and retained a polite,
  screen-reader-only phase announcement. Routine running continuity is no
  longer rendered beside the same active-turn state.
- Composer rotate emphasis now stops when visible assistant text streams.
  Source-owned `Task` cards use one theme-aware pulse owner for the most
  recently updated canonical in-progress work item; sibling tasks retain their
  semantic status without additional beams.
- A completed transport-level tool call can no longer mislabel a domain-level
  paused work-item execution as `Completed`. The shared Gateway presentation
  exposes `paused` task state, reason, route, next tool, and required evidence.
- Generic transcript tool rows now compose the source-owned AI Elements `Tool`
  pattern over Base UI `Collapsible` for running, completed, paused, and failed
  states; paused work-item output composes the existing source-owned `Task`
  pattern without a nested card.
- Structured tool error envelopes override misleading transport success,
  project as canonical diagnostics, and render code, recovery, next-tool, and
  required-input evidence through the shared Tool anatomy instead of raw JSON.
- Contract, session-store, transcript, and Chromium parity coverage verify the
  semantic warning state, accessible task/evidence structure, theme contrast,
  transcript bounds, and absence of raw JSON output.
- Deleted the obsolete assistant-anchor projection that created empty streaming
  messages around tool events. Tool rows remain standalone and the assistant
  message is created only by visible text or final response content.
- Removed the cursor-only streaming decoration and its unused theme token.
- Vite and Playwright now accept an isolated GUI development port while
  retaining `5183` as the operator default, so browser verification cannot
  silently reuse an unrelated live GUI proxy.
- Focused contract, session-store, and transcript tests pass; the complete GUI
  suite passes (445), GUI typecheck, focused lint, and production build pass,
  and the Chromium theme, layout, activity, task, diagnostic, and
  reduced-motion suite passes (6). React Doctor reports no finding in the new
  Tool/Task/Alert components; its changed-worktree scan remains affected by
  existing AppShell, store, and transcript findings outside this bounded
  change.
- Full GUI lint still reports two pre-existing accessibility findings in
  `markdown-table.tsx` and `transcript.tsx`. They are not caused by this slice
  and remain separate debt. Operator live validation is still required before
  Slices 0-2 are closed.

### Cross-Harness Agent and Tool Capability Routing

Status: Partially implemented; provider/model route eligibility complete

Problem:

- Kiln-managed agent routes are expected to work as native capabilities across
  GUI, CLI, TUI, and delegated harness surfaces.
- Provider/model route eligibility, stale catalog behavior, native route
  integrity classification, and managed-agent route admission are now governed
  by the canonical provider-model discovery architecture.
- Remaining release debt is the public operator experience for managed-agent
  and tool capability diagnostics: GUI, CLI, and TUI must explain whether a
  failure is provider/model eligibility, missing tool capability, missing
  harness support, skill/plugin admission, setup drift, or account entitlement.
- Release readiness still requires live operator validation and cross-surface
  parity so the GUI does not expose raw provider, harness, or tool exceptions as
  product truth.

Required outcome:

- Render the canonical provider-model eligibility result before invocation and
  present a clear actionable diagnostic instead of surfacing raw provider
  errors.
- Define or consume the canonical capability model for managed agents and tools
  across GUI, CLI, TUI, Codex, OpenCode, and future harness adapters.
- Ensure native Kiln agents/tools can be invoked consistently from all supported
  operator surfaces when the active provider/account is entitled.
- Document which failures are local setup drift, stale projection/install state,
  account entitlement limits, or missing Kiln product capability.
- Add a research-backed implementation plan before changing routing behavior.

Verification:

- Config/projection diagnostics prove whether local managed-agent definitions
  are current.
- Contract/runtime tests cover unavailable route diagnostics.
- GUI tests show clear capability errors without raw provider exception text.
- CLI/TUI tests prove the same route availability semantics.
- Research notes compare current Kiln behavior with relevant harness patterns.

### Skill Catalog Projection and Admission Parity

Status: Partially implemented; GUI/TUI setup rendering is the current bounded task

Problem:

- During live validation, a Codex OAuth session reported access only to the
  Kiln-admitted skill set such as `repo-context-review`, `codebase-scouting`,
  `tdd-workflow`, and `benchmark-readiness-review`, while other locally
  available Codex skills such as `shadcn`, `frontend-design`, and accessibility
  skills were not visible to that route.
- Kiln's architecture defines skills as governed procedural context resolved
  through registry, selection, admission, and native projection. A skill that
  exists in one harness's local skill directory is not automatically safe or
  admitted for every Kiln-managed route.
- The current operator experience does not clearly explain the difference
  between:
  - a first-party built-in Kiln skill.
  - a user-installed or project-installed skill.
  - a native harness skill projected by Kiln.
  - a skill available to the current Codex/Claude/OpenCode host outside Kiln.
  - a skill admitted into the current managed invocation or operator session.
- This ambiguity undermines Kiln's core promise that agents, skills,
  instructions, and tools are shared through governed projection rather than
  scattered per-harness setup.

Required outcome:

- Define the canonical skill capability model across:
  - Kiln built-in skills.
  - global user skills.
  - project skills.
  - plugin-provided skills.
  - native harness projections for Codex, OpenCode, and Claude Code.
  - per-route admitted skills for managed invocation and operator sessions.
- Add diagnostics that can answer, for any active session or agent route:
  - which skills exist in the configured registry.
  - where each skill came from.
  - which skills were projected to native harness directories.
  - which skills were admitted into the current context.
  - why an expected skill was omitted.
- Ensure UI/frontend work can request and receive the relevant design skills
  when policy allows them, instead of relying on harness-local availability that
  Kiln cannot audit.
- Adopt native harness-local skills into Kiln's governed registry when the
  contents are parseable and non-conflicting, then project the canonical copy
  back to every supported harness.
- Present missing skill capability as a clear setup/capability diagnostic, not
  as the assistant saying it cannot see skills that the operator believes Kiln
  should share.

Implemented:

- `kiln config read skills` and setup/status snapshots now report configured
  skill origin, built-in status, source path, native projection status, and
  admission availability.
- Managed invocation skill catalogs now project the same configured skill
  diagnostics and expose unmanaged native harness-local skills as diagnostics
  only, not as admissible skill ids.
- Explicit missing skills still fail closed; auto-selected recommendations are
  admitted only when configured and `skills.selection.mode: auto` is enabled.
- Native harness-local skills such as Codex-local `shadcn` are classified as
  `native-harness` / `unmanaged-native` with setup action guidance instead of
  being silently imported.
- `adopt-or-back-up-native-guidance` now adopts parseable, non-conflicting
  native skills into `~/.kiln/skills`, blocks same-name content conflicts for
  manual reconciliation, and runs native skill projection so Claude Code,
  Codex, and OpenCode receive the same governed skill set.
- Managed invocation tool descriptions now summarize long skill catalogs with
  omitted counts and diagnostic totals instead of injecting every native skill
  row into the model-facing prompt.
- Managed invocation now accepts a validated cross-domain work classification
  and records requested/resolved facets plus work-recommended skills. Auto mode
  can admit configured recommendations such as `clear-writing`; advisory mode
  records the recommendation without loading it.
- Approved plan work items now carry durable work classification provenance.
  Classification/provenance participate in plan content hashes, materialize to
  `WorkItem`, fail closed on conflict, and are forwarded into generated managed
  invocation requests for replayable diagnostics.
- `work_item.update` and agent profiles now provide governed entry points for
  explicit non-software work classification. Managed invocation context records
  per-skill recommendation diagnostics as `admitted`, `advisory`, or
  `unavailable`.

Remaining debt:

- Wire plugin/domain-package skills into the configured Kiln registry only
  after the plugin ownership, trust, and precedence contract is promoted from
  reserved model state to active config behavior.
- Tighten operator-facing copy across CLI/GUI/TUI so `admission.state:
  available` is never presented as "actively loaded in this session" unless the
  skill was admitted by explicit request, agent profile defaults, or auto skill
  selection. `available` means admissible through Kiln governance, not
  necessarily already in active procedural context.

Verification:

- Config/status diagnostics expose skill origin, projection state, and admission
  state.
- Managed invocation tests cover requested available skills, requested missing
  skills, auto-selected skills, and harness-local unmanaged skills.
- CLI setup/status views show actionable skill projection/admission status;
  GUI/TUI rendering remains follow-up work over the shared contract.
- Research notes compare current Kiln behavior with Codex, Claude Code,
  OpenCode, and any relevant plugin/skill ecosystem conventions.
- Documentation states that existence, native projection, and context admission
  are distinct states.

### Composer Context Usage Indicator

Status: Completed 2026-07-13

Delivered:

- Core owns the provider-neutral `context_usage_observed` event; Runtime alone
  normalizes provider evidence, binds it to the completing route/turn, and maps
  it to the standalone Gateway DTO.
- Provider-reported OpenAI/Codex input treats cached input as inclusive, while
  Anthropic cache read/write is adapter-declared additive. Output and reasoning
  tokens are not added to occupied input context.
- GUI renders the accessible circular indicator with unavailable, partial,
  authoritative, and restored/historical evidence; CLI and TUI consume the
  same projection where they already render session or turn status.
- Persisted/replayed evidence retains its original observation and source as
  historical; retry/fallback evidence remains bound to the successful route.

The canonical ownership, authority, lifecycle, and surface rules are in
[`docs/architecture/context-usage-projection.md`](../architecture/context-usage-projection.md).

### Cross-Surface Event Presentation Density

Status: Pending research

Problem:

- GUI live validation showed tool-result event details repeating the same
  information across the event row, expanded detail header, structured fields,
  and rendered content.
- The immediate GUI bug was fixed locally, but the underlying rule is
  cross-surface: every Kiln surface consumes the same event presentation
  contract and can repeat `title`, `summary`, fields, and body content unless
  presentation density is specified centrally.
- Repetition makes long-running agent/tool traces harder to scan and can hide
  the actual evidence users need to inspect.

Required outcome:

- Define canonical surface rules:
  - Event row shows action, status, and compact summary.
  - Expanded detail shows only non-duplicated evidence, structured fields, and
    rendered content.
  - Details do not repeat title or summary when the row already carries them.
- Audit GUI, CLI, and TUI event renderers against the same rule.
- Promote shared projection helpers if multiple surfaces need the same
  deduplication behavior.

Verification:

- GUI tests cover non-duplicated tool-result detail rendering.
- CLI/TUI snapshot or contract tests cover equivalent event output density.
- Documentation states the event presentation density rule for future surfaces.

### Tool Execution Continuity, Structured Output Visualizers, And Long-Thread Navigation

Status: Subtrack complete; public-release UI roadmap remains in progress

Problem:

- Tool usage is currently presented inside assistant bubbles, where execution
  can be difficult to distinguish from prose and expensive to scan in long
  conversations.
- Active tool activity can disappear when transient events are replaced,
  regrouped, or followed by later assistant/result events. The runtime identity
  must be the canonical `toolCallId`, not tool name, render position, or a
  GUI-generated key.
- Tool calls can emit JSON, source, markdown, trees, diffs, tables, images, and
  resource bundles. Public GUI quality requires each output type to render as
  the expected artifact, not as a generic preview card or repeated raw envelope.
- JSON uses a lightweight inspector and directory trees use a bounded static
  hierarchy, but this does not complete lifecycle continuity or the remaining
  structured-output behaviors.
- Long threads lack a compact semantic navigation rail. Operators need to move
  among meaningful turns and tool executions while preserving reader intent and
  retaining an explicit return to the live edge.

Slice 0 evidence and decisions:

- Codex captures establish the reference behavior: tool execution is separate
  from prose, active state persists through streaming, completion updates the
  same execution identity, and meaningful thread positions are directly
  navigable.
- shadcn MessageScroller hooks are a behavioral reference for live-edge
  following and reader-intent preservation, not a new dependency requirement.
- The maintained `border-beam` package is adopted only for the aggregate live
  activity surface. It communicates thinking or active execution and must not
  decorate individual tool rows or terminal evidence.
- Active tool rows remain compact inline traces with status text, iconography,
  and reduced-motion-safe shimmer only when useful.
- Runtime events remain canonical. The GUI derives presentation keyed by
  `toolCallId` and must not manufacture lifecycle transitions or merge calls by
  tool name.

Slice 1 evidence:

- Runtime event contracts require `toolCallId` for `tool_called` and
  `tool_result`.
- Tool execution producers carry the same identity from invocation to terminal
  result across success, failure, cache-hit, denied, rate-limited,
  invalid-input, and blocked paths.
- Dev-tool execution preserves upstream tool call identity when supplied and
  generates a local identity only for internal calls without one.
- Dev-tool authorization denial and approval-required failures now emit a
  terminal `tool_result` before rethrowing, so native/dev-tool activity does not
  remain permanently active in operator surfaces.
- Dangerous-command blocks now emit terminal output and policy metadata on the
  same correlated `tool_result`.
- Canonical session projection fails fast when runtime tool events are missing
  `toolCallId`, preventing GUI, CLI, or TUI surfaces from rebuilding identity
  from order or tool name.
- Canonical session projection no longer correlates same-name tool results by
  FIFO order; interleaved completions stay attached to their originating
  execution identity.
- Replay coverage proves persisted runtime events keep their original
  `toolCallId` through canonical projection.
- Work-item projection preserves the parent tool execution identity.
- Focused runtime tests, `@kilnai/core` tests (272 files, 3443 tests),
  `@kilnai/runtime` tests (185 files, 2476 tests, 5 skipped live files),
  workspace typecheck, and `git diff --check` passed on 2026-07-02.

Slice 2 evidence:

- Shared conversation projection now supports standalone tool-event rows through
  `anchorToolEventsToAssistant: false` while preserving the default grouped
  assistant behavior for other consumers.
- GUI transcript uses standalone operational rows for tool calls instead of
  rendering tool usage inside assistant prose bubbles.
- Completed starts collapse into their terminal execution row by canonical
  `toolCallId`; running calls remain visible as running rows until terminal
  evidence arrives.
- Running rows expose explicit state, text, iconography, and optional shimmer
  treatment. Shimmer and spinner motion are disabled under reduced motion.
- Focused gateway projection tests, focused GUI transcript tests, full
  `@kilnai/gui` tests, GUI build, GUI E2E, and workspace typecheck passed on
  2026-07-02.

Slice 3 evidence:

- Shared `ToolResultPresentation` carries explicit output classification with
  source, reason, confidence, and fallback reason where applicable.
- Valid presentation intents now classify table and resource-bundle outputs from
  contract evidence before renderer selection.
- File reads, source/code, markdown, diffs, trees, resource-linked outputs,
  browser screenshots, commands, stat, OCR, and fallback text carry
  provider-neutral classification evidence.
- Invalid or unsupported presentation intents do not leak raw envelopes or
  vanish silently; they fall back to readable text with validation failure
  evidence.
- Focused operator-event presentation tests, full gateway-contract tests,
  focused GUI transcript tests, focused TUI gateway-session tests, and workspace
  typecheck passed on 2026-07-02.

Slice 4 evidence:

- GUI transcript structured-output details now expose bounded containers for
  approved visualizers, with explicit table overflow boundaries and JSON preview
  width constraints.
- Active non-nested tool rows use a compact inline trace instead of decorative
  beam framing so operational activity stays subordinate to assistant prose.
- Active execution state remains represented by text, iconography, and
  `data-state`; optional shimmer is supplemental and suppressed with spinner
  motion under reduced-motion preference.
- No interactive tree/file dependency was introduced because current behavior
  does not require navigation, virtualization, keyboard traversal, lazy loading,
  or file actions.
- Focused transcript tests, full `@kilnai/gui` tests, GUI typecheck, GUI build,
  GUI E2E, and browser validation passed on 2026-07-02.

Slice 5 evidence:

- GUI transcript renders long-thread navigation as a quiet gutter trail rather
  than a permanent dot capsule. Marks expand and reveal nearby-turn previews on
  hover/focus, then delegate semantic scrolling to `MessageScroller`.
- Rail anchors are derived from the same conversation projection that renders
  transcript rows, so collapsed tool starts/completions do not create dead
  navigation targets.
- User turns, assistant replies, tool executions, failures, milestones, and live
  activity receive explicit anchor kinds.
- Current-position feedback uses the official message-scroller visibility hook;
  visible semantic anchors drive the rail's active mark, while `currentAnchorId`
  remains a fallback for scroller anchoring state. Hover/focus only selects and
  magnifies nearby marks for visual inspection.
- Pointer navigation scrolls only on explicit operator action, and the existing
  `MessageScrollerButton` remains the live-edge control.
- Focused transcript tests, workspace typecheck, full `@kilnai/gui` tests, GUI
  build, focused Playwright visual coverage, and full GUI E2E passed on
  2026-07-03.
- The 2026-07-03 visual-ownership correction restored `border-beam` exclusively
  to aggregate live activity, kept individual tool traces beam-free, replaced
  global DOM navigation with `MessageScroller.scrollToMessage`, and verified
  navigation plus reduced-motion behavior in Chromium.
- The aggregate live activity row no longer renders an isolated ellipsis for
  thinking state. Subsequent live validation moved passive activity ownership
  to the beamed composer: the transcript retains durable tool and approval
  evidence, while phase announcements remain accessible without duplicating
  visible `Thinking` or routine `Running` labels.
- The 2026-07-03 rail interaction correction verified the Codex-like gutter
  behavior in Chromium: one active mark, proximity zoom on hover/focus, subdued
  distant marks, preview cards, keyboard activation, and no duplicated scroll
  authority outside `MessageScroller`.
- The rail no longer renders a second "return to latest" arrow beside the
  official message-scroller control; hover/focus selection uses a neutral
  foreground treatment so it remains visually distinct from the primary active
  reader-position mark.
- The rail now highlights visible assistant replies and other semantic blocks
  without making those rows `scrollAnchor`s, preserving MessageScroller turn
  anchoring while matching Codex-style reading position feedback.
- Web/search tool output is classified at the shared Gateway contract layer as
  structured `search_results` evidence and rendered as source/result rows
  instead of raw monospaced `Text output` or generic document markdown.
- The 2026-07-14 governed-tool correction projects canonical `work_item.update`,
  `goal.create`, work-item execution, and failed-operation envelopes into
  purpose-built work progress, goal governance, task evidence, and diagnostic
  presentations. Known envelopes do not expose a generic text or JSON body.
- Unknown JSON remains inspectable through the bounded JSON visualizer, but is
  classified and labelled as `Structured data` rather than `Text output`.
  This is the explicit fallback boundary for tools without a canonical
  presentation; adding a supported Kiln tool requires a contract projector and
  focused renderer coverage instead of tool-name conditionals in the GUI.
- The 2026-07-15 activity-density correction makes the turn lifecycle the sole
  owner of composer beam activation: pulse-outside remains stable through
  thinking, tool execution, and response streaming, pauses for operator
  approval, and fades only at a true terminal turn state. Consecutive routine
  tools collapse into one accessible activity group; governed goals, work
  items, approvals, warnings, and failures remain standalone. Work-item details
  show compact canonical metadata and evidence progress without repeating the
  tool header or exposing internal next-tool hints as primary UI.
- Context-window UX now renders the canonical `ContextUsageProjection` through
  a compact percentage/token trigger and a Base UI popover with provenance,
  remaining capacity, freshness, and caveats. It does not install a parallel
  tokenizer or synthesize missing capacity, cost, or per-token-category data.

Required outcome:

- Render each tool execution as one stable transcript row outside assistant
  prose, retaining active, succeeded, failed, interrupted, replayed, and restored
  states under the same `toolCallId`.
- Ensure later prose, grouping, or result events cannot make active execution
  disappear; completion updates the existing row.
- Keep JSON on the maintained lightweight inspector and static directory trees
  as bounded hierarchies. Select source, markdown, diff, table, image, and
  resource-bundle views from shared presentation intents.
- Preserve readable raw evidence for unknown or invalid payloads.
- Introduce a tree/file explorer dependency only when approved behavior requires
  navigation, virtualization, keyboard traversal, lazy loading, or file actions.
- Keep active-row treatment compact and inline. Kiln's semantic wrapper owns
  transcript bounds and disables shimmer/spinner animation under reduced motion.
- Keep every visualizer bounded by the transcript column; expansion may grow
  vertically or scroll internally, never widen the chat layout.
- Add a compact, accessible gutter navigation trail based on durable semantic
  anchors, with nearby-turn previews on hover/focus, current-position feedback,
  and an explicit return-to-latest action.
- Preserve execution identity, output classification, anchor ordering, and
  terminal state across interruption, replay, reconnect, and session restore.

Delivery:

- Slice 1: canonical tool lifecycle contract and `toolCallId` projection.
- Slice 2: continuous execution rows and reduced-motion-safe active treatment.
- Slice 3: shared structured-output classification and readable fallbacks.
- Slice 4: bounded visualizers for approved presentation intents.
- Slice 5: semantic long-thread navigation rail.
- Slice 6: interruption, replay, reconnect, and restore continuity.
- Slice 7: public-release verification, live validation, review, and doctrine
  promotion.

Verification:

- Contract/runtime tests cover lifecycle transitions, interleaved calls,
  failures, interruption, replay, duplicate delivery, and restore by
  `toolCallId`.
- GUI tests prove active activity does not disappear and terminal events update
  the same execution row.
- GUI tests cover JSON inspection, invalid fallback, output classification,
  bounded horizontal layout, and large representative payloads.
- Accessibility and browser checks prove active state is not motion-only and
  shimmer/spinner motion is suppressed under reduced motion.
- Playwright covers desktop and compact navigation, keyboard use, live streaming,
  reader-away-from-edge behavior, return to latest, interruption, and restore.
- GUI typecheck, tests, build, relevant E2E, operator live validation, and review
  must pass before implementation is marked complete.

Subtrack closeout evidence (2026-07-03):

- Browser-backed gateway fixtures prove two concurrent live tools remain
  distinct through out-of-order success/failure completion.
- Playwright proves reduced-motion suppression for active inline tool rows,
  keyboard and pointer rail navigation, return to latest, compact rail hiding,
  persisted duplicate suppression, and canonical restore ordering.
- Focused contract/runtime/GUI tests cover interleaving, interruption, delayed
  terminal evidence, malformed structured-output fallback, and bounded large
  payloads. Final workspace gates and independent review are recorded in the
  completed implementation plan.
- This closes only the tool-continuity/visualizer/navigation subtrack. Roadmap 02
  remains active for its unrelated public-release UI debt and is not deleted.

## Promotion Gates

- Do not publish the GUI with a fake context percentage.
- Do not infer authoritative context usage without runtime evidence.
- Do not regress composer rail order: attachments and access controls on the
  left; context, model, voice, and send controls on the right.
- Do not duplicate passive turn activity across beam, status copy, continuity
  copy, send-button loading, and an empty transcript row.
- Do not adopt an AI Elements component until a real Kiln consumer, canonical
  projection, Base UI conversion boundary, replacement target, and focused
  verification are named.
- Do not let any public surface repeat event title/summary/details/body as
  separate visible facts.
- Do not optimize GUI startup from a single warm or cold measurement. Record
  cache state and separate CLI, gateway, Vite, browser launch, and first paint.
- Do not claim a harness has access to a skill unless Kiln can show whether the
  skill is configured, projected, and admitted for that route.
- Do not add a visualizer dependency unless it replaces real behavior that Kiln
  would otherwise maintain poorly in-house.
- Promote stable behavior into architecture or guide docs when this roadmap
  closes, then delete this roadmap file.

## Verification

Each debt item lists focused verification. Roadmap closeout also requires GUI
typecheck, GUI tests, GUI build, relevant E2E coverage, cross-surface contract
tests for shared semantics, and final operator live validation.

## Completion Criteria

This roadmap closes when no public GUI surface presents fake, unavailable, or
ambiguous capability state; when stable behavior has moved into architecture or
guide docs; and when this release-debt file can be deleted.
