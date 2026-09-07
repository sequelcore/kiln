# Managed-child startup diagnosis

Status: diagnosis confirmed by bounded offline reproduction; repair not implemented.

## Primary finding

Control 6 frozen source `1a75522610472686f034bef24b3b0a265af686dd`
confuses parent-turn authority with a child's economic reservation.
Request preparation attaches the parent's EffectiveAuthorityAdmissionBundle,
reserves a separate child commitment, fences it, then forwards both to Runtime.
The startup guard requires that child commitment to equal the execution
commitment inside the parent bundle. Those are different executions; both
failing retained parent bundles have no economic commitment.

The exact reproduced rejection is:
`Managed child economic commitment is not admitted by the parent authority bundle.`

Owners and causal path:

1. [Request preparation](../../../packages/runtime/src/agents/managed-invocation/runtime-tool/request-preparation.ts)
   binds the parent bundle at the tool boundary and carries it unchanged into
   lifecycle options alongside the new child commitment.
2. [Economic coordinator](../../../packages/runtime/src/agents/managed-invocation/economic-dispatch-coordinator.ts)
   realizes the request before fencing, but realization does not include the
   invocation service's remaining startup validation.
3. [Child authority admission](../../../packages/runtime/src/agents/managed-invocation/child-authority-admission.ts)
   compares the child commitment ID with the parent bundle's execution field.
4. [Invocation service](../../../packages/runtime/src/agents/managed-invocation/invocation-service.ts)
   catches this prestart rejection and records runtime-prestart-validation-failed
   as settlement-pending even though the adapter has not been called.
5. [Tool action claim](../../../packages/runtime/src/execution-kernel/runtime-tool-action-claim.ts)
   wraps the inner exception as an unreplayable effect outcome and persists only
   a generic tool-dispatch-failed reason. Benchmark diagnostics lose the cause.

The two pending reservations occupy both Plus-account capacities. The retained
22:59:07 economic denial explicitly reports two lease conflicts. Do not infer
that the earlier 22:56 denial had the same cause; it predates those reservations.

## Separate pre-acquisition failure

The first warm trial requested `functions.read`, `functions.grep`, and
`functions.glob`. The configured read-only profile permits canonical `read`,
`tree`, `grep`, and `glob`. Frozen evidence validation compares exact tool
names; these requests necessarily fail candidate admission. The constrained
route therefore produces an empty candidate set before economic acquisition.
No 22:56 economic decision exists in the ledger. This is distinct from the
22:57 and 22:58 startup failures and the 22:59 capacity denial.

Independent review matched retained tool-call arguments, the exactly restored
configuration, and frozen candidate filtering. The raw candidate rejection
object was not retained, so this proves a sufficient rejection condition, not
that it was the only simultaneous rejection. Calling this
economic_commitment_unavailable hides a non-economic input/capability mismatch.
Do not add blanket legacy aliases. Keep canonical tool identity at the owning
contract and report the missing required tools as such.

## Reproduction and limits

Private Control 6 evidence retains `diagnosis/reproduce-prestart.mjs`,
`prestart-reproduction.json`, and `evidence.json`. The reproduction imports the
frozen Runtime service, rehydrates both actual persisted parent bundles through
the canonical constructor, verifies their admission digests, and supplies the
actual retained child commitments read from the canonical global SQLite ledger.
A minimal request projection supplies the matching session, turn, route, model,
account policy, and read-only authority consumed by the prestart checks.

Both calls pass the earlier route/account guard, throw the exact parent-bundle
rejection, record runtime-prestart-validation-failed through an in-memory
settlement recorder, and make zero adapter calls. No provider or live ledger
mutation occurs. Source hashes, record identities, and reproduction hashes are
retained privately.

This is a bounded reproduction, not a replay of the complete original request.
The original inner exception was not retained in benchmark diagnostics.
The code path and retained parent/child identities substantiate the conflict;
missing child metadata alone is not the proof.

## Why verification missed it

Independent source review found a missing composed success test:

- Economic preparation tests exercise denials and interruption before startup.
- Coordinator tests end at realization and fencing.
- Direct adapter tests synthesize a matching admission bundle after receiving
  the child commitment, so they bypass the production mismatch.
- The economic lease happy path omits childAuthorityAdmission and skips its guard.
- The live proof manually constructs a matching bundle outside production
  request preparation.

Passing those checks did not establish that ordinary production composition
can start a child. The earlier completion claim exceeded that evidence.

## Required repair boundary

Keep the parent permission ceiling and child economic dispatch distinct.
If dispatch needs a commitment-bound admission receipt, its owning Runtime
contract must bind the child commitment to the admitted parent request. Do not
rewrite a persisted parent turn or remove authority validation to make it pass.

Complete fallible admission before the provider-effect fence, or return an
explicit owner-proven no-dispatch outcome for local failures after a fence.
Keep ambiguous external effects unknown and preserve action fences. Sanitized
structured evidence must preserve the rejection stage and owning reason.

The decisive regression test must compose the real lifecycle executor, real
economic coordinator, request preparation, and real invocation service with a
provider-free adapter. Cover a parent without an economic commitment and a
parent with a distinct commitment, plus denial/cancellation before adapter start.
Assert both adapter invocation and terminal reservation state.

Separate capability-discovery/approval failures also appear in this cohort.
They are not justification to bypass ask/deny or add a benchmark-only approval
handler. Their evidence and any unresolved cause must remain separate.

Two live reservations remain pending. Recovery and implementation are not
claimed complete by this diagnostic artifact. Six benchmark requests remain
within the cumulative authorization, below the next trial's allocation.
