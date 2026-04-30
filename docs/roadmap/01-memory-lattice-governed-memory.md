# 01 - Memory Lattice and Governed Memory

**Status:** In progress - slices 01.A through 01.E complete
**Owner:** Kiln core / runtime / GUI / context governance  
**Depends on:** `docs/adr/ADR-008-memory-lattice-governed-memory.md`, `docs/architecture/memory.md`, `docs/architecture/context-governance.md`, `docs/architecture/context-resource-plane.md`, `docs/architecture/runtime-surfaces.md`, `docs/architecture/shared-tooling-intelligence.md`, `docs/architecture/developer-tools.md`, `docs/guides/gui-parity.md`, `docs/guides/tui-maintenance.md`
**Related:** `docs/roadmap/02-operator-surfaces-and-remote-gui.md`, `docs/roadmap/03-provider-credential-pool.md`

## Purpose

Make Kiln memory explorable, governed, and reusable across every consumer
surface.

The first visible product surface is a GUI Memory Lattice: an interactive graph
view inspired by Obsidian-style linked knowledge and the existing Ehrlich hero
animation pattern. The implementation must not start in React. The GUI is only
one projection over a core memory graph contract that CLI, TUI, YAML apps, SDK,
MCP, and future remote surfaces can consume.

This roadmap replaces "memory as loose saved text" with "memory as governed
context evidence." It exists because larger context windows and changing
tokenizers do not remove the need for selective recall. Kiln should retrieve
what matters, explain why it was retrieved, and show what was excluded.

## Product Decision

Build Memory Lattice as governed memory, not as a visual metaphor.

The graph is a visualization of explicit memory records, relationships,
provenance, revisions, scope, and context-admission decisions. It is not the
source of truth and it must not invent meaning locally.

Correct ownership:

- core owns memory domain contracts, relation semantics, provenance, retention,
  reconsolidation, and graph projection
- `ContextGovernor` owns model-context admission and audit
- runtime/gateway exposes bounded read models over stable contracts
- GUI renders and explores the graph
- CLI, TUI, YAML, SDK, and MCP consume the same resource contracts later

## Non-Negotiables

- No GUI-private memory registry.
- No duplicate memory contracts per surface.
- No unbounded graph payloads.
- No hidden cross-scope memory leakage.
- No blind overwrite during reconsolidation.
- No migrations, compatibility shims, or dual-read paths for memory consumers
  that do not exist yet.
- No dead code, abandoned CRUD routes, or dual-write paths.
- No boilerplate DTO layer that mirrors domain objects without a consumer need.
- No model-context admission outside `ContextGovernor`.
- No "brain" vocabulary in public contracts. Use memory, graph, lattice,
  provenance, relation, scope, revision, and admission.

## Progress

Updated on 2026-04-30.

Completed:

- Slice 01.A froze the Memory Lattice doctrine in ADR-008 and aligned memory,
  context-resource, and runtime-surface architecture docs.
- Slice 01.B introduced pure memory domain contracts for scopes, records,
  relations, revisions, graph snapshots, and index queries.
- Slice 01.C replaced memory persistence with the final SQLite repository shape
  backed by `memory_records`, revisions, relations, context admissions, FTS, and
  scope isolation.
- Slice 01.D added reconsolidation and relation services with auditable
  correction, extension, noop, contradiction, supersession, topic validation,
  bound UUID defaults, and atomic repository transactions.
- Slice 01.E connected `ContextGovernor` admission decisions to memory
  provenance through stable memory block IDs and idempotent context-admission
  persistence.

Current verification:

- `bun run --cwd packages/core typecheck`
- `bun run --cwd packages/core test tests/context tests/memory`
- `bun run --cwd packages/core test`
- DDD and reviewer gates passed for Slice 01.E after the idempotency and stable
  block-ID fixes.

Next slice:

- Slice 01.F - Memory Graph Projector.

## References

### Kiln architecture

- `docs/adr/ADR-008-memory-lattice-governed-memory.md` - accepted decision for
  Memory Lattice ownership, domain contracts, resource projection, and clean
  replacement strategy.
- `docs/architecture/memory.md` - target layered memory model, retention,
  reconsolidation, recall policy, and invariants.
- `docs/architecture/context-governance.md` - context admission ownership.
- `docs/architecture/context-resource-plane.md` - shared read-only resource
  projection across CLI, GUI, TUI, SDK, runtime, and MCP.
- `docs/architecture/runtime-surfaces.md` - App Gateway and Operator Gateway
  ownership boundaries.
- `docs/architecture/shared-tooling-intelligence.md` - shared tool and resource
  contracts.
- `docs/architecture/developer-tools.md` - builtin tool/resource execution
  rules and resource-link doctrine.
- `docs/architecture/invariants.md` - architectural laws and failure modes.

### Engram research inputs

Engram v1.15.0 provides useful patterns, but Kiln should not copy its product
shape directly.

Adopt:

- agent-curated memory instead of raw transcript firehose
- topic-key reconsolidation with explicit revision counts
- conflict and supersession relations
- progressive disclosure from search result to timeline/detail
- one-way graph/export projection as a view over authoritative memory
- doctor/repair diagnostics for memory health

Do not adopt:

- export-only graph as the main product boundary
- FTS-only ranking as final recall policy
- global save instructions that bypass context governance
- "brain" wording in contracts

### External research inputs

- OpenAI Memory controls:
  `https://openai.com/index/memory-and-new-controls-for-chatgpt/`
- Claude Memory:
  `https://claude.com/blog/memory`
- LangGraph memory concepts:
  `https://docs.langchain.com/oss/javascript/concepts/memory`
- Mem0:
  `https://github.com/mem0ai/mem0`
- Graphiti:
  `https://github.com/getzep/graphiti`
- Zep temporal knowledge graph paper:
  `https://arxiv.org/abs/2501.13956`

The synthesis is stable enough for this roadmap: modern agent memory is moving
toward scoped, editable, provenance-aware, layered, and graph/temporal models.
Kiln's differentiator is that memory also participates in governed context
admission.

## Target Domain Model

### Memory layers

Use the layered model already documented in `docs/architecture/memory.md`:

- `working` - volatile session state, not canonical long-term memory
- `episodic` - mutable operational observations and session facts
- `semantic` - long-lived searchable knowledge
- `procedural` - skills, recipes, and reusable execution patterns
- `coordination` - handoffs, cross-agent state, and swarm state
- `audit` - append-only compliance and forensic evidence

The current `user | agent | project` model is not expressive enough. It should
be replaced by a scope model, not patched with more string tags.

### Core entities

Required domain contracts:

- `MemoryRecord` - canonical saved memory unit
- `MemoryScope` - user, agent, team, project, org, app, tenant, or session
  scope reference
- `MemoryLayerKind` - target layer enum
- `MemoryProvenance` - where the memory came from: session, turn, tool call,
  resource, file, gateway app, agent, or explicit operator action
- `MemoryRevision` - lineage for reconsolidated records
- `MemoryRelation` - typed edge between records or external resources
- `MemoryContextAdmission` - `ContextGovernor` decision evidence for memory
  blocks
- `MemoryGraphSnapshot` - bounded read model for consumer surfaces

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

## Persistence Model

SQLite remains the initial local authoritative store.

Target tables:

- `memory_records`
- `memory_revisions`
- `memory_relations`
- `memory_sources`
- `memory_context_admissions`
- `memory_fts`
- `memory_archive`

Replacement rule:

There are no external consumers for this memory model yet. Implement the target
schema directly, replace the current persistence shape in one clean cut, and
delete obsolete tables, routes, exports, tests, and docs in the same slice. Do
not add compatibility readers, migration fixtures, dual writes, or legacy
fallback paths.

## Resource Contracts

Expose Memory Lattice through the resource plane first.

Initial read-only templates:

```text
kiln://memory/graph{?scope,layer,query,depth,limit}
kiln://memory/nodes/{id}
kiln://memory/nodes/{id}/neighbors{?depth,limit}
kiln://memory/nodes/{id}/provenance
kiln://memory/relations/{id}
kiln://memory/admissions{?sessionId,recordId}
```

All reads must be bounded, scope-validated, and stable enough for GUI, CLI,
TUI, SDK, and MCP consumers. A `kiln://` URI grants read addressability, not
authority.

## GUI Target

The GUI Memory Lattice is the first consumer.

Required UI capabilities:

- left-rail mode named `Memory`
- graph canvas with bounded nodes and edges
- filters for scope, layer, topic, confidence, session, and admission status
- search over records and topic keys
- node detail panel with content, provenance, revisions, relations, and context
  admissions
- relation inspection for contradictions and supersession
- reduced-motion mode
- keyboard/list fallback for accessibility
- stable empty/error/loading states

The animation pattern can reuse ideas from the Ehrlich hero only after the data
contract exists. Motion must be a rendering concern, not an architecture input.

## Execution Workflow

Every slice follows the Sequel workflow:

1. `context-scout` maps files, contracts, dependencies, and risks.
2. `planner` writes the slice implementation plan with exact file paths.
3. `tdd-guide` writes failing tests first unless the slice is documentation
   only.
4. `worker` implements one atomic concern.
5. Compile check runs after each worker step: `bun run typecheck`.
6. Tests run before claiming the slice closed: `bun run test`.
7. `ddd-validator` checks bounded-context and Clean Architecture compliance
   for core/runtime slices.
8. `react-ts-reviewer` checks GUI slices.
9. `code-reviewer` is the final quality gate.

Agent routing:

- Scout: Dewey (`context-scout`)
- Planner: Hal (`planner`)
- TDD: Malcolm (`tdd-guide`)
- Complex implementation: Reese (`coder`)
- Mechanical DTO/test fixture work: Stevie (`fast-coder`)
- DDD validation: Ida (`ddd-validator`)
- React/TypeScript review: Cynthia (`react-ts-reviewer`)
- Final review: Lois (`code-reviewer`)
- Architecture escalation: Piama (`architect`) and Lloyd
  (`architecture-planner`)

Before execution, ask which engines have credits. If no choice is made, default
to the OpenCode-only worker route defined in `AGENTS.md`. This roadmap assigns
responsibilities; it does not bypass the runtime engine-routing rule.

## Slice Plan

### Slice 01.A - Architecture Record and Domain Contract Freeze

Goal: freeze the Memory Lattice doctrine before implementation.

Primary files:

- `docs/architecture/memory.md`
- `docs/architecture/context-resource-plane.md`
- `docs/architecture/runtime-surfaces.md`
- `docs/roadmap/01-memory-lattice-governed-memory.md`
- new ADR under `docs/adr/`

Delegation:

- Dewey maps existing memory, context, resource, runtime, GUI, CLI, TUI, and MCP
  contracts.
- Piama/Lloyd decide whether the memory graph belongs under current memory
  package boundaries or needs a new bounded submodule.
- Hal writes the ADR and exact implementation sequence.
- Lois reviews the ADR for scope creep and duplicate-contract risk.

Acceptance:

- ADR names the bounded context and public contracts.
- No implementation begins until the replacement and deletion strategy is
  clear.
- The ADR explicitly rejects GUI-private memory state.

### Slice 01.B - Memory Domain Model

Goal: introduce pure domain contracts with no IO.

Primary files:

- `packages/core/src/memory/domain/*.ts`
- `packages/core/src/memory/index.ts`
- `packages/core/tests/memory/*`

Delegation:

- Malcolm writes failing tests for scope validation, relation validation,
  revision lineage, and graph snapshot caps.
- Reese implements core domain contracts.
- Ida validates Clean Architecture boundaries.
- Lois reviews final API shape.

Acceptance:

- Domain code imports no runtime, GUI, Hono, filesystem, or SQLite modules.
- Invalid relation types, invalid scopes, and unbounded graph queries fail fast.
- `bun run typecheck` and targeted memory tests pass.

### Slice 01.C - SQLite Memory Repository Replacement

Goal: replace the old memory persistence shape with the new domain model.

Primary files:

- `packages/core/src/memory/sqlite-store.ts`
- new repository files under `packages/core/src/memory/`
- `packages/core/tests/memory/*`

Delegation:

- Dewey maps every current caller of `MemoryStore`, `SqliteMemoryStore`,
  `MemoryManager`, and `createMemoryRoutes`.
- Malcolm writes failing repository, scope-isolation, and replacement tests.
- Reese implements schema and repository replacement.
- Ida checks tenant/scope isolation and no cross-context persistence leaks.
- Lois reviews for obsolete code, compatibility shims, or dual-write leftovers.

Acceptance:

- The target repository uses the final `memory_records` shape directly.
- Old production write and read paths are removed or replaced in the same
  slice.
- No compatibility shim, migration fixture, or legacy fallback remains.
- Scope isolation is tested.

### Slice 01.D - Reconsolidation and Relation Services

Goal: make memory mutation explicit and auditable.

Primary files:

- `packages/core/src/memory/reconsolidation/*`
- `packages/core/src/memory/relations/*`
- `packages/core/tests/memory/*`

Delegation:

- Malcolm writes tests for correction, extension, contradiction, noop,
  supersession, and provenance requirements.
- Reese implements services.
- Ida validates that services depend on repository ports, not concrete SQLite.
- Lois reviews relation naming and failure modes.

Acceptance:

- Reconsolidation requires matching scope plus topic or explicit relation.
- Contradictions create relations; they do not silently overwrite.
- Superseded records remain inspectable unless policy deletes them.

### Slice 01.E - ContextGovernor Admission Provenance

Goal: link memory records to admitted/deferred context decisions.

Primary files:

- `packages/core/src/context/*`
- `packages/core/src/memory/*`
- `packages/core/tests/context/*`

Delegation:

- Dewey maps `ProjectedContextBlock`, `ContextAuditEntry`, and all memory
  candidate producers.
- Malcolm writes failing tests for memory block IDs, admission records, token
  accounting, deferred decisions, and required overflow.
- Reese implements admission provenance.
- Ida validates that `ContextGovernor` remains the only admission owner.
- Lois reviews audit completeness.

Acceptance:

- Memory context blocks carry stable memory record IDs.
- Admitted/deferred decisions can be queried later.
- No caller bypasses `ContextGovernor` to inject memory into model context.

### Slice 01.F - Memory Graph Projector

Goal: build the bounded graph read model in core.

Primary files:

- `packages/core/src/memory/graph/*`
- `packages/core/tests/memory/graph/*`

Delegation:

- Malcolm writes tests for depth, limit, scope, layer, query, relation filters,
  and deterministic ordering.
- Reese implements projector and graph DTOs.
- Stevie may write fixture builders only if they remain non-production helpers.
- Ida validates no GUI/runtime imports.
- Lois reviews graph semantics and payload caps.

Acceptance:

- Graph snapshots are deterministic and bounded.
- Projector returns empty graphs safely.
- Payload size caps are enforced before returning.

### Slice 01.G - Memory Resource Provider

Goal: expose graph and node detail through the canonical resource plane.

Primary files:

- `packages/core/src/tools/domain/tool-resource-registry.ts`
- new provider under `packages/core/src/memory/resources/*`
- `packages/core/src/tools/infrastructure/resource-tools.ts`
- `packages/core/tests/tools/*`

Delegation:

- Malcolm writes failing resource-list, template-list, read, pagination, and
  invalid URI tests.
- Reese implements `MemoryGraphResourceProvider`.
- Ida checks resource reads are read-only and scope-safe.
- Lois reviews URI contract stability.

Acceptance:

- `resource_list`, `resource_template_list`, and `resource_read` can discover
  and read memory graph resources.
- Invalid, stale, oversized, or cross-scope reads fail closed.
- No GUI-specific resource provider exists.

### Slice 01.H - Runtime and GUI Gateway Contracts

Goal: let the GUI consume Memory Lattice without owning memory logic.

Primary files:

- `packages/gateway-contracts/src/*`
- `packages/runtime/src/gateway/*`
- `packages/runtime/tests/gateway/*`
- `packages/gui/src/api/client.ts`

Delegation:

- Dewey maps current dashboard, session, workspace, and attached-runtime
  resource routes.
- Malcolm writes failing runtime and client parsing tests.
- Reese implements gateway contract and runtime adapters.
- Stevie may add mechanical contract exports.
- Ida validates runtime does not bypass the core provider.
- Lois reviews gateway behavior.

Acceptance:

- GUI gets memory snapshots through typed gateway contracts backed by core
  resources.
- Runtime does not expose raw SQLite or mutable memory internals.
- Existing GUI dashboard/session routes keep their current ownership.

### Slice 01.I - GUI Memory Lattice View

Goal: ship the first Memory Lattice GUI projection.

Primary files:

- `packages/gui/src/components/app-shell.tsx`
- new components under `packages/gui/src/components/memory-lattice/`
- `packages/gui/src/api/client.ts`
- `packages/gui/tests/*`

Delegation:

- Malcolm writes failing React/client tests for mode selection, loading,
  errors, empty state, filters, node selection, and reduced motion.
- Reese implements state and integration.
- Cynthia reviews React 19, TypeScript, accessibility, component boundaries,
  and performance.
- Lois does final review.

Acceptance:

- Left rail has a Memory mode.
- The graph renders from gateway data only.
- Node detail, filters, and list fallback work.
- Reduced-motion users do not get forced animation.
- Dev server is started and tested in browser before completion.

### Slice 01.J - CLI, TUI, MCP, and YAML Projection Stubs

Goal: prevent GUI-only product drift without fully building every surface.

Primary files:

- `packages/cli/src/*`
- `packages/tui/src/*`
- `packages/core/src/tools/*`
- YAML schema/docs files once located by scout

Delegation:

- Dewey maps existing CLI/TUI/resource/MCP projection seams.
- Hal decides which surface gets minimal read-only commands now versus later.
- Malcolm writes tests only for surfaces included in the slice.
- Reese implements minimal read-only projection.
- Ida validates shared contracts.
- Lois reviews surface parity risk.

Acceptance:

- At minimum, MCP/model-callable resources can read Memory Lattice data through
  existing resource tools.
- CLI/TUI work is either implemented through the shared resource plane or
  explicitly deferred with no duplicate contracts.
- YAML owns policy declarations only, not GUI layout.

### Slice 01.K - Cleanup, Docs, and Quality Gate

Goal: remove obsolete routes/docs and promote stable doctrine.

Primary files:

- `docs/architecture/memory.md`
- `docs/architecture/context-resource-plane.md`
- `docs/guides/*` as needed
- obsolete memory route files if superseded
- test files touched by prior slices

Delegation:

- Dewey identifies obsolete memory CRUD routes, stale docs, dead exports, and
  redundant tests.
- Reese removes dead code.
- Ida validates no bounded-context violations remain.
- Cynthia reviews GUI final state if GUI files changed.
- Lois performs final review.

Acceptance:

- No old memory CRUD surface remains.
- No dead exports or duplicate DTOs remain.
- Stable doctrine is promoted to architecture docs.
- `bun run typecheck`, `bun run test`, and GUI browser verification pass.

## Quality Gates

Each implementation PR must prove:

- tests were written before implementation for behavioral changes
- `bun run typecheck` passes
- `bun run test` passes
- graph/resource reads are bounded
- scope isolation is covered by tests
- DDD/Clean Architecture review passed
- GUI slices include browser verification
- no wildcard imports
- no dead code
- no migration, compatibility shim, or dual-write path

## Completion Definition

The roadmap closes only when:

- Memory Lattice is backed by core domain and persistence contracts.
- `ContextGovernor` admission decisions are explorable from memory records.
- GUI renders the graph through gateway/resource contracts.
- MCP/model-callable resource tools can read memory graph resources.
- Old memory persistence and route shapes are removed or promoted cleanly.
- Stable doctrine has moved from this roadmap into `docs/architecture/` and
  any consumer guide that needs it.
