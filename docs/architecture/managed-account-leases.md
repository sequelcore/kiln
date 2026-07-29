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
- Runtime owns one process-scoped SQLite lease and affinity authority per
  project runtime for managed invocations. Route catalogs and adapter factories
  do not own or recreate managed-path capacity.
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
4. Resolve configured continuity against the durable stable-capacity mapping,
   then persist the sanitized account reference, credential revision digest,
   selection reason, selected usage observation, candidate rejection evidence,
   and affinity outcome.
5. Resolve only the leased credential revision and bind a non-pooled direct
   adapter.
6. Advance `AttemptCommit` to `dispatching` immediately before provider effects.
7. Project the operator-visible terminal state independently of settlement.
8. On success, atomically release the lease and compare-and-set its affinity
   mapping. On every other outcome, release capacity only after authoritative
   execution settlement.

No account reassignment is permitted after `dispatching`. OpenCode and direct
selected-account adapters disable their internal account retry. Codex retains
its bounded same-credential transient and authorization retries; those retries
cannot enumerate, materialize, bind, construct, or dispatch through another
account. Credential revision drift fails before dispatch and releases only the
pre-dispatch lease.

## Configured Projection And Time

`ConfiguredManagedAccountRuntime` is the production candidate projector. It
reads only accounts explicitly named by the selected virtual model, emits
secret-free configured account references and credential revision digests, and
materializes only the revision already fenced by the acquired lease.

Its usage clock is injected once at composition and the same `Date` is passed
to usage listing and candidate construction. Time is evidence input, not
authority:

- fresh `exhausted` usage is unhealthy and excluded;
- expired usage disappears and becomes missing evidence, eligible with penalty;
- a newer explicit non-exhausted observation restores preference;
- usage expiry never creates an `available` observation or releases capacity.

The selected candidate's usage state is captured in the lease transaction and
remains immutable across settlement transitions. A missing observation is
persisted explicitly as missing; Runtime never reconstructs availability from
the selection result or from a later provider response.

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
- Total lease capacity is distinct from provider health and reserved new-work
  capacity. Exhaustion rejects both new work and existing affinity with
  `lease-conflict`; affinity reservation never permits oversubscription.

Release is idempotent and fenced by lease owner, lease ID, account, route, job,
and Runtime invocation identity. Lease rows are retained for replay rather than
deleted.

## Managed Affinity

Configured virtual models project `none`, `prefer`, or `require` continuity,
scope, and explicit rebind permission through the candidate port. Managed jobs
do not read gateway configuration directly and callers cannot submit an account
or affinity key.

Runtime derives an opaque SHA-256 key from admitted requester and parent
lineage, the account policy, canonical route, policy scope, and the parent turn
only for turn-scoped continuity. The authority stores that key against stable
configured `capacityIdentity`, not credential revision or the opaque account
reference.

- `none` always enters selection as new work.
- `prefer` creates a mapping only after successful execution and honors an
  existing mapping while respecting reservations and total concurrency.
- `require` fails closed without a durable mapping.
- rebind is pre-dispatch and requires explicit configured permission.

Successful finalization releases the exact lease and applies a first-bind or
rebind compare-and-set in one immediate SQLite transaction. Its canonical
outcome is `won`, `already-matched`, or `conflict`. A conflict preserves the
winner and the successful provider result; it cannot overwrite, retry, or
reassign work after effects. Failure, timeout, cancellation, and binding
failure never mutate affinity.

## Recovery

The authority heartbeat permits one live process owner. Ownership recovery
never deletes active leases:

- a pre-dispatch recovery checkpoint is reconcilable and can complete bounded
  cleanup;
- a checkpoint that crossed adapter start remains `settlement-pending`;
- an active lease with no matching checkpoint becomes `leaked`.

The managed-invocation recovery checkpoint is persisted before provider
dispatch. The production managed-job composition recovers Runtime invocations
and consumes Runtime's complete classified-lease result, including terminal
checkpoints and orphaned authority rows. It writes those classifications into
V4 jobs only after proving their stored `projectId` matches the trusted
composition project, before it marks those jobs interrupted.

## Evidence

Canonical account-lease evidence contains opaque account and policy identities,
canonical provider/model route, credential revision digest, selection and
rejection reasons, the acquisition-time usage snapshot, affinity selection and
commit outcomes, timestamps, lifecycle state, and safe resource or diagnostic
URIs. It excludes credentials, tokens, lineage-derived affinity keys, raw
provider payloads, exception details, and machine-specific paths. Account
references must use the `configured:` namespace. Resource and diagnostic
evidence is restricted to the lease's own
`kiln://managed-accounts/leases/<lease-id>` namespace and its closed diagnostic
vocabulary.

Managed-job V4 is the only writer and carries current lease evidence plus its
lifecycle history. Lease observations advance aggregate `updatedAt` without
fabricating job-state lifecycle entries; acquisition facts are immutable and
terminal lease states cannot regress. Diagnostic URIs are canonically ordered,
and same-state settlement enrichment requires a strict evidence-set increase.
The V3 reader remains because persisted
V3 jobs are a real consumer; there is no parallel V3 writer or compatibility
alias.

Terminal projection is enrichable evidence, not a one-shot loss boundary.
When execution settles after timeout or cancellation, Runtime appends a newer
canonical terminal event carrying the released lease. Replay and every
operator surface therefore converge on settlement without rewriting history.

These guarantees are limited to managed invocations. Model Gateway ingress
still uses `LocalModelGatewayStore`, whose lease and affinity tables are a
separate pre-existing authority. Cross-path capacity and affinity exclusivity is
not yet guaranteed and remains an explicit Roadmap 02 convergence slice.

## Non-Goals

- No ambient account discovery or inferred account policy.
- No quota evasion, hidden rotation, or provider-specific routing policy.
- No economic routing.
- No default timer that fabricates settlement or frees unknown work.
- No remote multi-runtime capacity sharing.
- No claim of shared capacity or affinity with Model Gateway ingress.
