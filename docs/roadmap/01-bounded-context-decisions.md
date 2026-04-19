# Bounded-Context Decisions

This document assigns an explicit refactor disposition to the major Kiln
packages and modules.

Allowed decisions:

- `keep`
- `split`
- `merge`
- `rename`
- `delete`

Multiple actions can apply when a module contains both valuable core logic and
obsolete framing.

## Purpose

Use this table before code refactors begin so each major area has a declared
fate. This avoids broad churn and prevents the old architecture from being
accidentally preserved through piecemeal edits.

Read first:

- Canonical naming and doctrine are now carried by the modular architecture docs.
- The prior module-mapping slice is closed and absorbed as completed planning context.

## Decision Table

| Area | Decision | Target direction | Why |
|------|----------|------------------|-----|
| `packages/core/src/engine` | `split`, `rename`, `keep` | Preserve foundational contracts and validation; extract or rename app/team/workflow-first language that blocks control-plane terminology | It still owns useful structural contracts but carries old identity heavily |
| `packages/core/src/orchestrator` | `split`, `rename` | Continue breaking apart into `IngressGovernor`, `DemandAllocator`, `ChainGovernor`, and related control logic; treat current split artifacts as partial completion, not end state | High-value logic exists here, but the naming and boundaries remain only partially modernized |
| `packages/core/src/tree` | `split`, `merge`, `delete` | Merge valid task-lifecycle ownership into `TaskRegistry`; delete speculative tree abstractions that do not survive the new model | Task ownership matters; exploration-first tree abstractions may not |
| `packages/core/src/memory` | `keep`, `split` | Keep storage and recall foundations; split toward layered memory responsibilities | Strategically important and compatible with the new doctrine after restructuring |
| `packages/core/src/knowledge` | `keep`, `split` | Keep retrieval/source-grounding logic; integrate more explicitly with `ContextGovernor` and layered memory | Useful subsystem, but should no longer overdefine product identity |
| `packages/core/src/field` | `split`, `merge`, `rename` | Rehome context-pressure and field-like concepts into `ContextGovernor` or `AdaptationEngine` where justified | Currently diffuse and conceptually unstable |
| `packages/core/src/safety` | `keep`, `merge` | Retain rails, classification, sanitization, and grounding logic under a clear `SafetyKernel` boundary | Strong base exists but ownership is fragmented |
| `packages/core/src/security` | `keep`, `merge` | Fold command safety, prompt scanning, secrets, audit, and guardian logic into the kernel boundary where possible | Security is real, but too separate from the safety story today |
| `packages/core/src/sandbox` | `keep`, `merge` | Treat as enforcement infrastructure under `SafetyKernel` rather than a parallel policy system | Important boundary-enforcement substrate |
| `packages/core/src/tools` | `keep`, `merge`, `rename` | Keep runtime tool execution and MCP exposure; align terminology under tool-execution doctrine | Real capability, but currently documented and owned too loosely |
| `packages/core/src/events` | `keep` | Keep as telemetry/event substrate under `TelemetryLoop` | Core infrastructure with low naming pressure |
| `packages/core/src/observability` | `keep` | Keep and clarify as observability segment of `TelemetryLoop` | Already aligned enough |
| `packages/core/src/cost` | `keep` | Keep under telemetry and control feedback | Important feedback loop input |
| `packages/core/src/enrichment` | `keep`, `split` | Keep if it remains operationally useful; separate telemetry-grade analytics from product-facing enrichment | Mixed telemetry and product concerns |
| `packages/core/src/eval` | `keep` | Keep as evaluation and verification support | Valuable and mostly orthogonal |
| `packages/core/src/verification` | `keep`, `merge` | Keep verification mechanics; merge policy ownership with governed execution flows | Useful but should not float as an isolated concern |
| `packages/core/src/domain` | `split`, `rename`, `keep` | Preserve only what fits DDD-safe boundaries; avoid letting "domain" become a vague umbrella | The name risks overlap with actual bounded-context language |
| `packages/core/src/domains` | `keep`, `demote` | Keep only as implementation support for stack-aware defaults | Not architectural center |
| `packages/core/src/package` | `keep` | Keep if still required for packaging/distribution | Operational area, low architectural pressure |
| `packages/core/src/presets` | `split`, `delete` | Keep only if presets still serve a concrete runtime purpose; delete stale preset layers | High risk of legacy abstraction residue |
| `packages/core/src/skill` | `keep` | Keep as operational capability surface | Useful, not architecture-defining |
| `packages/runtime/src/session` | `split`, `rename` | First separate session state/lifecycle, orchestration, persistence, and turn-recording/support helpers into coherent seams; rename toward control-plane vocabulary only after those seams are clean | One of the highest-value refactor targets, but already partially executed |
| `packages/runtime/src/gateway` | `keep`, `split` | Keep as runtime surface; separate admission, hosting, and transport concerns more clearly | Important, but should not define doctrine |
| `packages/runtime/src/channels` | `keep` | Keep as runtime I/O surface | Operationally necessary and conceptually stable |
| `packages/runtime/src/trigger` | `keep`, `split` | Keep trigger mechanics; align trigger admission and execution with governed flows | Useful but currently app/workflow-biased |
| `packages/runtime/src/tenant` | `keep`, `split` | Keep tenant isolation and config handling; reduce spillover into routing/identity logic | Important for isolation, but concept boundaries need tightening |
| `packages/runtime/src/mcp` | `keep`, `merge` | Keep MCP exposure; merge shared-state ownership concerns into future `CoordinationStore` where appropriate | Valuable integration layer with some state overlap |
| `packages/runtime/src/execution` | `keep`, `merge`, `rename` | Consolidate runtime execution ownership with the canonical flow model | Likely future home for explicit execution control surfaces |
| `packages/runtime/src/observability` | `keep` | Keep under `TelemetryLoop` | Operationally aligned already |
| `packages/runtime/src/a2a` | `keep`, `demote` | Keep if still useful, but treat as integration capability rather than identity | Peripheral to the control-plane core |
| `packages/cli/src/wrapper` | `rename`, `split`, `keep` | Keep as operator/runtime surface; remove meta-orchestrator-era framing from names and boundaries | Important surface with outdated conceptual leakage |
| `packages/cli/src/commands` | `keep` | Keep as command surface | Operationally necessary |
| `packages/cli/src/config` | `keep` | Keep as local configuration layer | Low architectural conflict |
| `packages/cli/src/sync` | `keep`, `demote` | Keep as support tooling, not product identity | Important utility, not doctrine |
| `packages/tui` | `keep`, `demote` | Keep as operator-facing surface under the control plane | Surface, not identity |
| `packages/sdk` | `keep` | Keep as integration surface | Stable enough conceptually |
| `packages/widget` | `keep` | Keep as embeddable surface | Stable enough conceptually |
| `packages/studio` | `keep` | Keep as inspection/development surface | Useful operator/developer interface |
| `packages/tools*` | `keep` | Keep as platform packaging support | Infrastructure, low conceptual pressure |

## Named Pressure Points

These current names should be treated as unstable unless justified by code-level
decisions:

- `orchestrator`
- `demand-allocator`
- `cascade-controller`
- `task-channel`
- `team-composer`
- `swarm` terminology
- `router` when used as architecture language rather than a narrow implementation detail

Some of these names already survive only as partial implementation residue or
legacy seams. They should be evaluated against the current exported surface, not
treated as if all of them remain equally active.

## Current Status

This decision table is no longer pure forward-looking planning. Parts of it have
already been partially executed by later roadmap work.

Current state of the highest-pressure rows:

- `packages/core/src/orchestrator`: partial
  Split artifacts such as `demand-allocator.ts`, `chain-governor.ts`, and
  `task-registry.ts` now exist, but the directory is not yet fully aligned to
  the target architecture.
- `packages/runtime/src/session`: partial
  Current `ModeBSession`, `ModeBOrchestrator`, and `SessionRegistry` surfaces
  indicate real execution work already landed, but the bounded-context and
  naming story is not yet settled. The next correct move is to separate state,
  orchestration, persistence, and support helpers before introducing a new
  control-plane name.
- `packages/core/src/engine`: open
  The engine surface still carries orchestrator-era naming and remains an active
  cleanup target.
- `packages/core/src/safety` + `security` + `sandbox` + `tools`: open
  These boundaries still exist as separate areas and have not yet converged into
  one clearly expressed kernel boundary.
- `packages/core/src/memory` + `knowledge` + `field`: open
  These remain distinct surfaces and still need the layered-memory and
  context-governance consolidation described here.

### `packages/runtime/src/session` execution slices

The session bounded context should now be executed in these slices:

1. Export freeze + characterization gates
   Define the public session surface explicitly and add tests that lock current
   behavior for session mode transitions, serialization, optimistic concurrency,
   and the runtime session barrel exports.
2. Persistence seam extraction
   Keep `SessionRegistry`, `SessionStore`, `InMemorySessionStore`,
   `RedisSessionStore`, and `session-serializer` conceptually grouped as
   persistence/identity infrastructure around the session aggregate, not as part
   of orchestration.
3. Support-helper extraction
   Separate continuity, summarization, escalation, artifact, and turn-recording
   helpers from the core session state and orchestration boundary.
4. Orchestrator internal decomposition
   Split `ModeBOrchestrator` into coherent internal collaborators for approvals,
   tool execution, routing/cost emission, and final response assembly without
   renaming the public surface yet.
5. Rename only after seams are clean
   Re-evaluate `ModeB*` naming only after state, orchestration, persistence, and
   support helpers are structurally separated.

#### First slice scope

The first slice is intentionally narrow:

- files in scope:
  - `packages/runtime/src/index.ts`
  - `packages/runtime/src/session/index.ts`
  - `packages/runtime/tests/session/session-mode.test.ts`
  - `packages/runtime/tests/session/session-serializer.test.ts`
  - `packages/runtime/tests/session/session-registry.test.ts`
  - any new focused session export/contract test file under
    `packages/runtime/tests/session/`
- goals:
  - make the runtime and session barrels the explicit reference surface for the
    current session boundary
  - lock the current session semantics with tests before structural extraction
- explicit non-goals:
  - no renaming of `ModeBSession`, `ModeBOrchestrator`, or `SessionRegistry`
  - no extraction of helpers yet
  - no behavior changes to routing, approvals, or tool execution

#### Slice progress

- Slice 1 (export freeze + characterization gates): done.
- Slice 2 (persistence seam extraction): done. `session/persistence/*`
  hosts the persistence implementations while legacy session file paths remain
  as compatibility wrappers.
- Slice 3 (support-helper extraction): done.
  - Extracted support helpers to `packages/runtime/src/session/support/*`:
    - `summarization/context-summarizer.ts`
    - `summarization/agent-handoff-summarizer.ts`
    - `escalation/escalation-detector.ts`
    - `artifacts/context-artifact-cache.ts`
    - `artifacts/context-artifact-summary.ts`
  - Updated session and runtime imports to consume the new support paths
    directly (no legacy wrapper shims were retained).
  - `runtime-turn-record.ts` remains in session core because it mutates
    canonical session state (`accumulateTokens`, `updateSessionLedger`,
    exact-artifact append), while consuming support artifact writers from
    `support/artifacts/context-artifact-summary.ts`.
- Slice 4 (orchestrator internal decomposition): done.
  - `ModeBOrchestrator` now coordinates internal collaborators instead of
    directly owning approvals, routing selection, tool execution, telemetry,
    and final response assembly in one file.
  - Added internal collaborators:
    - `mode-b-orchestrator-approvals.ts`
    - `mode-b-orchestrator-routing.ts`
    - `mode-b-orchestrator-tool-executor.ts`
    - `mode-b-orchestrator-telemetry.ts`
    - `mode-b-orchestrator-response.ts`
    - `mode-b-orchestrator.types.ts`
  - Public `ModeBOrchestrator` naming and external imports remain unchanged for
    the slice; the decomposition is internal only.

## First Refactor Sequence

The first code refactor sequence should follow this order:

1. `packages/core/src/orchestrator`
2. `packages/runtime/src/session`
3. `packages/core/src/engine`
4. `packages/core/src/safety` + `security` + `sandbox` + `tools`
5. `packages/core/src/memory` + `knowledge` + `field`

This order is preferred because it moves from the most identity-defining logic
to the supporting subsystems.

## Deletion Rule

No area is considered "refactored" if the new path exists but the obsolete path
remains active without a concrete reason. Replacement phases must end with old
names, old abstractions, or dead modules being removed.

## Closure Standard

This bounded-context decision slice is closed when all of the following are
true:

- the decision table reflects current reality rather than pre-execution intent
  for the major high-pressure areas
- rows that have moved into partial execution are marked as such instead of
  remaining framed as untouched planning
- target directions use vocabulary that still matches the current codebase and
  the canonical architecture docs
- slices that execute these decisions have either landed or been explicitly
  delegated to later roadmap files
- the document can be treated as a frozen decision reference rather than as an
  untracked planning placeholder
