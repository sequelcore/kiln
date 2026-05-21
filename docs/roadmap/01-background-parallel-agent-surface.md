# 01 - Background And Parallel Agent Surface

## Status

Active. Started on 2026-05-21.

Architecture sources:

- `docs/architecture/managed-agents.md`
- `docs/architecture/work-governance.md`
- `docs/architecture/operator-surfaces.md`
- `docs/architecture/agent-context.md`
- `docs/architecture/context-resource-plane.md`
- `docs/architecture/session-model.md`
- `docs/research/15-background-parallel-agent-surface.md`

## Objective

Promote background and parallel agents into a first-class Kiln control-plane
primitive. The target is not "more workers" or longer timeouts; it is a
governed child-agent lifecycle with explicit identity, admitted context,
bounded authority, isolated resources, replayable evidence, and equivalent
operator control across CLI, TUI, GUI, native, gateway, and runtime paths.

This is the primary long-term roadmap track because it is central to Kiln's
thesis: Kiln is a biocybernetic control plane for autonomous agent sessions.
Parallel child work must behave like regulated subsystems in one nervous
system, not like hidden processes outside the body. The parent can allocate
attention, authority, and resources, but every child must expose state,
heartbeat, output evidence, and recovery paths back through the same runtime
ledger.

## Design Principles

- Runtime owns child-agent lifecycle semantics; surfaces only project and
  control that lifecycle.
- Isolation is the default for write-capable children. Worktree, sandbox,
  artifact, environment, and port leases are explicit resources, not ambient
  side effects.
- Parent turns do not lend ambient authority. Child authority is admitted from
  requested profile, route, context mode, resource URIs, credential route,
  workspace lease, and work-governance phase.
- Parallelism is typed. Duplicate candidates, decomposed work, review swarms,
  route comparisons, and long-running background jobs are different modes with
  different evidence contracts.
- A child status of `completed` is not enough. Governed work completes only
  when the required handoff evidence is materialized through the owning phase,
  work item, artifact, or review contract.
- Fail closed at every boundary. Unknown agent profiles, unknown skills,
  unsupported fork context, missing route capability, missing isolation, stale
  heartbeat, and incomplete handoff must become explicit recovery states.
- No parallel truth. CLI, TUI, GUI, native, gateway, SDK/widget, and MCP views
  consume one runtime lifecycle projection.

## Scope

- Managed-agent lifecycle contract:
  - `managed_agent.start`
  - `managed_agent.status`
  - `managed_agent.join`
  - `managed_agent.cancel`
  - `managed_agent.list`
- Runtime child registry with invocation id, parent lineage, child session,
  child turn, route identity, agent profile, admitted skills, context mode,
  authority, workspace lease, heartbeat, transcript pointer, usage, terminal
  state, and handoff resources.
- Workspace isolation model:
  - read-only child with no write lease
  - write child with isolated worktree lease
  - sandbox child with bounded command/tool authority
  - remote/cloud child with equivalent lease and transcript evidence
  - artifact and resource namespaces per child
  - port/env allocation for parallel app/test processes
- Nonblocking background execution with explicit status, cancellation,
  timeout, late-output suppression, cleanup, and replay.
- Parallel orchestration modes:
  - fan-out duplicate candidates for comparison
  - task decomposition over independent work items
  - review/security/performance swarms
  - provider/model/route comparison
  - long-running background job with later join
- Cross-surface operator projection:
  - CLI status and join controls
  - TUI/GUI/native cockpit lists, child details, cancel controls, transcript
    links, diff/review links, and attention markers
  - gateway event stream and read-only cockpit contracts
- Handoff and merge workflow:
  - substantive child handoff schema
  - phase completion evidence
  - dirty worktree/diff summary
  - conflict and merge-readiness state
  - review gate before parent adoption
- Live cross-surface hardening for timeout, cancel, unavailable route,
  failed child, stale heartbeat, partial success, dirty workspace, conflicting
  children, and parent interruption.

## Non-Goals

- No hidden background work after a parent turn completes.
- No parallel write children in the same mutable checkout by default.
- No child context fork without explicit policy admission and replay evidence.
- No agent swarm that bypasses work governance, profile admission, or route
  admission.
- No surface-local lifecycle store.
- No benchmark, product, or public-readiness claim until live cross-surface
  evidence proves equivalence.
- No migration shim that preserves a legacy worker path as a second control
  plane. Existing `kiln run --workers` behavior must become an adapter over
  the runtime lifecycle or remain explicitly documented as transitional.

## Current State

Kiln already has two partial primitives:

- `kiln run --workers` starts isolated CLI workers on the same task and now
  routes session execution and verification through the prepared isolated
  working directory.
- `managed_agent.invoke` is a governed foreground child call. It blocks the
  parent until completion, failure, cancellation, or timeout and is appropriate
  for phase-gated delegation.

Those are useful but incomplete. The missing product primitive is the
nonblocking managed child lifecycle that can be observed, cancelled, joined,
and replayed across surfaces.

## Slices

### Slice 1 - Lifecycle Contract And Event Model

Status: next.

Deliverables:

- Add a runtime-owned lifecycle state model for managed child invocations.
- Define terminal and nonterminal states: `pending`, `starting`, `running`,
  `waiting_for_approval`, `completed`, `failed`, `timed_out`, `cancelled`,
  `stale`, and `recovered`.
- Define required lifecycle evidence: parent session, parent turn, invocation
  id, route id, provider, model, agent profile, context mode, authority,
  resource lease, transcript resource, heartbeat, result summary, diagnostics,
  usage, and handoff resources.
- Emit lifecycle events through the existing session ledger.
- Project read-only lifecycle summaries through gateway contracts.
- Preserve existing `managed_agent.invoke` behavior while making it write the
  new lifecycle evidence.

Expected files:

- `packages/core/src/agents/managed-invocation/*`
- `packages/runtime/src/agents/managed-invocation/*`
- `packages/runtime/src/session/*`
- `packages/gateway-contracts/src/*`
- `packages/runtime/tests/managed-agent/*`
- `packages/gateway-contracts/tests/*`
- `docs/architecture/managed-agents.md`
- this roadmap

### Slice 2 - Nonblocking Managed-Agent Tools

Status: pending.

Deliverables:

- Add `managed_agent.start`, `managed_agent.status`, `managed_agent.join`,
  `managed_agent.cancel`, and `managed_agent.list`.
- Make `start` return immediately with an invocation id after admission.
- Make `join` the only blocking wait primitive.
- Make `cancel` stop provider calls, suppress late child output, release
  leases, and record cancellation evidence.
- Keep `invoke` as a foreground convenience implemented through start/join
  semantics, not as a separate lifecycle.

### Slice 3 - Workspace And Sandbox Leases

Status: pending.

Deliverables:

- Introduce explicit child resource leases for worktree, sandbox, artifact
  directory, environment variables, dev-server ports, and credential routes.
- Require worktree or sandbox leases for write-capable parallel children.
- Record lease creation, health, cleanup, and leak diagnostics.
- Add stale lease recovery and dirty-worktree preservation policy.
- Reject same-checkout parallel writes unless an explicit approved write scope
  proves no overlap.

### Slice 4 - Parallel Orchestration Modes

Status: pending.

Deliverables:

- Model fan-out, decomposition, review swarm, route comparison, and background
  job modes as typed orchestration requests.
- Attach expected evidence and merge/adoption rules per mode.
- Rebase `kiln run --workers` onto the runtime lifecycle so CLI fan-out is not
  a parallel truth.
- Add K-worker admission limits from config, route health, budget, workspace
  availability, and task risk.

### Slice 5 - Cross-Surface Cockpit Projection

Status: pending.

Deliverables:

- CLI: list, status, join, cancel, transcript, and worktree/diff summary.
- TUI/GUI/native: active child list, attention state, lifecycle timeline,
  cancel controls, transcript/resource links, handoff evidence, and dirty
  workspace state.
- Gateway contracts: stable read-only projections for child lifecycle and
  cockpit targets.
- MCP/resource plane: child transcript and artifact resources exposed as
  paginated read-only resources.

### Slice 6 - Handoff, Review, And Adoption

Status: pending.

Deliverables:

- Require substantive handoff evidence before a child can complete a governed
  phase.
- Route code-writing children through diff, verification, review, and adoption
  gates.
- Record skipped, failed, unavailable, cancelled, and timed-out children as
  missing evidence, not as silent absence.
- Add merge-readiness and conflict states for worktree-backed children.
- Integrate with feedback/repair work items only after lifecycle and evidence
  are stable.

### Slice 7 - Live Cross-Surface Hardening

Status: pending.

Deliverables:

- Live tests for direct provider, Codex harness, OpenCode harness, and
  subscription-backed routes.
- Scenarios: timeout cancellation, operator cancellation, stale heartbeat,
  route unavailable, partial success, failed child, dirty worktree, conflicting
  worktrees, parent interruption, and late output suppression.
- Surface parity tests for CLI, TUI, GUI, native projection, gateway stream,
  and resource replay.

### Slice 8 - Remote And Cloud Execution

Status: deferred until local lifecycle is stable.

Deliverables:

- Remote sandbox/cloud child execution behind the same lifecycle, lease,
  transcript, and handoff contracts.
- Provider-specific limitations projected as route capabilities rather than
  special-case surface behavior.
- No cloud-only semantics that cannot be represented locally.

## Promotion Gates

Background/parallel agents remain early public hardening until all are true:

- `managed_agent.start/status/join/cancel/list` are stable and tested.
- `managed_agent.invoke` uses the same lifecycle internally.
- Worktree/sandbox/resource leases are explicit and leak-checked.
- Write-capable parallel children cannot mutate the same checkout by default.
- CLI, TUI, GUI, native, gateway, and resource-plane projections show
  equivalent lifecycle evidence.
- Timeout and cancellation actually stop child work and suppress late output.
- Handoff evidence is substantive enough for governed phase completion.
- Live route matrix passes for direct-provider and harness-backed children.
- Review evidence confirms no surface-local lifecycle store or legacy worker
  control plane remains.

## Verification

Initial slices:

```bash
bun run --filter @kilnai/core test
bun run --filter @kilnai/runtime test
bun run --filter @kilnai/gateway-contracts test
bun run typecheck
```

Live hardening:

```bash
bun run test:managed-agents:live
bun run --cwd packages/cli test -- tests/commands/run-parallel.test.ts
bun run --cwd packages/gui test:e2e
```

Each implementation slice must add focused unit tests first, then the smallest
cross-surface integration test that proves the lifecycle projection did not
fork into a surface-local behavior.
