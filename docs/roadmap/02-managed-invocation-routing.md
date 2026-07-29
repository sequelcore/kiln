# 02 - Managed Invocation Routing

Status: Active delivery track
Execution: Slices 1 and 2 complete; Slice 3 requires explicit operator authorization.
Created: 2026-07-23

## Objective

Own managed-job admission, route/account selection, execution lifecycle, result,
cancellation, timeout, replay, and economic evidence independently of any
harness presentation or gateway process.

## Ownership

Runtime owns job state and terminal truth. Route policy selects an eligible
configured route. Account leases bind one sanitized account reference to one job.
Harness adapters only submit and project canonical state.

## Scope

- Provider-neutral usage snapshots and account eligibility.
- Per-job leases, concurrency, reservations, affinity, and explicit rebind policy.
- Lifecycle/result/replay evidence including selection reason.
- Cost/quota-class route explanation after lease correctness is proven.
- Deterministic and bounded live verification.

## Non-Goals

- No ambient credential pooling or hidden round-robin.
- No quota evasion, subscription rotation, or retry across accounts after provider commitment.
- No harness-local job store or route policy.
- No Model Gateway service lifecycle or native picker projection.

## Ordered Slices

### Slice 0 - Usage And Account Inspection

Status: Complete.

Immutable sanitized usage snapshots, Codex usage refresh/removal, account-aware
ingress selection, and MCP inspection are implemented. Additional provider fields
remain evidence-driven rather than speculative.

### Slice 1 - Per-Job Account Leases

Status: Complete in issue #28.

Managed jobs acquire one durable Runtime-owned account lease after admission and
before provider dispatch. Selected credentials are revision-fenced and bypass
pooled selection. Canonical V4 job, invocation, replay, Gateway, CLI, GUI, TUI,
Native, MCP, and SDK evidence carries the sanitized account lifecycle. Capacity
follows settlement: timeout and cancellation remain settlement-pending, restart
never frees unknown external work, and release failure or unmatchable recovery
continues consuming capacity.

### Slice 2 - Deterministic Multi-Account Proof

Status: Complete in issue #30.

Two explicitly configured synthetic accounts and one injected usage clock prove
the three usage states, deterministic selection, atomic capacity, reservations,
durable affinity and fenced rebind, timeout/cancellation settlement, two-account
recovery, revision-stable capacity, and absence of cross-account retry.
Successful release and affinity CAS are one authority transaction, with
`won`, `already-matched`, or `conflict` retained in V4 status, result, history,
replay, and operator projections.

The proof is portable and network-free. It establishes managed-path guarantees
only and does not restore or mutate operator Codex configuration.

### Slice 3 - Bounded Live Probe

Status: Blocked on operator machine and credentials.

Run one explicitly authorized probe that records route, account reference,
selection reason, usage freshness, lifecycle, result, cancellation/timeout as
applicable, and replay without exposing credentials or raw provider payloads.

### Slice 4 - Economic Route Policy

Status: Queued behind live lease proof.

Represent quota class, subscription class, metered-cost class, and comparable
cost separately. Explain why an eligible job used Codex or OpenCode. Add explicit
reservations and ceilings without claiming free execution without evidence.

### Slice 5 - Cross-Path Account Authority Convergence

Status: Queued after the managed-path proof.

Unify capacity and affinity authority when Model Gateway ingress and managed
jobs target the same configured accounts. Replace the ingress
`LocalModelGatewayStore` lease deletion and last-writer-wins affinity behavior
with the same stable-capacity, settlement-conservative, fenced semantics,
without importing gateway process recovery into managed invocation.

## Promotion Gates

- Legacy pooled adapters retain the exactly-one guard while they remain real
  consumers.
- Every job records one explicit account selection and releases it correctly.
- Missing or stale usage is `unknown`, never fabricated.
- No provider commitment triggers hidden account retry.
- Focused tests, workspace typecheck, package builds, and teardown are reliable.

## Verification

Focused Core/Runtime/CLI tests, injected-clock integration tests, clean
output-tree typecheck/build, full affected-package tests, `git diff --check`,
and independent review. The authorized bounded live probe remains Slice 3 and
is not evidence for Slice 2.

## Completion Criteria

Managed jobs have deterministic, explainable, replayable route and account
selection with correct leases in every terminal state and no harness-specific
policy owner.
