# Coordination Guide

Use Kiln coordination when work governance requires managed execution or when
the result requires independently attributable review.

## Operator Flow

1. Assess the work with `work_governance.assess`.
2. Create governed work items with stable ids, evidence, authority, and
   dependencies.
3. Create the goal run that owns those work items.
4. Call `managed_agent.orchestrate` with the same bounded work graph, one
   admission profile, task risk, whether independent review is required, and
   an admitted `agentProfile` or explicit `routeId` on each work item.
5. Inspect the returned coordination decision and terminal orchestration
   evidence. Record accepted child handoffs on their governed work items.

Each admitted child is also persisted into the parent session as canonical
`agent_invocation_*` events while it runs. CLI, GUI, TUI, and replay consumers
must use that lineage instead of reconstructing children from the final
`managed_agent.orchestrate` tool output.

Do not choose a worker count in the prompt. Runtime uses the resolved Kiln
parallel-worker limit. Do not add dependency-free duplicate work solely to
force parallelism.

## Example Work Graph

This read-only frontend handoff assigns identity and routing per child:

```json
{
  "profile": "foundation-readonly-plan",
  "taskRisk": "medium",
  "requiresIndependentReview": false,
  "workItems": [
    {
      "id": "visual-producer",
      "roleIntent": "frontend-visual-producer",
      "task": "Produce the visual and interaction specification.",
      "agentProfile": "frontend-producer",
      "dependencies": []
    },
    {
      "id": "implementation-advisor",
      "roleIntent": "frontend-implementation-advisor",
      "task": "Verify the specification against the repository and produce an implementation handoff.",
      "agentProfile": "frontend-implementation-advisor",
      "dependencies": ["visual-producer"]
    }
  ]
}
```

The request has one authority profile and working-directory mode. If the
analysis recommends implementation, create a separate governed write task;
do not mix read-only advisory and mutation authority in one graph.

## Work Graph Rules

Each work item supplied to `managed_agent.orchestrate` has:

- `id`: stable identity within the request;
- `roleIntent`: `scout`, `worker`, `advisor`, `verifier`, `integrator`, or a
  more specific bounded role;
- `task`: the child-local objective;
- `agentProfile`: the configured specialist identity whose route hint and
  authority profile are validated by Runtime;
- `routeId`: an explicit per-child route only when no configured specialist
  owns the task; it must agree with any selected agent profile;
- `dependencies`: ids that must finish before this item.

Runtime executes dependency-ready waves. A downstream child starts only after
all dependencies finish successfully and receives their bounded summaries and
resource URIs as governed inputs. A failed dependency blocks its dependents.
Independent items may use centralized bounded concurrency.

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
- Unknown profiles, profile/route contradictions, and ambiguous per-child route
  selection fail before execution.
- Independent review requires at least two distinct provider/model identities;
  aliases of one model are not independent evidence.
- A child start failure cancels and joins siblings already started in the same
  batch.
- Child terminal failures produce partial or failed typed evidence; they are
  not opinions and must not be summarized as successful work.

See [Coordination](../../architecture/coordination/coordination.md),
[Managed Agents](../../architecture/coordination/managed-agents.md), and
[Work Governance](../../architecture/core/work-governance.md).
