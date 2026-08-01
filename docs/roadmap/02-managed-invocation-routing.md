# 02 - Managed Invocation Routing

Status: Active delivery track
Execution: Slices 1, 2, 3, and 4 complete; Slice 5 queued.
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
The account-scoped retry proof constructs the selected Codex adapter with its
bounded same-credential retries enabled while asserting zero materialization,
binding, adapter construction, or dispatch through the other account.

The proof is portable and network-free. It establishes managed-path guarantees
only and does not restore or mutate operator Codex configuration.

### Slice 3 - Bounded Live Probe

Status: Complete in issue #32.

Run one explicitly authorized probe that records route, account reference,
selection reason, usage freshness, lifecycle, result, cancellation/timeout as
applicable, and replay without exposing credentials or raw provider payloads.

Eight bounded read-only Codex probes completed provider execution and released
their leases. The final authorized execution passed the complete Slice 3 proof:
policy-scoped usage refresh, fresh available evidence, `least-pressure`
selection on a configured two-account policy, exact revision-fenced credential
binding, completed child execution, settlement-backed lease release, canonical
Runtime-to-Gateway replay projection, and the durable privacy gate. An earlier
authorized execution exposed the operator's absolute temporary workspace path
in durable capability and lease evidence. Canonical event projection now
preserves real paths only inside Runtime authority and emits portable
workspace-relative paths for capability snapshots, resource leases, read/write
scopes, worktree conflicts, free-text evidence, resource URIs, and
admission-denial evidence.
Core rejects filesystem volume roots as managed workspaces because `/`, drive
roots, and UNC share roots cannot be distinguished reliably from non-path
free-text syntax during durable privacy projection. An earlier harness version passed
flattened canonical Runtime events directly to the Gateway replay-envelope normalizer,
which correctly requires a `payload` envelope. The proof now uses Runtime's
canonical `toOperatorSessionEventFrame` boundary before Gateway normalization;
a network-free integration verifies that account lease and usage evidence
survive append, framing, normalization, and cockpit projection. The proof also
refreshes usage only for the policy's admitted credential IDs, fails before
child dispatch unless at least one candidate has fresh available evidence, and
records refresh-time credential resolutions separately from the single
revision-fenced execution resolution. An earlier authorized harness attempt failed before
provider dispatch because execution binding used JavaScript constructor
identity across duplicate workspace module instances. Binding now consumes an
explicit structural direct-provider capability, verifies its admitted provider
against the leased route, retains revision fencing, and requires the complete
post-bind descriptor to remain unchanged. Deterministic coverage reproduces the
cross-module boundary without provider access. The proof also injects and
observes the exact configured Codex pool instance; a network-free regression
verifies one revision-fenced credential resolution.
Earlier unstable generative-summary and incomplete privacy assertions were
replaced with canonical child-execution evidence, exact lease-to-credential
binding, structured privacy checks, and replayed usage assertions.

### Slice 4 - Economic Route Policy

Status: Implemented in issue #37 under issue #34 internal Slice 4.

Represent quota class, subscription class, metered-cost class, and comparable
cost separately. Explain why an eligible job used Codex or OpenCode. Add explicit
reservations and ceilings without claiming free execution without evidence.

Core now adopts one immutable economic snapshot with canonical sorted SHA-256
digests over the policy, candidate set, price/rate evidence, and full decision
basis. New managed jobs are V6 and durably pin a namespaced
`economicAttemptId` plus `adoptedDecisionAt`; V5 is strict historical input.

One project-runtime SQLite writer performs route capacity, account-backed or
accountless selection, reservation, and commitment synchronously in one
immediate transaction. Its versioned schema, live owner generation, exact
replay, identity/revision conflict, dispatch fence, conservative recovery,
pre-fence release, release-failure evidence, and explicit reconciliation make
SQLite authoritative while job JSON remains a projection. POSIX database
artifacts are owner-only.

The old managed-invocation account-only writer and port are deleted. Direct
account-leased invocation outside the economic job path fails closed. The
credentialless config contract requires an exact zero-account virtual economics
route when used by an economic policy; runtime-selected account policy remains
supported. A committed route mismatch emits sanitized evidence before adapter
construction.

This slice performs no provider dispatch. Issue #34 internal Slice 5 will wire
committed dispatch and settlement. That internal sequence is separate from
Roadmap 02 Slice 5 below, which converges the managed-job authority with Model
Gateway ingress.

### Slice 5 - Cross-Path Account Authority Convergence

Status: Queued after managed economic commitment and dispatch proof.

Unify capacity and affinity authority when Model Gateway ingress and managed
jobs target the same configured accounts. Replace the ingress
`LocalModelGatewayStore` lease deletion and last-writer-wins affinity behavior
with the same stable-capacity, settlement-conservative, fenced semantics,
without importing gateway process recovery into managed invocation.

## Promotion Gates

- Managed economic jobs use the one Runtime SQLite commitment writer; no
  account-only compatibility writer remains.
- Every committed job records one explicit account-backed or accountless
  selection and releases proven pre-fence interim work correctly.
- Missing or stale usage is `unknown`, never fabricated.
- No provider commitment triggers hidden account retry.
- Focused tests, workspace typecheck, package builds, and teardown are reliable.

## Verification

Focused Core/Runtime/CLI tests, injected-clock integration tests, clean
output-tree typecheck/build, full affected-package tests, `git diff --check`,
and independent review. The authorized bounded live probe remains Slice 3 and
is not evidence for Slice 2.

## Completion Criteria

Managed jobs have deterministic, explainable, replayable economic route and
account-backed or accountless commitment with conservative recovery and no
harness-specific policy owner. Provider dispatch remains issue #34 internal
Slice 5; Model Gateway authority convergence remains Roadmap 02 Slice 5.
