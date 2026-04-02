# Phase 4.5c Implementation Plan: Enforcement Integration

> Updated: 2026-04-01. Sources: local scout of current Kiln CLI/runtime code and prior competitor research.

## Objective

Phase 4.5c is the point where permission policy stops being only:

- schema
- normalization
- evaluation
- translation metadata

and starts becoming real runtime behavior.

The goal is to enforce policy at the correct architectural boundaries without
duplicating policy logic across CLI adapters, runtime gateways, and core.

**Status:** EFFECTIVELY COMPLETE (closable)

---

## Scout Summary

Current reality:

- `4.5a` exists: canonical evaluator in
  [permission-evaluator.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/permission-evaluator.ts)
- `4.5b` exists: backend translation + sync persistence
- approval state is still ephemeral in
  [approval-registry.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/approval-registry.ts)
- session persistence exists in
  [session-store.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/session-store.ts)
- prompt/context assembly is still coarse in
  [preamble-builder.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/preamble-builder.ts)
- outbound runtime sends are still policy-blind in
  [outbound-routes.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/outbound-routes.ts)

Main gaps:

- no `once / session / project` approval memory
- no real file-governance filtering before backend exposure
- no execution-time enforcement of agent scopes
- no destination-aware data-firewall enforcement in outbound runtime paths

---

## Architectural Position

Phase 4.5c must preserve this split:

- `packages/cli/src/application`
  owns enforcement orchestration
- `packages/cli/src/wrapper`
  owns persistence adapters and policy utilities
- `packages/runtime/src/gateway`
  owns outbound/channel enforcement
- `packages/core`
  may own shared low-level helpers only if reuse is proven

Forbidden:

- duplicating permission decision logic outside the evaluator
- moving product policy ownership into `core`
- hiding backend capability gaps by pretending translation equals enforcement

---

## Sub-Phase Sequence

### 4.5c.a — Approval Memory Foundation

**Purpose**

Add durable approval-memory primitives that can support:

- `once`
- `session`
- `project`

without changing runtime approval transport semantics yet.

**Primary files**

- new: `packages/cli/src/wrapper/approval-memory-store.ts`
- new tests in `packages/cli/tests/wrapper/`
- minimal application plumbing only if needed

**Notes**

This is the cleanest first slice because:

- it fits existing `.kiln` persistence
- it does not force premature runtime/UI behavior
- it creates a real foundation for later enforcement

**Current progress**

- approval memory is now consumed in the CLI application run loop for
  denied `tool_use` events
- matching approval memory grants allow the tool while preserving the normal
  allowed-tool flow (transcript + hooks + tool accounting)
- `once` grants are consumed only after command/MCP/later gates pass
- session-scoped matching uses stable logical Kiln session IDs from the outer
  run command, including resumed-session paths
- focused `run-session-permissions` coverage exists for once/session/project
  grants and the edge case where a later gate denies execution without
  consuming a `once` grant
- command-surface approval memory is now consumed for denied bash-like command
  executions in the same CLI run loop
- matching command grants preserve the normal allowed-tool flow
- command-surface `once` grants are consumed only after later gates pass
- command-surface session grants use the same stable logical Kiln session IDs
  rather than provider-local session ids
- file-governance deny decisions are now enforced in the CLI run loop for
  explicit path-bearing tool inputs (`input.filePath`, `input.path`) before
  normal tool execution flow is committed

### 4.5c.b — Context Governance Enforcement

**Purpose**

Enforce `fileGovernance.excludeFromContext` and related context filtering before
backend exposure.

**Current progress**

- first narrow slice landed in
  [preamble-builder.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/preamble-builder.ts):
  when `excludeFromContext === true`, memory snapshot is omitted from the
  generated preamble before backend handoff
- tests landed in
  [preamble-builder.test.ts](/C:/Proyectos/Sequel/kiln/packages/cli/tests/wrapper/preamble-builder.test.ts)
- second narrow slice landed in
  [context-governance.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/application/context-governance.ts)
  and [run-session.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/application/run-session.ts):
  governed session context is now produced in the application layer before
  prompt construction
- tests landed in
  [context-governance.test.ts](/C:/Proyectos/Sequel/kiln/packages/cli/tests/application/context-governance.test.ts)

**Primary files**

- `packages/cli/src/application/run-session.ts`
- `packages/cli/src/wrapper/preamble-builder.ts`
- backend wrappers only where native restrictions can be applied safely

### 4.5c.c — Agent Scope Execution Enforcement

**Purpose**

Enforce scoped tool/command/MCP restrictions in the CLI application run flow,
not only in evaluation or prompt text.

**Current progress**

- first narrow slice landed in
  [run-session.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/application/run-session.ts):
  denied `tool_use` events now stop the active provider attempt before
  `preToolUse` executes, record a denied transcript event, and surface a
  policy-derived provider failure
- agent-specific overlays are honored when `permissionAgent` is supplied to the
  application run flow
- second narrow slice landed in
  [run-session.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/application/run-session.ts):
  bash-like tool payloads (`Bash`, `bash`) now evaluate `commandRules` when a
  string command is present at `event.input.command`, and denied commands stop
  the active provider attempt before hook execution
- third narrow slice landed in
  [run-session.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/application/run-session.ts):
  explicitly marked MCP-origin tool events now honor scoped `mcpTools`
  allowlists with exact-match semantics when the active agent scope defines
  them
- wrapper metadata expansion landed in
  [claude-code-process.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/claude-code-process.ts):
  Claude MCP-origin tool blocks are now preserved as `tool_use` events with
  `source: "mcp"` instead of collapsing into generic tool calls
- wrapper metadata expansion landed in
  [opencode-session.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/opencode-session.ts):
  OpenCode now tracks MCP-backed tool names from `mcp.tools.changed` and marks
  matching `tool_use` events as `source: "mcp"`
- canonical MCP selector tightening landed across
  [mcp-selector.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/mcp-selector.ts),
  [session.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/session.ts),
  [codex-session.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/codex-session.ts),
  [claude-code-process.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/claude-code-process.ts),
  [opencode-session.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/opencode-session.ts),
  and [run-session.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/application/run-session.ts):
  MCP-origin tool events now carry canonical selectors, and scoped `mcpTools`
  enforcement compares normalized selectors rather than raw backend-specific
  tool names
- tests landed in
  [run-session-permissions.test.ts](/C:/Proyectos/Sequel/kiln/packages/cli/tests/application/run-session-permissions.test.ts)
  and [claude-code-process.test.ts](/C:/Proyectos/Sequel/kiln/packages/cli/tests/wrapper/claude-code-process.test.ts)
  and [opencode-session.test.ts](/C:/Proyectos/Sequel/kiln/packages/cli/tests/wrapper/opencode-session.test.ts)
  and [codex-session.test.ts](/C:/Proyectos/Sequel/kiln/packages/cli/tests/wrapper/codex-session.test.ts)

**Primary files**

- `packages/cli/src/application/run-session.ts`
- supporting application services as needed

### 4.5c.d — Runtime Data Firewall Enforcement

**Purpose**

Enforce destination-aware policy for outbound sends and runtime egress paths.

**Current progress**

- first narrow slice landed in
  [outbound-routes.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/outbound-routes.ts):
  outbound channel sends now consult an optional permission hook before
  provider calls
- current behavior for this slice:
  - `allow`: unchanged send behavior
  - `deny`: safe block before provider call
  - `redact`: text payload rewritten to `[REDACTED]`
  - template sends + `redact`: blocked safely, not mutated
- tests landed in
  [outbound-routes.test.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/tests/gateway/outbound-routes.test.ts)
- second narrow slice landed in
  [message-pipeline.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/message-pipeline.ts):
  covered runtime egress surfaces now consult an optional permission hook before
  returning or emitting text-bearing content
- covered surfaces in this slice:
  - assistant response parts
  - escalation summaries
  - tool result summaries
- tests landed in
  [message-pipeline.test.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/tests/gateway/message-pipeline.test.ts)

**Primary files**

- `packages/runtime/src/gateway/outbound-routes.ts`
- `packages/runtime/src/gateway/message-pipeline.ts`
- `packages/runtime/src/gateway/safety-middleware.ts` only where it can remain
  a middleware, not become policy owner

---

## Decision: Start With 4.5c.a

Although file governance is the highest-value behavior gap, the cleanest first
implementation slice is approval-memory persistence.

Why:

- it is independent
- it respects current package boundaries
- it avoids forcing fake enforcement into backends before the persistence and
  decision flow exist
- it is testable without changing terminal UX yet

That makes `4.5c.a` the correct start of the phase, followed by real
context/execution enforcement.

---

## Done Criteria For 4.5c.a

- approval memory store exists under `.kiln`
- supports `once`, `session`, and `project` scopes
- stores enough metadata to audit what was granted:
  - surface
  - selector / match key
  - action
  - scope
  - timestamps
- tests cover read/write/expiry or session-clearing semantics as applicable
- no runtime gateway logic is polluted with persistence concerns

## 4.5c Closure Note

- 4.5c core enforcement goals are now covered: approval memory consumption,
  context governance, agent-scope execution enforcement, and runtime data
  firewall slices.
- Remaining work in this area is optional expansion, not a blocking
  enforcement gap.
