# Shared Developer Tools Active Plan

## Current State

The completed 2026-04-29 foundation is now documented in
`docs/roadmap/07-shared-developer-tools.md` and
`docs/architecture/tool-execution.md`.

Closed slices:

1. `bash` metadata hardening.
2. `bash` timeout propagation.
3. Core-owned builtin tool metadata contract.
4. Runtime evidence extraction from shared metadata.
5. Shared projection cleanup across MCP, runtime-attached sessions, and CLI.
6. Kiln-owned MCP request timeout propagation and server-side progress
   notifications.
7. Core `patch({ patch, dryRun? })` tool with structured parsing, path
   validation, dry-run planning, per-file metadata, and shared projections.
8. Core `stat({ path, hash? })` and
   `tree({ path?, depth?, includeFiles? })` tools with sandbox validation,
   bounded deterministic output, shared `inspection` metadata, and shared
   projections.
9. Core `view_image({ path, detail? })` and
   `ocr_image({ path, language? })` tools with image MIME validation, size
   limits, MCP-compatible image content, configurable OCR backend execution,
   shared `media` metadata, and shared projections.
10. Core `verbosity?: "raw" | "structured" | "summary"` support for `bash`,
    `tree`, `grep`, and `glob`, preserving raw defaults while adding structured
    JSON and bounded summaries with stable metadata.
11. Core `web_search` and `web_fetch` foundation with shared `web` metadata,
    URL/domain policy helpers, sandbox `NetworkFilter` enforcement, private host
    rejection, sanitized fetch output, fail-closed injected search provider,
    verbosity support, and shared projections across MCP, runtime-attached
    sessions, and CLI startup.
12. Configured web provider and network-policy wiring through `KilnYaml.web`,
    CLI/MCP startup, direct provider sessions, GUI gateway startup, and TUI
    gateway startup. Defaults remain fail-closed when web configuration is
    absent.

## Active Objective

Start the second shared-tooling program from the canonical core surface outward.
Every phase must preserve the single core registry and shared runtime execution
path for CLI, GUI, TUI, SDK, and MCP consumers.

## References

- Architecture contract: `docs/architecture/tool-execution.md`
- User guide: `docs/guides/tool-use.md`
- Roadmap: `docs/roadmap/07-shared-developer-tools.md`
- Research basis: `docs/research/11-agent-tooling-surface.md`
- Next roadmap: `docs/roadmap/08-shared-tooling-intelligence.md`
- Next research basis: `docs/research/12-agent-tooling-next-surface.md`

## Closed Phase 10: Web Provider Configuration And Runtime Policy Wiring

The core web tools now accept explicit operational configuration without any
consumer-private tool implementation.

Implemented contracts:

- `KilnYaml.web.enabled` gates web tool activation; absent configuration keeps
  `web_fetch` network-denied and `web_search` provider-not-configured.
- `KilnYaml.web.netPolicy` supports `none`, `documentation`,
  `package-managers`, and `full`.
- `KilnYaml.web.allowedDomains` narrows the active network policy. When omitted,
  `documentation` and `package-managers` use the shared core default domain
  lists, and `full` uses unrestricted network policy.
- `KilnYaml.web.searchProvider` supports `{ type: "none" }` and
  `{ type: "http", url, headers? }`. The HTTP provider receives normalized
  `WebSearchProviderRequest` JSON and must return normalized source JSON.
- CLI `kiln tools --mcp` passes resolved web options into
  `createDefaultBuiltinToolSurface()`.
- Runtime-attached direct provider sessions, GUI gateway startup, and TUI
  gateway startup pass the same resolved options into
  `createAttachedRuntimeBuiltinToolSurface()`.

Focused tests:

- `packages/cli/tests/config/web-tools-config.test.ts`
- `packages/cli/tests/commands/tools-web-config.test.ts`
- `packages/cli/tests/commands/gui-dashboard-availability.test.ts`
- `packages/cli/tests/commands/tui-session-persistence.test.ts`
- `packages/runtime/tests/gateway/web-tool-surface-config.test.ts`
- `packages/runtime/tests/gateway/attached-runtime-tool-surface.test.ts`

## New Program: Shared Tooling Intelligence

The next plan is documented in
`docs/roadmap/08-shared-tooling-intelligence.md`. It starts from the research
in `docs/research/12-agent-tooling-next-surface.md`.

### Slice 11: Structured Tool Outputs And Output Schemas

Make builtin tool results machine-readable before adding more high-volume or
semantic tools.

Status: implemented for builtin developer tools.

Requirements:

- core output-schema contract for builtin tools
- MCP `outputSchema` projection
- stable text output for current consumers
- structured content for tool-level success and error results
- focused output validation tests
- docs distinguishing output contract from audit metadata

### Slice 12: Tool Catalog Index And Deferred Discovery

Add a searchable core catalog over tool names, descriptions, input fields,
output schemas, tags, authority, and source package. Keep execution through the
canonical registry while allowing deferred tool projection for large catalogs.

Status: implemented.

Implemented contract:

- `ToolCatalogIndex` indexes canonical `DevTool` definitions with names,
  descriptions, input fields, output fields, tags, authority class, source
  package, and optional cloned schemas.
- `tool_catalog_search` is the shared read-only discovery tool. It supports
  exact, prefix, tag, and lexical query search without requiring external
  embeddings.
- `DefaultBuiltinToolRegistryOptions.toolProjection` supports `mode:
  "deferred"` with an explicit `alwaysOnTools` list. Deferred projection
  changes advertised tools, not the canonical registry.
- MCP dev-tools listing accepts the projected tool set while execution still
  routes through the canonical `DevToolExecutionBridge`.
- Attached runtime surfaces consume the same projected core tool definitions,
  capabilities, and executors, so GUI, CLI, TUI, and SDK-backed runtime
  consumers share one contract.
- Missing exact catalog references return an empty result with `stale: true`
  and `reason: "tool_not_found"` instead of falling back to unrelated tools.

Verification:

- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run --cwd packages/core test tests/tools/domain/tool-catalog.test.ts tests/tools/default-tool-surface.test.ts tests/tools/mcp/dev-tools-server.test.ts`
- `bun run --cwd packages/runtime test tests/gateway/attached-runtime-tool-surface.test.ts`

### Slice 13: Semantic Code Intelligence

Add a provider-neutral `code_intelligence` tool backed by language-server
adapters for definitions, references, hover, symbols, diagnostics,
implementations, and call hierarchy.

Status: implemented.

Implemented contract:

- `CodeIntelligenceAdapter` is the provider-neutral core boundary for
  language-server-backed navigation and diagnostics.
- `code_intelligence` supports definition, references, hover,
  document symbols, workspace symbols, diagnostics, implementation, and call
  hierarchy operations.
- The tool validates workspace paths before adapter calls, requires positions
  for position-scoped operations, bounds results, and emits stable
  `code_intelligence` metadata.
- The default tool fails closed with `adapter_not_configured` when no language
  server adapter is supplied.
- The tool is registered in the canonical builtin surface, indexed in the tool
  catalog, projected through MCP, and available to runtime consumers through the
  same core projection model.

Verification:

- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run --cwd packages/core test tests/tools/infrastructure/code-intelligence-tool.test.ts tests/tools/domain/tool-catalog.test.ts tests/tools/default-tool-surface.test.ts tests/tools/mcp/dev-tools-server.test.ts tests/tools/domain/tool.test.ts`
- `bun run --cwd packages/runtime test tests/gateway/attached-runtime-tool-surface.test.ts`

### Slice 14: Bulk Context Ingestion

Add `read_many` for bounded, deterministic multi-file context packets with
include/exclude rules, gitignore respect, default excludes, provenance,
skipped-file reasons, and truncation metadata.

Status: implemented.

Implemented contract:

- `read_many` reads deterministic text-file context packets from files and
  directories with optional recursive expansion.
- The tool supports include/exclude glob filters, simple `.gitignore` pattern
  respect, default nuisance-directory excludes, `maxFiles`, `maxBytes`, and
  raw/structured/summary output.
- Binary, image, PDF, audio, video, denied, ignored, excluded, non-file, and
  overflow candidates are skipped with per-file reasons instead of silently
  disappearing.
- Returned metadata includes file count, skipped count, total bytes, truncation,
  and verbosity.
- The tool is registered in the canonical builtin surface, indexed in the tool
  catalog, projected through MCP, and available to runtime consumers through the
  same deferred projection model.

Verification:

- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run --cwd packages/core test tests/tools/infrastructure/read-many-tool.test.ts tests/tools/domain/tool-catalog.test.ts tests/tools/default-tool-surface.test.ts tests/tools/mcp/dev-tools-server.test.ts tests/tools/domain/tool.test.ts`
- `bun run --cwd packages/runtime test tests/gateway/attached-runtime-tool-surface.test.ts`

### Slice 15: Background Monitor And Long-Running Task Lifecycle

Add monitor start/read/stop/list semantics for dev servers, watch tests, logs,
and CI polling. Reuse `bash` command validation and expose lifecycle metadata
and runtime events.

Status: implemented.

Implemented contract:

- `MonitorRegistry` owns session-local long-running command lifecycles.
- Default builtin surfaces expose the owned `MonitorRegistry`, including
  `stopAll()`, so session teardown has an explicit orphan-cleanup boundary.
- `monitor_start` validates cwd and command through the shared sandbox helpers,
  starts a monitored `bash -c` process, records process ownership, and installs
  timeout cleanup.
- `monitor_read` returns bounded stdout, stderr, and lifecycle events after an
  optional sequence cursor.
- `monitor_stop` stops a running monitor by id and records explicit lifecycle
  completion evidence.
- `monitor_list` returns current monitor snapshots, optionally filtered by
  status.
- All four monitor tools support raw, structured, and summary output and emit
  shared `monitor` metadata.
- The tools are registered in the canonical builtin surface, indexed in the
  tool catalog, projected through MCP, and available to runtime consumers
  through the same deferred projection model.

Verification:

- `bun run typecheck`
- `bun run --cwd packages/core test tests/tools/infrastructure/monitor-tools.test.ts tests/tools/domain/tool.test.ts tests/tools/default-tool-surface.test.ts tests/tools/domain/tool-catalog.test.ts tests/tools/mcp/dev-tools-server.test.ts`
- `bun run --cwd packages/runtime test tests/gateway/attached-runtime-tool-surface.test.ts`
- `bun run test`
- `bun run build`

### Slice 16: Shared Task State

Add session-local task state so CLI, GUI, TUI, MCP, and SDK consumers observe
the same progress model instead of each surface inventing its own checklist.

Status: implemented.

Implemented contract:

- `TaskStateStore` owns session-local model-visible task progress.
- `task_update` creates or updates tasks with stable ids, title, status,
  optional details, optional dependencies, timestamps, and monotonic sequence
  numbers.
- `task_list` returns the shared task projection with optional status
  filtering.
- Supported task statuses are `pending`, `in_progress`, `blocked`,
  `completed`, and `cancelled`.
- The task-state model is deliberately separate from project documents,
  roadmap plans, orchestration demand registries, and external project
  management integrations.
- Both tools support raw, structured, and summary output and emit shared
  `task_state` metadata.
- The tools are registered in the canonical builtin surface, indexed in the
  tool catalog, projected through MCP, and available to runtime consumers
  through the same deferred projection model.

Verification:

- `bun run typecheck`
- `bun run --cwd packages/core test tests/tools/infrastructure/task-state-tools.test.ts tests/tools/domain/tool.test.ts tests/tools/default-tool-surface.test.ts tests/tools/domain/tool-catalog.test.ts tests/tools/mcp/dev-tools-server.test.ts`
- `bun run --cwd packages/runtime test tests/gateway/attached-runtime-tool-surface.test.ts`
- `bun run test`
- `bun run build`

### Slice 17: Operator Elicitation

Add one cross-surface structured-input boundary for asking the operator
questions. Map to MCP elicitation where available and require URL mode for
sensitive credential or OAuth-style handoffs.

### Slice 18: MCP Resources For Workspace And Artifacts

Expose stable context such as selected files, summaries, task state, plans, and
session artifacts as MCP resources with templates, pagination, and
list-changed/update notifications.

## Phase 9 Design Record

Research basis:

- Anthropic, Gemini CLI, and OpenCode all split web discovery from URL
  retrieval.
- OpenAI and Anthropic web search surfaces make source/citation data a first
  class output concern.
- MCP security guidance treats network access as a scope and SSRF boundary, not
  a formatting detail.
- User reports on coding-agent web search highlight stale documentation,
  unreliable lookup, and manual toggle friction.

Design decisions:

- Keep `web_search` and `web_fetch` in `@kilnai/core`; no GUI, CLI, TUI, or MCP
  private implementation.
- Add a new `web` metadata family instead of overloading workspace `search`
  metadata, because external source retrieval has different policy, source,
  HTTP, and truncation evidence.
- `web_fetch` uses an injected `WebFetchClient` with a default native
  `fetch`-based implementation. It validates URL, domain, redirects, content
  type, byte limits, and timeout before returning sanitized text.
- `web_search` uses an injected `WebSearchProvider`. The default provider fails
  closed with a configuration error; core must not scrape search-result pages or
  hide network calls behind shell commands.
- Both tools support `verbosity?: "raw" | "structured" | "summary"` because web
  outputs are high-volume.
- Domain inputs are allowlists for the call. They must be intersected with the
  sandbox/network policy; user-provided domains can narrow policy, never expand
  it.
- Domain parsing must use ASCII-normalized hostnames, reject URL-shaped domain
  values, and include subdomains consistently.
- Fetch follows redirects only when every hop passes the same policy. Redirect
  chains are recorded in metadata.
- Results are sanitized before reinjection: remove scripts/styles, collapse
  whitespace, strip control characters, cap output bytes/chars, and record
  truncation.

Planned contracts:

```ts
web_search({
  query: string,
  domains?: string[],
  recencyDays?: number,
  maxResults?: number,
  verbosity?: "raw" | "structured" | "summary"
})

web_fetch({
  url: string,
  maxBytes?: number,
  timeout?: number,
  verbosity?: "raw" | "structured" | "summary"
})
```

Core metadata:

```ts
WebToolResultMetadata {
  toolName: "web_search" | "web_fetch"
  kind: "web"
  operation: "search" | "fetch"
  provider?: string
  query?: string
  url?: string
  normalizedUrl?: string
  domains?: readonly string[]
  recencyDays?: number
  resultCount?: number
  retrievedAt?: string
  contentType?: string
  status?: number
  bytesRead?: number
  truncated?: boolean
  redirectChain?: readonly string[]
  sources?: readonly WebSourceMetadata[]
  errorCode?: "invalid_input" | "network_denied" | "unsupported_content_type" |
    "too_many_requests" | "unavailable" | "timeout" | "provider_not_configured"
  verbosity?: "raw" | "structured" | "summary"
}
```

Implemented core order:

1. Add failing core tests for `TOOL_SCHEMAS`, `DevToolName`, web metadata
   builders, default surface tool order, MCP schema projection, and runtime
   attached-surface projection. Expected count becomes 14 builtin tools for
   Slice 10 and 15 builtin tools after Slice 12 adds `tool_catalog_search`.
2. Add `packages/core/src/tools/infrastructure/web-policy.ts` for URL/domain
   normalization, sandbox `NetworkFilter` checks, redirect policy helpers, and
   private/localhost address rejection.
3. Add `packages/core/src/tools/infrastructure/web-result-format.ts` for shared
   raw/structured/summary output formatting and sanitized source snippets.
4. Add `packages/core/src/tools/infrastructure/web-fetch-tool.ts` with injected
   fetch client, timeout, byte cap, content-type allowlist, redirect validation,
   sanitization, and metadata.
5. Add `packages/core/src/tools/infrastructure/web-search-tool.ts` with injected
   provider, domain/recency/max-result validation, fail-closed default provider,
   result normalization, and metadata.
6. Register and export both tools from `TOOL_SCHEMAS`,
   `createDefaultBuiltinTools()`, and `packages/core/src/tools/index.ts`.
7. Update MCP tests, runtime attached-surface tests, CLI tool startup tests if
   needed, and user/architecture docs.

Focused test cases covered:

- `web_fetch` rejects non-HTTP(S), localhost/private IP, invalid URL, and
  domains outside sandbox policy.
- `web_fetch` rejects redirect hops that leave policy.
- `web_fetch` strips script/style content, strips control characters, records
  `retrievedAt`, `contentType`, `status`, `bytesRead`, `truncated`, and
  redirect chain.
- `web_fetch` formats raw, structured, and summary output without changing
  metadata.
- `web_search` rejects empty query, invalid domains, negative recency, and
  provider-not-configured.
- `web_search` passes query/domain/recency/maxResults to an injected provider
  and returns ranked sources with provider metadata.
- Both schemas expose read-only/idempotent annotations and shared `verbosity`.

## Verification For Every Phase

- Focused unit tests for the new core tool.
- Default surface tests proving the tool is projected from the canonical
  registry.
- MCP tests proving schema and call behavior.
- Runtime projection tests proving CLI, GUI, and TUI attached sessions receive
  the same developer-tool surface.
- `bun run typecheck`
- `bun run test`
- `bun run build`

## Non-Negotiables

- No GUI/TUI-private developer tool implementation.
- No duplicated builtin schema registry.
- No hidden shell fallback that bypasses path/network validation.
- No metadata contract outside core.
- No tool marked complete without docs and tests.
