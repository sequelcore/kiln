# 02 - Public Release UI Debt

Status: Active
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

Updated: 2026-07-02

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

- Authoritative composer context usage instead of the current neutral state.
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

Status: Pending research

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
- Render the richer skill setup diagnostics in GUI/TUI with the same fields now
  available in the shared setup contract.
- Repair the unrelated `@kilnai/cli` package test failure in
  `tests/config/managed-agent-routes.test.ts`, where direct ordered-routing
  route health now reports pending provider/model discovery for
  `codex-oauth-readonly` and `openrouter-readonly` but the test still expects
  those routes to be immediately available.
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

Status: Pending

Problem:

- The GUI composer currently renders a neutral context indicator because the
  composer does not receive trustworthy active-turn context usage.
- Provider model capability discovery exposes model `contextWindow`, and
  transcript events can contain token usage, but the composer does not yet have
  a normalized live value for context consumed versus available.
- Rendering a fake percentage would be misleading; the current neutral state is
  acceptable for local testing but not for public release.

Required outcome:

- Add a governed, contract-backed context usage projection for the active turn.
- Show a market-standard circular context indicator in the composer.
- Distinguish unavailable, partial, and authoritative context usage states.
- Use real provider/model context window data when available.
- Avoid estimating usage from unrelated transcript history unless the runtime
  marks the estimate as partial.
- Keep the indicator accessible with an explicit label and tooltip.

Verification:

- Gateway contract tests for context usage projection.
- Runtime/gateway tests proving unavailable, partial, and authoritative states.
- GUI tests for composer rendering, labels, tooltip, and layout order.
- Playwright parity coverage for the composer rail.
- `bun run --cwd packages/gui typecheck`
- `bun run --cwd packages/gui test:run`
- `bun run --cwd packages/gui build`
- `bun run --cwd packages/gui test:e2e`

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

Status: In progress; Slice 5 complete, Slice 6 next

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
- shadcn border beam examples are a visual reference, not a dependency. A local
  active beam may supplement status text and iconography, must remain subtle,
  and must become static under reduced motion.
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
- Running rows expose explicit state, text, iconography, shimmer treatment, and
  a subtle local active beam. Motion is supplemental and disabled under reduced
  motion.
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
- `border-beam` is adopted for active non-nested tool rows after package
  evaluation confirmed MIT licensing, React compatibility, and successful GUI
  build. The wrapper degrades safely where `window.matchMedia` is unavailable.
- Active execution state remains represented by text, iconography, and
  `data-state`; the beam is decorative and supplemental, not the only signal.
- No interactive tree/file dependency was introduced because current behavior
  does not require navigation, virtualization, keyboard traversal, lazy loading,
  or file actions.
- Focused transcript tests, full `@kilnai/gui` tests, GUI typecheck, GUI build,
  GUI E2E, and browser validation passed on 2026-07-02.

Slice 5 evidence:

- GUI transcript now renders a compact semantic navigation rail for long
  threads.
- Rail anchors are derived from the same conversation projection that renders
  transcript rows, so collapsed tool starts/completions do not create dead
  navigation targets.
- User turns, assistant replies, tool executions, failures, milestones, and live
  activity receive explicit anchor kinds.
- Current-position feedback uses the official message-scroller visibility hook;
  the rail marks visible/current anchors without owning scroll state.
- Pointer navigation scrolls only on explicit operator action, and the existing
  `MessageScrollerButton` remains the live-edge control.
- Focused transcript tests, workspace typecheck, full `@kilnai/gui` tests, GUI
  build, focused Playwright visual coverage, and full GUI E2E passed on
  2026-07-03.

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
- Evaluate `border-beam` (`Jakubantalik/border-beam`, MIT) as the preferred
  active-row beam implementation during Slice 4. Adopt it only if it maps cleanly
  to Kiln tokens, respects reduced motion, does not widen transcript rows, and
  passes bundle/build/browser gates; otherwise recreate the effect locally.
- Keep every visualizer bounded by the transcript column; expansion may grow
  vertically or scroll internally, never widen the chat layout.
- Add a compact, accessible navigation rail based on durable semantic anchors,
  with current-position feedback and an explicit return-to-latest action.
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
- Accessibility and browser checks prove active state is not motion-only and the
  beam is static under reduced motion.
- Playwright covers desktop and compact navigation, keyboard use, live streaming,
  reader-away-from-edge behavior, return to latest, interruption, and restore.
- GUI typecheck, tests, build, relevant E2E, operator live validation, and review
  must pass before implementation is marked complete.

## Promotion Gates

- Do not publish the GUI with a fake context percentage.
- Do not infer authoritative context usage without runtime evidence.
- Do not regress composer rail order: attachments and access controls on the
  left; context, model, voice, and send controls on the right.
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
