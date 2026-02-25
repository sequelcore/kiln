# Memory

Memory provides persistent, scope-based storage across five isolation boundaries. Agents read from and write to memory automatically during each session; no explicit memory management code is required in application logic.

Sources: `packages/core/src/memory/`, `packages/core/src/engine/domain/memory.ts`

---

## Overview

The `Memory` interface exposes three operations: `store`, `recall`, and `forget`. The engine handles the rest:

- **Auto-capture:** Agents decide what to store after each significant action and write entries to the appropriate scope.
- **Auto-recall:** All declared scopes are queried with the current task context at the start of each turn. Results are prepended to the agent's context window.
- **Token budgets:** The `budget` parameter on `recall()` limits the total token count of returned entries, preventing context overflow.

---

## Scopes

| Scope | Pattern | Backend | Sync | Purpose |
|-------|---------|---------|------|---------|
| `user` | literal `user` | SQLite at `~/.kiln/memory.db` | Local | User preferences, standards, style |
| `agent:{name}` | `agent:` + agent name | SQLite at `~/.kiln/agents/{name}.db` | Local | Per-agent patterns with exponential decay |
| `team:{name}` | `team:` + team name | SQLite at `~/.kiln/teams/{name}.db` | Local | Team conventions |
| `project:{id}` | `project:` + identifier | Gzipped JSONL in `{projectDir}/` | Git-synced | Project knowledge, shared across developers |
| `org` | literal `org` | Gzipped JSONL in `{projectDir}/org/` | Git-synced | Organization-wide standards |

Each scope is physically isolated: two Apps with `agent:architect` scopes use different SQLite databases because each App gets its own memory base path (`~/.kiln/gateway/{appName}/`).

---

## YAML Configuration

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
| `scopes` | `string[]` | Yes | Active scopes. Scopes not listed are inaccessible to the App. At least one required. |
| `backend` | `string` | Yes | Storage backend. See options below. |
| `sync` | `string` | No | `git` enables push/pull of `project:` and `org` scopes. Omit for local-only deployments. |

**Backends:**

| Value | Use Case |
|-------|---------|
| `sqlite+fts5` | Default. Local deployments, single-node, full-text search via FTS5. |
| `postgresql` | Multi-node deployments with shared memory across Gateway instances. |

---

## Auto-Capture and Auto-Recall

**Auto-capture** occurs after each agent action. The agent evaluates the action result and, if it contains useful information, writes a `MemoryEntry` with tags that describe the content category. Entries include an `id`, `content`, `tags`, `createdAt`, and optional `metadata`.

**Auto-recall** runs at the start of each turn. The engine queries all declared scopes with the current task context as the query string. Results are returned ordered by relevance (FTS5 BM25 ranking for SQLite stores) and prepended to the agent's context window.

The `budget` parameter on `recall()` specifies a token limit. The store returns entries in relevance order until the budget is reached. This prevents recall from consuming the entire context window on large memory stores.

---

## Decay Curves

Agent-scoped memories (`agent:{name}`) use configurable exponential decay. Relevance scores degrade over time so that recent patterns carry more weight than old ones.

Three decay curves are available:

| Curve | Formula | Behavior |
|-------|---------|---------|
| `exponential` | `score * e^(-λt)` | Continuous, smooth decay. Default for agent scopes. |
| `linear` | `score * max(0, 1 - λt)` | Linear decay to zero at a fixed horizon. |
| `step` | `score` if `t < threshold`, else `0` | Binary: full relevance until a cutoff, then zero. |

The decay rate `λ` and half-life are configurable per store. Decay applies to the recall scoring only; the underlying entry is not modified or deleted by decay.

---

## Auto-Compaction

When a memory store exceeds a configurable entry threshold, `MemoryCompactor` runs automatically:

1. Groups entries by tag.
2. Produces a deterministic summary of each group using an LLM call.
3. Writes the summary as a new entry with a `compacted` tag.
4. Archives the original entries (marks them inactive rather than deleting them).

Compaction reduces the number of entries returned by recall, keeping context injection lean as agents accumulate experience over many sessions.

---

## Git Sync

`project:{id}` and `org` scopes are stored as gzipped JSONL files in the project directory. When `sync: git` is declared:

- **On session end:** New entries are flushed to the JSONL file and committed to the local git repository.
- **On session start:** The latest committed JSONL is loaded, pulling in entries written by other developers.

This mechanism allows teams working on the same codebase to share project knowledge without a centralized server.

**Private tag stripping:** Any entry tagged `<private>` is stripped before writing to a git-synced scope. Use `<private>` for sensitive values (API keys, personal notes) that must stay local.

```typescript
// Entry with private tag — never written to git
{
  content: "Personal API key pattern",
  tags: ["credentials", "<private>"],
}
```

---

## Token Budgets

Each `recall()` call accepts an optional `budget` parameter (in tokens). The store returns entries in relevance order, stopping before the budget is exceeded.

Declare budgets at the orchestrator level to control how much memory each agent receives per turn. Without a budget, the store returns all matching entries, which can overflow the context window on long-running projects.

---

## Multi-Tenant Isolation

In multi-tenant deployments, `SqliteMemoryStore` automatically tags every entry with the tenant ID at write time and filters by tenant ID at read time. Cross-tenant queries are blocked at the store level; a query from tenant A will never return entries written by tenant B, even if they use the same scope name.

This enforcement is transparent to agents and capabilities — isolation happens inside the store implementation, not in the application layer.

---

## Memory API

The Gateway exposes production memory routes at `/api/memory`, available in all modes (dev and production):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/memory/:scope` | List memory entries for a scope. Accepts optional `q` (query) and `tags` query params. |
| `POST` | `/api/memory` | Create a memory entry. Returns `{ id }`. |
| `DELETE` | `/api/memory/:id` | Delete a memory entry by ID. Returns `{ ok: true }` or 404. |

The SDK's `useKilnMemory` hook targets these routes. In dev mode, the same endpoints are also mirrored at `/dev/memory` for Studio and the inline debugger.

The Gateway creates three SQLite stores (one per layer: `user`, `agent`, `project`) under `{memoryBasePath}/`. The memory routes delegate to these stores.

`SqliteMemoryStore` exposes two methods used by the memory API:

- **`listEntries(options?)`** — Scans entries without FTS, ordered by `last_accessed_at DESC`. Accepts optional `limit` and `tags` (comma-separated) filters. Respects tenant isolation when configured.
- **`hasEntry(id)`** — Checks if an entry exists by primary key. Used by `DELETE /api/memory/:id` to locate which layer store holds the entry.
