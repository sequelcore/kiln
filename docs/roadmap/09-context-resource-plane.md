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

Candidate tools:

- `read_many`
- `tree`
- `monitor_read`
- `monitor_list`
- `web_fetch`
- `web_search`
- `code_intelligence`
- future test/build tools

Requirements:

- extend `ToolResult.metadata` with optional resource link evidence
- write large structured outputs to `ArtifactResourceStore`
- keep compact `ToolResult.output` for existing consumers
- return resource links in structured output and metadata
- preserve truncation evidence even when a full artifact is available
- never store sensitive submitted operator values
- add retention and cleanup controls for generated artifacts

Planned metadata shape:

```ts
resourceLinks?: readonly {
  uri: string
  title?: string
  mimeType?: string
  size?: number
  relation: "full_output" | "snapshot" | "events" | "source" | "summary"
}[]
```

## Slice 24: Consumer Projection And Resource UX

Goal: make CLI, GUI, TUI, SDK, and MCP consumers use the same resource
projection without building private browse/read protocols.

Requirements:

- CLI can list/read resources for debugging and scripts
- SDK exports resource registry and resource read contracts
- GUI/TUI use resource descriptors for context browsing where appropriate
- MCP remains the external host contract
- direct-provider runtime can surface resource links in tool results without
  injecting large payloads into every turn
- consumers display resource title, URI, MIME type, size, and truncation state
  consistently
- no consumer stores private copies of resource data unless explicitly cached
  with invalidation semantics

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

Continue with Slice 23. Resource links from high-volume tools are now the next
resource-plane expansion because pagination, workspace resources, artifact
namespaces, and update notifications are closed.
