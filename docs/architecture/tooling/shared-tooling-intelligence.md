# Shared Tooling Intelligence

## Status

This is the canonical architecture record for the shared tooling intelligence
program completed on 2026-04-29.

The implementation moved Kiln beyond the concrete developer tools documented in
`developer-tools.md` into a shared model-callable tool plane that scales across
CLI, GUI, TUI, SDK, runtime gateways, and MCP without consumer-private
registries.

Stable tooling-intelligence doctrine lives here, in `tool-execution.md`, and in
`context-resource-plane.md`.

## Purpose

Shared tooling intelligence gives agents a compact way to discover, call, and
reason about a growing builtin tool surface without flooding every model turn
with every schema.

It owns these stable capabilities:

- machine-readable tool output contracts
- deferred tool catalog discovery
- semantic code-intelligence adapter boundaries
- bulk context ingestion
- session-owned long-running monitors
- session-local task state
- operator elicitation
- the initial MCP resource registry for stable context snapshots

## Boundaries

All capabilities are core-owned. Consumers may project them, but they do not
own alternate schemas, alternate registries, or private execution paths.

The canonical execution path remains:

1. `ToolRegistry` owns callable tools.
2. `DevToolExecutionBridge` validates, executes, and projects results.
3. Runtime, CLI, GUI, TUI, SDK, and MCP attach to that bridge.
4. Consumers render or forward the projection they receive.

Tools are still the only action surface. Resources and catalog entries are
context and discovery surfaces; they do not grant write, process, credential,
approval, or filesystem authority.

## Non-Negotiables

- No GUI/TUI-private tooling loops.
- No duplicated tool schema registry.
- No LSP, monitor, task, elicitation, or resource contract owned by a consumer.
- No background process without lifecycle ownership and stop semantics.
- No sensitive values collected through generic text prompts.
- No MCP resource read that bypasses action authority.
- No completion claim without focused tests, typecheck, full tests, build, and
  relevant docs.

## Structured Outputs

Builtin tools expose a text output for existing consumers and a structured
output contract for machine-readable consumers.

The stable distinction is:

- `ToolResult.output` is the human-readable visible result.
- `ToolResult.structuredContent` or projected equivalents are the
  machine-readable result body.
- `ToolResult.metadata` is audit and routing evidence, not the primary data
  contract.
- `ToolResult.outputSchema` describes structured output when the tool supports
  schema projection.

MCP tool definitions project `outputSchema` where supported. Error results use
the same envelope discipline so callers do not need a separate parsing path for
tool failures.

## Tool Catalog And Deferred Discovery

`ToolCatalogIndex` indexes names, descriptions, input fields, output schemas,
tags, authority, and source package. `tool_catalog_search` exposes read-only
catalog lookup.

Deferred projection exposes a compact always-on set plus catalog search. The
always-on set includes the tools required to discover more tools and follow
resource links. Concrete tool execution still goes through the canonical
registry; catalog results are not executable authority tokens.

Search supports exact, prefix, tag, and lexical matching without requiring an
external embedding provider. Stale exact-match lookups fail closed with an empty
result and a structured reason.

## Code Intelligence

`code_intelligence` is the shared semantic navigation tool. Its core boundary is
provider-neutral and adapter-backed:

- definition
- references
- hover
- document symbols
- workspace symbols
- diagnostics
- implementation
- call hierarchy

The GUI, TUI, CLI, runtime, and MCP projections do not manage language-server
processes directly. They attach to the shared adapter boundary. Path and
workspace validation happen before adapter execution. Unsupported languages or
missing adapters fail closed with structured metadata.

## Bulk Context Ingestion

`read_many` collects bounded multi-file context packets without forcing agents
to chain `glob` and many `read` calls.

The tool reuses core path validation, deterministic ordering, include/exclude
matching, `.gitignore` support, and nuisance-directory defaults. Text files are
included by default. Binary, media, PDF, archive, and other non-text inputs are
skipped unless a future explicit content policy enables them.

Results include per-file provenance, skipped-file reasons, truncation evidence,
total bytes, and file counts. When output is too large for direct model context,
the high-volume result can link to an artifact resource while keeping compact
visible output.

## Monitors

The monitor tool family models long-running commands as owned session tasks
instead of oversized shell calls:

- `monitor_start`
- `monitor_read`
- `monitor_stop`
- `monitor_list`

`MonitorRegistry` owns process lifecycle, output sequence numbers, timeout
cleanup, orphan cleanup, status, and bounded event retention. Commands reuse
the same validation and sandbox rules as `bash`.

GUI, TUI, CLI, SDK, runtime, and MCP projections read from the same registry.
They do not start private background processes outside the core lifecycle.

## Task State

The task-state tool family provides session-local work state:

- `task_update`
- `task_list`

`TaskStateStore` owns task ids, lifecycle status, dependencies, details,
timestamps, and monotonic sequence numbers.

This is model-visible session state. It does not replace project management
systems, docs saved to disk, or external issue trackers.

## Operator Elicitation

`operator_elicit` is the shared way for a tool or agent to ask for structured
operator input.

The stable contract supports:

- form mode for bounded non-sensitive fields
- HTTPS URL mode for credentials, OAuth, and other sensitive handoffs
- submitted, declined, cancelled, and unsupported outcomes
- value-free audit metadata for collected field names, mode, surface, and
  outcome

Sensitive values are not logged in tool output, metadata, resources, or
artifacts. Sensitive form collection is denied; URL mode owns credential-style
handoffs.

## Initial Resources

The shared tooling intelligence program introduced the first read-only resource
registry:

- `kiln://tools/catalog`
- `kiln://tools/catalog/{name}`
- `kiln://session/tasks`
- `kiln://session/tasks/{id}`
- `kiln://session/monitors`
- `kiln://session/monitors/{id}`

That foundation is now extended by the canonical context resource plane in
`context-resource-plane.md`.

## Consumer Contract

Consumers must attach to the shared core surface:

- CLI commands use `createDefaultBuiltinToolSurface()`.
- GUI and TUI gateways use runtime-attached builtin surfaces.
- Direct-provider sessions use the same execution bridge and state bundle.
- MCP projects the shared tool and resource registries externally.
- SDK exports the shared contracts rather than re-declaring them.

When provider sessions run in text-only mode, provider `tool_use` and
`tool_result` frames stay typed. They must not be degraded into assistant prose
or visible JSON that can break transcripts.

## Verification Baseline

The completed program was verified with focused package tests, root typecheck,
root tests, root build, and GUI live tests. The live tests confirmed that linked
resource artifacts remain readable across later turns and that high-volume tool
payloads no longer break transcript layout.
