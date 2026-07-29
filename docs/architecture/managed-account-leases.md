# Managed Account Leases

## Purpose

Managed account leases bind one admitted managed job to one explicitly
configured provider account before provider effects begin. They are distinct
from generic runtime resource leases and from Model Gateway ingress attempts.
Runtime owns their capacity, persistence, settlement, and recovery.

## Boundaries

- Core owns `AccountPolicyId`, deterministic account selection, `AttemptCommit`,
  and the sanitized `ManagedAccountLeaseEvidence` contract.
- CLI composition projects existing `modelGateway.accounts` and
  `modelGateway.virtualModels` through the Runtime-owned candidate port.
- Runtime owns one process-scoped SQLite lease authority per project runtime.
  Route catalogs and adapter factories do not own or recreate capacity.
- Provider adapters expose execution settlement. They do not select accounts,
  release capacity, retry across accounts, or reconstruct policy.
- Gateway Contracts and operator surfaces project canonical evidence without
  deriving eligibility or release state.

Managed jobs do not import Model Gateway HTTP or process lifecycle. Managed
routes reference one Core-owned `accountPolicyId`; provider and model must match
that policy exactly. Runtime-selected credentials are supported only on direct
routes that can bind the already selected credential revision.

CLI configuration names this operator intent `credentials.mode:
runtime-selected` and projects it to Core's `account-leased` authority. Core's
`runtime-selected` mode remains the separate contract for selecting one
credential route and never implies account-capacity ownership.

## Execution Flow

1. Admit governance, configured profile, route, authority, and capability.
2. Resolve secret-free candidates for the route's explicit account policy.
3. Acquire one durable lease in an immediate SQLite transaction.
4. Persist the sanitized account reference, credential revision digest,
   selection reason, candidate rejection evidence, and affinity outcome.
5. Resolve only the leased credential revision and bind a non-pooled direct
   adapter.
6. Advance `AttemptCommit` to `dispatching` immediately before provider effects.
7. Project the operator-visible terminal state independently of settlement.
8. Release capacity only after authoritative execution settlement.

No account reassignment is permitted after `dispatching`. Adapter or SDK
cross-account retry is disabled on selected-account paths. Credential revision
drift fails before dispatch and releases the pre-dispatch lease.

## Capacity And Settlement

Capacity follows settlement, not terminal projection.

- Success and failure release after their execution promise settles.
- Cancellation may project immediately, but capacity remains held until
  cancellation acknowledgement or execution settlement.
- Timeout projects `timed_out` while the lease becomes
  `settlement-pending`.
- Release failure becomes `release-failed` and continues consuming capacity.
- Work whose settlement cannot be matched after restart becomes `leaked` and
  continues consuming capacity until an explicit future reconciliation flow.

Release is idempotent and fenced by lease owner, lease ID, account, route, job,
and Runtime invocation identity. Lease rows are retained for replay rather than
deleted.

## Recovery

The authority heartbeat permits one live process owner. Ownership recovery
never deletes active leases:

- a pre-dispatch recovery checkpoint is reconcilable and can complete bounded
  cleanup;
- a checkpoint that crossed adapter start remains `settlement-pending`;
- an active lease with no matching checkpoint becomes `leaked`.

The managed-invocation recovery checkpoint is persisted before provider
dispatch. The production managed-job composition recovers Runtime invocations
and account leases before it marks interrupted jobs.

## Evidence

Canonical account-lease evidence contains opaque account and policy identities,
canonical provider/model route, credential revision digest, selection and
rejection reasons, affinity outcome, timestamps, lifecycle state, and safe
resource or diagnostic URIs. It excludes credentials, tokens, raw provider
payloads, exception details, and machine-specific paths.

Managed-job V4 is the only writer and carries current lease evidence plus its
lifecycle history. The V3 reader remains because persisted V3 jobs are a real
consumer; there is no parallel V3 writer or compatibility alias.

## Non-Goals

- No ambient account discovery or inferred account policy.
- No quota evasion, hidden rotation, or provider-specific routing policy.
- No economic routing or complete exhaustion/reset benchmark matrix.
- No default timer that fabricates settlement or frees unknown work.
- No remote multi-runtime capacity sharing.
