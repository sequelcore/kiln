# Tool Use Operations

Use this guide for tool configuration, execution flow, and runtime behavior. For
the architectural role of tool execution, start with:

- [Tool Execution](../architecture/tool-execution.md)
- [Safety](../architecture/safety.md)

Kiln uses the same runtime loop for every tool category: publish the schema,
authorize the call, execute it inside the runtime boundary, and inject the
structured result back into the session.

Sources: `packages/core/src/engine/domain/capability.ts`, `packages/core/src/engine/domain/tool-execution.ts`, `packages/core/src/orchestrator/orchestrator.ts`, `packages/core/src/security/annotation-authorizer.ts`, `packages/core/src/tools/default-tool-surface.ts`, `packages/core/src/tools/domain/tool.ts`, `packages/core/src/tools/domain/tool-registry.ts`, `packages/core/src/tools/domain/tool-result-metadata.ts`, `packages/core/src/tools/domain/tool-environment.ts`, `packages/core/src/tools/infrastructure/*.ts`, `packages/core/src/tools/tool-executor.ts`, `packages/core/src/tools/mcp/dev-tools-server.ts`, `packages/runtime/src/gateway/attached-runtime-tool-surface.ts`, `packages/cli/src/commands/tools.ts`, `packages/cli/src/wrapper/session.ts`, `packages/cli/src/wrapper/session-registry.ts`

---

## Overview

When an agent receives a message, the orchestrator enters a tool loop:

1. Send the conversation, system prompt, and tool schemas to the model.
2. If the model emits tool calls, authorize and execute them.
3. Append each tool result to the conversation.
4. Repeat until the model returns a final text response.

The loop is bounded by the session's execution settings and emits tool lifecycle events through the `EventBus`.

---

## Capabilities in `app.yaml`

Every non-native tool exposed by an app is declared as a capability and referenced by agent name. The loader validates those references at startup.

```yaml
capabilities:
  - name: search_products
    description: Search the product catalog by query
    tags: [catalog]
    annotations:
      readOnly: true
      idempotent: true

  - name: process_refund
    description: Process a customer refund
    tags: [billing]
    annotations:
      destructive: true
```

### Capability annotations

| Annotation | Type | Effect |
|-----------|------|--------|
| `readOnly` | boolean | Safe to auto-execute and retry. |
| `destructive` | boolean | Classified as always-confirm. |
| `idempotent` | boolean | Safe for audited retry. |
| `cacheTtl` | number | Enables tool-result caching for the declared TTL. |
| `guardrail` | boolean | Reserved for highest-friction confirmation flows. |
| `outputSchema` | JSON Schema | Validates the returned shape. |

Unannotated capabilities default to the authorizer's configured default level.

---

## Retry and fallback

Capabilities can declare retry behavior and an optional fallback tool:

```yaml
capabilities:
  - name: search_inventory
    retry:
      maxAttempts: 3
      backoff: exponential
      fallback: search_inventory_cache
```

At execution time, Kiln uses `executeWithRetry()` from `packages/core/src/agents/tool-execution-engine.ts`:

- `maxAttempts` defaults to `3`
- `timeout` defaults to `30s`
- validation errors can short-circuit
- timeouts surface as `TOOL_EXECUTION_TIMEOUT`
- exhausted retries surface as `TOOL_RETRY_EXHAUSTED`
- `fallback` is executed through the same executor path

---

## Authorization model

Native and app-defined tools both rely on annotation-driven authorization. `AnnotationAuthorizer` maps tool annotations onto four execution levels:

| Level | Annotation shape | Result |
|-------|------------------|--------|
| `1` | `readOnly: true` | auto-execute |
| `2` | `idempotent: true` or default policy | audited execution |
| `3` | unknown tool when approval is required | approval required |
| `4` | `destructive: true` | approval required |

`DevToolExecutionBridge` converts authorization failures into explicit engine errors:

- `TOOL_AUTHORIZATION_DENIED`: hard deny
- `TOOL_APPROVAL_REQUIRED`: execution is blocked pending approval

That distinction matters because the caller can treat "never allowed" differently from "allowed after approval."

---

## Structured output

Builtin developer tools publish a shared MCP `outputSchema`. The schema is the
execution envelope returned in MCP `structuredContent`:

```json
{
  "result": {
    "output": "tool-specific text output",
    "isError": false,
    "metadata": {}
  },
  "attempts": 1,
  "fallbackUsed": false
}
```

For backwards compatibility, MCP responses also include the serialized JSON
envelope as a text content item. `result.output` remains the human-readable tool
output and preserves each tool's existing `verbosity` behavior.

`result.metadata` is audit and provenance evidence, not the primary output
contract. Consumers should use the envelope and `outputSchema` for structural
validation, then use metadata for evidence such as paths, hashes, redirect
chains, search sources, byte counts, and truncation.

Tool-level failures still return the same structured envelope with
`result.isError: true` and MCP `isError: true`. Thrown execution failures and
unknown tools remain MCP error results.

---

## Webhook tools

Webhook tools expose external HTTP endpoints as tenant-scoped tools. Kiln signs requests with HMAC-SHA256 and returns the parsed JSON response as the tool result.

Key fields on `TenantConfig.webhookTools[]`:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Tool name shown to the model |
| `description` | Yes | Tool description |
| `url` | Yes | Endpoint to call |
| `secret` | Yes | Signing key |
| `timeout` | No | Request timeout in seconds |
| `inputSchema` | No | JSON Schema for request validation |

The webhook executor uses the same tool loop as any other capability, which means rate limiting, authorization, result sanitization, and event emission stay consistent.

---

## Integration tools

Integration tools wrap third-party APIs behind `IntegrationAdapter` implementations. The runtime handles:

- adapter registration
- credential resolution
- tool definition generation
- execution and error wrapping

Tool names follow `{provider}_{operation}`, such as `google_calendar_check_availability` or `stripe_create_payment_link`. Integration operations surface annotations, so they participate in the same authorization and retry rules as other tools.

---

## Native developer tools

The native developer tool stack lives under `packages/core/src/tools/`. It exists so Kiln can execute coding tasks without depending on an external harness backend.

### External runtime contract

MCP is Kiln's shared external runtime contract for native developer tools. Any
agent host, wrapper, plugin, or installer that needs Kiln tools should consume
the MCP projection or another projection from the canonical registry. It should
not copy tool schemas, own a private executor, or invent a second authorization
surface.

Packaging layers can describe how tools are used. They may provide:

- prompt or instruction payload
- policy hints for the host
- allowed tool groups
- workflow steps
- host installation metadata

They cannot own:

- authorization decisions
- tool execution
- telemetry or audit records
- result sanitization
- private tool executors for Kiln builtin tools

The canonical path remains: registry schema, runtime authorization, execution
bridge, telemetry, audit, and structured result reinjection.

The canonical builtin projection is `createDefaultBuiltinToolSurface()` in
`@kilnai/core`. MCP, runtime-attached sessions, and `kiln tools --mcp` consume
that surface or projections from it; they do not maintain their own builtin
tool registry. Runtime may append operator-surface tools such as
`operator_set_theme`, but the developer tools still come from the core surface.
`operator_elicit` is a core builtin developer tool for asking the operator for
bounded input through whatever responder the active consumer attaches.

The same default surface also owns a `ToolResourceRegistry` for read-only MCP
resources. Resources are context snapshots, not actions. The initial shared
resources are:

- `kiln://tools/catalog`
- `kiln://session/tasks`
- `kiln://session/monitors`

The initial resource templates are:

- `kiln://tools/catalog/{name}`
- `kiln://session/tasks/{id}`
- `kiln://session/monitors/{id}`

These resources read from the same catalog, task-state store, and monitor
registry used by the builtin tools. They return JSON content and never mutate
state, run commands, stop monitors, or bypass tool authorization.

MCP resource and resource-template listing supports cursor pagination. The
server accepts `cursor` from `resources/list` and `resources/templates/list`,
returns bounded pages, and includes `nextCursor` only when another page exists.
The cursor is opaque to consumers; callers should pass it back unchanged and
restart from the first page if it is rejected as invalid, stale, or
out-of-range. Core in-process callers that need the current complete static set
may still call `ToolResourceRegistry.list()` or `listTemplates()`.

When the builtin surface is created with `workspaceResources.rootPath`, the same
registry also exposes workspace resources:

- `kiln://workspace/tree`
- `kiln://workspace/tree{?path,depth,includeFiles}`
- `kiln://workspace/file/{path}`
- `kiln://workspace/preview/{path}{?offset,limit}`

Workspace resource paths are relative to the configured root and use forward
slashes. Tree and preview reads are bounded. Text files return text content with
metadata; binary files return metadata-only JSON because blob reads need a
separate policy. Workspace resources never write files, delete files, execute
commands, or grant tool authority.

The default builtin surface owns a session-local artifact store unless a
consumer supplies `artifactResources.store`. The same registry exposes artifact
resources:

- `kiln://artifacts/{namespace}`
- `kiln://artifacts/{namespace}/{id}`
- `kiln://artifacts/{namespace}/{id}/content`

Artifact writes go through `ArtifactResourceStore`, not through resource reads.
The memory-backed store requires explicit session retention on each write,
records producer provenance, and bounds content size plus retained artifacts per
namespace. Artifact content may be JSON, text, or blob content, all addressed by
stable artifact URIs.

Long-lived consumers that recreate tool surfaces per turn should create one
session-scoped builtin tool options bundle and reuse it for the session. That
keeps the artifact store, task-state store, monitor registry, and notification
hub stable while still letting each turn attach its own operator-surface
controllers. Without that shared state, a `kiln://artifacts/...` link created by
one tool call can become unreadable in a later turn.

High-volume tool results may include resource links to artifact content when
the output is large or explicitly truncated. The canonical execution bridge adds
these links after successful eligible tool calls, so MCP, CLI, GUI, TUI, SDK,
and runtime consumers share one behavior. The visible `ToolResult.output` is
not rewritten. Structured consumers should inspect
`result.metadata.resourceLinks`; MCP consumers also receive a `resource_link`
content part.

Linked artifact content is not required to be identical to the visible
`ToolResult.output`. Tools can provide an internal resource payload for the
artifact linker, and the linker strips that payload before returning the tool
result. For example, `read_many` summary output can remain a compact line such
as `24 files read...`, while the linked artifact stores the raw bounded file
packet that `resource_read` can inspect later.

Resource link metadata uses this shape:

```ts
resourceLinks?: readonly {
  uri: string
  title?: string
  mimeType?: string
  size?: number
  relation: "full_output" | "snapshot" | "events" | "source" | "summary"
}[]
```

Consumers can inspect resources without starting an MCP client:

```bash
kiln tools --resources
kiln tools --resource kiln://tools/catalog
```

Both commands use the same core builtin surface as `kiln tools --mcp`.
`--resources` prints compact display descriptors with URI, title, MIME type,
size, relation, and truncation state when available. `--resource <uri>` reads
the resource through the shared registry and prints text content directly when
the resource has a single text payload.

Runtime-attached consumers use the same projection through
`AttachedRuntimeBuiltinToolSurface.listResources()`,
`listResourceTemplates()`, and `readResource(uri)`. Direct-provider runtime tool
execution keeps linked high-volume payloads out of the turn by returning a
compact resource-pointer output while preserving `metadata.resourceLinks` and
`resource_link` content for clients that can render links. SDK consumers can
import the resource descriptor, read result, page, and display types from
`@kilnai/react`, which re-exports the core contracts.

Executable model sessions can consume the same resource plane through core
read-only builtin tools:

- `resource_list`: lists registry resources with optional cursor pagination
- `resource_template_list`: lists resource templates with optional cursor
  pagination
- `resource_read`: reads a `kiln://...` resource URI

These tools are thin adapters over the same `ToolResourceRegistry`; they do not
own a private browse/read protocol and they do not grant mutation authority.
They stay visible in deferred tool projection alongside `tool_catalog_search`,
so a model can follow `metadata.resourceLinks` from high-volume results without
requiring a GUI, TUI, CLI, or MCP-client-only helper. `resource_read` returns a
single text payload directly when possible and otherwise returns the resource
content array as JSON.

The builtin surface also creates a `ToolResourceNotificationHub`. Consumers can
subscribe by resource URI and receive MCP-compatible invalidation messages:

- `notifications/resources/updated` for subscribed resources or their
  descendants
- `notifications/resources/list_changed` when listable resource namespaces
  change

Task updates, monitor lifecycle/output changes, and artifact writes notify
after mutation. The notification is only a re-read hint; consumers should call
`resources/read` or the in-process registry again instead of treating the
notification as payload content. MCP clients use `resources/subscribe` and
`resources/unsubscribe`; CLI `kiln tools --mcp` wires those handlers from the
same core surface.

The deeper resource-plane roadmap is
`docs/roadmap/09-context-resource-plane.md`. Pagination, workspace-file
resources, artifact namespaces, update notifications, resource links from
high-volume tools, and consumer projection are implemented there; the remaining
slice covers evaluation.

### Domain contracts

`packages/core/src/tools/domain/tool.ts` defines the core types:

```ts
export type ToolInput = {
  readonly name: string;
  readonly input: Record<string, unknown>;
};

export type ToolResult = {
  readonly output: string;
  readonly isError: boolean;
  readonly metadata?: ToolResultMetadata;
  readonly content?: readonly ToolResultContentPart[];
};

export interface DevTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: DevToolAnnotations;
  execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult>;
}
```

The twenty-seven built-in tool names are:

- `bash`
- `read`
- `read_many`
- `write`
- `edit`
- `patch`
- `stat`
- `tree`
- `view_image`
- `ocr_image`
- `web_search`
- `web_fetch`
- `grep`
- `glob`
- `git`
- `code_intelligence`
- `monitor_start`
- `monitor_read`
- `monitor_stop`
- `monitor_list`
- `task_list`
- `task_update`
- `operator_elicit`
- `tool_catalog_search`
- `resource_list`
- `resource_template_list`
- `resource_read`

Operator-attached CLI, GUI, and TUI turns may also expose
`operator_set_theme`. That tool is not part of the filesystem developer-tool
registry; it is added by the runtime projection when the active consumer
provides an operator theme controller. GUI and TUI change the connected live
surface through the shared WebSocket frame contract and return an ordinary tool
result. CLI has no live visual surface, so it rejects `scope: "session"` with an
explicit tool error and accepts `scope: "persisted"` to save GUI/TUI defaults.

`operator_set_theme` parameters:

- `theme`: shared operator theme name
- `scope`: `session` for the live surface, or `persisted` to save the
  preference when the operator requested persistence
- `reason`: optional short explanation

The supported theme names are defined once in `@kilnai/gateway-contracts`.

### Built-in tool schemas

`TOOL_SCHEMAS` is the source of truth for names, descriptions, input schemas, and annotations. `createDefaultBuiltinToolSurface()` turns those core definitions into registry, MCP, runtime, CLI, and capability projections.

High-volume tools support a shared `verbosity` field:

- `raw`: preserves the compact historical `ToolResult.output`
- `structured`: returns JSON while keeping the same metadata contract
- `summary`: returns a bounded rollup for large outputs

The shared field is named `verbosity`, not `outputMode`, because `grep` already
uses `outputMode` for match shape: `content`, `files_with_matches`, or `count`.

### Result metadata

Builtin developer tools return one core-owned metadata contract from
`packages/core/src/tools/domain/tool-result-metadata.ts`.

Every metadata object includes:

- `toolName`: canonical builtin tool name
- `kind`: `command`, `file`, `inspection`, `media`, `web`, `search`,
  `monitor`, `task_state`, or `elicitation`
- optional `resourceLinks`: artifact-backed resources for large or truncated
  high-volume outputs

High-volume metadata may also include `verbosity`, which records the requested
output shape without changing the stable metadata family.

File metadata also includes `operation`, which is `read`, `read_many`, `write`,
`edit`, or `patch`. Runtime file-change evidence is derived from shared `file`
metadata for `write`, `edit`, and `patch`; read operations are not file-change
evidence. Patch metadata carries a `files` array so one tool result can report
every created, modified, deleted, or moved path.

Inspection metadata covers `stat` and `tree`. `stat` reports the inspected path,
entry type, size, modified time, and optional hash. `tree` reports the root path,
depth, file-inclusion mode, entry count, truncation state, and ignored
directories. Inspection metadata is orientation evidence, not file-change
evidence.

Media metadata covers `view_image` and `ocr_image`. `view_image` reports path,
MIME type, size, optional dimensions, and requested detail level. `ocr_image`
reports path, MIME type, size, language, extracted text length, and OCR backend
source or confidence when available. MCP consumers receive image content as a
standard MCP image content item; text-only consumers still receive the compact
JSON `output`.

Web metadata covers `web_search` and `web_fetch`. `web_search` reports provider,
query, normalized domain filters, recency, result count, retrieval time, ranked
sources, errors, and requested verbosity. `web_fetch` reports source URL,
normalized final URL, content type, status, bytes read, redirect chain,
truncation, errors, and requested verbosity. Web metadata is external-source
evidence, not workspace search or file-change evidence.

Monitor metadata covers `monitor_start`, `monitor_read`, `monitor_stop`, and
`monitor_list`. It reports monitor ids, command/cwd ownership, status, timeout,
sequence cursors, event counts, duration, exit code, signal, timeout state, and
truncation evidence. Monitor metadata is lifecycle evidence, not file-change
evidence.

Task-state metadata covers `task_list` and `task_update`. It reports task ids,
status filters, sequence numbers, task counts, and validation errors for the
session-local progress model. Task-state metadata is not a saved project plan,
external issue tracker record, or file-change signal.

Elicitation metadata covers `operator_elicit`. It reports mode, outcome, schema
presence, sensitivity flag, optional HTTPS URL handoff, answering surface, and
submitted field names. Submitted values are never written to metadata.

Web tools are fail-closed unless `KilnYaml.web` enables them:

```yaml
web:
  enabled: true
  netPolicy: documentation
  allowedDomains:
    - docs.example.com
  searchProvider:
    type: http
    url: https://search.example.com/query
    headers:
      authorization: Bearer replace-with-provider-token
```

`netPolicy` accepts `none`, `documentation`, `package-managers`, or `full`.
`allowedDomains` narrows the policy; when omitted, `documentation` and
`package-managers` use Kiln's shared default domain lists. The HTTP search
provider receives the normalized `WebSearchProviderRequest` as JSON and must
return a JSON object with a `sources` array.

### Tool reference

| Tool | Purpose | Key params | Output shape |
|------|---------|------------|--------------|
| `bash` | Run a shell command through `bash -c` | `command`, `timeout`, `cwd`, `verbosity` | `raw` output is combined stdout+stderr; `structured` is JSON command evidence; `summary` is a bounded rollup; metadata includes `cwd`, `command`, `timeoutMs`, `verbosity` |
| `read` | Read file content from disk | `filePath`, `offset`, `limit` | `output` is the selected line window; metadata includes `filePath`, `offset`, `limit`, `totalLines` |
| `read_many` | Read a bounded deterministic packet of text files | `paths`, `include`, `exclude`, `recursive`, `respectGitIgnore`, `useDefaultExcludes`, `maxFiles`, `maxBytes`, `verbosity` | `raw` output is a path-delimited text packet; `structured` is JSON file/skipped data; `summary` is a bounded rollup; metadata includes file count, skipped count, total bytes, truncation, and `verbosity` |
| `write` | Replace full file contents | `filePath`, `content` | `output` is a confirmation string; metadata includes `filePath`, `bytesWritten` |
| `edit` | Replace one or all string matches in a file | `filePath`, `oldString`, `newString`, `replaceAll` | `output` is a replacement summary or an error; metadata includes `filePath`, `replacements`, `replaceAll` |
| `patch` | Apply a structured multi-file patch | `patch`, `dryRun` | `output` is an apply or dry-run summary; metadata includes `operationCount`, `dryRun`, and per-file change entries |
| `stat` | Inspect file, directory, symlink, or other path metadata | `path`, `hash` | `output` is compact JSON metadata; metadata includes `path`, `type`, `size`, `modifiedTime`, and optional `hash` |
| `tree` | Produce a compact bounded directory tree | `path`, `depth`, `includeFiles`, `verbosity` | `raw` output is an indented deterministic tree; `structured` is JSON entry data; `summary` is a bounded rollup; metadata includes `path`, `depth`, `includeFiles`, `entryCount`, `truncated`, `verbosity`, and ignored directories |
| `view_image` | Read an image as model-consumable content | `path`, `detail` | `output` is compact JSON metadata; `content` includes MCP-compatible image data; metadata includes `path`, `mimeType`, `size`, dimensions, and `detail` |
| `ocr_image` | Extract text from an image through the configured OCR backend | `path`, `language` | `output` is compact JSON text extraction data; metadata includes `path`, `mimeType`, `language`, `textLength`, and optional backend confidence/source |
| `web_search` | Search the web through the configured provider | `query`, `domains`, `recencyDays`, `maxResults`, `verbosity` | default configuration fails closed; configured providers return ranked sources; metadata includes provider, query, domains, recency, result count, sources, errors, and `verbosity` |
| `web_fetch` | Fetch and sanitize allowed HTTP(S) text content | `url`, `maxBytes`, `timeout`, `verbosity` | default configuration requires explicit network policy; output is sanitized text, JSON, or summary; metadata includes source/final URL, status, content type, bytes read, redirect chain, truncation, errors, and `verbosity` |
| `grep` | Search file content by regex | `pattern`, optional file-or-directory `path`, `glob`, `outputMode`, `verbosity` | `raw` output is newline-delimited matches, file paths, or counts; `structured` is JSON result data; `summary` is a bounded rollup; metadata includes `path`, `strategy`, `outputMode`, `count`, and `verbosity` |
| `glob` | Match files by glob pattern | `pattern`, `path`, `verbosity` | `raw` output is newline-delimited relative file paths; `structured` is JSON matches; `summary` is a bounded rollup; metadata includes `path`, `strategy`, `count`, and `verbosity` |
| `git` | Run a git subcommand | `subcommand`, `args` | `output` is combined stdout+stderr; metadata includes `cwd`, `command` |
| `code_intelligence` | Query a configured language-server adapter | `operation`, `path`, `position`, `query`, `symbol`, `limit`, `verbosity` | default configuration fails closed; configured adapters return bounded semantic code results; metadata includes operation, workspace root, adapter, language, result count, errors, and `verbosity` |
| `monitor_start` | Start a monitored long-running shell command | `command`, `cwd`, `name`, `timeout`, `verbosity` | starts a session-local monitor with timeout cleanup; metadata includes id, command, cwd, status, timeout, sequence, and `verbosity` |
| `monitor_read` | Read bounded monitor output events | `id`, `sinceSequence`, `limit`, `verbosity` | `raw` output is concatenated event text; `structured` is JSON snapshot plus events; `summary` is a bounded rollup; metadata includes id, status, sequence, cursor, event count, and `verbosity` |
| `monitor_stop` | Stop a monitored command | `id`, `reason`, `verbosity` | stops a running monitor or returns the completed snapshot; metadata includes id, status, event count, duration, exit code, signal, timeout, and truncation |
| `monitor_list` | List monitor snapshots | `status`, `verbosity` | returns monitor rows, JSON snapshots, or a summary count; metadata includes monitor count, optional status filter, and `verbosity` |
| `task_list` | List session-local task state | `status`, `verbosity` | `raw` output is tab-delimited task rows; `structured` is JSON task state plus counts; `summary` is a bounded rollup; metadata includes filter status, task count, total task count, sequence, and `verbosity` |
| `task_update` | Create or update session-local task state | `id`, `title`, `status`, `details`, `dependsOn`, `verbosity` | creates or updates one task in the shared store; metadata includes task id, status, total task count, sequence, and `verbosity` |
| `operator_elicit` | Ask the operator for bounded input through the attached responder | `mode`, `message`, `schema`, `url`, `sensitive`, `verbosity` | form mode collects non-sensitive structured values; URL mode requires HTTPS for sensitive handoffs; metadata records mode, outcome, surface, URL, and value keys without values |
| `tool_catalog_search` | Search the shared tool catalog | `query`, `exact`, `prefix`, `tags`, `limit`, `includeSchemas`, `verbosity` | returns matched tool catalog entries and reports stale exact matches without falling back to unrelated tools |

`patch` accepts a structured document with `*** Begin Patch` and
`*** End Patch` sentinels. Supported operations are:

- `*** Add File: path` followed by `+` lines
- `*** Update File: path` followed by `@@` hunks using space, `-`, and `+`
  line prefixes
- `*** Delete File: path`
- `*** Update File: oldPath` plus `*** Move to: newPath`

Patch execution is all-or-nothing at the planning boundary: Kiln parses the
entire document, validates every target path, checks file existence, and
computes every changed file before applying any write. If application fails
after writing starts, Kiln restores captured file snapshots on a best-effort
basis. `dryRun: true` performs the same parsing, path validation, and planning
without changing disk.

### Executor behavior

The built-in executors are intentionally small and predictable:

- `BashTool` validates `cwd`, validates the command string against the sandbox policy, clamps timeout to `300000ms`, executes with `execFile("bash", ["-c", command])`, and applies `verbosity` after command metadata is built.
- `ReadTool` uses line-based slicing, not byte offsets.
- `WriteTool` creates parent directories before writing.
- `EditTool` supports single replacement and `replaceAll`, and fails if the target string is not found.
- `StatTool` validates the target path, reports `lstat` metadata, and computes SHA-256 only when requested for files.
- `TreeTool` validates the root path, bounds depth and entry count, sorts directories before files, skips nuisance directories by default, and can return raw, structured, or summary output.
- `ViewImageTool` validates path and image MIME by content, enforces size limits, and returns base64 image content plus media metadata.
- `OcrImageTool` validates the image through the same path and MIME checks, then calls the configured OCR runner; the default runner uses `tesseract` from PATH when available.
- `WebSearchTool` validates query, domain, recency, and result-count controls, intersects domains with sandbox network policy, calls an injected provider, and fails closed when no provider is configured.
- `WebFetchTool` validates HTTP(S) URLs, rejects private/local hosts, requires explicit network policy, validates redirect hops, caps bytes, checks supported text content types, sanitizes returned text, and supports raw, structured, or summary output.
- `GrepTool` uses `rg` when available and falls back to a recursive file walk plus JavaScript `RegExp`; `outputMode` controls match shape while `verbosity` controls result shape.
- `GlobTool` uses `fd` when available and falls back to the same recursive walker plus glob matching helpers; it can return raw path lists, structured JSON matches, or a summary.
- `GitTool` executes `git` directly and validates the reconstructed command string before running it.
- `ReadManyTool` builds bounded multi-file text packets with deterministic ordering, include/exclude globs, optional `.gitignore` respect, default nuisance-directory excludes, per-file skipped reasons, total bytes, and truncation metadata.
- `CodeIntelligenceTool` validates workspace paths and delegates semantic navigation, symbols, diagnostics, implementations, and call hierarchy to an injected `CodeIntelligenceAdapter`. The default fails closed with `adapter_not_configured` instead of approximating LSP behavior with text search.
- `MonitorRegistry` owns session-local long-running command lifecycles and exposes `stopAll()` for session teardown. `MonitorStartTool` reuses bash-style cwd and command validation, starts `bash -c`, installs timeout cleanup, and records sequence-numbered output. `MonitorReadTool`, `MonitorStopTool`, and `MonitorListTool` read, stop, and project the same registry rather than owning separate process state.
- `TaskStateStore` owns session-local model-visible task progress. `TaskUpdateTool` validates lifecycle status, title, ids, and dependencies before mutating the store. `TaskListTool` projects the same store with optional status filtering.
- `OperatorElicitationTool` validates form or URL mode, denies sensitive form collection, requires HTTPS URL handoffs, calls the attached `OperatorElicitationResponder`, and records only outcome evidence plus submitted field names.
- `ToolCatalogSearchTool` searches the shared catalog by exact name, prefix, tags, or lexical query. It is read-only, supports raw, structured, and summary output, and reports stale exact matches as an empty result with `reason: "tool_not_found"`.

All twenty-four tools return `ToolResult`; failures are regular tool results when possible, not uncaught process exceptions.

The default surface can also run in deferred projection mode. In that mode,
only configured always-on tools plus `tool_catalog_search` are advertised to a
consumer, while concrete execution still routes through the canonical registry
and bridge. This keeps GUI, CLI, TUI, SDK, and MCP consumers on the same tool
contract without forcing every tool schema into every context.

For MCP consumers, long-running calls have two coordinated timeout layers:

- Kiln-owned MCP clients pass a request timeout that is at least the requested
  millisecond tool timeout plus `30000ms`, and enable progress-based timeout
  reset handling.
- The dev-tools MCP server emits `notifications/progress` every `30000ms` while
  a call is still running when the caller provides an MCP progress token.

---

## ToolEnvironment

`ToolEnvironment` records the detected developer-tool binaries:

```ts
export interface ToolEnvironment {
  readonly rg?: BinaryInfo;
  readonly fd?: BinaryInfo;
  readonly jq?: BinaryInfo;
  readonly git?: BinaryInfo;
}
```

`detectToolEnvironment()` probes:

- `rg`
- `fd`
- `jq`
- `git`

It caches the first successful detection result process-wide, and `clearToolEnvironmentCache()` resets that cache for tests or PATH changes.

### Resolution order

Kiln's developer tool stack is designed around three layers:

1. Vendored binaries from `@kilnai/tools` platform packages for `rg`, `fd`, and `jq`
2. System binaries discovered from PATH
3. Pure TypeScript fallback inside the executor when no binary is available

In the current core source, `detectToolEnvironment()` performs the PATH probe and the fallback logic lives in `GrepTool` and `GlobTool`. The vendored resolver is packaged separately in `packages/tools`, which publishes platform-specific optional dependencies such as `@kilnai/tools-win32-x64`.

`git` is different: Kiln detects it from PATH, but there is no pure TypeScript git fallback.

---

## DevToolRegistry

`DevToolRegistry` is the runtime index for developer tools:

```ts
export class DevToolRegistry {
  register(tool: DevTool): void;
  lookup(name: string): DevTool | undefined;
  list(): readonly DevTool[];
  has(name: string): boolean;
  get size(): number;
}
```

Design choice:

- registration is explicit
- lookup is by stable string name
- duplicate registration throws immediately

That matters because the registry is the composition boundary for both the orchestrator and the MCP server. Silent replacement would make authorization, audit logging, and debugging unreliable.

### Custom registration example

```ts
import { DevToolRegistry, type DevTool, type ToolInput, type ToolResult } from "@kilnai/core";

const echoTool: DevTool = {
  name: "echo_json",
  description: "Echo structured JSON input back to the caller.",
  inputSchema: {
    type: "object",
    properties: {
      payload: { type: "object" },
    },
    required: ["payload"],
  },
  annotations: {
    readOnly: true,
    idempotent: true,
  },
  async execute(input: ToolInput): Promise<ToolResult> {
    return {
      output: JSON.stringify(input.input.payload, null, 2),
      isError: false,
      metadata: { tool: "echo_json" },
    };
  },
};

const registry = new DevToolRegistry();
registry.register(echoTool);
```

---

## DevToolExecutionBridge

`DevToolExecutionBridge` is the execution layer between the registry and the caller. It is used directly by the orchestrator and by the MCP server.

### Request shape

```ts
export interface DevToolExecutionRequest {
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly sandbox?: unknown;
  readonly retry?: RetryConfig;
}
```

### What it does

- resolves the primary tool from the registry
- validates fallback registration before execution begins
- authorizes the tool before execution
- delegates retry and timeout handling to `executeWithRetry()`
- re-validates tool registration for each attempt
- guarantees that the returned value conforms to `ToolResult`

### Authorization flow

`authorizeRequest()` exposes the decision without executing the tool. `execute()` performs the same check again before each run:

1. lookup tool
2. classify annotations through `ToolAuthorizer`
3. allow immediately, require approval, or deny
4. if approved, execute with retry/fallback

Error codes:

- `TOOL_AUTHORIZATION_DENIED`: execution is blocked
- `TOOL_APPROVAL_REQUIRED`: approval is required before execution
- `INTERNAL_ERROR`: missing primary tool, missing fallback tool, or invalid result shape

### Retry and fallback

Retries and fallback are not duplicated across tools. The bridge supplies a single executor closure to `executeWithRetry()`, which then applies:

- bounded timeout
- retry attempts
- error classification
- optional fallback tool invocation

### Event emission

The bridge itself focuses on execution. `Orchestrator.executeDevTool()` wraps it and emits:

- `tool_called`
- `tool_authorized`
- `tool_result`

Those events include authorization level, annotations, duration, success, and a result summary. The design keeps the bridge reusable while preserving observability at the orchestration boundary.

---

## DevToolsMcpServer

`DevToolsMcpServer` exposes the registered developer tools as MCP tools.

### Why it exists

Kiln's developer tools are useful beyond Kiln's own orchestrator. By
projecting the canonical registry through MCP, external agents can consume the
same tool implementations over stdio.

### How it works

- `listTools()` maps canonical developer tool definitions into MCP tool descriptors
- `callTool()` delegates to `DevToolExecutionBridge`
- successful calls return JSON-formatted text content
- failed calls return `isError: true`

The server lazily loads `@modelcontextprotocol/sdk`, caches the resolved modules on the instance, and clears the in-flight promise if initialization fails so a later retry can succeed.

### CLI entrypoint

`packages/cli/src/commands/tools.ts` wires the stdio transport:

```bash
kiln tools --mcp
```

That command:

1. builds the canonical default builtin tool surface from `@kilnai/core`
2. creates `DevToolExecutionBridge`
3. projects the same tool definitions used by runtime-attached sessions
4. starts `DevToolsMcpServer` on stdio

This is the consumption path for external MCP-compatible agents.

---

## Permission enforcement

Permission enforcement for native developer tools has two layers.

### Core execution layer

Inside `@kilnai/core`, the immediate gate is annotation-based:

- `read`, `grep`, and `glob` are `readOnly`
- `bash` and `write` are destructive
- `edit` and `git` are non-read-only but not marked destructive in the schema

`AnnotationAuthorizer` turns those annotations into execution levels before the bridge runs the tool.

### Wrapper policy layer

At the CLI wrapper layer, `KilnPermissionPolicy` controls what the backend is allowed to attempt:

- harness backends receive native permission translations where supported
- unsupported granular rules are rendered as constraint instructions
- direct API backends use `translatePermissionForProvider()` and inject constraints into the provider system prompt

That means the wrapper can restrict which tool calls a backend should make, while the core runtime still performs final authorization on the concrete developer tool that is about to execute.

For direct API backends, this is advisory rather than native sandbox enforcement. The provider sees policy constraints in the system prompt; the runtime still owns actual tool execution.

OAuth and direct API backends now use the same runtime-owned execution path
when their provider execution profile advertises tool support. The model emits
tool intent through the provider-native tool-calling protocol, and Kiln executes
the concrete developer tools locally through its own orchestrator, approval,
telemetry, and file-change pipeline.

---

## Per-tenant tool configuration

Tenants can further scope runtime tool behavior with:

- tool allowlists
- per-tool rate limits
- max iterations per session
- tenant-specific webhook and integration tool registration

These controls are passed into the orchestrator as per-call tool context instead of mutating global state. That keeps one orchestrator instance safe for multi-tenant use.

---

## Tool events

Tool execution emits two families of events.

### Internal EventBus events

| Event | Key fields |
|-------|------------|
| `tool_called` | `toolName`, `toolInput`, `annotations`, `authorizationLevel`, `taskId` |
| `tool_authorized` | `toolName`, `level`, `allowed`, `reason` |
| `tool_result` | `toolName`, `durationMs`, `success`, `isError`, `retryAttempt`, `resultSummary` |

### Conversation events

Gateway-side runtime sessions also emit `TOOL_EXECUTED` for downstream product integrations.

---

## Result sanitization

Tool results can flow through the safety pipeline before they are reinjected into the model context. Kiln uses the same sanitization principles across tool categories:

- PII detection and redaction
- content classification
- indirect prompt-injection scanning on returned content

The pipeline is intentionally fail-open so a safety-service outage does not freeze tool execution.

---

## Tool selection and scaling

When a session has many tools, Kiln can reduce the prompt footprint by ranking relevant tools before each round. Tool descriptions and annotations still remain the source of truth; ToolRAG only narrows the candidate set.

For large installations, that matters because developer tools, webhook tools, integration tools, and MCP tools all compete for context budget.

---

## Related

- [CLI Wrapper](cli-wrapper.md)
- [Gateway YAML Reference](../configuration/gateway-yaml.md)
- [Skills](skills.md)
- [Observability](observability.md)
