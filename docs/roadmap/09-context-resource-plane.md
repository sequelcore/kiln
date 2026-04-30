# Context Resource Plane Roadmap

## Purpose

This roadmap owns the follow-up program after
`08-shared-tooling-intelligence.md` closed the first MCP resource registry on
2026-04-29.

The previous program made resources available as read-only snapshots for:

- `kiln://tools/catalog`
- `kiln://session/tasks`
- `kiln://session/monitors`

This program turns that foundation into a deeper context resource plane:

- paginated resource and template listing
- workspace-file resource templates
- artifact namespaces
- resource subscriptions and update notifications
- resource links from high-volume tools
- consumer projection for CLI, GUI, TUI, SDK, and MCP clients

Use this file with:

- `docs/architecture/tool-execution.md`
- `docs/architecture/context-governance.md`
- `docs/guides/tool-use.md`
- `docs/roadmap/08-shared-tooling-intelligence.md`
- `docs/research/12-agent-tooling-next-surface.md`

## Research Basis

Primary MCP sources reviewed on 2026-04-29:

- MCP draft schema reference:
  `https://modelcontextprotocol.io/specification/draft/schema`
- MCP 2025-06-18 schema reference:
  `https://modelcontextprotocol.io/specification/2025-06-18/schema`
- TypeScript SDK client documentation:
  `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md`
- Local SDK protocol types under
  `packages/core/node_modules/@modelcontextprotocol/sdk/dist/`

Findings:

- MCP separates tools from resources. Resources are read-only context that
  clients can list and read; tools remain the action surface.
- `resources/list` and `resources/templates/list` are paginated through
  cursor-based request params and `nextCursor` results.
- `resources/read` returns `contents` as text or blob resource contents.
- `resources/subscribe` and `resources/unsubscribe` allow clients to subscribe
  to resource updates.
- `notifications/resources/list_changed` may be sent when the available
  resource list changes.
- `notifications/resources/updated` is scoped to resources a client subscribed
  to, and tells the client to re-read the resource.
- TypeScript SDK clients expose `listResources`, `readResource`,
  `listResourceTemplates`, `subscribeResource`, and `unsubscribeResource`.

Design consequence:

- Kiln should keep the resource plane read-only and core-owned.
- Mutation, process control, approvals, credential handoffs, and writes must
  remain tools routed through the canonical execution bridge.
- Resource URIs are context addresses. They are not authority grants.

## Non-Negotiables

- No GUI/TUI-private resource registry.
- No resource read that mutates filesystem, task state, monitor lifecycle,
  provider state, credentials, or approvals.
- No copied MCP resource schemas outside the core resource registry and MCP
  projection.
- No workspace resource read outside sandbox/path validation.
- No unbounded file, artifact, monitor, or directory resource payload.
- No notification API without subscription ownership and teardown semantics.
- No resource URI that leaks absolute local paths when a stable Kiln URI can
  represent the same context.
- No slice marked complete without docs, focused tests, typecheck, full tests,
  and build unless the slice is documentation-only.

## Slice 19: Resource Pagination And Stable Cursors

Goal: make the core `ToolResourceRegistry` and MCP server support cursor-based
pagination for resources and resource templates before adding large workspace
and artifact namespaces.

Status: implemented on 2026-04-29.

Implemented contract:

```ts
ToolResourceRegistry.listPage({ cursor?: string, limit?: number })
ToolResourceRegistry.listTemplatePage({ cursor?: string, limit?: number })
DevToolsMcpServer.listResources({ cursor?: string })
DevToolsMcpServer.listResourceTemplates({ cursor?: string })
```

Implemented requirements:

- add a core pagination model for resource descriptors and templates
- use opaque cursors, not numeric offsets exposed as public contract; cursors
  carry kind and fingerprint validation so stale namespace cursors fail closed
- keep default page sizes bounded and deterministic
- include `nextCursor` only when another page exists
- preserve current no-arg listing behavior for in-process callers
- project `cursor` handling through MCP `resources/list` and
  `resources/templates/list`
- test invalid, stale, and out-of-range cursor handling

Verification:

- `bun run --cwd packages/core test tests/tools/domain/tool-resource-registry.test.ts tests/tools/mcp/dev-tools-server.test.ts`

Why first:

- workspace files, artifacts, and generated summaries can be large
- every later namespace depends on predictable bounded list behavior

## Slice 20: Workspace File Resource Templates

Goal: expose workspace files and bounded directory snapshots as read-only
resources, using core path validation and the existing file/tool safety
helpers.

Status: implemented on 2026-04-29.

Implemented resource templates:

```text
kiln://workspace/tree{?path,depth,includeFiles}
kiln://workspace/file/{path}
kiln://workspace/preview/{path}{?offset,limit}
```

Implemented requirements:

- add a core `WorkspaceResourceProvider` behind the shared
  `ToolResourceProvider` registry boundary
- reuse core path validation by accepting an optional `PathValidator` and always
  enforcing a workspace-root subpath guard
- normalize paths to forward-slash workspace-relative identifiers
- reject traversal outside the workspace root
- text resources return `text`; binary resources return metadata-only until
  explicit blob policy is added
- cap bytes, line count, directory entries, and traversal depth
- preserve deterministic ordering with directories before files
- include resource metadata for size, modified time, MIME type, truncation, and
  path provenance
- expose resources through MCP only after the workspace root is known and
  policy allows reads; `kiln tools --mcp`, GUI, and TUI startup pass the same
  configured core builtin surface options

Out of scope:

- writing files
- editing files
- deleting files
- executing file-associated commands

Verification:

- `bun run --cwd packages/core test tests/tools/domain/tool-resource-registry.test.ts tests/tools/mcp/dev-tools-server.test.ts tests/tools/infrastructure/read-many-tool.test.ts`
- `bun run --cwd packages/cli test tests/config/web-tools-config.test.ts tests/commands/tools-web-config.test.ts`
- `bun run typecheck`

## Slice 21: Artifact Namespace Registry

Goal: define a core artifact resource namespace for generated context packets,
test results, monitor snapshots, plans, summaries, and other session artifacts
that should be read by URI instead of replayed as tool text.

Status: implemented on 2026-04-29.

Implemented resource templates:

```text
kiln://artifacts/{namespace}
kiln://artifacts/{namespace}/{id}
kiln://artifacts/{namespace}/{id}/content
```

Implemented requirements:

- introduce a core `ArtifactResourceStore` boundary with
  `MemoryArtifactResourceStore`
- support memory-backed session artifacts first through explicit session
  retention policy
- define artifact metadata: id, namespace, title, MIME type, createdAt,
  updatedAt, producer, size, sequence, and retention policy
- support JSON, text, and blob resource contents
- make artifact retention explicit so large tool outputs do not become hidden
  unbounded memory
- keep producer provenance for tool-generated artifacts
- project artifact resources through MCP without letting consumers mutate the
  store directly
- bound artifact content bytes and retained artifacts per namespace

Candidate namespaces:

- `context-packets`
- `tool-results`
- `monitor-output`
- `test-results`
- `plans`
- `summaries`

Verification:

- `bun run --cwd packages/core test tests/tools/domain/artifact-resource-store.test.ts tests/tools/domain/tool-resource-registry.test.ts tests/tools/mcp/dev-tools-server.test.ts`
- `bun run typecheck`

## Slice 22: Resource Subscriptions And Update Notifications

Goal: add MCP-compliant subscription ownership and update notifications for
resources that change during a session.

Status: implemented on 2026-04-29.

Implemented contract:

```ts
ToolResourceNotificationHub.subscribeResource({ sessionId, uri, sendNotification })
ToolResourceNotificationHub.unsubscribeResource({ sessionId, uri })
ToolResourceNotificationHub.notifyResourceUpdated(uri)
ToolResourceNotificationHub.notifyResourceListChanged()
```

Implemented requirements:

- added a core-owned `ToolResourceNotificationHub` with session registration,
  per-session resource subscriptions, debounce, unsubscribe, and teardown
  semantics
- projected `resources/subscribe` and `resources/unsubscribe` through the MCP
  server when a resource notification hub is configured
- advertised MCP resource capabilities as `{ subscribe: true, listChanged:
  true }` from the shared server projection
- sent `notifications/resources/updated` only to sessions subscribed to the
  exact resource URI or an ancestor URI
- sent `notifications/resources/list_changed` to active sessions when listable
  resource namespaces change
- wired task updates, monitor lifecycle/output updates, and artifact writes to
  notify after state mutation
- debounced rapid monitor and artifact updates without changing the underlying
  task, monitor, or artifact sequence numbers
- cleaned up sessions owned by a `DevToolsMcpServer` instance on close
- tested subscription isolation across two simulated MCP sessions

Design boundary:

- notifications tell clients to re-read; they do not push hidden resource
  payloads into context automatically.

Verification:

- `bun run --cwd packages/core test tests/tools/domain/tool-resource-notifications.test.ts tests/tools/mcp/dev-tools-server.test.ts`
- `bun run typecheck`

## Slice 23: Resource Links From High-Volume Tools

Goal: let high-volume tools return durable resource links when output is large,
repeatedly polled, or better consumed as an artifact.

Status: implemented on 2026-04-29.

Candidate tools:

- `read_many`
- `tree`
- `monitor_read`
- `monitor_list`
- `web_fetch`
- `web_search`
- `code_intelligence`
- future test/build tools

Implemented requirements:

- extend `ToolResult.metadata` with optional resource link evidence
- write large eligible tool outputs to `ArtifactResourceStore`
- keep compact `ToolResult.output` for existing consumers
- return MCP-compatible `resource_link` content and metadata
- preserve truncation evidence in the original metadata when a linked artifact is available
- never store sensitive submitted operator values; `operator_elicit` is not an eligible linked tool
- use explicit session retention for generated `tool-results` artifacts
- make the default builtin tool surface own a session artifact store so CLI, GUI,
  TUI, SDK, and MCP consumers inherit one resource-link behavior through the
  canonical execution bridge

Implemented metadata shape:

```ts
resourceLinks?: readonly {
  uri: string
  title?: string
  mimeType?: string
  size?: number
  relation: "full_output" | "snapshot" | "events" | "source" | "summary"
}[]
```

Implemented behavior:

- `ArtifactToolResourceLinker` is injected into `DevToolExecutionBridge`.
- Eligible successful tool results are linked when the output is at least 8 KiB
  or the result metadata reports `truncated: true`.
- Linked outputs are stored as `text/plain` artifacts in the `tool-results`
  namespace.
- MCP call results include a `resource_link` content item alongside the
  existing JSON text envelope and `structuredContent`.
- Existing `ToolResult.output` remains unchanged, so older consumers still see
  the same compact text.

Verification:

- `bun run --cwd packages/core test tests/tools/default-tool-surface.test.ts tests/tools/mcp/dev-tools-server.test.ts tests/tools/domain/tool-resource-registry.test.ts`
- `bun run --cwd packages/core typecheck`

## Slice 24: Consumer Projection And Resource UX

Goal: make CLI, GUI, TUI, SDK, and MCP consumers use the same resource
projection without building private browse/read protocols.

Status: implemented on 2026-04-29.

Implemented requirements:

- CLI can list/read resources for debugging and scripts
- SDK exports resource registry and resource read contracts
- GUI/TUI/runtime consumers can use the attached runtime surface's shared
  resource list/read projection instead of private browse protocols
- MCP remains the external host contract
- direct-provider runtime can surface resource links in tool results without
  injecting large payloads into every turn
- consumers display resource title, URI, MIME type, size, and truncation state
  consistently
- no consumer stores private copies of resource data unless explicitly cached
  with invalidation semantics

Implemented contract:

```ts
projectToolResourceDescriptor(resource)
projectToolResourceLink(link, truncated?)
projectToolResultResourceLinks(result)

AttachedRuntimeBuiltinToolSurface.listResources()
AttachedRuntimeBuiltinToolSurface.listResourceTemplates()
AttachedRuntimeBuiltinToolSurface.readResource(uri)

kiln tools --resources
kiln tools --resource <uri>
```

Design notes:

- CLI resource commands use the same `createDefaultBuiltinToolSurface()` as
  MCP mode, including workspace, artifact, web, and notification wiring.
- Direct-provider runtime tool execution compacts linked high-volume output to
  resource pointers while preserving `metadata.resourceLinks` and
  `resource_link` content.
- Runtime resource listing is live, not a copied snapshot, so artifact
  namespaces appear after tool execution writes linked artifacts.
- SDK exports the resource read/list/display contracts from `@kilnai/core` for
  consumer code.

Verification:

- `bun run --cwd packages/core test tests/tools/domain/tool-resource-display.test.ts`
- `bun run --cwd packages/cli test tests/tools-command.test.ts`
- `bun run --cwd packages/runtime test tests/gateway/attached-runtime-tool-surface.test.ts`
- `bun run --cwd packages/sdk test tests/resource-exports.test.ts`

## Slice 25: Resource Evaluation Harness

Goal: prove resource discovery and reading help agents solve realistic coding
tasks without increasing tool confusion or context bloat.

Requirements:

- create read-only evaluation questions that require resource discovery,
  template resolution, and resource reads
- include workspace-file, artifact, task-state, monitor, and catalog cases
- verify answers by deterministic expected output
- measure resource call counts and payload size versus equivalent tool-only
  workflows
- include failure cases for missing resources, denied paths, stale cursors, and
  unsubscribed updates

## Execution Rules

- Start each implementation slice with focused failing tests.
- Implement core resource contracts before MCP, runtime, CLI, GUI, TUI, or SDK
  projection.
- Keep tools as the only mutation/action surface.
- Project every resource capability through MCP when it is externally
  meaningful.
- Update `docs/guides/tool-use.md` and `docs/architecture/tool-execution.md`
  when resource contracts change.
- Run `bun run typecheck`, `bun run test`, and `bun run build` before marking
  implementation slices complete.

## Current Priority

Continue with Slice 25. Consumer projection is closed; the next work is a
read-only evaluation harness that proves resources reduce context bloat without
increasing tool confusion.
