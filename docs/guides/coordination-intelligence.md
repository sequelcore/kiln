# Coordination Guide

Use Kiln coordination when work governance requires managed execution or when
the result requires independently attributable review.

## Operator Flow

1. Assess the work with `work_governance.assess`.
2. Create governed work items with stable ids, evidence, authority, and
   dependencies.
3. Create the goal run that owns those work items.
4. Call `managed_agent.orchestrate` with the same bounded work graph, one
   admission profile, task risk, whether independent review is required, and a
   route id when more than one eligible route exists.
5. Inspect the returned coordination decision and terminal orchestration
   evidence. Record accepted child handoffs on their governed work items.

Each admitted child is also persisted into the parent session as canonical
`agent_invocation_*` events while it runs. CLI, GUI, TUI, and replay consumers
must use that lineage instead of reconstructing children from the final
`managed_agent.orchestrate` tool output.

Do not choose a worker count in the prompt. Runtime uses the resolved Kiln
parallel-worker limit. Do not add dependency-free duplicate work solely to
force parallelism.

## Work Graph Rules

Each work item supplied to `managed_agent.orchestrate` has:

- `id`: stable identity within the request;
- `roleIntent`: `scout`, `worker`, `advisor`, `verifier`, `integrator`, or a
  more specific bounded role;
- `task`: the child-local objective;
- `dependencies`: ids that must finish before this item.

Any dependency makes the current topology sequential because the managed
orchestration request deliberately does not pretend to support a distributed
DAG scheduler. Independent items may use centralized bounded concurrency.

Choose authority through the admission profile and configured route, not by
describing permissions in the prompt. Non-mutating review and decomposition may
run in `read-only` or policy-backed `sandbox` routes. Write-capable child work
uses a leased `isolated-worktree`; shared `workspace-write` is denied.

## Advisor Use

Advisor is a role, not a separate execution subsystem. Use it when a costly or
specialized route can materially improve a decision, and require a bounded
handoff. The parent remains the integrator and retains responsibility for
verification and adoption.

## Failure Semantics

- Missing route, budget, workspace, or review capacity is a denied decision.
- Invalid or cyclic graphs fail before any child starts.
- Ambiguous route selection fails before execution.
- A child start failure cancels and joins siblings already started in the same
  batch.
- Child terminal failures produce partial or failed typed evidence; they are
  not opinions and must not be summarized as successful work.

See [Coordination](../architecture/coordination.md),
[Managed Agents](../architecture/managed-agents.md), and
[Work Governance](../architecture/work-governance.md).
