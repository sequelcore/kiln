# Shared Tool Surface Unification

**Status:** Active execution track  
**Owner:** Kiln runtime / CLI surfaces  
**Depends on:** `docs/architecture/tool-execution.md`, `docs/architecture/subsystems.md`, `docs/architecture/flows.md`  
**Related:** `STRATEGY.md`, `docs/roadmap/README.md`

## Purpose

Make Kiln's tool surface canonical across provider classes without adding a
second execution substrate.

This roadmap exists because the current state is split in the wrong place:

- wrapper providers (`claude`, `codex`, `opencode`) run through their native
  execution environments
- `codex-oauth` is the only direct/OAuth provider currently wired into Kiln's
  executable tool path
- the other direct providers surface tool frames as plain text only
- builtin tool definitions are duplicated across session wiring and MCP
  exposure

That split is producing narrow bug fixes where Kiln needs a stable long-term
shape.

## Problem Statement

Today Kiln has two conflicting realities:

1. The canonical execution doctrine says provider-native proposals do not
   become authority until Kiln resolves and executes them.
2. The CLI wrapper layer still treats direct providers in two unrelated ways:
   `codex-oauth` gets real Kiln tool execution, while the rest degrade tool
   traffic into text.

This creates four classes of debt:

- direct-provider behavior depends on hardcoded session classes instead of
  declared capability
- builtin tools are registered more than once
- MCP exposure is adjacent to the canonical tool surface instead of being a
  thin projection of it
- wrapper integration has no explicit long-term boundary relative to Kiln's
  builtin tools

## Design References

The design direction here is informed by the local reference scouts already
run against adjacent ecosystems:

- `C:/Proyectos/Sequel/codex/docs/config.md`
- `C:/Proyectos/Sequel/codex/codex-rs/app-server/README.md`
- `C:/Proyectos/Sequel/opencode/packages/opencode/src/mcp/index.ts`
- `C:/Proyectos/Sequel/opencode/packages/opencode/src/plugin/index.ts`
- `C:/Proyectos/Sequel/claude-code/tools.ts`
- `C:/Proyectos/Sequel/claude-code/tools/MCPTool/MCPTool.ts`
- `C:/Proyectos/Sequel/hermes-agent/tools/mcp_tool.py`
- `C:/Proyectos/Sequel/hermes-agent/model_tools.py`

Observed pattern:

- MCP is the shared tool contract
- wrapper-native plugins are packaging and host-integration layers
- host-native tools still exist where the wrapper owns approvals, process
  control, or lifecycle

Kiln should follow that same boundary, but with stricter canonical ownership
of tool policy and telemetry.

## Market / Product Validation

Recent market and user research reinforces the core decision in this roadmap:
the tool substrate should converge, while human-facing surfaces can multiply.

Observed category direction:

- major AI coding products are moving toward shared runtimes with multiple
  surfaces, not one monolithic interface
- direct/API providers continue to expose native function/tool calling
- wrapper and editor ecosystems are converging on MCP as the external tool
  integration contract
- plugins, skills, rules, hooks, prompts, and workflows are emerging as
  packaging layers above tool execution, not replacements for the execution
  substrate
- users value transparency, approvals, diffs, logs, rollback, cost visibility,
  and session replay more than provider-specific tool behavior

Implication for this roadmap:

- MCP is a product surface, not a compatibility bridge
- provider-specific tool hacks are strategically wrong even when they are
  locally faster
- Kiln should expose one governed tool surface through transport-specific
  adapters:
  - direct/API/OAuth providers use native structured tool calling
  - wrapper providers use MCP first, with thin CLI/plugin bridges only where
    the wrapper host requires them
- skills/rules/workflows must compose over the canonical tool surface rather
  than creating parallel execution paths

Broader human-surface strategy is tracked separately in
`docs/roadmap/04-operator-surfaces-and-remote-gui.md`.

Session identity is tracked separately in `docs/architecture/session-model.md`.
This roadmap may change provider execution profiles, but those profiles must
not make sessions provider-owned. Provider-native thread IDs remain metadata
under canonical Kiln sessions.

## Architectural Decision

### 1. Kiln builtin tools remain the canonical tool source of truth

There is one builtin tool registry, one schema surface, and one execution
bridge. Any surface that exposes Kiln tools must project from that source.

### 2. Direct and OAuth providers converge on one Kiln-executed tool path

Direct/OAuth providers that support structured tool calls should not get
provider-specific session classes. They should declare capabilities and run
through one direct-provider session path that:

- appends execution identity
- exposes the canonical builtin tool definitions to the adapter
- routes tool calls through `RuntimeSessionOrchestrator`
- emits canonical telemetry and file-change evidence

### 3. Tool execution is capability-driven, not provider-name-driven

Whether a provider uses the executable path is determined by declared runtime
capability, not by hardcoded checks for `codex-oauth`.

That capability must account for:

- provider class: wrapper vs direct provider
- tool-call support
- billing mode default
- MCP posture
- session execution mode: text-only vs Kiln-executable vs wrapper-native

### 4. Wrapper providers keep native execution, but Kiln tools are exposed through MCP

`claude`, `codex`, and `opencode` should keep their native execution
environments. Kiln should not re-host their tool loops inside the wrapper
path. Instead:

- Kiln exposes its builtin tools through the canonical MCP surface
- wrappers can consume those tools through MCP where that matches their host
  model
- optional wrapper-specific install/auth UX layers stay thin

### 5. No second tool substrate

There will not be:

- a separate "GUI tools" registry
- a separate "OAuth tools" schema set
- provider-specific fake tool registries
- billing-model hacks encoded into model names

If two surfaces need the same tool, they use the same canonical registry and
execution bridge.

## Target End State

When this roadmap is complete:

- all direct/OAuth providers with structured tool support use the same
  executable session path
- direct providers without tool support still use the same session family, but
  in text-only mode
- `codex-oauth` is no longer a special execution snowflake
- builtin tool registration is centralized in `@kilnai/core`
- MCP exports the same builtin tool registry, not a parallel list
- wrapper integration points consume Kiln tools through MCP or explicit host
  bridges, not by duplicating schemas
- dead provider-session branches and duplicated tool builders are deleted

## Implementation Phases

### Phase 1. Canonical builtin-tool registry

Objective:
Move builtin tool registration behind one reusable factory in `@kilnai/core`.

Required results:

- one helper builds the default builtin registry
- one helper projects that registry into tool definitions / capabilities
- `ExecutableProviderSession` stops hand-registering tools
- `DevToolsMcpServer` stops listing tools from a parallel schema-only source

Completion standard:

- builtin tools are defined once and projected everywhere else
- no session wiring duplicates the registry setup

### Phase 2. Direct-provider execution profile registry

Objective:
Declare direct-provider execution behavior in metadata instead of session
selection hacks.

Required results:

- provider execution mode is declared explicitly
- tool support is resolved by provider/model capability
- billing mode defaults are declared with the provider execution profile
- session selection in `session-registry.ts` becomes data-driven

Completion standard:

- adding a new direct provider does not require inventing a new session class
  by default
- the special-case `codex-oauth -> ExecutableProviderSession` branch is gone

### Phase 3. Unified direct-provider session

Objective:
Replace the `ProviderSession` / `ExecutableProviderSession` hard split with one
direct-provider session family and an execution-mode switch.

Required results:

- direct-provider adapter creation is centralized
- direct-provider sessions can run in:
  - `text-only`
  - `kiln-executable`
- structured conversation hydration is shared
- cost and file-change telemetry are emitted consistently

Completion standard:

- direct-provider behavior differences are configuration, not class sprawl
- direct-provider execution mode does not redefine Kiln session identity

### Phase 4. Argument normalization and failure hardening

Objective:
Make tool-call ingestion resilient without hiding bad provider behavior.

Required results:

- malformed JSON arguments fail clearly and predictably
- recoverable argument-shape issues are normalized only at the adapter boundary
- write/edit tool evidence survives the executor boundary
- regression tests cover direct-provider tool execution for at least:
  - `codex-oauth`
  - one OpenAI-compatible provider
  - `anthropic`

Completion standard:

- the write-tool reliability issue is fixed through shared execution-path
  hardening, not a one-off `codex-oauth` patch

### Phase 5. Wrapper/MCP convergence

Objective:
Make MCP the official shared-tool contract for wrappers and future ecosystem
    integrations.

Required results:

- wrapper-facing Kiln tool exposure uses the canonical MCP server
- wrapper-specific convenience layers remain optional and thin
- docs describe MCP as the shared contract and plugins as packaging or
  host-UX layers

Completion standard:

- there is one answer to "how does another runtime use Kiln tools?"
  and that answer is MCP first

### Phase 5.5. Skills, rules, workflows, and plugin packaging

Objective:
Define reusable packaging above the canonical tool surface without creating a
second execution substrate.

Required results:

- document how Kiln skills/rules/workflows reference canonical tools
- define which metadata belongs to packaging:
  - prompt/instruction payload
  - policy hints
  - allowed tool groups
  - workflow steps
  - host-specific installation metadata
- keep authorization, execution, telemetry, and audit in the canonical tool
  path
- make wrapper-specific plugin/install layers thin projections over MCP or the
  canonical tool registry

Completion standard:

- a skill/workflow can package tool usage, but cannot bypass Kiln execution
  policy or define a private tool executor

### Phase 6. Deletion and cleanup

Objective:
Remove the temporary duplication created on the way to convergence.

Required results:

- delete duplicated tool builders
- delete obsolete direct-provider branching
- delete stale comments claiming direct providers cannot execute Kiln tools if
  that is no longer true
- update handoff and roadmap docs to point to the new source of truth

Completion standard:

- no dead code remains from the old split

## Concrete Code Slices

### Slice A. Core builtin-tool canonicalization

Primary files:

- `packages/core/src/tools/domain/tool-registry.ts`
- `packages/core/src/tools/index.ts`
- `packages/core/src/tools/mcp/dev-tools-server.ts`
- new helper(s) under `packages/core/src/tools/`

Deliverables:

- default builtin-tool registry factory
- tool-definition projection helper
- capability projection helper

### Slice B. Provider execution metadata

Primary files:

- `packages/core/src/agents/model-capability-registry.ts`
- new provider execution metadata module under `packages/core/src/agents/`
- `packages/core/src/index.ts`

Deliverables:

- provider execution profile type
- direct-provider execution mode metadata
- tool-support lookup helpers used by CLI/runtime

### Slice C. CLI direct-provider session convergence

Primary files:

- `packages/cli/src/wrapper/provider-session.ts`
- `packages/cli/src/wrapper/executable-provider-session.ts`
- `packages/cli/src/wrapper/session-registry.ts`
- optional new shared direct-provider helper under `packages/cli/src/wrapper/`

Deliverables:

- unified direct-provider session flow
- data-driven provider creation
- no `codex-oauth`-only executable branch

### Slice D. Regression coverage

Primary files:

- `packages/cli/tests/wrapper/provider-session.test.ts`
- `packages/cli/tests/wrapper/executable-provider-session.test.ts`
- `packages/cli/tests/wrapper/session-registry.test.ts`
- new focused tests if needed

Deliverables:

- direct-provider tool execution tests
- text-only fallback tests
- capability-driven session selection tests

### Slice E. MCP productization

Primary files:

- `packages/core/src/tools/mcp/dev-tools-server.ts`
- `packages/cli/src/commands/mcp-config.ts`
- `docs/guides/tool-use.md`
- `docs/architecture/tool-execution.md`

Deliverables:

- wrapper-facing MCP docs that describe Kiln tools as the official external
  contract
- clear distinction between MCP transport, wrapper plugin packaging, and
  canonical execution policy
- regression coverage proving MCP exports the same builtin registry used by
  direct-provider execution

### Slice F. Skill/workflow packaging design

Primary files:

- `docs/architecture/tool-execution.md`
- `docs/guides/tool-use.md`
- future packaging docs under `docs/guides/` or `docs/architecture/`

Deliverables:

- accepted design for skills/rules/workflows as packaging over canonical tools
- explicit rule that packaging layers cannot own tool authorization or
  execution
- migration notes for wrapper-specific packaging where needed

## Verification

Minimum verification gate for each implementation PR:

- `bun run typecheck`
- focused Vitest coverage for direct-provider sessions and registry selection
- regression showing structured tool calls from a direct provider produce
  canonical `tool_result` / `file_changed` events when executable mode is on
- regression showing text-only mode remains intact for unsupported providers

Additional live validation after merge:

- `kiln gui` provider switching across direct/OAuth providers
- real write/edit flow through at least one OAuth/direct provider
- telemetry sanity in both subscription-backed and metered direct-provider
  flows

## Rules

- No new provider-specific session classes unless a provider has a genuinely
  different transport contract that cannot fit the direct-provider session
  family.
- No hardcoded model-string pricing hacks.
- No wrapper-native plugin work before MCP-first exposure is clear.
- No skill/rule/workflow packaging that bypasses the canonical tool executor.
- No compatibility comments that justify keeping dead branches after the new
  path lands.

## Exit Criteria

This roadmap is complete only when:

- direct-provider tool execution is capability-driven
- MCP is the documented shared contract for Kiln builtin tools
- the old direct-provider split is deleted
- the known `codex-oauth` write-tool reliability defect is closed through the
  shared path
- no duplicate builtin tool registry/setup remains in the codebase
