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

1. authority resolution (request authority descriptor, then authorizer fallback)
2. rate-limit evaluation
3. sandbox validation
4. execution
5. result sanitization
6. reinjection or response

## Canonical Authority Contract

Tool execution uses one canonical authority shape:

- `AuthorityDescriptor`: `{ level, allowed, requiresApproval, reason }`
- `ToolExecutionRequest`: `{ name, input, authority? }`

Resolution rules:

- if request-level `authority` is present and valid, it is used as-is
- if request-level `authority` is malformed, execution is denied (fail closed)
- otherwise, existing `ToolAuthorizer` behavior is used
- if no authorizer exists, default audited execution (level 2) is preserved

## Current Status

Canonical tool authority semantics are implemented in the runtime/tool
execution path.

Current source-of-truth boundary:

- canonical authority is resolved in execution paths (`ToolExecutionRequest`
  authority when present, otherwise authorizer fallback and audited default)
- approval is part of authority handling (`requiresApproval`) rather than a
  parallel authority model
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
registry.

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

## Operator Surface Tools

CLI, GUI, and TUI sessions may add operator-surface tools to the same builtin
projection used for developer tools. These tools are runtime-owned projections,
not private consumer loops.

`operator_set_theme` is the canonical operator UI actuator for changing the
connected surface theme. GUI and TUI attach a live theme controller for each
turn; the runtime sends an `operator_theme_set` frame over the surface
WebSocket, waits for `operator_theme_set_result`, and returns that
acknowledgement as the tool result. CLI attaches the same tool contract but has
no live visual surface, so `scope: "session"` returns an explicit tool error and
`scope: "persisted"` updates GUI and TUI defaults in global config.

The tool accepts:

- `theme`: one of the shared `OPERATOR_THEME_NAMES`
- `scope`: `session` for the live surface or `persisted` when the operator has
  explicitly asked to save the preference
- `reason`: optional short operator-facing context

The shared theme catalog and frame contracts live in
`@kilnai/gateway-contracts` so GUI and TUI cannot drift.

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

## Runtime Projections

Several runtime-visible structures project authority state without becoming new
authority sources:

- `toolAuthority` carries per-tool authority descriptors into execution when
  tenant or integration context provides them
- `toolAuthorityClassification` exposes a coarse per-tool posture derived from
  capability annotations
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
- destructive actions require explicit approval unless policy says otherwise
- sandbox violations are denied and audited
- results are sanitized before re-entry
- retries and fallbacks are bounded

## Operational Concerns

- timeout handling
- retry strategy
- fallback strategy
- result sanitization
- dangerous command detection
- command and path safety checks

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
- `web`: external source evidence for `web_search` and `web_fetch`
- `search`: workspace search evidence for `grep` and `glob`
- `monitor`: long-running command lifecycle evidence for `monitor_start`,
  `monitor_read`, `monitor_stop`, and `monitor_list`
- `task_state`: session-local progress evidence for `task_list` and
  `task_update`

Every builtin metadata object includes:

- `toolName`: the canonical builtin tool name
- `kind`: one of `command`, `file`, `inspection`, `media`, `web`, `search`,
  `monitor`, or `task_state`

Existing metadata keys such as `cwd`, `command`, `filePath`, `bytesWritten`,
`replacements`, `path`, `type`, `size`, `modifiedTime`, `mimeType`, `strategy`,
`timedOut`, and `truncated` are preserved. High-volume tools may also include
`verbosity` to record whether the public `output` was raw, structured, or
summarized. The normalized fields are additive and come from
`packages/core/src/tools/domain/tool-result-metadata.ts`; consumers must not
create private metadata contracts for builtin tools.

The shared result-shaping input is `verbosity`, not `outputMode`. `grep` already
uses `outputMode` for match semantics (`content`, `files_with_matches`, or
`count`), so reusing that field for output shape would make the contract
ambiguous. `verbosity` is currently supported by `bash`, `tree`, `web_search`,
`web_fetch`, `grep`, `glob`, the monitor lifecycle tools, and task-state tools;
it changes only `ToolResult.output`, not the metadata family.

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
network/content errors. Web tools must require explicit network policy, reject
private and local targets, validate redirects, and sanitize text before
reinjection. Runtime file-change evidence must not treat `web` metadata as
filesystem mutation evidence.

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
