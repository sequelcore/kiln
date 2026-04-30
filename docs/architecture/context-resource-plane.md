# Context Resource Plane

## Status

This is the canonical architecture record for Kiln's resource plane as of
2026-04-30.

Pagination, workspace resources, artifact namespaces, resource notifications,
high-volume resource links, consumer projection, and model-callable resource
read tools are now stable architecture.

## Purpose

The context resource plane gives agents and clients stable read-only addresses
for context that should not be replayed as large tool text.

Resources are for context. Tools are for action.

The plane supports:

- paginated resource and template listing
- workspace-file resource templates
- session artifact namespaces
- resource subscriptions and invalidation notifications
- resource links from high-volume tool outputs
- shared projection across CLI, GUI, TUI, SDK, runtime, and MCP
- model-callable resource discovery and read tools

## MCP Basis

The design follows MCP resource semantics reviewed on 2026-04-29:

- resources are read-only context
- `resources/list` and `resources/templates/list` are cursor-paginated
- `resources/read` returns text or blob contents
- `resources/subscribe` and `resources/unsubscribe` own client subscriptions
- `notifications/resources/list_changed` invalidates list caches
- `notifications/resources/updated` tells subscribed clients to re-read a URI

Kiln keeps MCP as the external protocol projection. Internally, all consumers
attach to the same `ToolResourceRegistry` and related core resource services.

## Scope Model

Resource definitions are global contracts, but resource instances are scoped by
their backing state:

- Workspace resources are workspace-scoped and use the configured workspace
  root plus path validation.
- Session resources such as tasks, monitors, artifacts, notifications, and
  high-volume tool links are session-scoped.
- Tool catalog resources are produced from the active builtin surface for the
  current session configuration.

This means knowledge and artifacts created in one workspace or session do not
become global hidden memory for another project. Multi-project GUI usage shares
the same core contracts, not the same per-session state.

## Non-Negotiables

- No GUI/TUI-private resource registry.
- No resource read that mutates filesystem, task state, monitors, providers,
  credentials, approvals, or process lifecycle.
- No copied MCP resource schemas outside the core registry and MCP projection.
- No workspace resource read outside sandbox and path validation.
- No unbounded file, artifact, monitor, or directory payload.
- No notification API without subscription ownership and teardown.
- No `kiln://` URI that grants authority by itself.
- No absolute local path leak when a stable Kiln URI can represent the same
  context.

## Registry And Pagination

`ToolResourceRegistry` owns resource descriptors, templates, providers, reads,
and paginated listing.

Stable listing APIs:

```ts
ToolResourceRegistry.listPage({ cursor?: string, limit?: number })
ToolResourceRegistry.listTemplatePage({ cursor?: string, limit?: number })
```

Cursors are opaque public contract. They carry kind and fingerprint validation
so invalid, stale, and out-of-range cursors fail closed. No-arg listing remains
available for in-process callers that need the full bounded current set.

MCP projects the same contract through `resources/list` and
`resources/templates/list`.

## Workspace Resources

`WorkspaceResourceProvider` exposes read-only workspace context through stable
templates:

```text
kiln://workspace/tree{?path,depth,includeFiles}
kiln://workspace/file/{path}
kiln://workspace/preview/{path}{?offset,limit}
```

Workspace paths are workspace-relative, normalized to forward slashes, and
validated against the configured root. Traversal outside the workspace is
rejected. Tree and preview reads are bounded by depth, entry count, line count,
and byte count.

Text resources return text content with metadata. Binary files return
metadata-only content until an explicit blob policy is added.

## Memory Lattice Resources

Memory Lattice exposes governed memory graph data through the same resource
plane. The resource provider is owned by the core memory bounded context and
adapts bounded graph projections into read-only `kiln://memory/...` resources.

Stable memory templates:

```text
kiln://memory/graph{?scope,layer,query,depth,limit}
kiln://memory/nodes/{id}
kiln://memory/nodes/{id}/neighbors{?depth,limit}
kiln://memory/nodes/{id}/provenance
kiln://memory/relations/{id}
kiln://memory/admissions{?sessionId,recordId}
```

Memory resource reads must be:

- read-only
- scope-validated
- bounded by node count, depth, byte size, and query limits
- deterministic for the same backing state and options
- backed by the core memory graph projector, not GUI/TUI-local state

These resources are the shared contract for CLI, GUI, TUI, SDK, runtime, and
MCP consumers. GUI gateway endpoints may adapt these resources for operator UI
ergonomics, but they must not bypass the core provider or read memory storage
directly.

## Artifact Resources

`ArtifactResourceStore` owns generated context artifacts. The first
implementation is `MemoryArtifactResourceStore`, which is session-local and
retention-bounded.

Stable artifact templates:

```text
kiln://artifacts/{namespace}
kiln://artifacts/{namespace}/{id}
kiln://artifacts/{namespace}/{id}/content
```

Artifact metadata includes id, namespace, title, MIME type, created time,
updated time, producer, size, sequence, and retention policy.

Current namespaces include generated tool results and can support monitor
output, test results, plans, summaries, and other session artifacts without
changing the consumer contract.

## Notifications

`ToolResourceNotificationHub` owns subscription state:

```ts
subscribeResource({ sessionId, uri, sendNotification })
unsubscribeResource({ sessionId, uri })
notifyResourceUpdated(uri)
notifyResourceListChanged()
```

Notifications are invalidation hints only. They do not push hidden payloads
into model context. Subscribed clients must re-read the URI through the registry
or MCP.

Task updates, monitor lifecycle/output changes, and artifact writes notify
after mutation. Resource reads remain the ordering source of truth through task,
monitor, and artifact sequence numbers.

## Resource Links

High-volume tools can return compact visible output plus durable resource links
when output is large, truncated, repeatedly polled, or better consumed as an
artifact.

Stable metadata shape:

```ts
resourceLinks?: readonly {
  uri: string
  title?: string
  mimeType?: string
  size?: number
  relation: "full_output" | "snapshot" | "events" | "source" | "summary"
}[]
```

`ArtifactToolResourceLinker` writes eligible outputs to the session artifact
store and appends resource-link evidence. MCP projects compatible
`resource_link` content items alongside the existing text and structured
content.

Tools may provide an internal `resourcePayload` for the artifact store. The
linker stores that richer payload, strips it from the returned `ToolResult`,
and leaves `ToolResult.output` compact. `read_many` uses this path so summary
mode can display a compact result while linked artifacts contain the raw bounded
file packet.

Sensitive operator values are never eligible for linked artifacts.

## Model-Callable Resource Tools

The resource plane is exposed to executable model sessions through canonical
read-only builtin tools:

```ts
resource_list({ cursor?, limit? })
resource_template_list({ cursor?, limit? })
resource_read({ uri })
```

These tools are adapters over `ToolResourceRegistry`. They are not GUI, TUI, or
CLI helper APIs. They remain available in deferred tool projection so models
can follow `kiln://artifacts/...` links without needing raw tool-result JSON in
assistant prose.

## Consumer Projection

Consumers must use the shared projection:

- `kiln tools --resources`
- `kiln tools --resource <uri>`
- `AttachedRuntimeBuiltinToolSurface.listResources()`
- `AttachedRuntimeBuiltinToolSurface.listResourceTemplates()`
- `AttachedRuntimeBuiltinToolSurface.readResource(uri)`
- MCP `resources/*`
- SDK exports from `@kilnai/core`

Direct-provider runtime compacts linked high-volume output to resource pointers
while preserving `metadata.resourceLinks` and MCP-compatible resource-link
content. GUI and TUI surfaces render those links; they do not keep private
copies unless an explicit cache has invalidation semantics.

## Session Lifetime

GUI, TUI, and direct-provider sessions reuse one session-scoped builtin
tool-state bundle across recreated surfaces. That bundle owns the artifact
store, notification hub, monitor registry, and task-state store.

Resource links emitted in one turn must remain readable by `resource_read` in
later turns for the same session. They are not global cross-workspace memory and
they are not guaranteed after the owning session state is discarded.

## Evaluation

Resource behavior is validated by focused unit and integration tests plus live
GUI checks. The resource evaluation harness remains future product work, but it
is no longer tracked as an active numbered roadmap because the underlying
resource-plane architecture is complete and canonical here.
