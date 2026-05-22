# 01 - Background And Parallel Agent Surface

## Status

Active. Started on 2026-05-21. Current implementation status:

- Slice 1 is complete: the managed-child lifecycle vocabulary, evidence
  contract, session ledger events, and read-only gateway projections are in
  place.
- Slice 2 is complete at the runtime/tool contract layer:
  `managed_agent.start`, `managed_agent.status`, `managed_agent.join`,
  `managed_agent.cancel`, and `managed_agent.list` exist as nonblocking
  lifecycle tools.
- Slice 3 is in progress: lease evidence, operator projection, lifecycle
  health/cleanup metadata, same-checkout write guards, and runtime-owned
  isolated-worktree lease acquire/release now exist. Sandbox, port,
  environment, credential-route, stale recovery, and cleanup daemon work remain
  open.
- Slices 4-8 are not started.

Recent implementation commits:

- `fb6481ba` - lifecycle evidence contract.
- `fb8c4338` - nonblocking runtime registry.
- `e1a7d528` - nonblocking lifecycle tools.
- `7c17425f` - governed cancellation.
- `27e6a01d` - resource lease snapshot.
- `20302895` - operator resource lease projection.
- `0d8a8b7c` - admitted resource lease preservation.
- `f303f493` - same-checkout parallel write guard.
- `4526ba8a` - resource lease health, cleanup, and diagnostic evidence.

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

Kiln now has the first runtime-owned managed-child lifecycle foundation:

- `managed_agent.start/status/join/cancel/list` provide nonblocking child
  lifecycle control through runtime-managed invocation records.
- `managed_agent.invoke` remains the governed foreground convenience path, but
  it now participates in the same lifecycle evidence model.
- Child lifecycle evidence records parent lineage, route identity, authority,
  context, transcript/result handoff, usage unknowns, resource lease evidence,
  and terminal state through the session ledger.
- Gateway/operator projections expose read-only lifecycle and lease evidence
  without creating a surface-local lifecycle store.
- Resource leases now include `leaseId`, `createdAt`, `healthStatus`,
  `cleanupStatus`, working directory path/mode, resource URIs, and diagnostic
  URIs. Incomplete lifecycle leases fail closed instead of being merged with
  admission snapshots.
- Runtime rejects conflicting same-checkout write-capable children unless the
  admitted approved-write scopes are explicit and disjoint.
- Runtime has an isolated-worktree lease boundary for managed invocations:
  `isolated-worktree` children require a runtime worktree lease manager,
  acquire before adapter execution, and emit terminal lease evidence after
  release. Runtime reserves the invocation before asynchronous acquisition,
  rejects same-path isolated worktree collisions, validates manager output
  against the admitted lease, and confines git-backed paths to an explicit
  worktree root after canonical path normalization. Git-backed release only
  reports cleanup `completed` after the worktree is clean and
  `git worktree remove` succeeds; dirty or failed release is preserved as
  `cleanupStatus: failed` and `healthStatus: leaked`.
- `kiln run --workers` is still transitional CLI fan-out behavior, not yet
  rebased onto the managed-child lifecycle.

The missing product primitive is now narrower: lease-backed execution must
expand from isolated worktrees into sandbox, artifact directory, environment
binding, credential route, and dev-server port leases, then project that
lifecycle equivalently through CLI, TUI, GUI, native, gateway, and resource
plane surfaces.

## Slices

### Slice 1 - Lifecycle Contract And Event Model

Status: complete in code. Keep open only for architecture-doc promotion.

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

Status: complete in code. Keep open only for cross-surface hardening and
architecture-doc promotion.

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

Status: in progress.

Completed:

- Resource lease evidence is explicit in core lifecycle/capability contracts.
- Lease snapshots are preserved through runtime start/join/session evidence.
- Operator event details and read-only cockpit projections show lease identity,
  creation time, health, cleanup status, resources, and diagnostics.
- Terminal lifecycle lease evidence takes precedence over admission snapshot
  evidence for operator projections.
- Incomplete lifecycle lease evidence fails closed; it is not merged with
  snapshot fallbacks.
- Runtime blocks conflicting same-checkout parallel write children and allows
  only explicit disjoint approved-write scopes.
- Runtime owns an isolated-worktree lease manager port and a git-backed
  implementation that acquires before adapter execution and releases on
  terminal adapter completion/cancellation.
- Runtime rejects same-path isolated worktree collisions, refuses unmanaged
  pre-existing git worktree paths, confines git worktrees to a configured root,
  rejects path aliases/dot-segment escapes, and rejects lease-manager output
  that changes admitted lease identity, worktree path, mode, or
  non-invocation resource URIs.
- Runtime keeps `join` valid while isolated-worktree acquisition is in flight,
  prevents pre-launch cancellation from invoking the adapter, and records
  compensating cleanup evidence when acquisition fails after external side
  effects.
- Terminal lifecycle evidence can carry release outcomes without mutating the
  admitted capability snapshot.

Remaining:

- Wire product/runtime configuration to choose the git-backed worktree lease
  manager outside tests and harnesses.
- Provision real sandbox, artifact-directory, environment, credential-route,
  and port leases.
- Implement broader lease cleanup/recovery execution and stale sweeps beyond
  per-invocation worktree release.
- Add stale lease recovery and dirty-worktree preservation policy.

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
