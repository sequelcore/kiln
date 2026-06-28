# 03 - Public Release UI Debt

Status: Active
Started: 2026-06-28

## Objective

Track release-blocking GUI debt that must be resolved before Kiln is presented
as a public product surface. This roadmap is intentionally narrow: it captures
unfinished product semantics discovered during live GUI validation, not broad
visual polish or completed execution-surface work.

## Progress Snapshot

Updated: 2026-06-28

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

Current verification evidence:

- Focused component and contract tests pass for the transcript, composer,
  navigation, inspector panels, workspace tree, avatars, and event projection.
- GUI typecheck and focused lint checks pass for the implemented slices.
- GUI production builds pass with the existing large-chunk warning.
- Startup profiling tests, GUI tests, repository typecheck, and repository
  build pass for the measured startup slices.
- Final operator live validation remains pending and is required before this
  roadmap can close.

Still open before public release:

- Authoritative composer context usage instead of the current neutral state.
- Cross-surface event-density doctrine and parity verification for CLI/TUI.
- Research and correction of managed-agent/tool capability routing across
  harnesses and provider entitlements.
- Skill catalog projection and admission parity across Codex, OpenCode, Claude
  Code, and GUI-managed invocations.
- Final live validation of long conversations, streaming interruptions,
  restored sessions, structured outputs, inspector modes, responsive sidebar,
  and workspace file-type icon coverage.

## Release-Blocking Debt

### Cross-Harness Agent and Tool Capability Routing

Status: Partially implemented

Problem:

- Kiln-managed agent routes are expected to work as native capabilities across
  GUI, CLI, TUI, and delegated harness surfaces.
- During GUI transcript refactor validation, Codex subagent review routes failed
  because configured models were not available from the active ChatGPT account:
  `opencode-go/deepseek-v4-pro` and `codex-oauth/codex-auto-review`.
- This may indicate stale local config, missing latest Kiln install/projection,
  incorrect provider routing for this harness, or a broader product gap: managed
  agents/tools are not yet exposed as a reliable native capability layer across
  every surface.
- Release readiness requires this to be researched against current Kiln
  architecture, local projections, provider account entitlements, and comparable
  harness behavior before choosing an implementation.

Required outcome:

- Define the canonical capability model for managed agents and tools across
  GUI, CLI, TUI, Codex, OpenCode, and future harness adapters.
- Detect unavailable provider/model routes before invocation and present a clear
  actionable diagnostic instead of surfacing raw provider errors.
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

Remaining debt:

- Wire plugin/domain-package skills into the configured Kiln registry only
  after the plugin ownership, trust, and precedence contract is promoted from
  reserved model state to active config behavior.
- Render the richer skill setup diagnostics in GUI/TUI with the same fields now
  available in the shared setup contract.

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

### Structured Tool Output Visualizers

Status: Partially implemented

Problem:

- Tool calls can emit JSON, source, markdown, trees, diffs, tables, images, and
  resource bundles.
- Public GUI quality requires each output type to render as the user's expected
  artifact, not as a generic preview card or repeated raw envelope.
- JSON now uses a lightweight inspector in the GUI, and directory tree previews
  render as a bounded hierarchical list. Tree/file outputs still need a product
  decision before becoming interactive explorers.

Required outcome:

- Keep JSON rendering on a maintained, lightweight inspector instead of a local
  tokenizer.
- Keep static directory tree output as a bounded hierarchy instead of a raw
  monospaced preview block.
- Use native contract presentation intents for tables, resource bundles,
  screenshots, and markdown.
- Introduce a dedicated tree/file explorer library only when tool output needs
  navigation, virtualization, keyboard traversal, lazy loading, or file actions.
- Keep every visualizer bounded by the transcript column; expansion may grow
  vertically or scroll internally, never widen the chat layout.

Verification:

- GUI tests cover JSON inspector rendering, invalid JSON fallback, and bounded
  horizontal layout.
- Contract tests classify structured tool outputs before they reach surfaces.
- Research notes compare any future tree/file explorer dependency with the
  current static renderer before adoption.

## Gates

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
