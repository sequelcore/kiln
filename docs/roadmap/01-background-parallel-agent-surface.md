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
- Slice 3 is complete in code: lease evidence, operator projection, lifecycle
  health/cleanup metadata, same-checkout write guards, runtime-owned
  isolated-worktree lease acquire/release, runtime-owned filesystem
  artifact-directory lease acquire/release, runtime-owned dev-server port
  lease acquire/release, runtime-owned environment binding lease
  acquire/release, runtime-owned credential-route lease acquire/release,
  runtime-owned policy-backed sandbox lease acquire/release, and in-memory
  stale lease recovery now exist. Persistent restart recovery now exists;
  runtime-owned cleanup daemon scheduling now exists; dirty worktree
  preservation now emits runtime-owned review-required evidence.
- Slice 4 is started. Slice 4A is complete in code: a typed fan-out
  orchestration request/admission/result contract now exists, and
  `kiln run --workers` consumes it before launching isolated workers. Slice 4B
  is complete in code: core now exposes fail-closed request adapters for
  decomposition, review swarm, route comparison, and background job modes.
  Slice 4C is complete in code: `kiln run --workers` is hard-cut onto the
  managed invocation lifecycle and now starts, observes, and joins children
  through the runtime child registry instead of recursive CLI fan-out. Slice 4D
  is complete in code: typed orchestration requests can now materialize
  governed child work items with expected evidence, isolation, merge policy, and
  Slice 6 adoption-gate metadata.
- Slices 5-8 are not started.

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
- Product configuration can now select git-backed isolated worktree leases:
  `managedAgents.worktreeLease` defines the lease root and route projection
  admits `workingDirectory: isolated-worktree`. The shared managed invocation
  tool options carry the configured runtime service across CLI, TUI, GUI, and
  attached runtime surfaces, and each child receives an invocation-scoped
  worktree path before admission.
- Runtime now has a filesystem artifact-directory lease manager boundary for
  managed invocations. It creates invocation-scoped artifact directories,
  refuses to adopt pre-existing unmanaged directories, appends
  `kiln://artifacts/{invocationId}/artifact-directory` evidence, removes empty
  directories on release, preserves non-empty directories as explicit leaked
  terminal evidence with `artifact-directory-preserved` diagnostics, and keeps
  leaked/failed cleanup evidence sticky across later successful lease cleanup
  stages.
- Runtime now exposes an in-memory stale recovery sweep for managed
  invocations. The sweep marks aged active children `stale`, aborts the adapter
  signal, resolves the existing join handle with stale lifecycle evidence,
  releases already-acquired worktree, artifact-directory, and dev-server port
  lease stages even while a later acquisition stage is still pending, releases
  later acquired stages when they return, preserves dirty worktrees as
  leaked/failed cleanup evidence, and suppresses late adapter success or
  failure so stale recovery remains the terminal lifecycle record.
- Runtime now has a dev-server port lease manager boundary for managed
  invocations. It allocates ports from an explicit runtime pool, refuses ports
  that are already bound, records invocation-scoped
  `kiln://artifacts/{invocationId}/dev-server-port/{port}` evidence, releases
  allocations through terminal cleanup, reserves ports while availability
  probes are in flight, surfaces probe setup failures separately from capacity
  exhaustion, and keeps port cleanup evidence in the same terminal
  `resourceLease` record as worktree and artifact leases.
- Runtime now has an environment binding lease manager boundary for managed
  invocations. It binds static values and dev-server-port-derived values after
  earlier runtime leases, validates portable environment names and
  case-insensitive collisions, forwards bindings through the runtime adapter
  contract into CLI harness sessions, records only binding-name resource and
  release URIs, and releases environment evidence before the dev-server port
  stage.
- Runtime now has a credential-route lease manager boundary for managed
  invocations. Runtime-selected credential routes acquire after environment
  bindings and before adapter execution, record invocation-scoped route-id
  resource evidence without credential values, validate custom manager output
  against the invocation artifact namespace, release before earlier lease
  stages, and remain allowlist-bound through the shared CLI/TUI/GUI/run
  managed invocation service key. Runtime-selected credential routes fail
  closed when the runtime service lacks a credential-route lease manager.
  Credentialless invocations do not acquire or release this lease.
- Runtime now has a policy-backed sandbox lease manager boundary for managed
  invocations. `sandbox` working-directory children require a sandbox lease
  manager, acquire `sandbox-policy` evidence before artifact/port/environment
  and credential-route stages, release after later stages, validate custom
  manager output against the invocation artifact namespace, and keep sandbox
  write children in same-checkout conflict detection because this is Kiln tool
  policy enforcement rather than OS/container isolation. CLI route projection
  admits `workingDirectory: sandbox` only for direct-provider routes where
  Kiln owns builtin tool sandbox enforcement; harness sandbox routes remain
  unavailable until live proof exists.
- Runtime now has a durable managed-invocation recovery store boundary and a
  filesystem-backed JSON manifest implementation. Runtime writes recovery
  checkpoints after each acquired lease stage, deletes them after successful
  terminal cleanup, preserves leaked cleanup evidence when release fails, and
  exposes one-shot restart recovery that reconstructs abandoned invocations as
  `recovered`, releases acquired lease stages through the existing reverse-order
  cleanup path, and projects `stale`/`recovered` terminal records through
  managed invocation session events.
- Runtime now has a managed-invocation recovery daemon boundary. The daemon
  schedules immediate startup persisted recovery and recurring stale in-memory
  recovery through the same service methods, uses a `setTimeout` chain instead
  of overlapping intervals, coalesces concurrent sweeps, retains the latest
  scheduled failure for operator inspection, and keeps future sweeps scheduled.
- Runtime now has a dirty-worktree review policy for isolated worktree release
  failures. Dirty worktrees stay preserved for manual review, terminal cleanup
  records runtime-owned `worktreeReview` evidence with `required` status and a
  `dirty-worktree-preserved` reason, manager-injected review evidence is
  rejected, persistent recovery preserves the review marker, and gateway
  cockpit/operator event surfaces project the typed evidence without parsing
  diagnostic URIs. This is review-required evidence only; automatic adoption or
  parent checkout mutation remains out of scope.
- `kiln run --workers` now enters through a typed `fan-out` orchestration
  request with explicit child expected evidence, isolation policy, merge
  policy, configured worker-limit admission, managed lifecycle route/workspace
  admission, and terminal orchestration result evidence. CLI worker fan-out no
  longer recurses through `runCommand`; production execution requires a
  configured isolated-worktree `foundation-apply-approved-writes` managed route
  and a runtime invocation service, then starts children through
  `RuntimeManagedAgentInvocationService.start`, verifies running status, joins
  terminal records through `join`, and maps lifecycle records into orchestration
  result evidence.

The missing product primitive is now narrower: lease-backed execution has
explicit in-memory stale recovery, persistent restart recovery, and
runtime-owned daemonized cleanup scheduling plus typed dirty-worktree
review-required evidence. Full handoff/adoption workflows remain later
background-agent surface work; Slice 3 lifecycle evidence now projects
equivalently through CLI, TUI, GUI, native, gateway, and resource plane
surfaces.

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

Status: complete in code. Keep open only for architecture-document promotion
and later Slice 6 adoption workflow integration.

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
- Runtime owns an artifact-directory lease manager port and filesystem-backed
  implementation that acquires invocation-scoped directories before adapter
  execution, releases empty directories as terminal lease evidence, and
  preserves non-empty directories as leaked terminal evidence.
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
  admitted capability snapshot, and leaked cleanup state remains sticky when
  later cleanup stages succeed.
- Product/runtime route configuration can choose the git-backed worktree lease
  manager outside test harnesses through `managedAgents.worktreeLease` and
  `workingDirectory: isolated-worktree`.
- Runtime can sweep stale in-memory invocations, abort adapter execution,
  immediately release already-acquired lease stages, release later acquired
  stages when an in-flight manager returns, preserve dirty worktrees as
  leaked/failed evidence, keep `join` valid, and suppress late adapter output
  after stale recovery.
- Runtime owns a dev-server port lease manager port and an in-memory
  implementation that allocates from explicit configured ports, rejects
  already-bound ports, prevents concurrent and in-flight reuse, releases
  allocations on terminal cleanup, records port resource/release evidence, and
  reports bind probe misconfiguration distinctly from pool exhaustion.
- Runtime owns an environment binding lease manager port and implementation
  that binds static values or the previously leased dev-server port into child
  adapter environment, validates portable names and case collisions, records
  redacted binding-name resource/release evidence, and forwards bindings to CLI
  harness sessions without placing values in lifecycle URIs.
- Runtime owns a credential-route lease manager port and implementation that
  records admitted runtime-selected route-id resource/release evidence, rejects
  non-invocation resource URIs from custom managers, enforces configured route
  allowlists, fails closed when runtime-selected routes lack a manager, skips
  credentialless invocations, and is wired into shared managed invocation route
  options without a worktree-lease prerequisite.
- Runtime owns a policy-backed sandbox lease manager port and implementation
  that records `sandbox-policy` resource/release evidence, rejects
  non-invocation resource and diagnostic URIs from custom managers, fails
  closed when sandbox-mode children lack a manager, keeps sandbox write
  invocations in same-checkout conflict detection, and is wired into shared
  direct-provider managed invocation route options and fallback runtime-tool
  services. Harness sandbox routes fail closed until equivalent sandbox
  enforcement proof exists.
- Runtime owns a persistent recovery-store port and filesystem-backed manifest
  implementation. It writes validated recovery checkpoints after lease-stage
  acquisition, reconstructs abandoned invocations after restart as `recovered`,
  reuses the same terminal lease cleanup path, deletes manifests after proven
  cleanup, preserves manifests with leaked evidence when cleanup fails, rejects
  malformed checkpoints instead of adopting them, and maps `stale`/`recovered`
  terminal records into canonical session failure events.
- Runtime owns a recovery daemon boundary that schedules immediate one-shot
  persisted recovery followed by recurring stale cleanup sweeps through the
  same runtime service methods, uses non-overlapping `setTimeout` scheduling,
  coalesces in-flight sweeps, and records the latest scheduled sweep failure.
- Runtime owns dirty-worktree review-required evidence for preserved isolated
  worktrees. Dirty release failures keep the worktree intact, append
  invocation-scoped review resource/diagnostic URIs, reject manager-supplied
  review markers, preserve review evidence through restart recovery, and expose
  the typed review state through gateway cockpit projection and operator event
  presentation.

Remaining:

- None for the Slice 3 runtime lifecycle scope. Parent adoption workflows
  continue in Slice 6.

Deliverables:

- Introduce explicit child resource leases for worktree, sandbox, artifact
  directory, environment variables, dev-server ports, and credential routes.
- Require worktree or sandbox leases for write-capable parallel children.
- Record lease creation, health, cleanup, and leak diagnostics.
- Add persistent stale lease recovery and dirty-worktree review-required
  evidence.
- Reject same-checkout parallel writes unless an explicit approved write scope
  proves no overlap.

### Slice 4 - Parallel Orchestration Modes

Status: code-complete for Slice 4A, Slice 4B, Slice 4C, and Slice 4D. The
remaining item below is a deferred budget-plane integration follow-up.

Completed:

- Core now defines typed orchestration modes for `fan-out`, `decomposition`,
  `review-swarm`, `route-comparison`, and `background-job` without introducing
  provider-native worker vocabulary into the managed invocation contract.
- Core now validates orchestration requests with explicit parent lineage,
  child requests, expected evidence, isolation policy, merge/adoption policy,
  and terminal result evidence.
- Core now exposes request adapters for `decomposition`, `review-swarm`,
  `route-comparison`, and `background-job`, with per-mode expected evidence,
  merge/adoption policy, isolated worktree requirements, and child-count
  invariants enforced at the `define*` boundary.
- Fan-out admission now fails closed against configured maximum child count,
  route health availability, budget-aware usage availability, workspace
  availability, and high task-risk signals.
- `kiln run --workers` now builds a typed `fan-out` orchestration request,
  enforces the configured `parallelWorkers` limit before launching children,
  records each child result in orchestration result evidence, and reports the
  orchestration mode/status in CLI output.
- Runtime now owns a fan-out lifecycle helper that selects a lease-backed
  isolated worktree managed route, constructs invocation-scoped child requests,
  starts children through `RuntimeManagedAgentInvocationService.start`,
  observes lifecycle status, joins terminal records, and returns normalized
  orchestration evidence.
- `kiln run --workers` now fails closed when no managed lifecycle route/service
  is available or route selection is ambiguous, and no longer preserves the
  legacy recursive child `runCommand` execution path. Route/workspace admission
  now reflects actual configured managed lifecycle routes and task risk is
  derived from the shared complexity scorer before child launch.
- Core now materializes typed managed orchestration requests into governed child
  work items. Each materialized work item carries child identity, role intent,
  per-mode expected evidence, isolation policy, merge policy, and Slice 6
  adoption-gate metadata. Adoption-required modes add
  `managed-orchestration:adoption-gate` to expected evidence so closeout blocks
  until a structured Slice 6 adoption resolution is recorded on the work item;
  child-provided evidence cannot self-satisfy the gate.
- `kiln run --workers` now fails closed for budget-aware routing when no live
  usage source is available or every eligible lifecycle route is over budget.
- `kiln run --workers` now installs parallel-worker `SIGINT`/`SIGTERM`
  handlers before child launch and routes normal completion, failure, and
  interruption through one transcript finalization and worktree cleanup path.

Remaining:

- Replace the CLI budget usage hook with live budget admission from the
  runtime/session path when that budget plane is available.

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
