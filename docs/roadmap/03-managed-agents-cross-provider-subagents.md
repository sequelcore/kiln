# 03 - Managed Agents and Cross-Provider Subagents

## Status

Deferred until `01-memory-lattice-governed-memory.md` is complete or reaches a
stable memory projection and admission boundary.

## Goal

Make Kiln the control plane for invoking, supervising, and replaying managed
agents across providers and operator surfaces.

The feature is not a GUI-only subagent button. It is a runtime/session feature
where GUI, CLI, TUI, YAML apps, future IDE surfaces, and remote operator
surfaces all submit the same invocation request and project the same lifecycle
events.

## Required Capabilities

- Invoke agents across provider families: OAuth providers, wrapper providers,
  direct API providers, and local providers.
- Let each child invocation own its provider route, model, credential route,
  execution mode, working directory, timeout, tool authority, and permission
  profile.
- Represent parent-child lineage with stable `parentSessionId`,
  `parentTurnId`, `invocationId`, `agentId`, and child session or child turn
  references.
- Emit canonical lifecycle events for requested, admitted, started, progress,
  completed, failed, cancelled, and result handoff states.
- Support sequential pipelines, fan-out/fan-in parallelism, bounded
  concurrency, DAG-shaped workflows, cancellation, partial success, and
  provider-aware scheduling.
- Persist enough replay data for every operator surface to answer who invoked
  whom, under which policy, with which tools, what changed, what it cost, and
  what evidence was returned.

## Memory Dependency

Managed agents depend on governed memory.

Before implementation, Memory Lattice must define how memory is admitted into a
child invocation, which scopes are visible, how provenance records the
agent/session/turn that used or produced memory, and how write proposals are
reviewed before becoming durable memory.

Without that boundary, managed agents would fall back to oversized prompts,
provider-local memories, duplicate instruction files, and unauditable child
context.

## Non-Goals

- Do not implement managed agents as GUI-local state.
- Do not let a provider directly spawn another provider.
- Do not treat `kiln run --agent`, YAML app agent routing, or `--workers N` as
  the managed-agent substrate.
- Do not give child invocations implicit access to parent permissions,
  workspace write scope, memory scope, or provider credentials.
- Do not preserve provider-native subagent behavior as the source of truth.

## Architecture Boundary

The parent agent may request an invocation, but Kiln admits and executes it.

```text
operator surface or parent turn
  -> managed agent invocation request
  -> runtime admission and policy
  -> child invocation with explicit route/scope/authority
  -> canonical session events, artifacts, memory evidence, and result handoff
  -> shared projection to GUI / CLI / TUI / IDE / remote surfaces
```

Cross-provider invocation is valid only through this boundary. For example, a
`codex-oauth` parent may request a `claude-code` wrapper reviewer, but Kiln
must choose the route, permission profile, tool surface, and memory admission.

## Relation to Existing Capabilities

- `kiln run --agent <name>` selects one agent profile for one CLI run. It does
  not create a managed child invocation.
- `kiln run --workers N` runs isolated parallel workers for the same CLI task.
  It does not provide parent-child lineage, policy inheritance, cancellation,
  memory admission, or replayable lifecycle evidence.
- YAML app agents and teams define app routing and tenant behavior. They are
  not the operator workflow substrate by themselves.
- Existing `agent_invocation_*` session events are the beginning of the replay
  contract, not the complete invocation engine.

## Initial MVP

1. Define canonical agent registry and invocation request contracts.
2. Admit one read-only child invocation from GUI through runtime.
3. Execute the child in `plan` mode with explicit provider route and tool
   allowlist.
4. Emit lifecycle events and persist parent-child lineage.
5. Return a bounded result summary and resource links to the parent turn.
6. Render the invocation in GUI from the shared session projection.

Only after the single-child path is replayable should the feature add write
authority, parallel fan-out, DAG orchestration, and result aggregation.

## Verification Gates

- Invocation cannot bypass runtime policy.
- Child permissions, tool authority, provider route, execution mode, and memory
  scope are explicit and tested.
- Session reload preserves parent-child lineage and lifecycle evidence.
- GUI renders from canonical events only.
- CLI/TUI/IDE future consumers can project the same events without GUI-specific
  DTOs.
- Parallelism is bounded, observable, cancellable, and replayable.
