# ADR-005: Memory Lattice Governed Memory Graph

## Status

Accepted

## Context

Kiln needs durable memory across sessions, agents, and surfaces. A simple saved
text list cannot support recall evidence, context admission, lifecycle policy,
relationship traversal, operator inspection, or multi-agent coordination.

Memory must be a governed bounded context, not a GUI feature and not an
implicit provider memory cache.

## Decision

Kiln models memory as a governed graph in `packages/core/src/memory`. Memory
records, scopes, revisions, relations, authority, lifecycle policy, recall,
resources, and context-admission evidence are domain concerns owned by core.

The memory model has these rules:

- `MemoryRecord` is the durable unit of memory with scope, layer, provenance,
  confidence, importance, lifecycle state, and revision metadata.
- Memory layers include working, episodic, semantic, procedural, coordination,
  and audit memory.
- `MemoryMutationService` is the write boundary for memory changes.
- `MemoryRepository` is the Core persistence port. Runtime owns the concrete
  SQLite adapter and exposes one `createSqliteMemoryRepository({ dbPath })`
  factory; Core does not own a concrete storage implementation.
- Relation, lifecycle, reconsolidation, recall, and graph projection services
  operate on the core memory model.
- `MemoryContextAdmission` records how memory entered or was deferred from a
  governed turn.
- Memory resources are exposed through `kiln://` resource providers so
  surfaces and managed children consume governed projections, not raw tables.

## Boundaries

- GUI, TUI, CLI, native, and MCP surfaces may request and render memory
  projections. They do not own memory semantics.
- A `memory_save` tool call is not sufficient authority by itself. Runtime
  policy and memory authority decide whether a write is allowed.
- Lifecycle operations such as decay, promotion, compaction, forgetting, and
  reconsolidation must be explicit domain operations with evidence.
- Graph rendering is projection-only. Three.js scene state must never become
  canonical memory state.

## Consequences

Kiln gets auditable recall, inspectable memory state, and a shared surface for
human and managed-agent context. The cost is stricter write policy and more
explicit domain modeling than a flat note store.

## Verification

Professional acceptance for this ADR requires tests that cover:

- memory record validation and repository persistence
- mutation authority and revision behavior
- relation and graph projection behavior
- lifecycle and reconsolidation operations
- recall scoring and resource projection
- context admission evidence linked to governed turns
- GUI projection using gateway/resource data only

Canonical architecture reference: `docs/architecture/context/memory.md`.
