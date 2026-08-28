# Memory

## Memory Model

Kiln uses a layered memory architecture with explicit retention, decay,
mutation, and deletion rules.

Memory Lattice is the product and architecture name for Kiln's governed memory
graph. It is defined by `docs/adr/ADR-005-memory-lattice-governed-memory.md`.
The implementation belongs to the `memory` bounded context in `@kilnai/core`;
GUI, CLI, TUI, SDK, YAML apps, and MCP are projections over that core contract.

The architecture distinguishes:

- working memory
- episodic or mutable operational memory
- procedural memory
- immutable audit memory

## Research Synthesis

The strongest research mapping is the layered-memory model:

- working memory as volatile session state
- episodic memory as event and observation storage
- procedural memory as reusable operational skill or recipe structures

The analogy is useful for retention policy and role separation. It is not a
claim that Kiln reproduces biological recall or plasticity.

## Implemented State

- Working memory is carried by `RuntimeSession` and related session state.
- Durable records are stored through the Core `MemoryRepository` contract. The
  Runtime gateway owns the concrete SQLite adapter and exposes
  `createSqliteMemoryRepository({ dbPath })` from its root surface.
- Episodic traces can be written as scoped memory records with provenance,
  revisions, relations, and context-admission evidence.
- Procedural memory exists through the skill system and enters admitted-turn
  model context as governed `procedural` candidates.
- Cross-agent coordination state exists through coordination primitives and can
  enter admitted-turn model context as governed `coordination` candidates.
- Memory graph reads are projected through bounded `kiln://memory/...`
  resources. GUI, CLI, TUI, SDK, YAML apps, MCP, IDE, remote operator surfaces,
  and managed agents consume those shared contracts rather than owning separate
  memory registries.
- Model-facing memory reads and writes are governed by `MemoryAuthorityPolicy`.
  Operator-only inspection can use unrestricted local resources, but model
  calls must be constrained by explicit scope, layer, and operation authority.

## Current Boundaries

- Coordination state uses its own naming and scope conventions.
- Storage and mutation APIs are not context policy. They produce or retrieve
  state; `ContextGovernor` decides admitted-turn model context.
- Memory Lattice is not GUI state. The GUI may render memory records,
  relations, provenance, revisions, and context-admission decisions, but it
  does not own those rules or persist its own memory graph.

## Storage Ownership

Mutable CLI memory is operator state, not repository source. CLI, TUI, GUI, and
MCP surfaces that need a project-scoped SQLite backing store must resolve it
through the shared CLI memory storage resolver, which stores data under the
bound private project namespace's `memory/` directory keyed by the normalized
`krp_<sha256>` project identity.

The CLI owns project identity and path resolution, then passes the explicit
database path to the Runtime factory. Runtime owns opening, schema migration,
WAL, queries, transactions, archival, and close behavior for that path.

The repository is never a Kiln project-state root. A surface must not create a
`.kiln/` tree or `memory.db` in the current working directory as an implicit
side effect of opening Kiln or exposing tools. Repository-local `.kiln` state is
legacy debris, not a supported contract; remove it rather than importing it
through a compatibility reader. Gateway apps remain separate:
their tenant/application memory uses the app-resolved memory base path, not the
CLI project-state resolver.

## Memory Lattice Contracts

The memory bounded context owns these public domain concepts:

- `MemoryRecord`
- `MemoryScope`
- `MemoryLayerKind`
- `MemoryProvenance`
- `MemoryRevision`
- `MemoryRelation`
- `MemoryContextAdmission`
- `MemoryGraphSnapshot`

Relation types are explicit domain vocabulary:

- `related_to`
- `supports`
- `contradicts`
- `supersedes`
- `revises`
- `derived_from`
- `same_topic`
- `admitted_to_context`
- `linked_resource`
- `belongs_to_scope`

Memory graph projection is read-only and bounded. Context admission remains
owned by `ContextGovernor`; memory records can be candidates, but they become
model-visible context only after governed admission.

Canonical resource templates:

```text
kiln://memory/graph{?scope,scopeKind,scopeId,layer,query,depth,limit}
kiln://memory/nodes/{id}{?scope,scopeKind,scopeId}
kiln://memory/nodes/{id}/lifecycle{?scope,scopeKind,scopeId}
kiln://memory/nodes/{id}/neighbors{?scope,scopeKind,scopeId,depth,limit}
kiln://memory/nodes/{id}/provenance{?scope,scopeKind,scopeId}
kiln://memory/relations/{id}{?scope,scopeKind,scopeId}
kiln://memory/admissions{?sessionId,recordId,scope,scopeKind,scopeId,layer,limit}
```

## Memory Authority

Memory authority is separate from generic tool permission.

The authority model defines:

- caller identity: surface or agent invoking memory access
- access: `read` or `write`
- operations: `read`, `save`, `revise`, `relate`, `delete`, `forget`,
  `compact`, or `promote`
- optional scope-kind, scope-id, and layer constraints
- explicit audit-write opt-in for writes to the audit layer

Read rules for model-facing resources must constrain scope kind, scope id, and
layer. Unscoped list reads, including admissions, fail closed unless the caller
has authority for the requested scope/layer. Write rules are enforced by
`MemoryMutationService`; the default model-callable write surface is
`memory_save`, and it only performs explicit `save` operations with provenance.

Model-facing GUI, TUI, CLI, `kiln run`, and `kiln tools --mcp` surfaces derive
memory authority from `permissions.memory` and agent-scoped overrides. When no
explicit memory policy exists, model-facing sessions default to read-only
project-scope access. A generic `memory_save` tool allow rule does not grant
write authority.

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

Decay belongs primarily to mutable episodic memory and must never silently
change an existing record.

### Lifecycle Policy

Retention, decay, forgetting, compaction, promotion, salience, and inhibition
are implemented as governed lifecycle policy over Memory Lattice.

Lifecycle policy operates on the governed memory model:

- policy objects reference `MemoryScope` and `MemoryLayerKind`
- decay is applied only by explicit lifecycle policy, never by repository side
  effects
- compaction creates revisions, relations, or derived records through governed
  mutation services
- deletion and archival remain auditable through repository state and memory
  events
- recall scoring can use salience, recency, frequency, and cue matching without
  bypassing `ContextGovernor`

The lifecycle domain starts with pure core policy contracts. It defines policy
sets and proposed lifecycle actions, but it does not project UI state or bypass
governed mutation paths. Approved lifecycle actions are applied by
`MemoryLifecycleApplicationService`, which validates the current record scope
and layer, then routes material changes through `MemoryMutationService` so
relations, archive state, deletion evidence, and memory events remain
auditable.

The lifecycle evaluator is also pure. It accepts memory records plus bounded
evaluation evidence such as recall salience and use counts, then returns
proposed lifecycle actions with policy id, policy version, and reasons. It does
not own persistence, approval, mutation, or context admission.

Forgetting policy is explicit and scope-bound. A pure planner proposes
forgetting decisions only for explicitly scoped records; governed services then
apply `soft_delete` or `redact` mutations through `MemoryMutationService` so
audit lineage and evidence remain preserved. Graph and resource projections hide
soft-deleted records by default.

Lifecycle promotion and derived summaries create new records with
`derived_from` relations instead of overwriting sources. Promotion planning is
explicit: working or episodic records must meet confidence, repeated utility,
scope, provenance quality, and topic-coherence criteria before a promotion
action is proposed. Topic keys are grouping cues rather than uniqueness
constraints, so multiple records in the same scope can share a topic for
compaction and lineage. Compaction planning preserves source records and emits
source lineage that the governed application service materializes as derived
records and relations.

Lifecycle-aware recall scoring is also pure. It ranks in-scope records by cue
match, layer, confidence, recency, bounded salience, prior usefulness, and
inhibition signals. It can produce `ContextCandidate` objects for memory blocks,
but it does not inject them into model context or write admission records;
`DefaultContextGovernor` remains the owner of admission, deferral, token-budget
selection, and context audit evidence.

Default policy posture:

- audit memory is immutable and cannot be decayed, compacted, promoted, or
  forgotten by generic lifecycle policy
- semantic and procedural memory are retained by default
- semantic decay requires explicit policy opt-in
- mutable working, episodic, and coordination memory can decay through explicit
  layer-aware policy
- recall salience changes are separate from model-context admission;
  `ContextGovernor` remains the only owner of injection into model context

### Operator Projection

Memory lifecycle evidence is projected through the same resource plane as the
memory graph. The dedicated lifecycle evidence resource is:

```text
kiln://memory/nodes/{id}/lifecycle{?scope,scopeKind,scopeId}
```

Graph and node detail payloads expose bounded `lifecycleEvidence` summaries for
operator surfaces. The full lifecycle resource exposes lifecycle tags, relation
types, revision evidence, context-admission evidence, and truncation state. The
projection is read-only, bounded, and scope-aware.

GUI is the first practical live consumer, but it is not the policy owner. CLI,
TUI, SDK, YAML apps, MCP, IDE, remote operator surfaces, and managed agents must
consume the same resource contracts or explicitly defer their projection.

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
