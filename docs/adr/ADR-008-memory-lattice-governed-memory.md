# ADR-008: Memory Lattice governed memory graph

**Status:** Accepted (2026-04-30)
**Date:** 2026-04-30
**Author:** Ricardo Armenta
**Scope:** `packages/core/src/memory/`, `packages/core/src/context/`, `packages/core/src/tools/`, `packages/runtime/src/gateway/`, `packages/gateway-contracts/`, `packages/gui/`, `packages/cli/`, `packages/tui/`, `docs/architecture/memory.md`, `docs/architecture/context-resource-plane.md`
**Supersedes:** none
**Follows:** ADR-004 (Budgeted Sufficient Context Orchestration), ADR-006 (GUI stack, boundaries, and binding contract)

---

## Context

Kiln already has early memory primitives: SQLite-backed saved entries, topic
keys, recall under token budget, context candidates, and `ContextGovernor`
audit trails. Those pieces are useful, but they are not yet a single governed
memory model.

The product direction now requires Memory Lattice: an explorable, scoped,
provenance-aware memory graph that shows how memory records, relations,
revisions, and context-admission decisions connect. The first visible consumer
will be the GUI, but the feature cannot be GUI-owned. CLI, TUI, YAML apps, SDK,
MCP, and model-callable resources must be able to consume the same contracts.

There are no external consumers for the current memory shape. Kiln is still in
a phase where clean architecture matters more than compatibility with internal
intermediate forms. Designing migrations or compatibility shims for a memory
contract that has not shipped to consumers would create dead code and slow the
next slices.

Research and product inputs converge on the same shape:

- persistent agent memory should be external and selectively recalled, not
  replayed as raw transcript
- memory needs scope, provenance, revision, and user/operator control
- graph and temporal relationships help surface conflicts, supersession, and
  continuity
- larger context windows do not remove the need for governed retrieval and
  budgeted admission

---

## Decision

Kiln will implement **Memory Lattice** as the product name for a governed memory
graph. The technical bounded context is `memory` under `@kilnai/core`.

Memory Lattice is not a separate GUI system. It is a core domain and resource
projection with one first-party GUI view.

### 1. Bounded context and package boundary

The memory bounded context owns:

- memory domain entities
- scope validation
- provenance
- revision lineage
- relation semantics
- reconsolidation policy
- persistence repository ports and adapters
- graph projection
- memory resource provider

Target core layout:

```text
packages/core/src/memory/
  domain/
  repository/
  reconsolidation/
  relations/
  graph/
  resources/
```

`packages/core/src/context/` owns context-admission decisions. Memory may
produce candidates and record admission evidence, but it must not decide what
enters the model context. That remains `ContextGovernor`'s responsibility.

Runtime and GUI packages may adapt memory contracts, but they do not own memory
rules.

### 2. Public domain contracts

The core memory domain must expose these concepts:

- `MemoryRecord`
- `MemoryScope`
- `MemoryLayerKind`
- `MemoryProvenance`
- `MemoryRevision`
- `MemoryRelation`
- `MemoryContextAdmission`
- `MemoryGraphSnapshot`

Required memory layers:

- `working`
- `episodic`
- `semantic`
- `procedural`
- `coordination`
- `audit`

Required relation types:

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

These are domain contracts, not GUI DTOs. Gateway and GUI contracts can project
smaller shapes only when a consumer needs them.

### 3. Persistence replacement, not migration

SQLite remains the first authoritative local persistence adapter.

Target tables:

- `memory_records`
- `memory_revisions`
- `memory_relations`
- `memory_sources`
- `memory_context_admissions`
- `memory_fts`
- `memory_archive`

Because the current memory shape has no external consumers, the implementation
must replace it cleanly. Do not create migration code, compatibility readers,
dual-write paths, legacy fallback tables, or fixtures whose only purpose is to
preserve the old internal shape.

When the repository slice lands, it must delete or replace obsolete memory
routes, exports, tests, docs, and persistence code in the same slice.

### 4. Context admission is auditable memory evidence

Memory records may become context candidates, but the model only sees memory
after `ContextGovernor` admits it.

Every memory-derived context block must carry enough stable identity to record:

- memory record ID
- relation or source evidence when relevant
- estimated tokens
- score and effective score
- admitted or deferred decision
- reason
- session or turn provenance when available

Memory Lattice must make these decisions explorable. The graph is not only
"what Kiln remembers"; it also shows what Kiln chose to use or defer.

### 5. Resource projection is the shared read contract

Memory Lattice data is exposed first through the context resource plane.

Canonical read-only URI templates:

```text
kiln://memory/graph{?scope,layer,query,depth,limit}
kiln://memory/nodes/{id}
kiln://memory/nodes/{id}/neighbors{?depth,limit}
kiln://memory/nodes/{id}/provenance
kiln://memory/relations/{id}
kiln://memory/admissions{?sessionId,recordId}
```

All reads must be bounded, scope-validated, deterministic, and read-only.

These resources are the shared contract for CLI, GUI, TUI, SDK, runtime, and
MCP. The GUI may have convenience gateway endpoints, but those endpoints must
adapt the core resource contract. They must not read SQLite directly or create
a private graph registry.

### 6. GUI view is a projection

The GUI may render Memory Lattice as an animated graph with node detail,
filters, provenance, revisions, relations, admissions, and a reduced-motion
fallback. The GUI must not:

- invent memory records
- infer relation semantics locally
- bypass scope rules
- own graph ranking
- own context-admission decisions
- persist memory state outside the core memory repository

The Ehrlich hero animation may inspire rendering behavior only after the core
graph contract exists. Motion is presentation, not architecture.

### 7. YAML, CLI, TUI, SDK, and MCP

YAML may eventually declare memory policy: retention, allowed scopes, exposed
layers, sync policy, and admission policy references. YAML must not declare GUI
layout.

CLI and TUI consume Memory Lattice through the same resource contracts or
thin operator contracts. MCP consumes the same resources through standard
resource projection and model-callable resource tools.

---

## Consequences

### Positive

- One memory bounded context instead of per-surface memory models.
- Context admission becomes visible and auditable, not hidden prompt assembly.
- GUI, CLI, TUI, SDK, YAML apps, and MCP can converge on one graph contract.
- No compatibility debt is introduced for old internal memory shapes.
- Memory Lattice stays aligned with Kiln's biocybernetic control-plane identity
  without using informal "brain" contracts.

### Negative / risks

- The clean replacement will break any internal code that still assumes the
  old `MemoryEntry` shape. That is accepted. The implementation slices must
  replace callers directly.
- The graph model can become ornamental if relation semantics are weak.
  Mitigation: relation types and provenance are domain contracts before GUI
  work begins.
- Resource payloads can grow quickly. Mitigation: graph depth, node count,
  byte caps, and deterministic ordering are required in the core projector.
- Memory and knowledge overlap conceptually. Mitigation: memory owns durable
  records, provenance, relations, and recall evidence; knowledge retrieval
  remains a separate source that may link into memory through explicit
  relations.

---

## Alternatives Considered

### A. GUI-only Memory Lattice

Rejected. It would produce a compelling visual surface quickly, but it would
create a second memory model and violate the resource-plane rule that surfaces
project core capabilities instead of owning them.

### B. Keep the current memory store and add graph metadata around it

Rejected. The current `user | agent | project` layer model and loose tags do
not represent the target layer/scope/provenance/relation model. Wrapping it
would preserve the wrong abstraction.

### C. Add compatibility migrations from the current memory shape

Rejected. There are no external consumers for the current shape. Compatibility
code would be dead weight and contradict the Sequel rule against legacy hacks.

### D. Use "Atlas" as the feature name

Rejected. "Atlas" communicates map/exploration but does not fit Kiln's
biocybernetic, cybernetic, control-plane identity as well as "Memory Lattice."
The term "lattice" better communicates structured interconnection without
turning the product into a toy visual metaphor.

---

## Implementation Sequence

1. Freeze this ADR and update architecture docs.
2. Replace the memory domain contracts in `@kilnai/core`.
3. Replace SQLite persistence and delete obsolete memory paths.
4. Add reconsolidation and relation services.
5. Link memory records to `ContextGovernor` admission evidence.
6. Add bounded core graph projection.
7. Expose graph resources through `ToolResourceProvider`.
8. Add runtime/gateway contracts backed by core resources.
9. Build the GUI Memory Lattice view.
10. Add minimal CLI/TUI/MCP/YAML projection only through shared contracts.
11. Remove stale docs, routes, exports, tests, and internal code.

---

## Verification Requirements

Each implementation slice must prove:

- `bun run typecheck` passes
- `bun run test` passes for touched packages
- scope isolation is tested
- graph reads are bounded
- resource reads are read-only
- context admission remains owned by `ContextGovernor`
- GUI slices are browser-tested before completion
- no migration, compatibility shim, or dual-write path remains
- no GUI-private memory state exists
