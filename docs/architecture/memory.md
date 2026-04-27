# Memory

## Memory Model

Kiln uses a layered memory architecture with explicit retention, decay,
mutation, and deletion rules.

The architecture distinguishes:

- working memory
- episodic or mutable operational memory
- semantic or knowledge memory
- procedural memory
- immutable audit memory

## Research Synthesis

The strongest research mapping is the layered-memory model:

- working memory as volatile session state
- episodic memory as event and observation storage
- semantic memory as long-lived searchable knowledge
- procedural memory as reusable operational skill or recipe structures

The analogy is useful for retention policy and role separation. It is not a
claim that Kiln reproduces biological recall or plasticity.

## Current State

- Working memory is carried by `RuntimeSession` and related session state.
- Episodic traces exist in transcripts and mutable memory storage.
- Semantic storage exists through SQLite plus FTS5 and vector-backed knowledge
  retrieval.
- Procedural memory exists through the skill system and enters admitted-turn
  model context as governed `procedural` candidates.
- Cross-agent coordination state exists through coordination primitives and can
  enter admitted-turn model context as governed `coordination` candidates.

## Current Boundaries

- Memory and knowledge use different access patterns with overlapping concerns.
- Coordination state uses its own naming and scope conventions.
- Storage and mutation APIs are not context policy. They produce or retrieve
  state; `ContextGovernor` decides admitted-turn model context.

## Target Layer Model

### Layer 0: Working

- session lifetime only
- volatile
- not persisted as canonical long-term memory

### Layer 1: Episodic

- mutable operational memory
- scope-aware
- decay-capable
- soft-delete capable
- reconsolidation-capable

### Layer 2: Semantic

- long-lived searchable knowledge
- non-decaying by default
- overwritten or deleted only by explicit policy

### Procedural Memory

- skills and execution recipes
- retrieved through the skill subsystem
- admitted to model context only as governed procedural candidates

### Coordination Context

- cross-agent memory, handoff state, and swarm state
- owned by coordination subsystems for storage and mutation
- admitted to model context only as governed coordination candidates

### Audit Memory

- append-only
- immutable
- compliance and forensic role only

## Retention And Forgetting

- retention is explicit policy
- decay is explicit policy
- deletion is explicit policy
- no implicit forgetting is allowed

Decay belongs primarily to mutable episodic memory. Semantic knowledge should
not decay silently just because it is old.

## Reconsolidation

Reconsolidation should be the canonical mutation mechanism for mutable memory.

Rules:

- update only when the same `topic_key` and scope are involved
- require provenance and confidence to justify mutation
- distinguish correction, extension, contradiction, and noop
- increment revision lineage explicitly
- keep immutable audit separate from mutable state

Reconsolidation should not degrade into blind overwrite.

## Recall Policy

Recall is governed by:

- scope
- salience
- recency
- frequency
- token budget
- governor audit policy

Cue-based recall remains important. Queries should act as retrieval cues, not
just raw text matches.

## Invariants

- no cross-scope leakage
- explicit retention policy on every layer
- explicit GDPR delete path
- explicit mutation rules
- audit memory is never rewritten
- model-context admission goes through `ContextGovernor`
