# Memory Systems

## Purpose

This document captures the research basis for Kiln's layered memory model.

Its job is not to restate the architecture document. Its job is to explain why
working, episodic, semantic, procedural, and mutable memory should remain
separate concerns with explicit consolidation and forgetting policy.

## Core Conclusion

The strongest memory conclusion for Kiln is not "remember more." It is
"separate memory roles and govern mutation explicitly."

Kiln benefits from:

- working memory for the active session and current task
- episodic memory for event-like traces and session continuity
- semantic memory for long-lived searchable knowledge
- procedural memory for reusable skills and execution recipes
- audit memory that is immutable and separate from mutable recall
- user-specific contact memory as a semantically scoped layer rather than an
  ad-hoc prompt convenience

## Research Inputs

### Working Memory

Useful for:

- active context assembly
- short-horizon state tracking
- budget-aware focus on what matters now

The key constraint is bounded capacity. Working memory should stay small and
should not silently absorb long-term storage duties.

### Episodic Memory

Useful for:

- session traces
- continuity across turns or resumptions
- replayable operational history

The biological analogy is event-and-context rich memory, not permanent truth.
This is why episodic material should be recoverable and useful, but not treated
as semantically authoritative by default.

### Semantic Memory

Useful for:

- durable knowledge retrieval
- concept-level recall
- cross-session domain knowledge

The important lesson is role separation. Semantic memory should not decay
silently just because it is old, and it should not be updated by casual
session-level noise.

### Procedural Memory

Useful for:

- skills
- learned execution recipes
- repeatable tool-use patterns

This is the clean research basis for keeping skills separate from general
knowledge and session state.

## Consolidation And Reconsolidation

Consolidation is the movement from volatile context into more durable memory.
The software lesson is that not every session artifact deserves promotion.

Promotion should require explicit criteria such as:

- repeated utility
- clear scope
- source provenance
- adequate confidence

Reconsolidation is more important than simple overwrite. When a recalled memory
is touched again, Kiln should decide whether to:

- add a new fact
- update an existing memory
- leave the existing memory unchanged
- delete or retire a memory that is no longer valid

This is why mutable memory needs explicit update rules rather than blind merge.

## Recall And Cueing

Human memory recall is cue-driven. The software equivalent is that retrieval
should be shaped by:

- task relevance
- scope
- recency
- salience
- prior usefulness

This supports retrieval that is selective and budget-aware rather than purely
textual.

## Forgetting

Forgetting is a feature when it is policy-driven.

Kiln should distinguish:

- operational forgetting: reduce ranking, compact, or age out mutable recall
- legal or audit retention: preserve required history separately

This is the clean way to adopt decay without corrupting compliance or
traceability.

## Direct Kiln Mappings

- session state maps to working memory
- governed `MemoryRecord` entries with operational provenance map to episodic
  memory
- knowledge retrieval and durable knowledge records map to semantic memory,
  but storage adapters are not the contract
- skills map to procedural memory
- contact and tenant conversation memory map to scoped user or tenant episodic
  and semantic memory depending on provenance and promotion policy
- audit traces remain a separate immutable layer
- coordination records are governed `coordination` memory, but their admission
  still belongs to context governance

Cross-agent state should not be treated as ordinary memory just because it is
stored. It behaves more like coordination substrate with memory-like
properties, which is why it belongs at the boundary between memory and
coordination rather than inside either one by default.

The main architectural consequence is that mutation rules, retention rules, and
retrieval rules should differ by layer.

Post-lattice architecture implements these mappings through Memory Lattice:

- `MemoryRepository` is the Core persistence port
- Runtime owns the current local SQLite adapter and exposes its explicit-path
  factory from the Runtime root
- `MemoryMutationService` owns governed writes
- lifecycle policy owns decay, forgetting, compaction, promotion, salience, and
  inhibition
- `ContextGovernor` remains the only owner of prompt admission

Lifecycle and recall behavior should use Memory Lattice domain contracts rather
than standalone utility abstractions.

## Risks / Misuse

- mixing session state with durable knowledge will create drift and false recall
- treating all recall as equal will flood context and degrade reasoning quality
- applying decay uniformly will erase useful knowledge and preserve the wrong
  artifacts
- treating reconsolidation as overwrite will corrupt memory lineage

## Where The Analogy Breaks

- biological memory is reconstructive and noisy; Kiln memory is explicit and
  queryable
- Kiln needs auditability, scope control, and legal deletion in ways biology
  does not
- there is no biological equivalent to exact transactional mutation policy

## Actionable Research Follow-Ups

- formalize promotion criteria from working or episodic memory into durable
  memory
- formalize reconsolidation operations for mutable recall
- keep procedural memory retrieval distinct from semantic retrieval
- define forgetting separately for mutable recall and audit retention
