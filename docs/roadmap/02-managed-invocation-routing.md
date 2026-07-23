# 02 - Managed Invocation Routing

Status: Active delivery track
Execution: Ready - complete per-job account leases and reliable lifecycle evidence.
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

Status: Ready.

Acquire the lease when the managed job starts, not when an adapter factory is
constructed. Persist selection reason and sanitized account reference. Retain a
lease after timeout until execution settles; release on success, failure,
cancellation, and cleanup. Preserve affinity and allow rebind only by explicit
virtual-model policy.

### Slice 2 - Deterministic Multi-Account Proof

Status: Queued behind Slice 1.

Use two configured synthetic accounts and a fake clock to prove exhaustion,
reset, concurrency, reserved slots, affinity, cancellation, timeout settlement,
and no cross-account retry. Restore Codex managed routes only after this passes.

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

## Promotion Gates

- Legacy pooled adapters retain the exactly-one guard until replaced.
- Every job records one explicit account selection and releases it correctly.
- Missing or stale usage is `unknown`, never fabricated.
- No provider commitment triggers hidden account retry.
- Focused tests, workspace typecheck, package builds, and teardown are reliable.

## Verification

Focused Core/Runtime/CLI tests, fake-clock integration tests, clean output-tree
typecheck/build, full affected-package tests, `git diff --check`, and an
authorized bounded live probe.

## Completion Criteria

Managed jobs have deterministic, explainable, replayable route and account
selection with correct leases in every terminal state and no harness-specific
policy owner.
