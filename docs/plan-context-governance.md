# Context Governance & Field Layer Plan

> Generated: 2026-04-03.
> Sources: current Kiln codebase, ADR-001, ADR-004, and recent context/memory research.

## Status Snapshot

**All CG and F phases complete as of 2026-04-03.** See ADR-004 implementation
status table for the full summary. Remaining deferred work: ADR-001 salience
overlay integration once field substrate is proven in production.

---

### Historical detail (CG1–CG2 initial notes)

As of `2026-04-03`, the first two slices have started:

- `CG1` landed in the CLI path:
  - explicit `ProjectedContext` and `ProjectedContextBlock` types exist
  - `SessionContext` now carries `projectedContext` instead of a raw
    `memorySnapshot`
  - prompt assembly renders projected context rather than reading anonymous
    memory strings directly
- `CG2` landed in a first deterministic pass:
  - `packages/core/src/memory/context-budget.ts` now provides a reusable
    budget selector
  - the default CLI `ContextGovernor` now selects projected blocks under a token
    budget instead of blindly forwarding every candidate block

What is still missing from `CG2`:

- richer candidate collection beyond the current memory-snapshot input
- explicit required/supporting/deferred sources from session ledger and exact
  artifacts
- runtime-side governor integration
- TUI visibility for projected context pressure

`CG3` is now complete for the CLI path:

- `packages/cli/src/application/session-ledger.ts` now defines explicit session
  ledger state
- the CLI governor can now consume:
  - session-ledger candidates
  - exact operational artifact candidates
- `run.ts` now resolves resume state before session preparation so the initial
  ledger can capture resumed-session context
- session metadata now persists:
  - structured ledger state
  - exact artifacts
- resume preparation now hydrates prior ledger/artifact state back into the
  governor
- runtime session serialization now persists:
  - structured ledger state
  - exact artifacts
- shared runtime message processing now records ledger/artifact state from real
  routing, summary, escalation, grounding, and tool-execution outcomes

`CG4` is now started in controlled slices:

- `core` now defines typed context-artifact cache interfaces plus an in-memory
  implementation
- the CLI path now writes a reusable session-summary artifact on successful
  session completion
- resume preparation can inject that cached summary back into the projected
  context via the governor
- the reusable project-backed persistent cache adapter now lives in
  `packages/runtime/src/session/context-artifact-cache.ts`, so downstream
  runtime consumers can use the same cache substrate instead of depending on a
  CLI-wrapper-only implementation
- runtime gateway/TUI flows can now read and refresh a generic thread-summary
  artifact keyed by `appName + tenantId + userId` when a
  `ContextArtifactCache` is supplied
- runtime cache coverage now also includes:
  - escalation/handoff summaries per thread
  - context-summary bundles keyed by route/provider/task shape
  - tool-result bundles keyed by channel/task shape

## Goal

Implement context/token governance first, then implement the ADR-001 field layer
as an advanced salience overlay.

This plan is sequential on purpose:

- **Phase CG** solves the immediate product problem: token burn, context bloat,
  weak resumability
- **Phase F** builds the deferred field layer on top of that stronger substrate

## Compatibility Rule

Kiln currently has no external consumers that justify preserving weak internal
shapes or adding legacy compatibility hacks.

For this plan:

- prefer clean replacements over adapter layers
- prefer schema and API changes over permanent shims
- migrate in-repo call sites directly
- remove obsolete structures once the replacement is landed

This phase should optimize for architecture quality and future leverage, not
backward compatibility with prior internal versions.

---

## Current Code Reality

Kiln already has the following ingredients:

- Prompt assembly:
  [preamble-builder.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/preamble-builder.ts),
  [context-formatter.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/context-formatter.ts)
- Minimal governance seam:
  [context-governance.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/application/context-governance.ts)
- Memory recall and compaction:
  [sqlite-store.ts](/C:/Proyectos/Sequel/kiln/packages/core/src/memory/sqlite-store.ts),
  [compactor.ts](/C:/Proyectos/Sequel/kiln/packages/core/src/memory/compactor.ts)
- Session persistence and resume:
  [session-store.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/session-store.ts),
  [session-manager.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/session-manager.ts),
  [mode-b-session.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/session/mode-b-session.ts)
- Budget/token tracking:
  [budget-middleware.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/budget-middleware.ts),
  [message-pipeline.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/message-pipeline.ts)
- TUI budget/resume surfaces:
  [state.ts](/C:/Proyectos/Sequel/kiln/packages/tui/src/state.ts),
  [handlers.ts](/C:/Proyectos/Sequel/kiln/packages/tui/src/handlers.ts),
  [tui.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/commands/tui.ts)
- Provider routing:
  [session-registry.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/session-registry.ts)

Main gap:

- Kiln has raw ingredients, but no single policy layer that decides what the
  minimum sufficient context is for the next turn.

---

## Phase CG — Budgeted Sufficient Context

### CG1. Introduce explicit projected-context types

**Goal:** stop treating prompt assembly as anonymous strings.

**Status:** DONE (first CLI slice landed 2026-04-03)

**Files**
- new `packages/cli/src/application/context-governor.ts`
- new `packages/cli/src/application/context-types.ts`
- new `packages/runtime/src/gateway/context-governor.ts`

**Work**
- Define types for:
  - stable prefix
  - session ledger
  - exact artifacts
  - retrieved memory bundle
  - compacted summary bundle
  - projected working set
- Replace ad hoc `memorySnapshot?: string` assumptions with richer projected
  context objects at the application layer

**Why first**
- Everything else depends on explicit context structure
- This is a clean-break step; do not keep weak legacy prompt/context shapes
  alive longer than necessary

### CG2. Build deterministic budget selector

**Goal:** pick the minimum sufficient context for the turn under a token budget.

**Status:** STARTED (first deterministic selector landed 2026-04-03)

**Files**
- new `packages/core/src/memory/context-budget.ts`
- `packages/cli/src/application/context-governance.ts`
- `packages/cli/src/application/run-session.ts`
- `packages/runtime/src/gateway/message-pipeline.ts`
- `packages/runtime/src/gateway/context-formatter.ts`

**Work**
- Add a deterministic scoring policy:
  - required
  - supporting
  - deferred
- Estimate token cost for candidate context blocks
- Select exact artifacts first, then summaries, then optional recall
- Feed the projected working set into prompt assembly

**Result**
- Kiln moves from “trim what we have” to “choose what we need”
- First landed step: reusable core selector + CLI governor integration
- Remaining work: broaden candidate sources and wire runtime/TUI visibility

### CG3. Add session ledger and exact artifact extraction

**Goal:** separate continuity state from transcript replay.

**Status:** DONE (CLI path landed 2026-04-03)

**Files**
- `packages/cli/src/wrapper/session-store.ts`
- `packages/runtime/src/session/mode-b-session.ts`
- new `packages/cli/src/application/session-ledger.ts`

**Work**
- Persist structured per-session state:
  - goal
  - current plan step
  - open questions
  - changed files
  - last error / blocker
  - last useful tool outputs
- Keep transcript as audit log, not live default prompt source

**Landed scope**
- `SessionLedger` type exists
- CLI preparation path injects ledger and exact operational artifacts into the
  governor
- session metadata persists structured ledger state and exact artifacts
- resume preparation hydrates prior ledger/artifact state back into the
  governor

**Deferred follow-up**
- richer artifact extraction from broader tool/result categories
- deeper task-state capture beyond the current phase/error/provider/tool-depth
  baseline

### CG4. Add cacheable context artifacts

**Goal:** reuse context work rather than regenerate it.

**Status:** STARTED (first session-summary cache slice landed 2026-04-03)

**Files**
- new `packages/core/src/memory/context-cache.ts`
- new `packages/core/src/memory/plan-cache.ts`
- new `packages/core/src/memory/repo-context-cache.ts`
- `packages/cli/src/application/context-governor.ts`

**Work**
- Cache:
  - stable prefix blocks
  - validated session summaries
  - plan summaries/templates
  - file/module summaries keyed by content hash
  - safe tool outputs for idempotent tools

**Note**
- Do not start with final response caching

**First landed step**
- typed context-artifact cache interfaces in `core`
- persistent project-scoped cache implementation via a reusable runtime adapter
- CLI session-summary artifact generation and reuse on resume
- CLI project-summary artifact generation and reuse by working directory
- CLI plan-summary/template artifact generation and reuse by project + task key
- CLI module-summary artifact generation and reuse keyed by current file content
  hash
- runtime gateway/session flows can now consume and refresh a generic cached
  thread summary when a cache adapter is provided
- runtime gateway/session flows now also write and reuse bounded escalation,
  context-summary, and tool-result support artifacts

**Remaining work**
- expand artifact quality/ranking beyond the current bounded runtime support
  bundles and hook the same cache semantics into more gateway/app entrypoints

### CG5. Resume under governance

**Goal:** resume into a bounded working set, not a bloated replay.

**Status:** SUBSTANTIALLY COMPLETE (final verification/cleanup deferred to the
end-of-phase context-governance sweep)

**Files**
- `packages/cli/src/commands/tui.ts`
- `packages/cli/src/wrapper/session-store.ts`
- `packages/cli/src/wrapper/session-manager.ts`
- `packages/cli/src/wrapper/claude-code-process.ts`
- `packages/cli/src/wrapper/codex-session.ts`
- `packages/cli/src/wrapper/opencode-session.ts`

**Work**
- On resume:
  - recover provider-native session IDs when useful
  - rebuild a projected working set from session ledger + compacted summaries
  - avoid resending unnecessary history

**First landed step**
- the CLI resume path now prefers cached session/project/plan/module artifacts
  when reconstructing projected context
- persisted exact artifacts now fall back only when the cache layer cannot
  supply enough continuity
- resume still keeps minimal session-ledger continuity, but no longer drags the
  prior exact-artifact set forward by default when cached summaries exist
- provider-native resume is now conditional in the CLI path: Kiln only passes a
  provider resume session through when cached continuity is weak enough that
  reconstructed context alone is not trusted yet
- provider-native trust is now backend-aware in the first policy pass:
  - `codex` and `opencode` may use native resume when cache continuity is weak
  - `claude` currently stays cache-first unless a later policy slice proves
    native continuity is worth trusting more aggressively
- resume strategy is now observable in the CLI path:
  - the chosen strategy is persisted in session metadata
  - the final session report prints whether Kiln used `cache-first`,
    `provider-native`, or `fallback-replay`
- resume strategy now also captures bounded outcome data:
  - success/failure
  - final provider
  - cost
  - tool count
  - duration
  - verification result when available
- local project history now provides a first deterministic feedback signal:
  - recent resume outcomes are compared by provider and strategy
  - only borderline cases are affected
  - strong cache remains cache-first
  - no-cache cases keep provider-native or fallback behavior
  - when evidence is strong enough, Kiln biases the strategy choice toward the
    cheaper or more successful local option
- reports and persisted session metadata now show whether that local history
  actually influenced the final resume choice or merely existed as background
  evidence, together with the bounded sample size considered
- the TUI now surfaces the last known per-provider resume strategy and feedback
  in the sidebar, so interactive provider switching exposes the same bounded
  resume-policy context without waiting for a CLI end-of-session report
- interactive TUI turns now refresh that sidebar metadata after completion by
  persisting minimal per-turn transcript meta in the TUI path and reloading the
  per-provider resume view
- the TUI session factory now also uses the same bounded cache-first vs
  provider-native resume policy surface instead of hardcoding interactive turns
  to `provider-native | none`
- the CLI path and TUI session factory now share one authoritative
  resume-strategy decision helper instead of maintaining near-copy policy logic
- that shared policy is now split into signal collection plus strategy
  decision, so future runtime/gateway callers can reuse the same decision layer
  without inheriting CLI-specific artifact-key construction
- the neutral presence-based signal collector now lives in `core`, and runtime
  support-artifact hydration uses it too, so the substrate is no longer only a
  CLI/TUI concern
- the neutral resume-decision layer now also lives in `core`, while the CLI
  keeps only the provider-specific wrapper semantics on top
- runtime support-artifact hydration now also calls the shared core decision
  layer, so `CG5` is no longer only about CLI/TUI resume behavior
- runtime continuity decisions are now explainable too:
  - runtime support-artifact reads return both content and decision metadata
  - gateway paths record the chosen `cache-first` or fallback continuity
    decision into session artifacts and trace logs
- runtime now also persists bounded continuity outcome history per
  thread/channel, including strategy, signal count, cache usage, queued vs
  responded result, token volume, tool count, and routed provider/model when
  available
- runtime now also reads that bounded outcome history back into the shared
  resume-policy decision layer, allowing cache-first versus fallback behavior
  to be biased by local runtime evidence in borderline cases
- the TUI now also surfaces runtime continuity strategy and feedback in the
  sidebar for the active provider, so governed runtime decisions are visible
  during interactive sessions instead of only in traces and cached artifacts
- final `CG5` closure work is intentionally deferred to the end-of-phase
  sweep:
  - focused tests for resume/runtime continuity behavior
  - final cleanup of any duplicated policy wording/helpers
  - status flip once the broader context-governance phase is closed

### CG6. TUI visibility for context pressure

**Goal:** make the governor visible to the operator.

**Status:** SUBSTANTIALLY COMPLETE (final verification/cleanup deferred to the
end-of-phase context-governance sweep)

**Files**
- `packages/tui/src/state.ts`
- `packages/tui/src/render.ts`
- `packages/tui/src/handlers.ts`

**Work**
- Show:
  - projected next-turn context size
  - current context pressure
  - selected sources for the next turn
  - why a summary or memory block was included/excluded

**First landed step**
- the TUI sidebar now shows a bounded runtime context-pressure line for the
  active provider
- the first pressure heuristic is derived from runtime support-artifact count:
  - `none`
  - `low`
  - `medium`
  - `high`
- the sidebar also shows the current support-artifact source count so the
  operator can see whether runtime continuity is being rebuilt from 0, 1, 2, or
  3+ cached support sources
- the sidebar now also names the current bounded source set:
  - `thread`
  - `handoff`
  - `context`
  - `tools`
- the sidebar now also distinguishes why runtime is in fallback:
  - `live-session`
  - `no-sources`
  - `sources-not-selected`
- the sidebar now also distinguishes bounded source availability versus actual
  selection for the current turn (`available-only` vs `selected`)
- the sidebar now also exposes a bounded selection explanation:
  - `single-source-cache`
  - `multi-source-cache`
  - `withheld-by-policy`
  - `no-sources`
  - `live-session`
- the CLI/session report path now also exposes a bounded context-governance
  summary from the real projected context:
  - selected tokens vs budget
  - selected/deferred block counts
  - selected/deferred block kinds
  - bounded defer reasons inferred from deferred projected-context blocks
  - selected/deferred block sources
- final `CG6` closure work is intentionally deferred to the same end-of-phase
  sweep as `CG5`:
  - focused UI/report verification
  - final naming cleanup across TUI and CLI surfaces
  - explicit status flip when the broader phase closes

### CG7. YAML/config support

**Goal:** make governance configurable without hardcoding policy.

**Status:** SUBSTANTIALLY COMPLETE (final verification/cleanup deferred to the
end-of-phase context-governance sweep)

**Files**
- `packages/cli/src/kiln-yaml-types.ts`
- parser/validation call sites as needed

**Work**
- Replace the narrow `compaction` config with broader `contextGovernance`:
  - turn budget
  - preview mode
  - preferred sources
  - summary aggressiveness
  - cache policy

**First landed step**
- `packages/cli/src/kiln-yaml-types.ts` now defines a first-class
  `contextGovernance` config block instead of the old narrow `compaction`
  shape
- the first live config fields are now wired into session preparation:
  - `contextGovernance.turnBudget`
  - `contextGovernance.cachePolicy`
  - `contextGovernance.preferredSources`
  - `contextGovernance.summaryAggressiveness`
  - `contextGovernance.previewBeforeApply`
- the default CLI/TUI preparation path now uses those fields to:
  - override the projected-context token budget
  - disable cache-backed projected-context assembly when explicitly requested
  - bias optional projected-context selection toward preferred source classes
    without excluding required context
  - tune optional summary-vs-artifact weighting without weakening required
    correctness blocks
  - print a bounded pre-run preview from the actual projected context when
    preview mode is enabled
- docs/examples now exist in the CLI wrapper guide so the first live
  `contextGovernance` surface is discoverable and copyable from project docs

**Compatibility note**
- The old `compaction` shape was too narrow and has been replaced directly
  rather than kept alive through indefinite compatibility parsing

**Deferred closure work**
- focused config-path verification
- final documentation cleanup once the broader phase closes

---

## Phase F — ADR-001 Field Layer

Begin only after Phase CG stabilizes.

### F1. Field substrate

**Status:** STARTED (first substrate slice landed 2026-04-03)

**Files**
- new `packages/core/src/field/domain/*`
- new `packages/core/src/field/infrastructure/*`

**Work**
- Add `FieldStore`, `FieldSnapshot`, `FieldVector`, config types
- Start with `InMemoryFieldStore`
- Add optional persistent store later

**First landed step**
- new `packages/core/src/field/` bounded context now exists
- domain substrate landed:
  - `FieldSignal`
  - `FieldVector`
  - `FieldSnapshot`
  - `FieldConfig`
  - `FieldStore`
- infrastructure substrate landed:
  - `InMemoryFieldStore`
  - `SqliteFieldStore` persisted vectors to a Bun SQLite file
- `@kilnai/core` now exports the field substrate for later runtime/router
  integration

### F2. EventBus-driven field updates
**Status:** STARTED (field updater now injects signals from a few EventBus events)
**Files**
- new `packages/core/src/field/field-updater.ts`
- integration with current EventBus emission sites

**Work**
- Inject signals from:
  - memory recall
  - tool execution
  - routing decisions
  - successful/failed turns
**First landed step**
- Added `FieldUpdater` that currently listens to `tool_result`, `memory_recalled`,
  `task_completed`, and `agent_routed` events and injects lightweight field
  signals into the shared `FieldStore`, but it does not yet alter routing
  or recall.
- Added `FieldPropagator` running every second; it applies decay + diffusion
  to the snapshot, injecting propagation signals back into the store without
  changing routing yet.
- Orchestrator now wires the shared store into these helpers via
  `field-service`, so live PhaseMachine events start populating the field.

### F3. Field-modulated recall

**Files**
- `packages/core/src/memory/sqlite-store.ts`
- `packages/cli/src/application/context-governor.ts`
- `packages/runtime/src/gateway/context-governor.ts`

**Work**
- Boost or suppress candidate recall bundles by field salience
- Keep deterministic correctness rules above field weighting
**First landed step**
- Introduced `field-service` so orchestrator wiring can share a single store/propagator.
- `context-governor` now reads field strength (category per block) and adds a bounded bonus to optional candidate scores based on the last snapshot.

### F4. Field-modulated routing

**Files**
- `packages/cli/src/wrapper/session-registry.ts`
- runtime routing call sites as needed

**Work**
- Bias route choice by field activity and saturation
- Keep hard constraints and circuit breaker semantics intact
**First landed step**
- `SessionRegistry._score()` reads `getFieldStrength("provider:<id>")` and
  adds a bounded +0..15 bonus after priority scoring. Hard exclusions and the
  circuit breaker remain the authoritative gate; the field bonus is a soft
  tiebreaker only.

### F5. Propagation, inhibition, stability

**Files**
- new `packages/core/src/field/field-propagator.ts`
- new `packages/core/src/field/field-inhibitor.ts`
- new `packages/core/src/field/stability-monitor.ts`

**Work**
- Decay
- diffusion
- inhibition
- runaway / starvation detection
**First landed step**
- `FieldPropagator`: decay + diffusion tick (landed in F1/F3).
- `FieldInhibitor`: lateral inhibition — suppresses weakest non-dominant regions
  when a dominant region exceeds the threshold; configurable strength, interval,
  and suppression limit.
- `StabilityMonitor`: detects runaway and starvation states; fires typed callbacks
  on transitions; `getStatus()` returns last computed state for polling callers.
- Both wired into `field-service` singletons and exported from `@kilnai/core`.
- `Orchestrator` constructor now calls `startFieldInhibitor()` and
  `startStabilityMonitor()` — both are active for every orchestrator instance.

### F6. TUI observability for the field

**Files**
- `packages/tui/src/state.ts`
- `packages/tui/src/render.ts`

**Work**
- Show:
  - dominant context regions
  - saturation
  - current routing pressure
  - whether the field is stabilizing or oscillating
**First landed step**
- `FieldSidebarInfo` added to `ReactiveState` with `dominantRegions`,
  `saturation`, `entropy`, and `status`.
- `renderSidebarField` renders a 3-line panel: field status indicator, top
  dominant regions, saturation % and entropy.
- `sidebarFieldText` wired into the sidebar below the resume block.
- `app.tsx` polls the shared `FieldStore` every 2 s and updates the panel live.

---

## Verification Criteria

### Phase CG is successful when

- prompt assembly receives explicit projected context objects
- next-turn context can be explained before execution
- resume reconstructs a bounded working set
- token burn is reduced on repeated/resumed workflows
- TUI shows projected context pressure, not only historical spend
- obsolete internal prompt/context compatibility shims have been removed

### Phase F is successful when

- field snapshots influence retrieval and routing without breaking correctness
- overloaded regions can be inhibited
- field-modulated behavior is observable and optional
- deterministic routing remains available as fallback

---

## Recommended Order

1. CG1
2. CG2
3. CG3
4. CG4
5. CG5
6. CG6
7. CG7
8. F1
9. F2
10. F3
11. F4
12. F5
13. F6

---

## Why This Matters

This phase is strategically important because it gives Kiln a reason to exist as
more than a wrapper.

If Kiln can reduce token burn, preserve continuity, and project the minimum
sufficient working set into each turn, it becomes the right environment for
using Kiln to build Kiln itself.

That creates a compounding advantage:

- cheaper long-horizon sessions
- less context drift
- better resume quality
- stronger multi-provider orchestration

This is the layer that makes the rest of Kiln easier to use, cheaper to run,
and more defensible as a product.
