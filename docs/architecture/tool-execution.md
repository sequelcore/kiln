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
