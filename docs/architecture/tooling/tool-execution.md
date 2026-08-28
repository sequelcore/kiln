# Tool Execution

## Purpose

Tool execution is the controlled actuator layer for external action.

It must stay separate from:

- tool policy
- coordination logic
- context assembly

These systems interact, but they are not the same concern.

## Execution Sequence

The canonical sequence is:

1. look up the canonical tool definition
2. validate concrete tool input
3. resolve the trusted declared action-effect envelope
4. resolve the concrete invocation effect from validated input
5. validate that the resolved effect is equal to or narrower than the envelope
6. resolve active policy or explicit authority carried by an admitted caller
7. derive canonical authority from the resolved effect
8. resolve approval when required
9. execute through the actuator adapter
10. sanitize the result
11. record resolved effect, authority, attempts, and execution evidence
12. reinject or return the result
13. repeat the full sequence for any fallback tool
14. persist canonical evidence for replay

## Canonical Authority Contract

Tool execution uses one canonical authority shape:

- `AuthorityDescriptor`: `{ level, allowed, requiresApproval, reason }`
- `ToolExecutionRequest`: `{ name, input, authority? }`
- `ActionEffectEnvelope`: immutable catalog-time maximum effect
- `ResolvedInvocationEffect`: concrete invocation effect computed from
  validated input before authority and execution

Resolution rules:

- builtin and trusted integration definitions declare maximum effect envelopes
- input-sensitive builtins resolve the concrete invocation effect before
  authorization
- malformed, missing, contradictory, or widening effects fail closed
- `ToolAuthorizer` receives the resolved invocation effect, not annotations
- if request-level `authority` is present and valid, it is treated as an
  explicit admitted-policy decision and recorded with the resolved effect
- if request-level `authority` is malformed, execution is denied
- external MCP annotations are interoperability hints only; they may be
  projected for presentation, but they do not narrow trusted effect envelopes
  or reduce required authority

## Current Status

Canonical tool authority semantics are implemented in the runtime/tool
execution path.

Current source-of-truth boundary:

- canonical authority is resolved in execution paths (`ToolExecutionRequest`
  authority when present, otherwise resolved-effect authorizer derivation)
- approval is part of authority handling (`requiresApproval`) rather than a
  parallel authority model
- execution evidence records the resolved invocation effect and authority
  decision on tool authorization, tool result, audit, and session execution
  summaries
- operator approval resolution is keyed by canonical `approvalId`; session IDs
  are routing/audit context and must not be used as the approval grant key
- safety/security middleware audit rows are explicitly non-authority surfaces
- GUI/TUI operator authority indicators are read-only projections of existing
  authority state, not independent policy evaluators
- authority evidence and dangerous-command outcomes are recorded through one
  canonical turn-record shape across admitted surfaces
- structured file-change evidence from runtime file tools must be derived from
  shared core file metadata when it is present, and must survive the executor
  boundary rather than being flattened away

## Shared Provider Tool Surface

Kiln has one builtin developer-tool surface. The default builtin registry lives
in `@kilnai/core` and every runtime-facing projection is derived from that
registry. The concrete builtin developer-tool catalog and consumer contract are
documented in `docs/architecture/tooling/developer-tools.md`.

Canonical tool IDs and operator-facing aliases are separate. The initial
provider projection, the derived `authorizedMaterializable` view, and later
materialized tool state are separate projections; materialized state does not
become an authority source. Discovery may reveal only tools already authorized
for the turn, with typed status, and never widens the turn's authority or
allowlist.

Completion obligations resolve operator-facing producer names to canonical
producer IDs. Completion requires scoped evidence from that exact producer (or
an explicitly listed equivalent); shell substitution is prohibited unless Core
explicitly declares the equivalence. Configured producer diagnostics exposed to
the model are typed and redacted to configuration status/version facts. They do
not expose paths, credentials, or raw probe payloads and do not grant execution
authority.

Projection rules:

- direct and OAuth providers receive tool definitions from the canonical
  builtin surface when their execution profile supports Kiln-local tool
  execution
- MCP exposes the same builtin registry rather than a parallel schema list
- CLI, GUI, TUI, and runtime adapters consume projections instead of rebuilding
  tool schemas locally
- wrapper-specific install, plugin, or prompt layers remain packaging and host
  UX; they do not own private execution loops for Kiln builtin tools

Direct and OAuth providers share one direct-provider session family. Execution
mode is declared by provider/profile capability rather than by hardcoded
provider-name branches:

- `text-only`: model output is treated as text and tool proposals are not
  executed by Kiln
- `kiln-executable`: structured provider tool calls are routed through the
  runtime orchestrator, canonical authority, execution bridge, telemetry, and
  turn-record evidence

`codex-oauth` is not a special session class. It is one provider profile using
the same executable direct-provider path as any other provider that advertises
the required structured tool capability.

`operator_elicit` is part of the core shared builtin surface, not a GUI/TUI
private prompt loop. It lets executable sessions request bounded operator input
through a consumer-provided responder. Form mode is only for non-sensitive
structured values. Credential, OAuth, token, and other sensitive handoffs must
use HTTPS URL mode so submitted secrets are handled by the operator surface and
are not collected by generic tool metadata.

## Operator Surface Tools

CLI, GUI, and TUI sessions may add operator-surface tools to the same builtin
projection used for developer tools. These tools are runtime-owned projections,
not private consumer loops.

`operator_set_theme` is the session-only operator UI actuator for changing the
connected surface theme. GUI and TUI attach a live theme controller for each
turn; the runtime sends an `operator_theme_set` frame over the surface
WebSocket, waits for `operator_theme_set_result`, and returns that
acknowledgement as the tool result. CLI attaches the same tool contract but has
no live visual surface, so it returns an explicit capability error. The tool
cannot mutate durable configuration.

The tool accepts:

- `theme`: one of the shared `OPERATOR_THEME_NAMES`
- `reason`: optional short operator-facing context

The palette policy and built-in catalog live in the pure
`@kilnai/operator-appearance` package. Gateway contracts own only the transport
frames, so visual policy does not acquire a transport dependency.

Operator-surface tools depend on two separate gates:

- the selected provider/model must support structured function tools and Kiln
  runtime tool execution
- the active consumer must attach a controller for the operator capability

Provider-native shell or patch metadata does not decide whether operator tools
are exposed. Those fields describe provider-native affordances, not Kiln's
runtime execution authority.

## Execution Boundary

Execution adapters may host transport or session wiring, but they do not own
execution policy.

Current boundary posture:

- `runtime-session-orchestrator-tool-executor` remains the canonical
  tool-execution authority path
- `cli-subscription-executor.ts` is a bounded operator transport adapter, not
  a hidden execution-policy owner
- dead executor wrappers should be deleted once no concrete caller set remains

## MCP-First Packaging Boundary

MCP is the shared external runtime contract for Kiln developer tools. External
hosts and wrappers consume Kiln tools through MCP or through projections of the
canonical registry. Skills, rules, workflows, prompts, and wrapper plugins are
packaging layers above that contract.

Packaging layers may define:

- prompt payload and reusable instructions
- policy hints for a host
- allowed tool groups
- workflow steps
- host-specific installation metadata

Packaging layers must not define:

- independent authorization semantics
- private execution loops for Kiln builtin tools
- telemetry or audit ownership
- result sanitization bypasses
- copied tool schemas that drift from the canonical registry

Wrapper-specific plugins or installers are thin projections. They can install
MCP configuration, register host metadata, or package instructions, but the
concrete tool call still resolves through the canonical runtime authority and
execution path before any local action happens.

## Tool Call Identity

Canonical tool execution identity is `(toolCallScopeId, toolCallId)`.
`toolCallId` comes from the provider response, while the runtime creates
`toolCallScopeId` once at the model-response boundary that admitted that call.
The same provider call ID may therefore appear in different scopes without
collision.

Every canonical start, output, and terminal event preserves both values.
Persistence, replay, and audit projections fail closed when either value is
missing; they do not use event IDs, tool names, or stream order as identity
substitutes. Native harness adapters that cannot expose truthful response
coordinates remain explicitly incapable of persisted tool correlation rather
than fabricating a scope.

## MCP Resource Boundary

MCP resources are the read-only context plane. They expose stable snapshots and
addressable context without turning reads into tool actions.

The default builtin tool surface owns a `ToolResourceRegistry` alongside the
tool registry. Shared session resources include:

- `kiln://tools/catalog`
- `kiln://session/tasks`
- `kiln://session/monitors`
- `kiln://session/specifications`
- `kiln://session/clarifications`
- `kiln://session/plans`
- `kiln://session/analysis-reports`
- `kiln://session/analysis-findings`
- `kiln://session/authority`
- `kiln://session/work-items`
- `kiln://session/goals`

Shared resource templates include:

- `kiln://tools/catalog/{name}`
- `kiln://session/tasks/{id}`
- `kiln://session/monitors/{id}`
- `kiln://session/specifications/{id}`
- `kiln://session/clarifications/{specificationId}`
- `kiln://session/plans/{id}`
- `kiln://session/analysis-reports/{id}`
- `kiln://session/analysis-findings/{id}`
- `kiln://session/authority/{id}`
- `kiln://session/work-items/{id}`
- `kiln://session/goals/{id}`

Resource reads are backed by the same `ToolCatalogIndex`, `TaskStateStore`, and
`MonitorRegistry` instances that power builtin tools, plus the canonical
specification, plan, analysis, authority, work-item, and goal-run stores when
those stores are attached to the surface. They are read-only JSON snapshots.
They must not execute commands, mutate files, update tasks, stop monitors,
grant approval, advance goals, complete work items, or bypass canonical tool
authority. If a consumer needs to act, it must call the appropriate tool
through the execution bridge.

Resource and resource-template listing is cursor-paginated at the core registry
boundary. In-process callers can still use the no-arg full listing for the
current small static set, while MCP `resources/list` and
`resources/templates/list` project bounded pages and return `nextCursor` only
when another page exists. Cursors are opaque context positions with namespace
and fingerprint validation; invalid, stale, and out-of-range cursors fail
closed.

Workspace resources are projected through the same core registry only when a
workspace root is explicitly configured. The `WorkspaceResourceProvider` exposes
read-only `kiln://workspace/...` resources for bounded tree snapshots, whole
text files, and line previews. Workspace URIs use normalized relative paths, not
absolute local paths. Every read is checked against the configured root and any
provided `PathValidator`; traversal outside the root fails closed. Binary files
return metadata-only JSON until a separate blob policy exists.

Artifact resources are projected through the same core registry. The default
builtin surface owns a session-local `MemoryArtifactResourceStore` unless a
consumer provides a store explicitly. It requires explicit session retention on
writes, bounds content size and retained artifacts per namespace, records
producer provenance, and exposes read-only `kiln://artifacts/...` resources for
namespace indexes, artifact metadata, and JSON/text/blob content. Resource reads
do not give consumers mutation access to the store.

Operator sessions that recreate provider/runtime surfaces across turns must
reuse one session-scoped builtin tool-state bundle. That bundle owns the
artifact store, resource notification hub, monitor registry, and task-state
store for the operator session. Recreating a turn surface must not orphan
`metadata.resourceLinks`; a `kiln://artifacts/...` URI emitted in one turn must
remain readable by `resource_read` in later turns until the session retention
policy evicts it.

High-volume tools can attach resource links after execution through the
canonical `DevToolExecutionBridge`. The bridge uses an `ArtifactToolResourceLinker`
to store eligible successful outputs in the `tool-results` artifact namespace
and appends `metadata.resourceLinks` plus MCP-compatible `resource_link`
content. The original `ToolResult.output` and truncation metadata stay intact;
resource links are an addressable follow-up read path, not hidden context
injection. Sensitive operator elicitation results are not eligible for artifact
linking.

Tools may provide an internal `resourcePayload` when the best linked artifact is
richer than the visible `ToolResult.output`. The linker stores that payload and
then strips it from the returned tool result, so consumers still receive compact
output plus a resource URI. This is required for summary-mode high-volume tools:
`read_many` can return a one-line summary to the model while the linked
`kiln://artifacts/.../content` resource contains the raw bounded file packet.

Consumer surfaces use a shared resource display projection. Core exposes
`ToolResourceDisplayDescriptor` plus projection helpers for registry descriptors
and tool-result resource links. CLI can list and read resources through
`kiln tools --resources` and `kiln tools --resource <uri>`. Attached runtime
surfaces expose live `listResources`, `listResourceTemplates`, and
`readResource` functions backed by the same core registry, so GUI, TUI, SDK, and
direct-provider runtime consumers do not need private browse/read protocols.
When direct-provider tool execution receives linked high-volume output, the
runtime projection returns a compact resource-pointer message rather than
injecting the full artifact payload into every turn.

The same registry is also exposed to executable model sessions as read-only
builtin tools: `resource_list`, `resource_template_list`, and `resource_read`.
Those tools are canonical adapters over `ToolResourceRegistry`, not consumer UI
helpers. They remain available in deferred tool projection so models can
discover and read resource links without raw tool-result JSON being pasted into
assistant prose. Resource tools can only list or read context; any action still
routes through the normal tool execution bridge and authority contract.

Resource notifications are owned by the same core surface. A
`ToolResourceNotificationHub` tracks active consumer sessions, debounced
pending updates, list-change notices, and teardown. MCP `2026-07-28` projects
them through the SDK v2 `subscriptions/listen` router as
`notifications/resources/updated` and
`notifications/resources/list_changed`. Removed 2025 subscribe and
unsubscribe methods are not registered.

Notifications are invalidation hints only. They tell a subscribed client to
re-read a resource URI; they never push hidden payloads into model context.
Task updates, monitor lifecycle/output changes, and artifact writes notify
after their state mutation completes, so the resource read remains the ordering
source of truth through the task, monitor, and artifact sequence numbers.

The completed resource-plane architecture is documented in
`docs/architecture/context-resource-plane.md`. Pagination, workspace resources,
artifact namespaces, resource subscriptions, notifications, high-volume
resource links, model-callable resource tools, and consumer projection extend
the read-only context plane; they do not change the action boundary.

## Runtime Projections

Several runtime-visible structures project authority state without becoming new
authority sources:

- `toolAuthority` carries per-tool authority descriptors into execution when
  tenant or integration context provides them
- `toolAuthorityClassification` exposes a coarse per-tool posture projected
  from canonical declared effects or explicit admitted authority
- `integrationAuthorityRollup` exposes a conservative per-integration posture
  reduced from per-tool classifications
- GUI/TUI `authorityStatus` exposes operator-facing visibility derived from the
  current surface configuration

These structures exist for routing visibility, audit clarity, and operator UX.
They do not replace canonical authority resolution in the execution path.

## Surface Boundaries

Authority behavior differs by surface:

- tenant-backed and harness-controlled API paths can carry resolved authority
  into execution directly
- operator-attached GUI/TUI paths default to explicit fail-closed authority for
  orchestrator-managed tools when no richer authority source is present
- provider-native runtimes may still act as attached-runtime surfaces; their
  proposals do not become authority unless Kiln resolves and executes them

## Core Rules

- authorization happens before execution
- authorization is derived from resolved invocation effect, not annotations
- tools with a conservative declared envelope may use a runtime-owned,
  input-sensitive effect resolver. The resolved effect must be a valid
  narrowing of that envelope; otherwise execution falls back to the declared
  conservative effect.
- destructive or unknown actions require explicit approval unless an admitted
  operator policy explicitly overrides that behavior
- sandbox violations are denied and audited
- results are sanitized before re-entry
- retries and fallbacks are bounded, and every fallback resolves and authorizes
  its own tool and input

## Operational Concerns

- timeout handling
- retry strategy
- fallback strategy
- result sanitization
- dangerous command detection
- command and path safety checks

## Runtime Turn Convergence

`RuntimeSessionOrchestrator` is the sole live-loop owner for attached Runtime
turns. Provider adapters and GUI, TUI, CLI, and gateway transports supply
requests and evidence; they do not run private model/tool loops or settle a
turn independently.

Every attached turn receives one complete, finite convergence policy. Runtime
resolves `RuntimeExecutionEnvelope.convergence` when a workflow supplies an
explicit policy, otherwise it uses the centralized
`RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY`. The policy carries a stable identity,
configuration digest, and limits for provider requests, tool rounds and calls,
cumulative input tokens, elapsed and active time, recovery attempts, and
consecutive no-progress steps. The numeric defaults are centralized and
provisional pending calibration; they are not an additional YAML configuration
schema.

Runtime calls the convergence decision before every provider request and before
every atomically admitted tool batch, including the first request. A bound is
settled deterministically as a typed pause in the same turn; reaching a bound
does not trigger another model request or a hidden finalization prompt. The
terminal disposition carries the exact reason and convergence evidence for
replay. No-progress evidence may pause a turn, but it never proves completion.

`sessionTurnBudget` is a separate outer/session-history authorization. Runtime
checks it before consequential steps, but it cannot replace or widen the
turn-local convergence policy. Per-tool usage snapshots remain count-only
evidence and do not authorize surface-owned thresholds.

Current model context and cumulative input are separate quantities. The current
context is the projected message set sent to the next provider request and may
be reduced by the conversation projection policy. Cumulative input is turn-wide
observed provider usage used by convergence; neither quantity substitutes for
the other.

## Tool Identity, Discovery, And Completion Evidence

Canonical tool IDs and operator-facing aliases are separate. The initial
provider projection, the `authorizedMaterializable` set, and the later
materialized tool state are separate projections as well. Discovery may reveal
only tools already authorized for the turn, with typed status; it never widens
the turn's authority or allowlist. Progressive materialization therefore
requires both an admitted canonical ID and an already-authorized materialization
capability.

Completion obligations are explicit. A request such as “use Dafny” resolves to
the canonical `formal_verify` producer, while the alias remains presentation
metadata. Completion requires a successful typed observation from that exact
producer (or an explicitly listed equivalent) with scoped
`(toolCallScopeId, toolCallId)` evidence. Shell substitution, including `bash`,
does not satisfy a required producer unless Core explicitly declares the
equivalence.

Configured producer diagnostics may be exposed to the model through catalog
discovery. They are typed, canonical-ID-scoped, and redacted to configuration
status/version facts; paths, credentials, and raw probe payloads do not cross
the model boundary. An unavailable or invalid producer therefore remains a
diagnostic and cannot be treated as executable authority.

## Invocation Authority

Tool authority is resolved at the invocation boundary. Static capability
metadata describes the maximum effect a tool can produce; it must not override a
narrower input-sensitive effect. Shell tools use deterministic command analysis
to admit read-only commands without confirmation while preserving confirmation
or denial for ambiguous, networked, privileged, or destructive commands.

## Timeout Contract

Tool-specific timeout inputs stay owned by the tool that executes the work. The
execution bridge may only derive its outer retry guard from canonical tool
schema metadata when all of these are true:

- the tool input has a numeric `timeout` field
- that schema field is marked with `x-kiln-timeout-unit: "milliseconds"`
- the execution request did not provide an explicit `retry.timeout`

This keeps long-running MCP calls, such as `bash` with a larger millisecond
timeout, from being preempted by the bridge default while preserving explicit
retry policy as the stronger request-level contract. Kiln-owned MCP clients
also pass an MCP request timeout that is at least the tool timeout plus a
`30000ms` buffer and opt into progress-based timeout resets.

Operational verification on 2026-04-29 confirmed that, after restarting the
Kiln MCP server, `bash` accepted a `180000ms` request timeout and completed the
runtime package test suite in `76986ms` with `timedOut: false`.

Dev-tools MCP calls emit `notifications/progress` every `30000ms` when the
caller supplies a progress token. This gives compliant MCP clients a standard
keepalive path for long-running calls; callers that impose a hard request-await
ceiling while ignoring request timeout options and progress notifications can
still time out outside Kiln's execution path.

## Tool Result Metadata Contract

Builtin developer tools expose one core-owned result metadata contract from
`@kilnai/core`. Public `ToolResult.output` text remains the user-facing payload;
metadata is structured evidence for projections, audit, and later runtime
evidence extraction.

The shared metadata families are:

- `command`: shell-like execution evidence for `bash` and `git`
- `file`: file operation evidence for `read`, `read_many`, `write`, `edit`,
  and `patch`
- `inspection`: workspace orientation evidence for `stat` and `tree`
- `media`: image and OCR evidence for `view_image` and `ocr_image`
- `web`: external source evidence for `web_search`, `web_fetch`, and
  `web_extract`
- `interactive`: browser and computer automation evidence for `browser_*` and
  `computer_*`
- `search`: workspace search evidence for `grep` and `glob`
- `monitor`: long-running command lifecycle evidence for `monitor_start`,
  `monitor_read`, `monitor_stop`, and `monitor_list`
- `task_state`: session-local progress evidence for `task_list` and
  `task_update`
- `elicitation`: operator-input evidence for `operator_elicit`

Every builtin metadata object includes:

- `toolName`: the canonical builtin tool name
- `kind`: one of `command`, `file`, `inspection`, `media`, `web`,
  `interactive`, `search`, `monitor`, `task_state`, or `elicitation`

Existing metadata keys such as `cwd`, `command`, `filePath`, `bytesWritten`,
`replacements`, `path`, `type`, `size`, `modifiedTime`, `mimeType`, `strategy`,
`runtimeSource`, `runtimePath`, `runtimeVersion`, `timedOut`, and `truncated`
are preserved. High-volume tools may also include `verbosity` to record whether
the public `output` was raw, structured, or summarized. The normalized fields
are additive and come from
`packages/core/src/tools/domain/tool-result-metadata.ts`; consumers must not
create private metadata contracts for builtin tools.

The shared result-shaping input is `verbosity`, not `outputMode`. `grep` already
uses `outputMode` for match shape (`content`, `files_with_matches`, or
`count`) and `matchMode` for pattern semantics (`auto`, `regex`, or `literal`),
so reusing that field for output shape would make the contract ambiguous.
`verbosity` is currently supported by `bash`, `tree`, `web_search`,
`web_fetch`, `web_extract`, `grep`, `glob`, the monitor lifecycle tools,
task-state tools, and `operator_elicit`; it changes only `ToolResult.output`,
not the metadata family.

Tool schemas are projected across CLI, GUI, TUI, MCP, and direct-provider
managed routes. Every object property in a builtin tool schema must declare an
explicit JSON Schema shape, usually `type`, even when an `enum` is present.
Enum-only property definitions are rejected by stricter OpenAI-compatible
providers and are treated as contract regressions.

Inspection metadata is read-only orientation state. `stat` can report type,
size, modified time, and an optional checksum. `tree` can report bounded
directory shape, entry count, truncation state, and ignored nuisance
directories. Runtime file-change evidence must continue to come from shared
`file` metadata only; `inspection` metadata must not be treated as a write,
edit, or patch signal.

Media metadata is read-only image state. `view_image` can return MCP-compatible
image content while preserving a compact text `output` for text-only consumers.
`ocr_image` can report extracted text, language, text length, and OCR backend
source or confidence when the backend provides it. Runtime file-change evidence
must not treat `media` metadata as filesystem mutation evidence.

Web metadata is read-only external-source state. `web_search` can report query,
provider, recency, domain filters, ranked sources, result count, retrieval time,
and provider/configuration errors. `web_fetch` can report source URL, normalized
final URL, content type, status, bytes read, redirect chain, truncation, and
network/content errors. `web_extract` can report requested URLs, extraction
format, provider, page evidence, bytes read, truncation, and
provider/configuration errors. Web tools must require explicit network policy,
reject private and local targets, validate redirects where they own fetching,
and sanitize text before reinjection. Runtime file-change evidence must not
treat `web` metadata as filesystem mutation evidence.

Interactive metadata is browser and computer automation state. Browser tools
can report session id, URL, title, visible text, screenshot/artifact URIs,
coordinates, selectors, keys, scroll deltas, timeout, provider, and typed text
length. Computer tools can report window title, app name, screenshot/artifact
URIs, coordinates, keys, timeout, and provider. Metadata must not contain typed
secrets or screenshots as inline blob payloads; screenshots and traces belong
behind artifact/resource URIs. Observation operations are read-only orientation
evidence. Action operations remain governed tool actions and must not be
treated as file-change evidence unless a separate file tool reports shared
`file` metadata.

Monitor metadata is lifecycle evidence for session-local long-running
commands. `monitor_start` records command, cwd, timeout, monitor id, status, and
current sequence. `monitor_read` records cursor and event-count evidence.
`monitor_stop` records explicit stop outcome, duration, exit code, signal,
timeout, and truncation evidence. `monitor_list` records the projected monitor
count and optional status filter. Monitor output is command output, not
workspace mutation evidence; file-change extraction must not parse monitor text
as file evidence.

Task-state metadata is model-visible session progress evidence. `task_update`
records the updated task id, status, sequence, and total task count.
`task_list` records status filters, returned task count, total task count, and
sequence. Task-state tools are session-local coordination state, not saved
project plans, external project management records, or file-change evidence.

Elicitation metadata is operator-input evidence. `operator_elicit` records the
mode, outcome, schema presence, sensitivity flag, optional HTTPS URL handoff,
answering surface, and submitted field names. It must not record submitted
values. Runtime consumers must treat declined, cancelled, unsupported, and
responder-missing outcomes as explicit tool-level errors rather than retrying
through ad hoc text prompts.

`patch` is the multi-file member of the file metadata family. Its top-level
metadata uses `operation: "patch"`, `dryRun`, and `operationCount`, and its
`files` array contains the per-path change evidence used by runtime file-change
tracking. Runtime consumers must read that shared metadata instead of parsing
patch text or maintaining a private diff contract.

Runtime evidence extraction reads shared metadata first. File-change evidence is
recognized from `kind: "file"` metadata with `operation: "write"` or
`operation: "edit"`; `operation: "read"` is explicitly not change evidence.
Legacy runtime fallbacks for canonical `write` and `edit` tool names exist only
to preserve older tool results that do not yet emit shared metadata.

## Invariants

- deny-by-default authorization
- explicit rate-limit behavior
- explicit timeout behavior
- explicit error classification
- no silent fallback that bypasses safety or policy
- no parallel authority DSL outside `AuthorityDescriptor` + existing authorizer
- no packaging-owned execution substrate outside the canonical runtime path
- no duplicated builtin-tool schema or execution registry outside the canonical
  core tool surface
- no provider-specific direct-provider session branch when execution profile
  metadata can express the behavior
