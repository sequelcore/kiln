# ADR-003: Budgeted Sufficient Context Orchestration

**Status:** Accepted
**Date:** 2026-04-03
**Author:** Ricardo Armenta
**Scope:** `packages/cli/src/application/`, `packages/cli/src/wrapper/`, `packages/runtime/src/gateway/`, `packages/core/src/memory/`, `packages/core/src/field/`, `packages/tui/src/`

---

## Context

### The Product Problem

Kiln can already orchestrate CLI and runtime sessions, persist transcripts,
track token/cost usage, and compact memory. What it does **not** yet do is
govern context as a first-class budgeted resource.

Today, the live prompt is still assembled mostly by forwarding available
context:

- `packages/cli/src/wrapper/preamble-builder.ts` structures the prompt and
  trims `memorySnapshot` to 200 lines
- `packages/cli/src/application/context-governance.ts` only strips
  `memorySnapshot` when file governance excludes it
- `packages/runtime/src/gateway/message-pipeline.ts` merges recalled memory,
  knowledge, and contact context into a single block
- `packages/core/src/memory/sqlite-store.ts` recalls within a token budget, but
  does not decide what is *sufficient* for the current turn

This means Kiln can observe token burn and enforce session limits, but it still
does not systematically answer the critical question:

**What is the minimum sufficient working set that should enter the next model
turn?**

### Research Convergence

Independent lines of research point in the same direction:

- **Prompt caching** (OpenAI, Anthropic): stable prefixes and reusable prompt
  structure reduce latency and cost
- **Persistent external memory** (Mem0): long-horizon agents perform better and
  cheaper when memory is extracted and recalled, not replayed as raw history
- **Structured retrieval** (GraphRAG, HippoRAG): retrieval should be selective
  and structure-aware, not just chunk stuffing
- **Sufficient-context framing** (Google Research): the key question is not
  “how much context was added?” but “is the context sufficient for this turn?”
- **Learned compression** (ACON): context compression should be treated as an
  optimization problem, not emergency summarization after overflow
- **Long-context orchestration** (Chain-of-Agents): large tasks can be solved by
  controlled decomposition rather than feeding ever-larger windows

These findings support a simple architectural conclusion:

**Context must be managed as an external working set with explicit budget,
selection, retrieval, compression, and continuity policies.**

---

## Decision

Introduce **Budgeted Sufficient Context Orchestration** as a top-level Kiln
architecture principle.

Kiln will treat provider context windows as bounded execution surfaces and
maintain a larger, externalized **virtual context window** composed of:

- structured session state
- exact artifacts
- long-term memory
- retrieved knowledge
- cached plans and summaries
- compacted prior turns

Before every model call, Kiln will build a **projected working set**: the
minimum sufficient context needed for the current turn under a configurable
token budget.

---

## Core Principles

1. **Transcript is not memory**
   Raw conversation history is an audit artifact, not the default live prompt.

2. **Context is a working set**
   The prompt should contain only the minimum sufficient state for the current
   decision/action.

3. **Exact artifacts and summaries have different roles**
   Summaries preserve continuity. Exact artifacts preserve precision.

4. **Compression is proactive**
   Kiln should compact continuously at phase/turn boundaries, not only when
   hitting the wall.

5. **Stable prefixes are sacred**
   Prompt structure must maximize reuse and provider-side caching where
   available.

6. **Resume must be context-governed**
   Session restore should reconstruct the right working set, not replay
   everything.

7. **Field dynamics are additive**
   Continuous salience and inhibition may guide recall and routing later, but
   only after the discrete context-governance layer is sound.

8. **No legacy hacks while Kiln is pre-consumer**
   Kiln currently has no external consumers that require compatibility
   preservation. During this phase, architecture quality takes precedence over
   backward compatibility with earlier internal shapes, partial config formats,
   or transitional wrapper behaviors. If a clean design requires breaking old
   internal assumptions, prefer the clean break.

---

## Architecture

### New Application Layer Concept: `ContextGovernor`

Kiln adds a new application service responsible for selecting the projected
working set for each turn.

Suggested location:

```text
packages/cli/src/application/context-governor.ts
packages/runtime/src/gateway/context-governor.ts
packages/core/src/memory/context-budget.ts
```

`ContextGovernor` does not store memory. It orchestrates:

- budget estimation
- candidate context collection
- sufficiency checks
- compression / summary selection
- cache selection
- prompt projection

Initial implementation note:

- The first CLI slice is now landed:
  `SessionContext` carries explicit projected context and the default governor
  already applies a deterministic token-budget selector over candidate blocks.
- The next CLI slice is also landed:
  the governor now accepts an explicit session ledger and exact operational
  artifacts, and the CLI persistence path stores/rehydrates that state on
  resume.
- The matching runtime slice is also landed:
  runtime session serialization and the shared message pipeline now persist and
  update ledger/artifact state from real session activity.
- The first cache slice is also landed:
  typed context-artifact cache interfaces exist in `core`, and the CLI path now
  writes and reuses cached session-summary, project-summary, plan-summary, and
  module-summary artifacts. Module summaries are keyed by current file content
  hash, and a reusable project-backed persistence adapter now lives in
  `packages/runtime/src/session/context-artifact-cache.ts`. The CLI currently
  uses that adapter to persist artifacts per project under
  `.kiln/context-artifacts.json`.
- Runtime now also owns a generic thread-summary cache path for gateway/TUI
  sessions: when a `ContextArtifactCache` is supplied, runtime can inject a
  cached thread summary before orchestration if the live session lacks its own
  continuity state and then refresh that summary after the turn.
- The runtime cache layer now also persists bounded support artifacts for:
  - escalation/handoff continuity
  - context summaries by route/provider/task shape
  - tool-result bundles by channel/task shape
- Resume under governance is now started in the CLI path:
  session preparation prefers cached resume artifacts first and only falls back
  to persisted exact-artifact replay when the cache layer cannot reconstruct
  enough continuity.
- Provider-native resume is now part of that policy decision rather than an
  unconditional passthrough: when cached resume artifacts already provide
  sufficient continuity, Kiln withholds the provider resume session and relies
  on reconstructed projected context instead.
- The first provider-aware rule is now explicit:
  `codex` and `opencode` are allowed to use native resume when cache continuity
  is weak, while `claude` currently remains cache-first.
- The chosen resume strategy is now persisted and reportable in the CLI path, so
  this policy can be inspected before expanding the decision surface further.
- The CLI path now also records bounded outcome data next to the chosen resume
  strategy, creating a minimal feedback loop for comparing strategy quality with
  real session results.
- The first deterministic policy-learning slice is now started:
  local project history can bias `cache-first` versus `provider-native` for the
  same provider when both are plausible, but only in borderline cases. Strong
  cache continuity still stays cache-first, and no-cache cases keep their
  existing native/fallback behavior.
- The CLI path now persists and reports that feedback signal explicitly,
  including whether local history actually influenced the final strategy choice
  and how many bounded samples were considered.
- The TUI now surfaces resume strategy and feedback in its sidebar without
  making session history provider-owned. Provider switching changes the next
  execution route, while resume still targets a canonical Kiln session.
- The interactive TUI path now also refreshes that metadata after completed
  turns by persisting minimal transcript meta for native-resume sessions and
  reloading the per-provider sidebar state.
- The interactive TUI session factory now also applies the same bounded
  cache-first versus provider-native resume policy surface used by the CLI path,
  instead of treating interactive resume as an unconditional native-resume case.
- The CLI path and interactive TUI path now share one authoritative
  resume-strategy decision helper, reducing policy drift between the two entry
  surfaces.
- That shared helper is now split into signal collection and strategy decision,
  so future runtime/gateway callers can reuse the decision layer without
  depending on CLI-shaped cache keys.
- The neutral presence-based signal collector now lives in `core`, and runtime
  support-artifact hydration uses it too. This is still part of `CG5`, but the
  shared substrate now spans `core`, `runtime`, and `cli` instead of only the
  interactive entry surfaces.
- The neutral resume-decision layer now also lives in `core`, while `cli`
  retains only provider-specific wrapper semantics above that shared decision
  substrate.
- Runtime support-artifact hydration now also calls the shared core decision
  layer, so this governed-resume work is no longer limited to CLI/TUI entry
  surfaces.
- Runtime continuity decisions are now explainable as well: gateway paths
  record the chosen cache-first or fallback continuity decision in session
  artifacts and trace logs instead of treating the policy as silent internal
  behavior.
- Runtime continuity now also persists bounded local outcome history, so later
  policy slices can compare governed cache-first versus fallback behavior using
  real gateway/TUI results instead of only static heuristics.
- Runtime continuity now feeds that bounded local history back into the shared
  decision layer, so borderline cache-first versus fallback choices can be
  biased by recent real outcomes instead of staying fully heuristic.
- Runtime continuity is now also operator-visible in the TUI path, keeping this
  governed decision surface inspectable beyond backend trace logs.
- `CG5` feature work is effectively complete; its final tests and cleanup are
  deferred to the end-of-phase context-governance sweep rather than blocking
  the start of `CG6`.
- `CG6` is now started with a bounded runtime context-pressure view in the TUI,
  using support-artifact count as the first operator-facing pressure signal.
- That first `CG6` slice now also exposes which bounded support sources are
  active, so operator visibility is not limited to a count alone.
- The same bounded `CG6` view now exposes why runtime fallback occurred,
  distinguishing absent sources from policy-driven fallback and existing live
  session continuity.
- The same bounded `CG6` view now also distinguishes available support sources
  from support sources actually selected into the current turn.
- The same bounded `CG6` view now adds a short selection explanation so the
  operator can tell whether selection happened due to single-source cache,
  multi-source cache, explicit policy withholding, or absence of sources.
- `CG6` now also extends into the CLI/reporting path, so context-governance is
  not TUI-only; the session report can summarize selected tokens, budget, and
  selected/deferred context kinds from the actual projected working set.
- That CLI/reporting surface now also explains bounded defer reasons, so
  deferred context is not only counted but given a compact policy explanation.
- That same CLI/reporting surface now shows source breakdowns for selected and
  deferred blocks, so operators can see where projected context actually came
  from.
- `CG6` feature work is now substantially complete; its final tests and cleanup
  are deferred to the same end-of-phase context-governance sweep as `CG5`
  rather than blocking `CG7`.
- `CG7` is now started with the first live configuration slice:
  `kiln.yaml` now uses a first-class `contextGovernance` block, and the
  projected-context assembly path already honors:
  - `contextGovernance.turnBudget`
  - `contextGovernance.cachePolicy`
  - `contextGovernance.preferredSources`
- the same `CG7` layer now also honors
  `contextGovernance.summaryAggressiveness`, currently as a bounded score
  adjustment that shifts optional summaries versus optional artifacts without
  changing required-block semantics
- the same `CG7` layer now also honors `contextGovernance.previewBeforeApply`
  in the CLI path, printing a bounded preview from the actual projected
  working set before the session starts
- `CG7` feature work is now substantially complete; its final verification and
  cleanup are deferred to the same end-of-phase sweep as `CG5` and `CG6`
- `F1` is now started with the first field substrate slice in `core`:
  `FieldSignal`, `FieldVector`, `FieldSnapshot`, `FieldConfig`, `FieldStore`,
  and `InMemoryFieldStore` now exist as a new bounded context without changing
  routing or recall behavior yet
- That preferred-source policy is currently implemented as a bounded score bias
  over optional projected-context blocks rather than as a hard exclusion rule,
  so required correctness context cannot be starved by configuration alone.
- This is intentionally only the foundation. Richer candidate collection,
  runtime integration, and sufficiency policy still need to be built.

### Context Tiers

Kiln should model context in explicit tiers:

1. **Stable prefix**
   - static system instructions
   - tool definitions
   - domain/quality-gate context
   - cacheable boilerplate

2. **Session ledger**
   - current goal
   - plan step
   - constraints
   - open questions
   - current phase

3. **Exact working artifacts**
   - file paths
   - commands
   - stack traces
   - diffs
   - tool outputs

4. **Retrieved memory / knowledge**
   - user facts
   - project memory
   - relevant knowledge snippets
   - prior summaries

5. **Compacted history**
   - turn summaries
   - session handoff summaries
   - plan summaries

Only the needed portions of tiers 2-5 should enter the live prompt.

### New Projection Flow

For each turn:

1. Determine task class and target action
2. Estimate token budget for the turn
3. Collect candidate context from memory, session state, knowledge, and caches
4. Rank candidates by relevance and necessity
5. Include exact artifacts required for correctness
6. Fill remaining budget with summaries / memory / knowledge in descending value
7. Emit a projected working set for prompt assembly

This flow will feed:

- `packages/cli/src/wrapper/preamble-builder.ts`
- `packages/runtime/src/gateway/context-formatter.ts`
- future TUI context-pressure views

### Caches

Kiln should introduce cacheable context artifacts before caching final model
responses.

Priority caches:

- `PrefixCache`
  stable prompt sections and reusable static blocks
- `PlanCache`
  reusable plan skeletons and prior successful plan summaries
- `RepoContextCache`
  file/module summaries keyed by content hash
- `CompactionCache`
  validated session summaries and handoff artifacts
- `ToolResultCache`
  only for safe/idempotent tools

### Sufficiency Policy

Kiln should explicitly distinguish:

- **required** context: must be present for correctness
- **supporting** context: useful but optional
- **deferred** context: not needed for this turn

This can begin as a deterministic policy layer and later evolve into learned
policies.

---

## Consequences

### Positive

- Lower effective token burn through explicit working-set projection
- Stronger resume behavior because Kiln owns the session ledger outside the
  provider
- Better compatibility with provider prompt caching and session reuse
- Cleaner path to cross-surface context-pressure visibility and cost forecasting

### Negative

- More orchestration complexity in the application layer
- New cache invalidation rules and summary-quality risks
- Additional policy decisions for every turn
- Requires discipline to avoid duplicating logic across CLI and runtime paths

### Compatibility Stance

- Do **not** preserve weak abstractions just because they already exist
- Do **not** add legacy shims for old internal context/prompt shapes unless a
  concrete current path still depends on them during the migration window
- Do **not** optimize for hypothetical future users over present architecture
- Prefer explicit migrations in-repo over permanent backward-compatibility code

### Neutral

- Existing transcript, memory, and budget systems remain valid
- Current compaction logic remains useful but becomes one input to a broader
  governor
- Provider-native resume and cache behaviors remain best-effort, especially for
  CLIs

---

## Verification

- Kiln can explain what context will be injected next turn and why
- Resume reconstructs a bounded working set instead of naive replay
- Operator surfaces can show current context pressure and projected prompt cost
- Prompt assembly uses explicit projected context, not ad hoc merged strings

---

## References

- OpenAI prompt caching docs
- Anthropic prompt caching docs
- Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory
- GraphRAG: From Local to Global
- HippoRAG
- Sufficient Context (Google Research)
- Chain-of-Agents
- ACON

---

*This ADR establishes context governance as a first-class Kiln primitive.*
