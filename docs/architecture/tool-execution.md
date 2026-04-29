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
- structured file-change evidence from runtime write and edit tools must
  survive the executor boundary rather than being flattened away

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

Attached GUI and TUI sessions may add operator-surface tools to the same
per-turn builtin projection. These tools are runtime-owned projections, not
private GUI or TUI tool loops.

`operator_set_theme` is the canonical operator UI actuator for changing the
connected surface theme. It is only exposed when a live operator surface is
attached to the turn. The runtime sends an `operator_theme_set` frame over the
surface WebSocket, waits for `operator_theme_set_result`, and returns that
acknowledgement as the tool result.

The tool accepts:

- `theme`: one of the shared `OPERATOR_THEME_NAMES`
- `scope`: `session` for the live surface or `persisted` when the operator has
  explicitly asked to save the preference
- `reason`: optional short operator-facing context

The shared theme catalog and frame contracts live in
`@kilnai/gateway-contracts` so GUI and TUI cannot drift.

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
