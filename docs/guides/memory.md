# Memory Operations

Use this guide for memory configuration, runtime behavior, and operator-facing
API surfaces. For doctrine and system role, start with:

- [Memory](../architecture/memory.md)
- [Context Governance](../architecture/context-governance.md)

Sources: `packages/core/src/memory/`,
`packages/core/src/engine/domain/memory.ts`

## What This Guide Covers

Memory operations answer four practical questions:

- which scopes are enabled for an app
- where those scopes are stored
- how recall, compaction, and sync behave at runtime
- which APIs and hooks expose the stored entries

## Scope Configuration

| Scope | Pattern | Backend | Sync | Typical use |
|-------|---------|---------|------|-------------|
| `user` | literal `user` | SQLite at `~/.kiln/memory.db` | Local | User preferences and operator defaults |
| `agent:{name}` | `agent:` + agent name | SQLite at `~/.kiln/agents/{name}.db` | Local | Per-agent working patterns |
| `team:{name}` | `team:` + team name | SQLite at `~/.kiln/teams/{name}.db` | Local | Team conventions |
| `project:{id}` | `project:` + identifier | Gzipped JSONL in `{projectDir}/` | Git-synced | Shared project knowledge |
| `org` | literal `org` | Gzipped JSONL in `{projectDir}/org/` | Git-synced | Organization-wide standards |

Each scope is physically isolated. Two apps using `agent:architect` do not
share a database unless they share the same configured memory base path.

## `app.yaml`

```yaml
memory:
  scopes:
    - user
    - "agent:architect"
    - "agent:worker"
    - "project:my-project"
    - org
  backend: sqlite+fts5
  sync: git
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scopes` | `string[]` | Yes | Enabled memory scopes. Scopes not listed are inaccessible. |
| `backend` | `string` | Yes | Storage backend. |
| `sync` | `string` | No | `git` enables sync for `project:` and `org` scopes. |

Supported backends:

- `sqlite+fts5` for local or single-node deployments
- `postgresql` for shared multi-node deployments

## Runtime Behavior

### Auto-capture

After a significant action, the agent may persist a `MemoryEntry` with tags and
metadata. Application code does not manually orchestrate this for normal
session flow.

### Auto-recall

At the start of each turn, declared scopes are queried with the current task
context. Results are ranked and injected subject to budget limits.

### Budgets

`recall()` accepts an optional token budget. Results are returned in relevance
order until the budget is exhausted.

### Decay

Agent scopes can apply decay during recall scoring so recent patterns outrank
stale ones. Supported curves are `exponential`, `linear`, and `step`.

### Compaction

When a store exceeds its configured threshold, `MemoryCompactor` can summarize
tag groups into compacted entries and archive the originals as inactive.

## Git Sync

`project:{id}` and `org` scopes can be flushed to gzipped JSONL in the project
directory when `sync: git` is enabled.

- session end writes new entries to the synced store
- session start loads the latest committed state
- entries tagged `<private>` are stripped before git-backed persistence

## Multi-Tenant Isolation

Tenant isolation is enforced inside the store implementation. Entries are
tagged with tenant identity at write time and filtered at read time, so queries
for one tenant do not surface another tenant's data.

## Memory API

The Gateway exposes memory routes at `/api/memory` in all modes, and mirrors
them at `/dev/memory` for Studio and debugger surfaces in dev mode.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/memory/:scope` | List memory entries for a scope. Supports `q` and `tags`. |
| `POST` | `/api/memory` | Create a memory entry. Returns `{ id }`. |
| `DELETE` | `/api/memory/:id` | Delete a memory entry by ID. |

The SDK's `useKilnMemory` hook targets the same surface.
