# Managed-child startup diagnosis

Status: historical economic commitments recovered with retained evidence. A
bounded trial is authorized, but remains gated on preventive child/tool limits
shared across parent and child. Temporary discovery grants are not applied.

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

Both live reservations were reconciled on 2026-09-07 through the canonical
operator command using the reviewed source and denial evidence. Read-only ledger
verification confirmed `released` commitments and leases, `not-dispatched`
settlements, retained reconciliation evidence, and preserved dispatch fences.
There were zero remaining pending commitments or held economic leases.
The repair binds each child economic action claim to the parent admission ID,
without equating parent and child economic commitments. Request realization and
parent authority checks run before fencing. A dedicated, owner-generation-fenced
Runtime operation records local no-dispatch evidence after fencing; ambiguous
adapter execution remains pending.

The composed regression uses the real lifecycle executor, economic coordinator,
SQLite authority, request preparation, invocation service, and direct adapter
with a synthetic provider. Both parent commitment variants now invoke the provider
once and release the child reservation. Cancellation and missing canonical tools
are covered. A temporary reintroduction of the former commitment comparison made
both success cases fail; removing that probe restored all four passing cases.

Verification passed the full workspace typecheck, foundation suites, all 345
Runtime test files (4,216 passed; five skipped), and the native Bun listener and
SQLite durability checks. Runtime's credential-absence test ran with
`OPENAI_API_KEY` removed only from the test process environment. The operator's
configured credentials were unchanged.

The full CLI run passed 2,820 tests with one skipped and two failures in the
container verifier while Docker Desktop's Linux engine was unavailable. After
starting the engine, all 22 tests in that verifier file passed, including both
failures. The native CLI projection-lock check also passed. No implementation
change or live model call was needed for that environment repair.

Six benchmark requests remain
within the cumulative authorization, below the next trial's allocation. No new
live benchmark trial was run for this repair.


## Follow-up diagnostic: host enforcement and request settlement

A single cold managed-child diagnostic on 2026-09-08 used the frozen source
`493ea5adccbbbd599fd87aa5a54aa6a717080c02`. The child passed startup and
made provider requests. Its `grep` calls failed because the direct adapter did
not carry the process-local Runtime host enforcement capability into the child
orchestrator. The persisted parent bundle included host-enforcement evidence;
that projection could not replace the missing executable capability.

The existing direct-adapter fixtures omitted host-enforcement evidence, so their
successful tool calls did not exercise the production guard. The repair carries
the actual process-local capability through request preparation and invocation
lifecycle, preserves the persisted parent identity, and intersects each child's
sandbox restrictions and invocation admission with its ancestors. Copied or
missing capabilities still fail before execution.

The diagnostic confirmed five parent and three child physical requests. The
shared eight-request fence then denied further transport admission. Model-round
settlement treated those local denials as unknown provider outcomes. The merged
collector evidence consequently included additional unknown rows and could not
close the report within its reserved maximum. This does not establish additional
physical requests: the transport evidence records eight completed requests, and
the budget owner reports exhaustion at eight.

A proven transport-admission denial now settles the consumed action claim as
`not_dispatched`, retains its replay fence, and ends the turn with
`outer_authority_denied`. It produces no physical provider observation. A denial
after an admitted physical attempt, an emitted stream event, or a settlement
failure preserves uncertainty. SQLite upgrades the outcome constraint inside the
exclusive owner startup transaction and preserves existing claims and permits.
A live owner prevents both migration and restart reconciliation.

Offline regression coverage includes an actual child builtin execution with a
host-bound parent, missing and copied capabilities, ancestor restrictions,
conjunctive invocation admission, streaming and non-streaming budget denials,
settlement failure, and old-schema recovery. The composed orchestrator test
executes one physical request and its tool, then closes the exhausted next round
without a second provider observation. The report consumer reconciles the
eight-request parent-child fixture at eight, with no unknown requests.

The child resource lease was released and cleanup completed. The exact previous
operator configuration was restored. The original failed report, transport
observations, and terminal review remain in private benchmark evidence; they are
not rewritten into a passing result. This diagnostic exhausted its authorization
and establishes no comparative performance or promotion claim.

Verification for the follow-up repair passed the full workspace typecheck, 107
Runtime session/managed-agent/execution-kernel files (1,175 tests), six Core
sandbox files (53 tests), two CLI claim-store/direct-adapter files (20 tests),
and two diagnostic/report-integrity files (51 tests). Focused post-integration
checks and `bun run docs:check` also passed. No live provider call was made for
this repair.


## Follow-up diagnostic: unattended approval and terminal deadline

The next single cold diagnostic on 2026-09-08 froze source `e3742529`.
The collector terminated its CLI process after the 180-second trial limit;
startup and termination took approximately 186 seconds overall. No canonical
terminal run artifact was available. Durable claims showed six successful
parent model rounds and two successful child rounds, but those claims alone
cannot establish the complete physical transport count. The eight-request
reservation remains uncertain. No further live trial was run for this repair.

The child checkpoint remained running with cleanup pending, and its tool claim
store contained no executed tool claims. Source investigation identified an
approval gate that treated a configured authority source as proof of a live
approval response channel. Direct children had a telemetry event bus but no
approval responder. A composed direct-child regression reproduces that wait
when parent admission requires approval. Temporarily restoring the former gate
made the regression time out; the repaired gate denies the unattended request,
keeps the protected tool unexecuted, and lets the child finish.

Runtime now requires an explicit response bridge for interactive approval.
Pending approvals observe turn cancellation and deny exactly once; late approval
responses cannot revive them. The normal provider-session surface supplies its
existing bridge. Direct children remain noninteractive.

The diagnostic previously killed the process at the same deadline at which it
needed to settle. Nonformal benchmark sessions did not install a cooperative
abort timer. The collector now passes an absolute execution deadline to the
CLI, whose timer also respects the stricter execution-envelope limit. Terminal
cleanup and artifact writing have a separate bounded drain period. Forced
termination remains an infrastructure failure with unknown dispatch, never
synthetic no-dispatch or successful cleanup evidence.

The operator configuration was restored exactly after the failed live attempt.
Its original report and pending child checkpoint remain private evidence; this
code repair does not retroactively settle that invocation or release its
uncertain economic commitment. Further live validation needs a new authorized
request allocation. Offline tests use synthetic providers only.

Verification passed the full workspace typecheck, 102 Runtime session and
managed-agent/approval files (1,127 tests), the CLI executor/provider-session
suites (107 tests) and benchmark command suite (21 tests), and three diagnostic
collector/process/report suites (55 tests). The direct-child regression failed
with an approval timeout when the old gate was temporarily restored and passed
again after restoration. Documentation validation also passed.

## Offline readiness verification (2026-09-08)

The subsequent diagnostic at `b311a8fd`, summarized in the
[advisor brief](managed-child-advisor-brief.md), completed with four settled
physical requests and no managed invocation. Its valid collection and successful
session do not satisfy the managed-child task oracle. The retained tool evidence
contains calls and error flags, but does not establish the exact discovery
rejection reasons.

Read-only preparation inspected the current configuration and canonical global
economic ledger. A probe of the real CLI permission evaluator and configured
invocation admission confirms that `capability.search` and `capability.describe`
fall through to `ask`, while `tool_catalog_search` and `managed_agent.invoke`
have explicit allow rules. The retained parent admission bundle already permits
the two discovery tools. Execution still intersects that bundle with configured
invocation policy; the unattended surface cannot satisfy the additional approval
requirement. This is a demonstrated current readiness blocker and a sufficient
explanation under that policy, not a replay of the missing historical errors.

An in-memory proposal with two exact discovery allow rules passed the same
invocation-policy probe; an explicit deny remained denied. No operator policy
was changed. Any actual change still needs scope review and authorization.
The proposal does not establish valid capability identity, successful
materialization, or a complete discovery-to-child workflow. In particular, the
observed `capability.describe` call must not assume a tool name and `current`
are the returned capability identity and revision.

The global ledger still contains two settlement-pending commitments and two
unreleased leases from earlier diagnostics. One settlement records unknown
provider usage; the other remains pending after a dispatch fence. Associated
diagnostics observed child provider execution, so the not-dispatched
reconciliation command cannot truthfully settle these records. Preserve their
uncertainty and fences until the economic owner can accept adequate settlement
evidence. No ledger mutation occurred during preparation.

The latest retained accounting is 654 known physical requests plus 25 reserved
for uncertainty against 683 authorized, leaving four below the existing
eight-request trial allocation. A private candidate protocol and proposal retain
the proposed next allocation, unchanged bounded trial, recovery prerequisites,
and rollback requirements. They are not authorized or frozen for execution.

Verification used an isolated checkout at `10e0588b`, then adopted `4257ee9f`
to include the intervening configuration-binding refactor. The unchanged Runtime
boundary passed six focused files (66 tests). The updated CLI boundary passed
nine focused files (102 tests), and the full workspace typecheck passed.
The native Bun SQLite owner-open smoke also passed; it is not a settlement
recovery proof.

The collector checkpoint test failed twice because its one-second test budget
included real Git fingerprint duration. A paired synthetic-command probe
reproduced the early stop and exercised the intended later crash with an
injected clock. The test now supplies that existing clock dependency, preserving
its timeout and checkpoint assertions. All four selected collector, protocol,
report-integrity, and subprocess-lifecycle files passed (67 tests), and scripts
typechecking passed. Production deadlines are unchanged.

Before another live diagnostic, resolve economic recovery, prove discovery and
invocation through real configured admission with a synthetic provider, review
any narrow configuration change, and freeze fresh source/configuration/account
evidence with an authorized allocation. No provider request was dispatched for
this preparation; no valid control or analyzer comparison is established.

## Evidence-retaining recovery (2026-09-08)

The operator subsequently authorized recovery and the proposed single bounded
diagnostic. Recovery reconstructed three child requests from the first report's
completed physical observations. For the interrupted second trial, the frozen
canonical CLI path injected one eight-request transport authority into parent
and child. Six distinct successful parent rounds and two successful child rounds
require at least eight physical requests; the shared cap permits at most eight.
This establishes exactly two child requests. It does not establish the missing
token usage, token-envelope compliance, or historical cleanup completion.

The new authenticated `managed-economic reconcile-execution` command released
both historical global commitments and account leases through their owning
Runtime service. Readback verified retained original `unknown` and `pending`
settlements, evidence digests, and dispatch fences. The service required a managed
restart to load the current code before accepting the recovery session. Historical
benchmark outcomes and the 654 known plus 25 uncertain request accounting were
preserved. Recovery itself used no provider requests.

The synthetic configured AgentTask workflow also exposed two independent defects:
the CLI forwarded the accepted task's admission identity alongside a derived
child bundle, and the public economic replay parser rejected the canonical
`priceClass` field. The CLI now forwards the identity of the actual child bundle
without changing the durable task action claim. Runtime validates `priceClass`
before producing its sanitized replay. The regression reaches child execution,
a builtin call, terminal success, and released economic capacity. This fixture
covers the configured AgentTask entry.

A separate hermetic regression now exercises the real attached Runtime surface
used by the benchmark's generic `managed_agent.invoke` path. Configured
on-request discovery yields an approval requirement and no child. Adding only
the two exact discovery grants passes the returned capability identity,
revision and descriptor digest into describe, materializes the generic tool,
executes a synthetic child builtin, and verifies terminal lease release and
owner shutdown. The provider, builtin, claim stores and sandbox lease are
synthetic; this proves the attached surface and configured admission, not full
benchmark orchestration, real transport or provider behavior.

The governed global settings surface now accepts `permissions.tools`, requires
authority approval, and validates the resulting global document before writing.
Tool-rule validation rejects malformed names, actions and unknown rule fields.
The two exact discovery grants remain a separate temporary configuration action;
their proposal retains all existing rules and an exact rollback requirement.

Protocol review found a further readiness gate. The physical-request authority
enforces eight requests across parent and child before transport. In contrast,
the collector's one-child threshold is checked after execution, and parent and
child each receive their own tool-call budget. The current report's tool count
does not establish an aggregate parent-and-child limit of 32. Before executing
under the proposed maxima, the owning Runtime path needs a shared preventive
limit for child starts and tool execution, with matching aggregate evidence.
The authorization must not be silently reinterpreted as permission to exceed
these maxima and merely invalidate the resulting row. No discovery grant was
applied and no new provider trial was dispatched during this recovery step.
