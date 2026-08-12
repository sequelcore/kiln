# Managed Economic Commitment Authority

## Purpose

Managed economic commitment binds one admitted managed job to one immutable
economic route decision before provider effects begin. Runtime owns the local
SQLite authority for route reservations, account selection when applicable,
dispatch fencing, release, recovery, and reconciliation. Job JSON is a durable
projection of that authority, not a second commitment store.

This boundary is shared by managed jobs and Model Gateway ingress. One
user-scoped physical SQLite ledger is the sole writer for account capacity and
affinity. Economic commitments are project-namespaced within that ledger, so a
project cannot consume or recover another project's work.

## Adopted Input

Core owns the immutable `ManagedEconomicSnapshot` and its validation rules. CLI
composition adopts one snapshot outside the SQLite write transaction from:

- the exact economic policy id and revision;
- the admitted candidate identities and authority rejections;
- canonical provider, model, capability, tariff, comparison-domain, envelope,
  ceiling, account-policy, usage, and quota evidence; and
- the pinned `adoptedDecisionAt` used for the decision.

Canonical sorted serialization and SHA-256 digests bind the policy, candidate
set, price evidence, rate schedules, and complete snapshot. Reordered object
keys cannot change a digest. A later config read or clock value cannot rewrite
the adopted decision basis.

Managed-job V10 is the only persisted representation. Its discriminated
`dispatch.kind` is either `economic` or `native-harness`. The economic branch
durably creates a namespaced `economicAttemptId` and `adoptedDecisionAt` before
adoption or commitment. The native-harness branch stores only its exact
credentialless route/provider/model, stable versioned route acknowledgement,
and optional Runtime dispatch fence; it never creates an economic policy,
account, quota, price, candidate, reservation, or settlement record. V9 is
migrated once to V10 to preserve operator evidence; pre-V9
records fail closed and are never upgraded by inference.

## Atomic Commitment

Runtime owns one user-scoped SQLite ledger and executes commitment acquisition
synchronously in one `BEGIN IMMEDIATE` transaction. Each participant is keyed
by its kind, recovery domain, and owner generation/configuration revision;
stale writers cannot settle, release, or replace newer work. The ledger uses a
versioned `PRAGMA user_version` schema, refuses newer schemas, and permits only
rolling compatible schema changes.

The transaction:

1. replays an exact `(jobId, economicAttemptId, intentFingerprint)` result or
   rejects an identity/revision conflict;
2. revalidates the adopted policy, candidate-set, snapshot, route, capability,
   tariff, and account evidence;
3. applies deterministic route ranking and persists rejection evidence;
4. checks project-namespaced economic commitments and shared account capacity
   against already consuming commitments;
5. selects and reserves either one eligible configured account or the explicit
   accountless identity; and
6. persists the decision, reservation, optional account lease, and commitment
   before returning.

Account-backed and accountless routes share this transaction. Account-backed
selection uses sanitized stable-capacity identity, revision-fenced credential
evidence, usage/quota evidence, capacity, and configured affinity. Accountless
selection creates no account identity or account lease. Missing, stale,
contradictory, or unverifiable authority fails closed; there is no implicit
route, account, overage, or fallback.

Configured account economics owns the stable capacity identity, subscription
and quota classes, credit posture, and overage posture. Codex provider usage may
project authoritative percentage windows, exact decimal credits, spend control,
reset evidence, and exhaustion reasons into that identity. Providers without a
stable proactive quota snapshot, including the current OpenCode Go boundary,
remain explicitly `unknown`; required quota policy cannot treat that as
unlimited or zero.

Exact replay returns the prior result without consuming capacity twice. A
changed intent fingerprint, policy revision, candidate digest, snapshot digest,
or selected identity evidence returns explicit conflict or drift evidence.

## Dispatch And Release

Commitment state and account-lease lifecycle are separate contracts. Runtime
must hold the economic commitment and account capacity before adapter or
credential materialization. It writes the distinct dispatch fence after that
recoverable preparation and immediately before process launch or provider
effects. The fence does not finalize or release an account lease and forbids
route or account reassignment.

Any interim failure that is proven pre-fence releases the commitment and its
optional account lease before the job is projected terminal. Release is
idempotent and owner-generation fenced. Once dispatch is fenced, unknown
external work continues consuming capacity until authoritative settlement or
explicit reconciliation proves release safe.

Execution settlement is a typed union. Provider-reported charge requires
provider authority and the committed unit/scheme. A local rate-card calculation
is `estimated`, never `charged`; subscription, included allowance, proven free,
unknown, pending, and leaked remain separate variants. Exact replay is
idempotent, while a conflicting terminal settlement fails closed.

The selected route timeout governs one lifecycle beginning when the authority
acquires the held commitment. Adapter materialization, exact account binding,
runtime authority observation, resource acquisition, recovery checkpointing,
and provider execution share that deadline and cancellation signal. Invalid
pre-fence preparation releases the hold exactly once. Adapter, credential,
startup, checkpoint, or provider failure after the fence never fabricates a
safe release; typed settlement or reconciliation remains authoritative.

For an economically owned account route, the Runtime recovery checkpoint stores
only the immutable commitment, job, attempt, and dispatch-fence identifiers.
SQLite remains the sole account-lease authority; the checkpoint must not copy a
second lease record or combine runtime-owned and economically owned authority.

Release failure becomes `release-failed`; unknown fenced work becomes
`settlement-pending`; unmatched work can become `leaked`. All remain
capacity-consuming and carry sanitized settlement or reconciliation evidence.
They remain held until an authoritative settlement is recorded; startup recovery
only classifies unresolved work conservatively and never fabricates a release.

Economic commitments are project-namespaced. Account capacity and affinity are
shared across the managed-job and Gateway participants for the same configured
capacity identity; neither participant may overwrite affinity or delete another
participant's live reservation.

## Recovery

Startup first recovers the SQLite authority and then recovers managed jobs.
Economic recovery queries the exact `(jobId, economicAttemptId)`:

- `absent` may be committed from the persisted V10 economic intent;
- a historical V6 held commitment from the interim no-dispatch path is released
  directly from its durable job and economic-attempt identity without
  re-adopting config;
- a dispatch-fenced, settlement-pending, release-failed, or leaked commitment
  remains conservatively fenced; and
- conflicting identity or revision evidence fails closed.

Native-harness recovery does not query or recreate an economic commitment. Any
queued or dispatch-fenced native-harness job found after restart becomes
`interrupted`; Runtime never silently redispatches work whose external process
state cannot be proven.

A crash between SQLite commit and job projection therefore recovers and
releases the exact durable commitment instead of selecting again. Migrated
account-only leases that were still capacity-consuming are conservatively
classified `leaked`; they remain capacity-consuming pending authoritative
settlement rather than being released by recovery.

## Configuration Boundary

Managed direct routes reference exactly one `executionRouteId`. The global
execution catalog owns that route's provider, provider model, automatic account
policy or exact account, and economic evidence. Managed configuration does not
duplicate credential selectors, account lists, or a second economic-route
identity.

Candidate collection is secret-free and performs no adapter construction,
credential resolution, process launch, lease acquisition, reservation, or
provider call. Only a committed request may construct the deferred adapter. An
exact route/provider/model mismatch emits sanitized typed evidence before
construction and dispatch.

## Local Guarantees

The ledger is user-scoped and Kiln-local. It makes no provider-global,
subscription-global, or multi-user capacity claim. Database, WAL, and SHM
artifacts are owner-only on POSIX systems. Projected and operator-visible
evidence excludes secrets, raw provider payloads, exception details,
machine-specific paths, and derived affinity keys. Runtime persists only the
opaque derived affinity key inside its owner-restricted SQLite authority so
continuity can be enforced.

The former managed-invocation account-only writer and the separate Gateway
lease authority are deleted. Direct account-leased invocation outside Runtime
admission fails closed. Replay storage owns only replay, cooldown, and evidence
retention; it cannot reserve capacity, select an account, or commit affinity.

## Non-Goals

- No ambient account discovery or hidden credential rotation.
- No quota evasion, inferred credit, overage, or economic fallback.
- No provider dispatch in Roadmap issue #34 internal Slice 4 / issue #37.
- No remote or provider-global capacity coordination.
- No provider-global capacity, affinity, or account ownership claim.
- No incompatible rolling schema migration or legacy authority reader.
