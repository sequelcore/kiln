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

Planned resource templates:

```text
kiln://workspace/tree{?path,depth,includeFiles}
kiln://workspace/file/{path}
kiln://workspace/preview/{path}{?offset,limit}
```

Requirements:

- reuse sandbox path validation from file tools
- normalize paths to forward-slash workspace-relative identifiers
- reject traversal outside the workspace root
- text resources return `text`; binary resources return metadata-only until
  explicit blob policy is added
- cap bytes, line count, directory entries, and traversal depth
- preserve deterministic ordering with directories before files
- include resource metadata for size, modified time, MIME type, truncation, and
  path provenance
- expose resources through MCP only after the workspace root is known and
  policy allows reads

Out of scope:

- writing files
- editing files
- deleting files
- executing file-associated commands

## Slice 21: Artifact Namespace Registry

Goal: define a core artifact resource namespace for generated context packets,
test results, monitor snapshots, plans, summaries, and other session artifacts
that should be read by URI instead of replayed as tool text.

Planned resource templates:

```text
kiln://artifacts/{namespace}
kiln://artifacts/{namespace}/{id}
kiln://artifacts/{namespace}/{id}/content
```

Requirements:

- introduce a core `ArtifactResourceStore` boundary
- support memory-backed session artifacts first
- define artifact metadata: id, namespace, title, MIME type, createdAt,
  updatedAt, producer, size, sequence, and retention policy
- support JSON, text, and blob resource contents
- make artifact retention explicit so large tool outputs do not become hidden
  unbounded memory
- keep producer provenance for tool-generated artifacts
- project artifact resources through MCP without letting consumers mutate the
  store directly

Candidate namespaces:

- `context-packets`
- `tool-results`
- `monitor-output`
- `test-results`
- `plans`
- `summaries`

## Slice 22: Resource Subscriptions And Update Notifications

Goal: add MCP-compliant subscription ownership and update notifications for
resources that change during a session.

Planned contract:

```ts
subscribeResource({ uri })
unsubscribeResource({ uri })
notifyResourceUpdated(uri)
notifyResourceListChanged()
```

Requirements:

- track subscriptions per MCP connection/session
- support `resources/subscribe` and `resources/unsubscribe`
- send `notifications/resources/updated` only for subscribed resources
- send `notifications/resources/list_changed` when listable resources change
- clean up subscriptions on connection close/session teardown
- debounce rapid updates from monitors and artifact writers
- define notification ordering relative to task, monitor, and artifact
  sequence numbers
- test subscription isolation across two simulated MCP clients

Design boundary:

- notifications tell clients to re-read; they do not push hidden resource
  payloads into context automatically.

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

Start with Slice 19. Pagination and stable cursors are the smallest safe
extension of the current `ToolResourceRegistry`, and they prevent workspace and
artifact namespaces from creating unbounded MCP list responses.
