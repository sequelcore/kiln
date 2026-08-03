# Managed Economic Commitment Authority

## Purpose

Managed economic commitment binds one admitted managed job to one immutable
economic route decision before provider effects begin. Runtime owns the local
SQLite authority for route reservations, account selection when applicable,
dispatch fencing, release, recovery, and reconciliation. Job JSON is a durable
projection of that authority, not a second commitment store.

This boundary is distinct from generic runtime resource leases and from Model
Gateway ingress. The latter continues to use `LocalModelGatewayStore` until
Roadmap 02 Slice 5 converges the two authorities.

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

Managed-job V7 is the only persisted representation. It durably creates a
namespaced `economicAttemptId` and `adoptedDecisionAt` before adoption or
commitment. Pre-V7 records fail closed and are never upgraded into a new
economic attempt by inference.

## Atomic Commitment

One process-scoped Runtime SQLite authority is created per project runtime. It
claims a single live owner generation, migrates through a versioned
`PRAGMA user_version` schema, refuses newer schemas, and executes commitment
acquisition synchronously in one `BEGIN IMMEDIATE` transaction.

The transaction:

1. replays an exact `(jobId, economicAttemptId, intentFingerprint)` result or
   rejects an identity/revision conflict;
2. revalidates the adopted policy, candidate-set, snapshot, route, capability,
   tariff, and account evidence;
3. applies deterministic route ranking and persists rejection evidence;
4. checks exact route ceilings against already consuming commitments;
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

Commitment state and account-lease lifecycle are separate contracts. The
commitment is initially held. Runtime writes a distinct dispatch fence before
adapter construction, credential materialization, process launch, or provider
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
Runtime exposes an explicit operator-identity, reason, and evidence-bound
reconciliation transaction for those states rather than a timer or terminal-job
projection that fabricates settlement.

## Recovery

Startup first recovers the SQLite authority and then recovers managed jobs.
Recovery queries the exact `(jobId, economicAttemptId)`:

- `absent` may be committed from the persisted V7 intent;
- a historical V6 held commitment from the interim no-dispatch path is released
  directly from its durable job and economic-attempt identity without
  re-adopting config;
- a dispatch-fenced, settlement-pending, release-failed, or leaked commitment
  remains conservatively fenced; and
- conflicting identity or revision evidence fails closed.

A crash between SQLite commit and job projection therefore recovers and
releases the exact durable commitment instead of selecting again. Migrated
account-only leases that were still capacity-consuming are conservatively
classified `leaked`; a separate audited legacy-lease reconciliation releases
them by lease ID without fabricating an economic attempt and durably retains
the operator, reason, evidence URI, prior state, and idempotent replay. Reconciliation
changes only authority state through an owner-fenced transaction; projections
observe the resulting evidence without becoming authority.

## Configuration Boundary

Economic candidates are explicit direct managed routes. A `runtime-selected`
route names its virtual account policy and remains supported. A
`credentialless` route used by an economic policy must name
`credentials.economicsRouteId`; that virtual economics route must match the
managed route's provider and model exactly and contain zero `accountIds`.

Candidate collection is secret-free and performs no adapter construction,
credential resolution, process launch, lease acquisition, reservation, or
provider call. Only a committed request may construct the deferred adapter. An
exact route/provider/model mismatch emits sanitized typed evidence before
construction and dispatch.

## Local Guarantees

The authority is Kiln-local and project-local. It makes no provider-global,
subscription-global, or multi-runtime capacity claim. Database, WAL, and SHM
artifacts are owner-only on POSIX systems. Projected and operator-visible
evidence excludes secrets, raw provider payloads, exception details,
machine-specific paths, and derived affinity keys. Runtime persists only the
opaque derived affinity key inside its owner-restricted SQLite authority so
continuity can be enforced.

The former managed-invocation account-only writer and port are deleted. Direct
account-leased invocation outside the managed economic job path fails closed;
there is no compatibility writer. Model Gateway ingress remains a separate
`LocalModelGatewayStore` consumer until Roadmap 02 Slice 5.

## Non-Goals

- No ambient account discovery or hidden credential rotation.
- No quota evasion, inferred credit, overage, or economic fallback.
- No provider dispatch in Roadmap issue #34 internal Slice 4 / issue #37.
- No remote or provider-global capacity coordination.
- No cross-path capacity or affinity exclusivity before Roadmap 02 Slice 5.
