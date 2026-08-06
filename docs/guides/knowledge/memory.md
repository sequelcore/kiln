# Memory Operations

Use this guide for the operator-facing memory surface. For doctrine and system
role, start with:

- [Memory](../../architecture/context/memory.md)
- [Context Governance](../../architecture/context/context-governance.md)
- [Context Resource Plane](../../architecture/context/context-resource-plane.md)

Source: `packages/core/src/memory/`

## Current Model

Kiln memory is governed memory, not loose saved text.

The canonical persistence boundary is `MemoryRepository`, currently backed by
`SqliteMemoryRepository`. Records are stored with explicit:

- `MemoryScope`: `user`, `agent`, `team`, `project`, `org`, `app`, `tenant`, or
  `session`
- `MemoryLayerKind`: `working`, `episodic`, `semantic`, `procedural`,
  `coordination`, or `audit`
- `MemoryProvenance`: source type, source id, capture time, and optional actor,
  session, turn, or tool-call identity
- tags and optional topic keys
- revisions, relations, and context-admission evidence when available

There is no separate memory CRUD API. Reads are exposed through the resource
plane. Writes go through governed mutation services and tools.

## Reads

Read Memory Lattice through `kiln://memory/...` resources:

```text
kiln://memory/graph{?scope,scopeKind,scopeId,layer,query,depth,limit}
kiln://memory/nodes/{id}{?scope,scopeKind,scopeId}
kiln://memory/nodes/{id}/lifecycle{?scope,scopeKind,scopeId}
kiln://memory/nodes/{id}/neighbors{?scope,scopeKind,scopeId,depth,limit}
kiln://memory/nodes/{id}/provenance{?scope,scopeKind,scopeId}
kiln://memory/relations/{id}{?scope,scopeKind,scopeId}
kiln://memory/admissions{?sessionId,recordId,scope,scopeKind,scopeId,layer,limit}
```

All reads are bounded and scope-aware. GUI, CLI, TUI, SDK, MCP, and app-level
consumers must use this resource contract rather than reading storage directly.
Model-facing surfaces must also pass memory authority, so read results are
filtered to the caller's allowed scopes and layers.

## Lifecycle Evidence Resources

Lifecycle evidence projection is a shared resource contract for all memory
surfaces and adapters: runtime services, CLI, TUI, SDK, MCP, GUI, IDE, remote
operator surfaces, and managed agents.

Primary lifecycle evidence URI:

```text
kiln://memory/nodes/{id}/lifecycle{?scope,scopeKind,scopeId}
```

Related resources that complete lifecycle inspection:

```text
kiln://memory/nodes/{id}{?scope,scopeKind,scopeId}
kiln://memory/nodes/{id}/neighbors{?scope,scopeKind,scopeId,depth,limit}
kiln://memory/relations/{id}{?scope,scopeKind,scopeId}
kiln://memory/admissions{?sessionId,recordId,scope,scopeKind,scopeId,layer,limit}
```

Lifecycle evidence includes:

- lifecycle tags and policy/action markers
- relation types such as `derived_from`, `revises`, and `supersedes`
- revision lineage and archival or deletion transitions
- context-admission and deferral evidence
- bounded truncation metadata when evidence is cut by projection limits

The GUI is the first practical consumer, but it reads the same
lifecycle evidence resources used by every other surface.

## Reads

Use `memory_search` when a model-facing or operator-facing session needs to
consult memory directly. The tool searches governed Memory Lattice context and
returns readable matched records plus the bounded graph evidence used to find
them. It is a native adapter over the same `kiln://memory/...` resource plane,
so it inherits the same read authority and does not create a private memory
backend.

Use `resource_read` for exact `kiln://memory/...` resources when a caller
already has a graph, node, relation, provenance, lifecycle, or admission URI.

## Writes

Use governed write paths:

- `memory_save` for operator or model-callable explicit memory writes
- `MemoryMutationService` for runtime/application services that create,
  update, delete, revise, relate, or admit memory records
- channel adapters may save tenant conversation exchanges as `episodic`
  `tenant`-scoped records with gateway provenance
- coordination services save cross-agent state as `coordination` records

Mutation services emit memory events. Operator surfaces use those events to
invalidate their resource projection and re-read through the same resource
plane.

`memory_save` requires layer, scope, content, and provenance. It returns the
record id and canonical node resource URI. Generic tool allowlists do not grant
memory write authority; a model-facing caller needs an explicit
`permissions.memory.write` rule for the requested operation, scope, and layer.
Audit-layer writes require `allowAuditWrite: true`.

Example YAML permission:

```yaml
permissions:
  memory:
    read:
      - operations: [read]
        scopeKinds: [project]
        scopeIds: [kiln]
        layers: [working, episodic, semantic, procedural, coordination, audit]
    write:
      - operations: [save]
        scopeKinds: [project]
        scopeIds: [kiln]
        layers: [episodic, semantic, procedural, coordination]
```

Agent-scoped permissions can override or extend these rules through
`permissions.agentScopes[].memory`. Read rules must constrain scope kind, scope
id, and layer. Write rules are denied unless the operation, scope, and layer
match a configured rule.

## Isolation

Scope is part of the domain record, not only a tag. Reads and deletes must pass
through scope validation when a caller is scoped. Tenant conversation memory is
stored in the app memory database and isolated by `scope.kind = "tenant"` plus
`scope.id = tenantId`.

## Context Admission

Memory records can become context candidates, but `ContextGovernor` decides what
enters model context. Admission and deferral decisions are persisted as memory
evidence and are visible through Memory Lattice resources.

## Configuration

The current local backing store is SQLite. CLI surfaces store mutable memory
under Kiln user app state, keyed by normalized project identity. They must not
create `.kiln/memory.db` in arbitrary working directories as an implicit side
effect. Project-local `.kiln/` remains for explicit project config, repo
shims, and governed projections.

Project-local `.kiln/memory.db` files are not supported Kiln state. Remove them
from workspaces instead of importing them into the current storage contract.
Gateway apps continue to use their resolved app memory base path. YAML can
declare model-facing memory authority through `permissions.memory` and
agent-scoped overrides. Lifecycle retention, sync policy, and
admission-policy references remain separate policy concerns. YAML must not
define GUI layout or duplicate memory contracts.
