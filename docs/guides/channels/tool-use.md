# Tool Use Operations

Use this guide for tool configuration, execution flow, and runtime behavior. For
the architectural role of tool execution, start with:

- [Tool Execution](../../architecture/tooling/tool-execution.md)
- [Safety](../../architecture/safety/safety.md)

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
    effectEnvelope:
      operation: observe
      boundaries: [external-system]
      reversibility: reversible
      dataEgress: metadata
      identityUse: authenticated
      consequences: []
      idempotency: idempotent

  - name: process_refund
    description: Process a customer refund
    tags: [billing]
    effectEnvelope:
      operation: mutate
      boundaries: [external-system]
      reversibility: compensatable
      dataEgress: sensitive-data
      identityUse: authenticated
      consequences: [financial, external-state]
      idempotency: non-idempotent
```

### Capability effect envelopes

| Field | Type | Effect |
|-----------|------|--------|
| `operation` | enum | Observe or mutate. |
| `boundaries` | enum array | Process, workspace, machine, network, or external system. |
| `reversibility` | enum | Reversible, compensatable, irreversible, or unknown. |
| `dataEgress` | enum | None, metadata, project data, sensitive data, or unknown. |
| `identityUse` | enum | None, authenticated, privileged, or unknown. |
| `consequences` | enum array | Local state, external state, financial, legal, security, or unknown. |
| `idempotency` | enum | Idempotent, conditionally idempotent, non-idempotent, or unknown. |
| `cacheTtl` | number | Enables tool-result caching for the declared TTL. |
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

Native and app-defined tools rely on canonical action-effect authorization.
Trusted tool definitions declare immutable maximum effect envelopes, and the
execution boundary resolves the concrete invocation effect from validated input
before deriving authority.

| Level | Resolved effect shape | Result |
|-------|------------------|--------|
| `1` | read-only observation, or reversible idempotent local mutation | auto-execute |
| `2` | compensatable mutation or observation with external access | audited execution |
| `3` | unknown tool when approval is required | approval required |
| `4` | irreversible, privileged, malformed, or sensitive/external effect | approval required or denied |

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

## Governed Work Tools

Governed execution uses explicit goal and work-item contracts:

- `work_item.update` creates or updates bounded work items with workflow
  profile, evidence, gates, route hints, and pause requirements. Its manual
  tool contract requires a stable caller-owned `id`; choose it before the first
  call and reuse it for classification provenance, execution, evidence, and
  closeout. Do not send temporary identities such as `pending`.
- `goal.create` creates the canonical goal run from existing work items and
  links those work items to the goal before execution starts. Attached runtime
  surfaces bind the goal to the current session when `ownerSessionId` is omitted
  or null and record the current operator turn as its source. Callers should not
  pass placeholders such as `"current"`, a fabricated `planId`, or a fabricated
  turn id. Approved-plan goals use the plan approval/materialization flow instead
  of `goal.create`.
- `work_item.execution.start` starts the next ready work item for an existing
  goal. If the goal id is unknown, it returns a structured recoverable error
  with `suggestedNextTool: "goal.create"` instead of accepting an invented id.
  A started attempt is not closeout by itself; while the item remains
  `in_progress`, the latest governed turn is projected as failed/blocked until
  `work_item.execution.finish` records terminal evidence. `work_item.complete`
  is reserved for standalone work and rejects goal-owned items.
- `work_item.execution.finish` closes the attempt and fails closed when
  work-item evidence, verification gates, or residual-risk closeout is missing.
  For managed execution, the verified child handoff is bound by
  `work_item.execution.start`; never send or reconstruct a
  `managedInvocationResultHandoff` at finish.
  If only goal-level evidence remains, it returns the successful
  `work_completed_goal_closeout_pending` transition and directs the caller to
  `goal.evidence.record`; it does not mark the completed attempt as failed.
  Finishing the last work item does not implicitly complete its goal.
- `goal.evidence.record` satisfies one declared goal-level evidence requirement
  with a structured summary, resource links, and contributing work-item ids.
  Work-item evidence with the same label is not a substitute.
- `goal.complete` performs the terminal goal validation after every work item
  and required goal evidence record is complete. Do not recreate a paused goal
  to bypass missing evidence; record the missing evidence and close the same
  goal id. Successful completion also makes the goal phase terminal rather than
  leaving a stale `paused:goal-closeout` phase.

Tool responses expose bounded work-item and attempt projections plus canonical
resource URIs. Read the resource when full replay detail is needed; do not ask
the model-facing tool output to repeat structured child transcripts or handoff
bodies.

Agents should not fabricate `goalRunId` values. They must call `goal.create`
after creating the relevant work items and before starting execution.
`managed_agent.invoke` validates supplied governed identifiers against the
session stores before launching a provider. The goal must be active and owned
by the current runtime session; the work item must be open and belong to that
goal; any supplied attempt must be the active attempt for the same pair. Treat
`goal_not_found`, `work_item_not_found`, and scope-mismatch results as required
governance recovery, not as provider failures.
When an operator enables **Governed task** in the GUI, the outbound frame carries
a typed required work-item count. Until exactly that many distinct work items and
their linked operator-direct goal exist in canonical tool results, the runtime
restricts the model to governance tools and rejects inspection or execution calls.
This ordering is enforced from tool metadata; it is not inferred from prompt prose.
After a scout or local read-only diagnosis, an open routed work item is still
unfinished. The next governed step is `goal.create` when no goal exists, then
`work_item.execution.start`; parent agents must not report a generic read-only
sandbox block when a write-capable managed route is already selected.
After the final work-item attempt finishes, the next governed steps are
`goal.evidence.record` for each outstanding declared requirement and then
`goal.complete`.
When `work_item.execution.start` returns or auto-starts a managed invocation,
keep the selected route identity intact. Do not recover by switching from the
work item's route to an unrelated read-only route unless an explicit fallback
policy selects that route and records the reason. Route-owned requests may omit
`providerRoute.providerId`; attached runtime surfaces hydrate provider/model
from the configured `routeId`.
For UI work, visual-reference research is an explicit exception to the write
route: it must run through a read-only route with web/browser capability. Put
that route in `phaseRoutes.visual-reference-research` on the work item, or pass
`managedResearchRouteId` when starting that phase. After `work_item.update`
records the phase evidence, later implementation phases return to the work
item's write route. `work_item.update` rejects an approved-write UI work item
that still expects `visual-reference-research` and does not declare
`phaseRoutes.visual-reference-research`; do not create the work item with an
empty `phaseRoutes` object. If `work_item.update` returns
`visual_reference_phase_route_required`, retry `work_item.update` as an actual
tool call with the returned `retryInputPatch` shape and the configured read-only
route id. Do not paste the JSON recovery payload as assistant text; prose does
not materialize governed state.
For broad delegated work, treat the generated `executionPhase` as the active
contract. If `executionPhase.completionTool` is `work_item.update`, the managed
child is producing intermediate evidence only; record that phase's
`expectedEvidence` on the same pending item and call
`work_item.execution.start` again for the next phase. Do not call
`work_item.execution.finish` until the generated phase is final. If
`executionPhase.completionTool` is `work_item.execution.finish`,
call `work_item.execution.start` with the returned verified managed invocation
id. That transition creates and links the canonical attempt; only then finish
the attempt with the final evidence, checks, and residual risk. Never predict or
copy an attempt id into the pre-start managed invocation request.
If a managed child fails before starting an intermediate phase but the parent
collects that evidence locally, follow the runtime `recovery` object exactly:
call `work_item.update` with the supplied `workItemUpdateInputTemplate`, then
call `work_item.execution.start` again. The recovery template includes the
required summary, provided evidence, and verification gate placeholders; replace
only the placeholders with real evidence. Do not end the turn with local
research prose while the phase evidence remains unrecorded. Writing the JSON
shape in the assistant message is not recovery; only the actual tool call
changes governed state. Attached Runtime surfaces may execute the hydrated
managed invocation atomically from `work_item.execution.start`; direct callers
may execute the returned `managed_agent.invoke` request explicitly. Both paths
use the same route, authority, handoff, and invocation-id contract. Treat that
object as exact tool input. Do not add
`agentProfile` when it is absent, do not replace the route with a guessed
profile, and do not paste the request as assistant text. If the runtime attaches
`agentProfile` because exactly one configured profile owns the route, keep that
value unchanged.
If invocation fails before a work-item attempt exists, use the returned blocked
`work_item.update` template. Do not call `work_item.execution.fail`; there is no
attempt to fail at that point.
When the generated request includes `requiredToolNames`, keep them intact in
`managed_agent.invoke`. A route that cannot provide those tools is not a valid
fallback for that phase; select a capable configured route or let runtime fail
closed before the child starts. Web and browser tools also require route network
authority. Do not put network authority on approved-write routes; split
research and implementation into separate phases/routes.

UI and visual-design work has one extra pre-plan evidence gate:
`visual-reference-research`. Text search is not enough when the requested
change depends on real visual taste, hierarchy, density, or product polish.
Use running-product UI captures when they exist. If the reference repository has
no public screenshots, inspect the frontend implementation itself and record
code-backed evidence: source URLs, relevant frontend file paths,
component/layout/navigation patterns, density, typography, panels, status
areas, and reusable design principles without copying another product. A
GitHub repository page, README text, file listing, stars, forks, issues, or code
navigation screenshot does not satisfy this gate by itself.
If browser/web tools are used for this phase, call `work_item.update` with
`providedEvidence: ["visual-reference-research"]` and a passed
`verificationGateResults` frontend-reference gate before replying, submitting a plan, or
starting the next phase.

Execute-mode provider calls include shared governed closeout instructions. When
`work_governance.assess` recommends orchestration or delegation, research,
inspection, planning prose, and successful read-only scouts are intermediate
evidence only. The parent must keep using the same governed work item until it
starts execution, finishes execution, completes the item, submits a structured
terminal plan, or records a concrete pause requirement. Open work items without
terminal closeout project as failed consistently in CLI, TUI, and GUI.

Optional array fields in these contracts use omission semantics. A model or
surface may send `null` for optional arrays such as `pauseRequirements`,
`include`, or `exclude`; tools normalize those values as omitted rather than
failing schema intent after a recoverable model serialization choice.

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

Tool names follow `{provider}_{operation}`, such as `google_calendar_check_availability` or `stripe_create_payment_link`. Integration operations surface declared effect envelopes, so they participate in the same authorization and retry rules as other tools.

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
the resource has a single text payload. Non-text and multi-content reads print
the shared `OperatorResourceReadResult` shape used by operator surfaces.

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
- `memory_search`: searches governed Memory Lattice context and returns
  readable matched records plus the bounded graph evidence used to find them
- `resource_read`: reads a `kiln://...` resource URI

These tools are thin adapters over the same `ToolResourceRegistry`; they do not
own a private browse/read protocol and they do not grant mutation authority.
They stay visible in deferred tool projection alongside `tool_catalog_search`,
so a model can search memory or follow `metadata.resourceLinks` from high-volume
results without requiring a GUI, TUI, CLI, or MCP-client-only helper.
`memory_search` respects the same memory read authority as
`kiln://memory/...` resources. `resource_read` returns a
single text payload directly when possible and otherwise returns the resource
content array as JSON. For paginated reads, copy the exact opaque `nextCursor`
from the trailing `--- resource_read ---` JSON control block; do not infer a
cursor from line numbers or offsets.

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

The completed resource-plane contract is documented in
`docs/architecture/context-resource-plane.md`. Pagination, workspace-file
resources, artifact namespaces, update notifications, resource links from
high-volume tools, model-callable resource tools, and consumer projection are
implemented there.

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
  readonly effectEnvelope?: ActionEffectEnvelope;
  execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult>;
}
```

The forty-seven built-in tool names are:

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
- `web_extract`
- `browser_session_start`
- `browser_navigate`
- `browser_observe`
- `browser_click`
- `browser_type`
- `browser_keypress`
- `browser_scroll`
- `browser_session_stop`
- `computer_observe`
- `computer_click`
- `computer_type`
- `computer_keypress`
- `computer_open_application`
- `computer_focus_application`
- `computer_minimize_application`
- `computer_close_application`
- `grep`
- `glob`
- `json_query`
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
- `memory_search`
- `memory_save`
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

`TOOL_SCHEMAS` is the source of truth for names, descriptions, input schemas, and declared effect envelopes. `createDefaultBuiltinToolSurface()` turns those core definitions into registry, MCP, runtime, CLI, and capability projections.

Builtin `inputSchema` properties must carry explicit JSON Schema shape
information. Do not rely on enum-only property definitions such as
`{ enum: [...] }`; use `type: "string"` with string enums so strict
OpenAI-compatible providers can accept the same schemas projected through
direct-provider managed routes.

High-volume tools support a shared `verbosity` field:

- `raw`: preserves the compact historical `ToolResult.output`
- `structured`: returns JSON while keeping the same metadata contract
- `summary`: returns a bounded rollup for large outputs

The shared field is named `verbosity`, not `outputMode`, because `grep` already
uses `outputMode` for match shape: `content`, `files_with_matches`, or `count`.
`grep.matchMode` controls pattern semantics: `auto` treats valid patterns as
regular expressions and falls back to literal matching for invalid regex syntax,
`regex` is strict, and `literal` searches fixed strings.

### Result metadata

Builtin developer tools return one core-owned metadata contract from
`packages/core/src/tools/domain/tool-result-metadata.ts`.

Every metadata object includes:

- `toolName`: canonical builtin tool name
- `kind`: `command`, `file`, `inspection`, `media`, `web`, `interactive`,
  `search`, `structured_data`, `monitor`, `task_state`, or `elicitation`
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

Web metadata covers `web_search`, `web_fetch`, and `web_extract`. `web_search`
reports provider, neutral search intent, normalized domain filters, provider
attempts, strict domain postconditions, provider request/duration/usage
evidence, retrieval time, ranked sources and relevance scores, errors, and
requested verbosity. `web_fetch`
reports source URL, normalized final URL, content type, status, bytes read,
redirect chain, truncation, errors, and requested verbosity. `web_extract`
reports requested URLs, format, extraction provider, extracted page evidence,
bytes, truncation, errors, and requested verbosity. Web metadata is
external-source evidence, not workspace search or file-change evidence.

Interactive metadata covers `browser_*` and `computer_*`. Browser metadata can
report session id, URL, title, visible text, screenshot/artifact URI, action
coordinates or selectors, keys, scroll deltas, timeout, provider, sensitivity,
and approval hints. Computer metadata can report window title, app name,
screenshot/artifact URI, coordinates, keys, timeout, and provider. Type actions
record text length and sensitivity, never the typed text. Observation tools are
read-only orientation evidence; action tools are governed automation actions,
not file-change evidence.

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
# .kiln/kiln.yaml
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
  extractProvider:
    type: firecrawl
    apiKeyEnv: FIRECRAWL_API_KEY
```

`netPolicy` accepts `none`, `documentation`, `package-managers`, or `full`.
`allowedDomains` narrows the policy; when omitted, `documentation` and
`package-managers` use Kiln's shared default domain lists. The HTTP search
provider receives the normalized `WebSearchProviderRequest` as JSON and must
return a JSON object with a `sources` array.

The HTTP extract provider receives the normalized `WebExtractProviderRequest`
as JSON and must return a JSON object with a `pages` array. Each page must
include `url` and extracted `text`; optional fields include `normalizedUrl`,
`title`, `contentType`, `status`, `bytesRead`, and `truncated`.

First-party search provider adapters are also available:

```yaml
# .kiln/kiln.yaml
web:
  enabled: true
  netPolicy: documentation
  allowedDomains:
    - docs.example.com
  searchProvider:
    type: tavily
    apiKeyEnv: TAVILY_API_KEY
  searchFallbackProviders:
    - type: brave
      apiKeyEnv: BRAVE_API_KEY
    - type: exa
      apiKeyEnv: EXA_API_KEY
```

Supported `searchProvider.type` values are `none`, `http`, `searxng`, `brave`,
`tavily`, and `exa`. Providers that need credentials use `apiKeyEnv` so secrets
stay in the environment rather than `kiln.yaml`.

`searchFallbackProviders` uses the same provider shape in priority order. Kiln
selects only providers whose declared capabilities satisfy the neutral request
and falls through on transport failure, strict domain-contract rejection,
empty evidence, or rejected exact-date event evidence. `web_search` supports
`topic`, `quality`, `startDate`, `endDate`, `country`, `language`, and
`exactPhrases`; provider adapters translate those controls without leaking
vendor fields into model-facing contracts.

Exact-date event questions should not be expressed as publication-date
queries. Start with a general discovery query and `temporalRequirement`; do not
copy the event date into `startDate` or `endDate`, invent a domain allowlist, or
put ordinary entity names in `exactPhrases`. If the first result lacks semantic
consensus, follow the typed recovery directive: retry once with a materially
broader query while preserving operator constraints, then call `web_extract`
on the strongest candidates with the same `temporalRequirement`.

Supported `extractProvider.type` values are `none`, `http`, `tavily`, and
`firecrawl`. `tavily` uses Tavily Extract; `firecrawl` uses Firecrawl Scrape
per URL and normalizes the result into the same page shape.

Provider defaults may also live in global config:

```yaml
# ~/.kiln/config.yaml
version: "1"
web:
  searchProvider:
    type: tavily
    apiKeyEnv: TAVILY_API_KEY
  searchFallbackProviders:
    - type: brave
      apiKeyEnv: BRAVE_API_KEY
  extractProvider:
    type: firecrawl
    apiKeyEnv: FIRECRAWL_API_KEY
```

Global web config only supplies adapters, fallback order, and credential environment variable
names. It cannot enable web access or set network policy. Each project still
has to declare `web.enabled`, `web.netPolicy`, and optional `allowedDomains` in
`.kiln/kiln.yaml`; otherwise the effective tool surface remains fail-closed.

Run `kiln status` to inspect web configuration without making network calls. It
prints whether web access is enabled, the network policy, allowed domains, the
search and extract provider types, whether those providers come from global or
project config, and configuration issues such as missing network policy or
missing search provider.

`web_search.recencyDays: null` is accepted and treated as no recency filter.
`web_extract` reports provider responses with no pages as `empty_extraction`
errors, because zero extracted pages means no usable source text was captured.
PDF and scanned-document handling is a separate future path based on binary
download artifacts plus PDF text extraction or OCR.

`web_search`, `web_fetch`, and `web_extract` remain primitives. Governed
multi-source research will be implemented as a higher-level capability over
search, fetch, extraction, optional browser interaction, artifacts, citations,
and budgets; its architecture lives in
[`Controlled Web Research`](../../architecture/tooling/controlled-web-research.md).

Browser and computer use tools fail closed unless the runtime injects an
interactive-use provider. They are cross-surface developer tools: GUI shows
browser use as a dynamic workbench tab when a browser session exists, while
CLI, TUI, SDK, and MCP consumers receive the same tool contracts and
artifact/resource evidence.

Project-scoped interactive authority is configured under
`interactiveUse`:

```yaml
# .kiln/kiln.yaml
interactiveUse:
  enabled: true
  browserProvider: playwright
  browserEnvironment: isolated-headless
  allowedDomains:
    - app.example.com
  allowComputer: true
  computerProvider: windows-uia
  computerEnvironment: local-active-desktop
  allowedApplications:
    - Calculator
    - msedge
    - notepad
  applicationAliases:
    Calculator:
      - Calculadora
      - CalculatorApp
      - calc
      - ApplicationFrameHost
    msedge:
      - Edge
      - Microsoft Edge
    notepad:
      - Notepad
      - Bloc de notas
      - notas
```

`allowedDomains` scopes browser automation. `browserEnvironment:
isolated-headless` runs Playwright in the background and prevents the prompt
from opening a visible browser window. Use `isolated-headed` only when you
explicitly want a visible debugging window. `allowExternalBrowser: true` is
required before an adapter can attach to an operator-controlled browser instead
of an isolated project session.

`allowComputer: true`, `allowedApplications`, and `computerEnvironment:
local-active-desktop` scope desktop automation. `allowedApplications` should
use canonical process or launch names; `applicationAliases` maps localized,
branded, or human names to those canonical app names without adding app-specific
runtime code. Local Windows computer control uses the current interactive
desktop; it is not a hidden background desktop. Use browser automation for
background web tasks, and add a future remote/VM computer provider when full
background desktop automation is required. Run `kiln status` to inspect this
configuration without launching a browser or observing the desktop.

The same policy can be edited through `kiln config set` without hand-editing
YAML:

```bash
kiln config set interactiveUse.enabled true
kiln config set interactiveUse.browserProvider playwright
kiln config set interactiveUse.browserEnvironment isolated-headless
kiln config set interactiveUse.allowedDomains example.com,docs.example.com
kiln config set interactiveUse.allowComputer true
kiln config set interactiveUse.computerProvider windows-uia
kiln config set interactiveUse.computerEnvironment local-active-desktop
kiln config set interactiveUse.allowedApplications Calculator,msedge,notepad
kiln config set interactiveUse.applicationAliases '{"notepad":["Notepad","Bloc de notas","notas"]}'
```

The runtime Playwright provider is optional. Runtime hosts that enable
`browserProvider: playwright` must install Playwright and a Chromium browser:

```bash
bun add -d playwright
bun x playwright install chromium
```

On Windows+Bun, Kiln runs Playwright through a persistent Node sidecar because
Chromium launch can hang under Bun while the same Playwright call succeeds
under Node. Operators do not need to start that sidecar manually; `node` must be
available on PATH for the browser provider.

Screenshot observations are artifact-backed. A provider may capture an internal
data URL, but the shared tool layer writes it to
`kiln://artifacts/interactive-screenshots/.../content` when the session artifact
store is available, and transcript metadata keeps the URI instead of the base64
payload. Agents should call `browser_session_stop` when a one-off browser task
is finished; Playwright sessions also have an idle cleanup backstop if the stop
call is missed. On Windows+Bun, the Node sidecar exits once all browser
sessions are closed and restarts on demand.

GUI resolves browser screenshot artifact URIs through the runtime resource
plane for display. Browser screenshot evidence should first appear in the
transcript beside the producing tool call as a numbered capture gallery, so the
operator can inspect the visual state with the action that caused it. The
dynamic Browser tab is a focused latest-snapshot and live-stream projection,
not the only inspection path. The primary sidebar remains for stable workbench
destinations; browser sessions appear in tabs only when the agent is using one.
Call the Browser tab a snapshot monitor when it is showing artifact-backed
polling frames. Call it a frame stream when it is showing CDP screencast or a
future remote stream. Do not call either mode an embedded browser. If
`interactiveUse.browserEnvironment` is `isolated-headed`, a separate visible
Chromium window is expected; that window is governed by Kiln but it is still
outside the operator app.

The GUI can request operator takeover or release for a browser session.
Takeover is a provider-owned lock: agent browser mutations are blocked while
ownership is `operator`. During that window, GUI sends viewport-relative
pointer, wheel, text, and key intents through `browser_operator_input`; runtime
and provider code validate the active session before accepting or rejecting the
input. Release captures a fresh artifact-backed observation before agent
actions resume.

Browser evidence is durable but bounded. Persisted evidence should identify
the browser session, ownership transitions, input summaries or
acknowledgements, fresh observations, artifact links, and the active transport
such as `snapshot-polling` or `cdp-screencast`. Text input evidence records
text length rather than raw text. CLI, TUI, SDK, and replay surfaces may
degrade browser monitoring to status plus resource links.

Computer use should target explicit allowed applications instead of requiring
the operator to manually focus the right window first. Pass `application` and,
when needed, `windowTitle` to observe, click, type, open, focus, minimize, or
close a governed app. Providers validate the requested app against
`interactiveUse.allowedApplications` before changing focus or closing a window.
`computer_close_application` is graceful close behavior; force-killing a
process is intentionally outside the current tool contract.

Windows computer providers are also optional. Runtime hosts that enable
`computerProvider: windows` must install the low-level desktop automation peer:

```bash
bun add -d @nut-tree/nut-js
```

Runtime hosts that enable `computerProvider: windows-uia` must build Kiln's
Microsoft UI Automation sidecar on Windows:

```bash
packages\runtime\native\windows-uia\build.cmd
```

If the executable is stored outside the default runtime package path, set
`KILN_WINDOWS_UIA_HELPER` to the full `kiln-windows-uia.exe` path before
starting the runtime host.

Kiln still requires `allowComputer: true` before computer tools can execute.
External app automation requires at least one `allowedApplications` entry.
Returning focus to the Kiln operator window through `computer_focus_application`
is self-authority and does not require listing Kiln as an external governed
application; closing or otherwise automating Kiln still requires explicit
policy. Provider authority comes from trusted runtime observation. The model's
`application` input is not accepted as allowlist evidence.

Use `windows-uia` when the target exposes useful accessibility metadata and you
want stable semantic selectors such as `#plusButton`,
`type=button;title=OK`, or JSON `{"type":"button","title":"OK"}`. The `#...`
form maps to UIA `AutomationId`, matching the IDs shown in accessibility tree
output. Use `windows` when the task needs physical pointer or keyboard actions
by coordinates.

Live smoke prompts for `windows-uia`:

```text
Observe the current Windows desktop with accessibility details and tell me the active application, window title, and visible UI controls.
```

```text
In the active Calculator window, click the UIA target type=button;title=One.
```

```text
Open Calculator, click #num2Button, #plusButton, #num3Button, and #equalButton, observe the result, then close Calculator.
```

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
| `web_search` | Search through capability-aware provider routes | `query`, `domains`, `recencyDays`, `topic`, `quality`, `startDate`, `endDate`, `country`, `language`, `exactPhrases`, `temporalRequirement`, `maxResults`, `verbosity` | default configuration fails closed; strict domain and semantic evidence postconditions govern fallback; metadata preserves provider attempts, request telemetry, intent, ranked sources, and errors |
| `web_fetch` | Fetch and sanitize allowed HTTP(S) text content | `url`, `maxBytes`, `timeout`, `verbosity` | default configuration requires explicit network policy; output is sanitized text, JSON, or summary; metadata includes source/final URL, status, content type, bytes read, redirect chain, truncation, errors, and `verbosity` |
| `web_extract` | Extract readable text or markdown from allowed HTTP(S) URLs through the configured provider | `urls`, `format`, `maxBytes`, `timeout`, `verbosity` | default configuration requires explicit network policy and an extract provider; output is page text, JSON, or summary; metadata includes requested URLs, format, provider, page evidence, bytes read, truncation, errors, and `verbosity` |
| `browser_session_start` | Start or attach an isolated browser automation session | `sessionId`, `url`, `headless`, `timeout`, `verbosity` | default configuration fails closed; configured providers return session and observation evidence; `headless:false` is rejected unless `interactiveUse.browserEnvironment` is `isolated-headed`; metadata includes target, operation, provider, session id, timeout, and artifacts |
| `browser_navigate` | Navigate a browser session to a URL | `url`, `sessionId`, `timeout`, `verbosity` | metadata includes URL, provider, session id, timeout, and observation evidence such as final URL, title, and screenshot/artifact URI |
| `browser_observe` | Observe the current browser session state | `sessionId`, `includeScreenshot`, `verbosity` | read-only/idempotent observation evidence; metadata may include URL, title, visible text, screenshot/artifact URI, and provider |
| `browser_click` | Click in a browser session by selector or coordinates | `sessionId`, `selector`, `x`, `y`, `button`, `timeout`, `verbosity` | governed action evidence; metadata records selector/coordinates, provider, session id, timeout, and resulting observation |
| `browser_type` | Type text into the active browser target | `sessionId`, `text`, `sensitive`, `timeout`, `verbosity` | governed action evidence; metadata records text length and sensitivity without echoing text |
| `browser_keypress` | Send key presses to the browser session | `sessionId`, `keys`, `timeout`, `verbosity` | governed action evidence; metadata records key names, provider, session id, timeout, and observation |
| `browser_scroll` | Scroll a browser session | `sessionId`, `deltaX`, `deltaY`, `timeout`, `verbosity` | governed action evidence; metadata records scroll deltas, provider, session id, timeout, and observation |
| `browser_session_stop` | Stop a browser automation session | `sessionId`, `reason`, `verbosity` | governed lifecycle evidence; metadata records session id, provider, operation, and stop reason |
| `computer_observe` | Observe governed desktop state | `application`, `windowTitle`, `includeScreenshot`, `includeAccessibility`, `verbosity` | read-only/idempotent observation evidence; metadata may include app name, window title, accessibility text, screenshot/artifact URI, and provider |
| `computer_click` | Click in the governed desktop surface | `application`, `windowTitle`, `target`, `button`, `timeout`, `verbosity` | governed action evidence; metadata records selector/ref or coordinates, button, provider, timeout, and observation; `windows-uia` requires semantic selectors/refs |
| `computer_type` | Type text into the governed desktop surface | `application`, `windowTitle`, `text`, `sensitive`, `timeout`, `verbosity` | governed action evidence; metadata records text length and sensitivity without echoing text |
| `computer_keypress` | Send key presses to the governed desktop surface | `application`, `windowTitle`, `keys`, `timeout`, `verbosity` | governed action evidence; metadata records key names, provider, timeout, and observation |
| `computer_open_application` | Open a governed desktop app | `application`, `windowTitle`, `timeout`, `verbosity` | destructive lifecycle evidence; provider validates the requested app against `allowedApplications` before launching/focusing it |
| `computer_focus_application` | Bring a governed desktop app/window to foreground | `application`, `windowTitle`, `timeout`, `verbosity` | destructive lifecycle evidence; useful before semantic UIA interactions when the app is not active |
| `computer_minimize_application` | Minimize a governed desktop app/window | `application`, `windowTitle`, `timeout`, `verbosity` | destructive lifecycle evidence; used to return the operator's desktop to a quieter state after automation |
| `computer_close_application` | Gracefully close a governed desktop app/window | `application`, `windowTitle`, `timeout`, `verbosity` | destructive lifecycle evidence; captures and reports the requested target, verifies it closed, reports `closeMethod`, and does not force-kill |
| `grep` | Search file content by pattern | `pattern`, optional file-or-directory `path`, `glob`, `outputMode`, `matchMode`, `maxResults`, `verbosity` | `raw` output is newline-delimited matches, file paths, or counts; `structured` is JSON result data; `summary` is a bounded rollup; requires native `rg`; content/file searches pass native match, filesize, and nuisance-directory bounds before output shaping; metadata includes `path`, `strategy`, `runtimeSource`, `runtimePath`, `runtimeVersion`, `outputMode`, `matchMode`, `count`, `maxResults`, and `verbosity` |
| `glob` | Match files by glob pattern | `pattern`, `path`, `verbosity` | `raw` output is newline-delimited relative file paths; `structured` is JSON matches; `summary` is a bounded rollup; metadata includes `path`, `strategy`, `count`, and `verbosity` |
| `json_query` | Query JSON with jq | `filter`, exactly one of `json` or `path`, `maxBytes`, `verbosity` | `raw` output is compact jq output; `structured` wraps output and line count; `summary` is a bounded rollup; requires native `jq`; metadata includes source, path, filter, strategy, runtime source/path/version, output bytes, truncation, and `verbosity` |
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
| `memory_search` | Search governed Memory Lattice context | `query`, `scopeKind`, `scopeId`, `layer`, `depth`, `limit` | returns matched memory records with content plus bounded graph evidence; metadata includes scope, query, result count, truncation, and resource URI |

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
- `WebExtractTool` validates one or more HTTP(S) URLs against the active network policy, calls an injected extraction provider, caps bytes per page, sanitizes extracted text or markdown, emits page evidence, and fails closed when no provider is configured.
- `Browser*Tool` and `Computer*Tool` validate the shared interactive-use schema, fail closed when no provider is configured, delegate actual automation to an injected provider, and emit shared `interactive` metadata without echoing sensitive typed text.
- `GrepTool` requires a resolved native `rg` runtime and fails fast when none
  is available; `matchMode` controls regex versus fixed-string matching,
  `outputMode` controls match shape, and `verbosity` controls result shape.
  Content and file-match searches pass native execution bounds to `rg`
  (`maxResults`, `--max-filesize`, and default nuisance-directory excludes)
  before Kiln applies final output shaping.
- `GlobTool` uses `fd` when available and falls back to the same recursive walker plus glob matching helpers; it can return raw path lists, structured JSON matches, or a summary.
- `JsonQueryTool` requires a resolved native `jq` runtime, accepts either inline JSON over stdin or a sandbox-validated JSON file path, and fails fast when no runtime exists instead of approximating jq semantics in TypeScript.
- `GitTool` executes `git` directly and validates the reconstructed command string before running it.
- `ReadManyTool` builds bounded multi-file text packets with deterministic ordering, include/exclude globs, optional `.gitignore` respect, default nuisance-directory excludes, per-file skipped reasons, total bytes, and truncation metadata.
- `CodeIntelligenceTool` validates workspace paths and delegates semantic navigation, symbols, diagnostics, implementations, and call hierarchy to an injected `CodeIntelligenceAdapter`. The default fails closed with `adapter_not_configured` instead of approximating LSP behavior with text search.
- `MonitorRegistry` owns session-local long-running command lifecycles and exposes `stopAll()` for session teardown. `MonitorStartTool` reuses bash-style cwd and command validation, starts `bash -c`, installs timeout cleanup, and records sequence-numbered output. `MonitorReadTool`, `MonitorStopTool`, and `MonitorListTool` read, stop, and project the same registry rather than owning separate process state.
- `TaskStateStore` owns session-local model-visible task progress. `TaskUpdateTool` validates lifecycle status, title, ids, and dependencies before mutating the store. `TaskListTool` projects the same store with optional status filtering.
- `OperatorElicitationTool` validates form or URL mode, denies sensitive form collection, requires HTTPS URL handoffs, calls the attached `OperatorElicitationResponder`, and records only outcome evidence plus submitted field names.
- `ToolCatalogSearchTool` searches the shared catalog by exact name, prefix, tags, or lexical query. It is read-only, supports raw, structured, and summary output, and reports stale exact matches as an empty result with `reason: "tool_not_found"`.

All built-in tools return `ToolResult`; failures are regular tool results when
possible, not uncaught process exceptions.

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

Kiln's developer tool stack is designed around two layers:

1. Bundled or explicitly configured native runtimes
2. System binaries discovered from PATH
3. Pure TypeScript fallback only for tools whose contract explicitly permits it

In the current core source, `GrepTool` resolves native `rg` through the search
runtime provider and fails fast when no runtime exists. The resolver checks the
vendored `@kilnai/tools` platform package first and treats it as bundled only
when `tools.json` declares the binary and the expected binary file exists.
`rg`, `fd`, and `jq` are vendored from upstream release artifacts with SHA-256
verification via `bun run vendor:tools`. `GlobTool` checks vendored `fd` before
PATH-provided `fd`, then falls back to its internal walker because file
discovery can be expressed safely without changing `grep` result semantics.
`JsonQueryTool` checks vendored `jq` before PATH-provided `jq` and does not
provide a fallback because jq filter semantics are the contract.

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
  effectEnvelope: {
    operation: "observe",
    boundaries: ["process"],
    reversibility: "reversible",
    dataEgress: "metadata",
    identityUse: "none",
    consequences: [],
    idempotency: "idempotent",
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
2. validate input
3. resolve the declared effect envelope and concrete invocation effect
4. derive authority from the resolved effect through `ToolAuthorizer`
5. allow immediately, require approval, or deny
6. if approved, execute with retry/fallback; fallbacks repeat this sequence

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

Those events include the resolved invocation effect, authority decision, duration, success, and a result summary. The design keeps the bridge reusable while preserving observability at the orchestration boundary.

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

Inside `@kilnai/core`, the immediate gate is action-effect based:

- builtin tools declare maximum `ActionEffectEnvelope` values
- input-sensitive tools such as `bash`, `git`, and `patch` resolve concrete
  invocation effects from validated input
- malformed or widening resolved effects fail closed
- external MCP annotations are hints for interoperability and presentation
  only; they do not grant trusted effect envelopes or reduce authority

`ToolAuthorizer` consumes the resolved invocation effect before the bridge runs
the tool.

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
| `tool_called` | `toolName`, `toolInput`, `resolvedEffect`, `authority`, `authorizationLevel`, `taskId` |
| `tool_output` | `toolCallId`, `toolName`, `stream`, `delta`, `chunkIndex` |
| `tool_authorized` | `toolName`, `level`, `allowed`, `reason` |
| `tool_result` | `toolName`, `durationMs`, `success`, `isError`, `retryAttempt`, `resultSummary` |

### Conversation events

Gateway-side runtime sessions also emit `TOOL_EXECUTED` for downstream product integrations.

### Command output lifecycle

Foreground command tools use the shared spawned-process runner also used by
background monitors. The foreground execution retains a bounded terminal result
while emitting bounded, ordered output deltas. Runtime owns correlation and adds
the canonical `toolCallId` plus a monotonic `chunkIndex`; surfaces must fold
those deltas into the existing tool execution rather than create transcript
rows for individual chunks.

The attended operator lifecycle is `tool_call_started`, zero or more live
`tool_call_output_delta` frames, then exactly one durable
`tool_call_completed` event. Incremental chunks are deliberately not persisted;
the bounded terminal result remains the durable evidence.
The same turn abort signal terminates the foreground process tree. Background
monitors remain session-owned and are not cancelled with an individual turn.

GUI uses the source-owned AI Elements terminal presentation for the bounded
operator log. TUI updates the matching tool node by `toolCallId`, and CLI writes
live command output to stderr so answer and JSON stdout remain machine-clean.
This output presentation is read-only; an interactive operator terminal is a
separate PTY capability with independent input, resize, and lifecycle authority.

### Interactive operator terminal

The local GUI launcher creates an ephemeral terminal capability and passes it
in the GUI URL fragment. The fragment is projected into the WebSocket query by
the loaded GUI, but is not sent in the initial HTTP request. Only a connection
holding that capability may open a PTY. Each PTY is then owned by that specific
WebSocket connection and is terminated when the operator closes it, the socket
disconnects, or the gateway shuts down.

The runtime terminal service uses Bun's platform PTY primitive (ConPTY on
Windows and `openpty()` on Linux/macOS) and enforces these invariants:

- the canonical working directory is the project workspace or a real directory
  beneath it; traversal and symlink escapes fail closed
- input and resize requests are bounded and validated at the gateway and service
  boundaries
- output is live and bounded per frame; it is not persisted in the session
  ledger or supplied to the model
- PTYs inherit the local launcher process authority, never the selected turn or
  agent authority
- a terminal ID is scoped to its owning connection; another connection receives
  the same not-found response as an unknown ID

GUI renders the bidirectional stream with xterm.js and forwards resize events to
the PTY. Its workbench panel is persistent across GUI surfaces, defaults closed,
and stores only the operator's preferred panel height per workspace. On narrow
layouts the same PTY occupies the workbench surface rather than opening a second
terminal implementation. CLI and TUI already run inside a native terminal, so
operator shell use remains native to their host rather than being projected as
transcript events. The runtime service and gateway frame vocabulary remain
surface-neutral for future native and IDE consumers.

---

## Result sanitization

Tool results can flow through the safety pipeline before they are reinjected into the model context. Kiln uses the same sanitization principles across tool categories:

- PII detection and redaction
- content classification
- indirect prompt-injection scanning on returned content

The pipeline is intentionally fail-open so a safety-service outage does not freeze tool execution.

---

## Tool selection and scaling

When a session has many tools, Kiln can reduce the prompt footprint by ranking relevant tools before each round. Tool descriptions and declared effect envelopes still remain the source of truth; ToolRAG only narrows the candidate set.

For large installations, that matters because developer tools, webhook tools, integration tools, and MCP tools all compete for context budget.

---

## Related

- [CLI Wrapper](../gui/cli-wrapper.md)
- [Gateway YAML Reference](../../configuration/gateway-yaml.md)
- [Skills](../agents/skills.md)
- [Observability](../ops/observability.md)
