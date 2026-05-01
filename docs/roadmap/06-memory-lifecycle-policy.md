# 06 - Memory Lifecycle Policy

## Status

Started. Slices 06.A, 06.B, and 06.C landed on 2026-05-01 with pure lifecycle
policy domain contracts, a mutation-free evaluator, and a governed lifecycle
application service.

This roadmap should run before first-class managed agents write or propose
durable memory at scale.

## Goal

Restore the research-backed memory lifecycle capabilities on top of Memory
Lattice:

- retention
- decay
- forgetting
- compaction
- promotion
- salience and inhibition for recall

This is not a rollback to the deleted pre-lattice memory implementation. The
old helpers were removed because they were tied to `MemoryEntry`, git sync,
chunk sync, and the obsolete `user | agent | project` vocabulary. The new work
must operate on `MemoryRecord`, `MemoryScope`, `MemoryLayerKind`, provenance,
revisions, relations, archive state, context-admission evidence, and memory
events.

This roadmap is surface-neutral. GUI may be the first consumer because it is the
most practical local testing and inspection surface, but lifecycle policy is a
core/runtime capability that must project consistently to CLI, TUI, YAML apps,
SDK, MCP, IDE, remote operator surfaces, and future managed agents.

## Research Basis

The memory research conclusion is not "remember more." It is "separate memory
roles and govern mutation explicitly."

Relevant research inputs:

- `docs/research/05-memory-systems.md` - layered memory, consolidation,
  reconsolidation, cue-based recall, forgetting, and promotion criteria.
- `docs/research/08-context-governance.md` - salience, inhibition, pruning,
  overflow, and the separation between recall eligibility and injection
  eligibility.
- `docs/research/07-regulation-and-adaptation.md` - predictive compaction and
  budget reservation as allostatic regulation.
- `docs/research/10-coordination-intelligence.md` - shared-state trace
  dynamics, evaporation, saturation, and stale-state risk.
- `docs/adr/ADR-008-memory-lattice-governed-memory.md` - lifecycle capabilities
  must return as governed policies over the Memory Lattice model and must not
  mutate silently inside repository adapters.

## Non-Negotiables

- No resurrection of pre-lattice `MemoryEntry` stores, decay helpers,
  compactor classes, git sync, or chunk sync as compatibility code.
- No repository-side silent decay, compaction, archival, or deletion.
- No uniform decay across all layers.
- No silent decay of semantic memory because it is old.
- No rewrite of audit memory.
- No model-context admission outside `ContextGovernor`.
- No deletion or forgetting path without explicit scope validation and event
  evidence.
- No lifecycle policy that bypasses `MemoryMutationService` or equivalent
  governed application services.

## Target Model

Lifecycle policy acts in three stages:

1. Evaluate records and produce proposed lifecycle actions.
2. Apply approved actions through governed memory services.
3. Emit revisions, relations, archive records, deletion evidence, and memory
   events for every material change.

The repository remains an authoritative storage boundary only. Policy selection,
mutation, archival, compaction, promotion, and event emission belong in memory
application services.

## Slice Plan

### Slice 06.A - Lifecycle Policy Domain

Goal: introduce pure lifecycle policy contracts with no IO.

Status: implemented on 2026-05-01.

Primary files:

- `packages/core/src/memory/lifecycle/*`
- `packages/core/tests/memory/lifecycle/*`
- `docs/architecture/memory.md`

Contracts:

- `MemoryRetentionPolicy`
- `MemoryDecayPolicy`
- `MemoryForgettingPolicy`
- `MemoryCompactionPolicy`
- `MemoryPromotionPolicy`
- `MemoryLifecyclePolicySet`
- `MemoryLifecycleDecision`
- `MemoryLifecycleAction`

Acceptance:

- policies are layer-aware and scope-aware
- audit memory cannot be rewritten
- semantic memory does not decay by default
- invalid policy values fail fast
- no imports from runtime, GUI, filesystem, SQLite, or gateway packages

Verification:

- `bun run --cwd packages/core test tests/memory/lifecycle/policy.test.ts`
- `bun run --cwd packages/core test tests/memory`
- `bun run --cwd packages/core typecheck`
- `bun run typecheck`
- `bun run test`

### Slice 06.B - Lifecycle Evaluator

Goal: evaluate records and produce proposed lifecycle actions without mutating
state.

Status: implemented on 2026-05-01.

Primary files:

- `packages/core/src/memory/lifecycle/evaluator.ts`
- `packages/core/tests/memory/lifecycle/evaluator.test.ts`

Action types:

- retain
- lower recall salience
- archive
- compact
- promote
- forget
- create derived summary

Acceptance:

- evaluator returns auditable reasons
- decisions include policy id/version
- episodic decay differs from semantic retention
- stale coordination records can be proposed for archival without deleting audit
  evidence
- evaluator has deterministic ordering for batch decisions

Verification:

- `bun run --cwd packages/core test tests/memory/lifecycle`
- `bun run --cwd packages/core test tests/memory`
- `bun run --cwd packages/core typecheck`
- `bun run typecheck`
- `bun run test`

### Slice 06.C - Governed Lifecycle Application Service

Goal: apply approved lifecycle actions through governed memory services.

Status: implemented on 2026-05-01.

Primary files:

- `packages/core/src/memory/lifecycle/service.ts`
- `packages/core/src/memory/service.ts`
- `packages/core/src/memory/sqlite-repository.ts`
- `packages/core/tests/memory/lifecycle/service.test.ts`

Acceptance:

- all mutations go through `MemoryMutationService` or a governed memory
  application service
- compaction creates revisions, relations, or derived records instead of blind
  overwrite
- archive/delete operations preserve audit evidence
- lifecycle events are emitted from the service layer
- repository adapters do not emit lifecycle events directly
- same-topic records can coexist so compaction can operate over topic groups

Verification:

- `bun run --cwd packages/core test tests/memory/lifecycle/service.test.ts`
- `bun run --cwd packages/core test tests/memory/lifecycle`
- `bun run --cwd packages/core test tests/memory`
- `bun run --cwd packages/core typecheck`

### Slice 06.D - Recall Salience And Inhibition

Goal: add lifecycle-aware recall scoring without bypassing context governance.

Primary files:

- `packages/core/src/memory/recall/*`
- `packages/core/src/memory/graph/projector.ts` if graph score projection needs
  lifecycle evidence
- `packages/core/tests/memory/recall/*`

Inputs:

- scope match
- layer
- topic/cue match
- confidence
- recency
- prior admission usefulness
- decay-adjusted salience for mutable layers
- inhibition for stale or noisy records

Acceptance:

- recall eligibility is separate from context injection eligibility
- `ContextGovernor` remains the only owner of model-context admission
- salience changes are bounded and explainable
- low-salience records remain inspectable unless policy archives or deletes
  them

### Slice 06.E - Promotion And Compaction

Goal: promote useful operational memory and compact stale episodic material
without corrupting lineage.

Primary files:

- `packages/core/src/memory/lifecycle/promotion.ts`
- `packages/core/src/memory/lifecycle/compaction.ts`
- `packages/core/tests/memory/lifecycle/promotion.test.ts`
- `packages/core/tests/memory/lifecycle/compaction.test.ts`

Acceptance:

- promotion from working or episodic memory requires explicit criteria:
  repeated utility, scope, provenance quality, confidence, and topic coherence
- compaction creates derived records with `derived_from`, `revises`, or
  `supersedes` relations
- source records remain inspectable unless a separate forgetting policy applies
- semantic memory is not overwritten by casual session noise

### Slice 06.F - Forgetting And Delete Semantics

Goal: make forgetting explicit, scoped, and auditable.

Primary files:

- `packages/core/src/memory/lifecycle/forgetting.ts`
- `packages/core/tests/memory/lifecycle/forgetting.test.ts`
- resource and graph tests if archived/deleted records need projection changes

Acceptance:

- scoped delete cannot cross tenant/user/project boundaries
- audit memory is preserved or separately redacted only through explicit policy
- graph and resource reads handle archived/deleted records consistently
- deletion emits bounded events and does not leak raw deleted content

### Slice 06.G - Operator Projection

Goal: expose lifecycle evidence across surfaces without creating surface-owned
memory policy.

Primary files:

- `packages/core/src/memory/resources/*`
- `packages/runtime/src/gateway/*`
- `packages/gui/src/components/memory-lattice/*`
- `docs/guides/memory.md`

Acceptance:

- operators can inspect why a record was retained, decayed, archived,
  compacted, promoted, or forgotten
- GUI reads lifecycle evidence through resources or gateway adapters backed by
  core resources and serves as the first practical live-test consumer
- CLI, TUI, YAML apps, SDK, MCP, IDE, remote surfaces, and managed agents consume
  the same lifecycle/resource contracts or explicitly deferred projections
- no GUI-private lifecycle registry
- CLI/MCP consumers can inspect lifecycle evidence through shared resource
  tools

## Relation To Managed Agents

Managed agents should not start durable memory writes at scale until lifecycle
policy exists. Child invocations will produce more memory pressure, more
coordination traces, and more write proposals than single-session flows.

Before `03-managed-agents-cross-provider-subagents.md` allows child agents to
propose or promote durable memories, Kiln needs:

- explicit promotion criteria
- lifecycle-aware recall scoring
- stale coordination trace handling
- scope-safe forgetting
- auditable compaction and archive behavior

## Verification Gates

- tests are written before implementation for every behavioral slice
- `bun run typecheck`
- `bun run test`
- lifecycle policy domain imports no runtime, GUI, gateway, filesystem, or
  SQLite modules
- repository adapters do not own lifecycle policy or event emission
- scope isolation is tested for retention, archival, and delete paths
- graph/resource reads remain bounded
- `ContextGovernor` remains the only model-context admission owner
- no dead pre-lattice memory compatibility code is restored
