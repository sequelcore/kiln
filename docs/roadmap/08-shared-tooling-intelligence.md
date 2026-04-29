# Shared Tooling Intelligence Roadmap

## Purpose

This roadmap owns the second shared-tooling program after the initial developer
tool foundation closed on 2026-04-29.

The first program made core file/search/patch/media/web tools consistent across
CLI, GUI, TUI, runtime-attached sessions, and MCP. This program makes the
surface smarter and more scalable:

- structured outputs and output schemas
- deferred tool catalog discovery
- semantic code intelligence
- bulk context ingestion
- long-running monitors
- cross-surface task state
- operator elicitation
- MCP resources for context artifacts

Use this file with:

- `docs/architecture/tool-execution.md`
- `docs/architecture/context-governance.md`
- `docs/roadmap/07-shared-developer-tools.md`
- `docs/research/12-agent-tooling-next-surface.md`

## Non-Negotiables

- No GUI/TUI-private tooling loops.
- No duplicated tool schema registry.
- No LSP, monitor, task, or elicitation contract owned by a consumer package.
- No background process without explicit lifecycle ownership and stop semantics.
- No sensitive data collection through generic text prompts.
- No MCP resource projection that bypasses tool authority for actions.
- No phase marked complete without docs, tests, typecheck, full tests, and
  build.

## Slice 11: Structured Tool Outputs And Output Schemas

Goal: make builtin tool results machine-readable for MCP, SDK, runtime, and
future tool catalog indexing.

Status: implemented for the shared builtin developer-tool envelope.

Requirements:

- add a core output-schema contract for builtin tools: complete
- project `outputSchema` into MCP tool definitions where supported: complete
- keep current text output stable for existing consumers: complete
- expose structured content consistently for tool-level success and error
  results: complete
- validate structured tool outputs in focused tests: complete
- document which fields are output contract versus audit metadata: complete

Why first:

- every later phase depends on stable machine-readable result shapes
- MCP clients can validate output when schemas exist
- tool search and catalog indexing need reliable schemas and descriptions

## Slice 12: Tool Catalog Index And Deferred Discovery

Goal: prevent context bloat and tool-selection degradation as Kiln gains more
builtin, MCP, skill, package, and app-integration tools.

Requirements:

- build a core tool catalog index over names, descriptions, input fields,
  output schemas, tags, authority, and source package
- add a deferred projection mode that exposes a small always-on tool set plus a
  catalog search capability
- keep all concrete tool execution through the canonical registry
- support exact, prefix, tag, and semantic/BM25-ready search adapters
- test catalog search without requiring external embeddings
- define failure behavior for missing, stale, or unauthorized tool references

Implemented in Slice 12:

- core `ToolCatalogIndex` with exact, prefix, tag, and lexical search adapters
- shared `tool_catalog_search` read-only builtin tool
- deferred projection through `DefaultBuiltinToolRegistryOptions.toolProjection`
- projected MCP listing with canonical bridge execution
- attached runtime propagation for all operator consumers
- stale exact-match behavior: empty result plus `reason: "tool_not_found"`

## Slice 13: Semantic Code Intelligence

Goal: add shared language-server-backed code navigation and diagnostics.

Planned tool shape:

```ts
code_intelligence({
  operation:
    | "definition"
    | "references"
    | "hover"
    | "document_symbols"
    | "workspace_symbols"
    | "diagnostics"
    | "implementation"
    | "call_hierarchy",
  path?: string,
  position?: { line: number, character: number },
  query?: string,
  symbol?: string,
  verbosity?: "raw" | "structured" | "summary"
})
```

Requirements:

- define a provider-neutral LSP adapter boundary in core
- keep language-server process management outside GUI/TUI components
- validate path and workspace roots before querying
- return bounded structured results with stable `code_intelligence` metadata
- fail clearly when no language server is configured or a language is
  unsupported
- project through MCP and runtime-attached sessions from the canonical surface

Implemented in Slice 13:

- core `CodeIntelligenceAdapter` request/result boundary
- shared `code_intelligence` read-only builtin tool
- path validation before adapter execution
- required position validation for position-scoped operations
- bounded raw, structured, and summary outputs with `code` metadata
- fail-closed default when no adapter is configured
- catalog, MCP, and attached-runtime projection through the canonical surface

## Slice 14: Bulk Context Ingestion

Goal: collect bounded multi-file context packets without forcing the model to
chain `glob` plus many `read` calls.

Planned tool shape:

```ts
read_many({
  paths: string[],
  include?: string[],
  exclude?: string[],
  recursive?: boolean,
  respectGitIgnore?: boolean,
  useDefaultExcludes?: boolean,
  maxFiles?: number,
  maxBytes?: number,
  verbosity?: "raw" | "structured" | "summary"
})
```

Requirements:

- reuse existing path validation, glob matching, and nuisance-directory rules
- include text files by default and require explicit selection for binary,
  image, PDF, audio, or video content
- return per-file provenance, skipped-file reasons, truncation, and total bytes
- support resource links for large files when MCP resources are available
- preserve deterministic ordering

Implemented in Slice 14:

- shared `read_many` read-only builtin tool
- deterministic file ordering from explicit files and directory expansion
- include/exclude glob filters plus simple `.gitignore` pattern support
- default nuisance-directory excludes for `.git`, `node_modules`, `dist`,
  `build`, `coverage`, and `.kiln-worktrees`
- text-only inclusion by default with binary/media/PDF/archive skip reasons
- per-file provenance, skipped reasons, total bytes, and truncation metadata
- catalog, MCP, and attached-runtime projection through the canonical surface

## Slice 15: Background Monitor And Long-Running Task Lifecycle

Goal: model dev servers, watch tests, logs, and CI polling as monitored tasks
instead of one oversized `bash` call.

Planned tool family:

```ts
monitor_start({ command, cwd?, name?, timeout?, verbosity? })
monitor_read({ id, sinceSequence?, limit? })
monitor_stop({ id, reason? })
monitor_list({ status? })
```

Requirements:

- reuse command validation and sandbox policy from `bash`
- provide explicit process ownership, cancellation, timeout, and cleanup
- stream or poll bounded output with sequence numbers
- expose structured lifecycle metadata and runtime events
- make GUI/TUI/CLI status projections read from the same monitor registry
- define orphan cleanup on session end

Implemented in Slice 15:

- shared session-local `MonitorRegistry` with explicit process ownership,
  stop semantics, timeout cleanup, lifecycle output events, and bounded output
  event text
- default builtin surfaces expose the owned monitor registry so session teardown
  can call `stopAll()` for orphan cleanup
- core `monitor_start`, `monitor_read`, `monitor_stop`, and `monitor_list`
  builtin tools
- command and cwd validation through the same sandbox helpers used by `bash`
- sequence-numbered stdout, stderr, and lifecycle events with raw, structured,
  and summary output modes
- shared `monitor` metadata for lifecycle evidence, status, timing, truncation,
  event counts, and error classification
- catalog, MCP, and attached-runtime projection through the canonical surface

## Slice 16: Shared Task State

Goal: make progress tracking observable and consistent across surfaces.

Planned tool family:

```ts
task_list({ status? })
task_update({
  id?: string,
  title: string,
  status: "pending" | "in_progress" | "blocked" | "completed" | "cancelled",
  details?: string,
  dependsOn?: string[]
})
```

Requirements:

- define core task-state model and lifecycle rules
- separate model-visible task state from docs/plans saved to disk
- expose read-only projections to GUI/TUI and MCP clients
- record task changes in session telemetry
- avoid replacing project management integrations; this is session-local work
  state

Implemented in Slice 16:

- shared session-local `TaskStateStore` with stable task ids, lifecycle status,
  details, dependencies, timestamps, and monotonic sequence numbers
- core `task_update` builtin tool for creating or updating model-visible task
  progress
- core `task_list` builtin tool for read-only task projection with optional
  status filtering
- supported statuses: `pending`, `in_progress`, `blocked`, `completed`, and
  `cancelled`
- shared `task_state` metadata for update/list evidence, sequence, status,
  task counts, and validation errors
- catalog, MCP, and attached-runtime projection through the canonical surface

## Slice 17: Operator Elicitation

Goal: give tools and agents one safe cross-surface way to ask for structured
operator input.

Planned capability:

```ts
operator_elicit({
  mode: "form" | "url",
  message: string,
  schema?: Record<string, unknown>,
  url?: string,
  sensitive?: boolean
})
```

Requirements:

- map to MCP elicitation where the client supports it
- project to CLI, GUI, and TUI with one runtime contract
- deny secrets in form mode; require URL mode for credentials and OAuth-style
  handoffs
- support decline/cancel states explicitly
- audit who asked, what surface answered, and what fields were collected
  without logging sensitive values

## Slice 18: MCP Resources For Workspace And Artifacts

Goal: expose stable context as resources rather than forcing every context read
through a tool call.

Requirements:

- expose selected workspace files, summaries, plans, task state, and session
  artifacts as resource URIs
- support resource templates for project files and artifact namespaces
- add pagination and bounded reads
- support list-changed notifications for artifact updates
- keep resource reads read-only and separate from tool execution authority
- allow tools such as `read_many`, `tree`, and monitors to return resource
  links for large or evolving outputs

## Execution Rules

- Start each slice with focused failing tests.
- Implement core contracts before runtime or consumer projections.
- Project every capability through MCP and runtime-attached sessions.
- Update `docs/guides/tool-use.md` and architecture docs when contracts change.
- Run `bun run typecheck`, `bun run test`, and `bun run build` before marking a
  slice complete.

## Current Priority

Start with Slice 11. Structured output schemas reduce ambiguity and lower the
risk of every later slice.
