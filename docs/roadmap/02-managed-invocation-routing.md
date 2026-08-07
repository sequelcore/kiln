# 02 - Managed Invocation Routing

Status: Active delivery track
Execution: Slices 1, 2, 3, and 4 complete. Issue #34 internal Slice 5 dispatch enforcement delivered, then independently reviewed: two High findings (a profile-less `managed_agent_invoke` call bypassing economic commitment entirely; adapter/credential materialization before any commitment existed) plus five Medium/Low findings, all closed - see the internal-Slice-5 remediation note below. Issue #34 internal Slice 6 (durable lifecycle, replay, cross-surface projection) has a second bounded piece delivered beyond the Slice 5 remediation's Runtime-to-Gateway-contracts frame boundary: Gateway-contracts now carries a typed `managed_economic_lifecycle` wire contract, shared presentation (title/tone/details) for all seven lifecycle transitions, and a top-level `economicAttempts` collection folded into the same `OperatorCockpitReadOnlyProjection`/`ViewState` that CLI, GUI, and TUI all read. All three active surfaces render it: `kiln managed-agent list` (CLI), the TUI sidebar cockpit, and the GUI `ManagedAgentCockpitPanel` (which additionally required a fix to its inbound WebSocket Zod schema, `GuiSessionEventSchema` in `ws-client.ts`, that was silently dropping the event kind before this change). Native is out of active development and was left unwired.

Two further bounded pieces landed after that. First, recovery-checkpoint economic evidence: `ManagedAgentRuntimeEconomicDispatchCheckpoint` (Runtime `recovery-store.ts`, still `version: 2`) now carries the full `ManagedEconomicReservation`, not just its four ID strings - structurally validated on read (not re-deriving Core's economic-domain rules) and optional so checkpoints persisted before this field existed still validate on restart. Second, the session-event `jobId`-to-`invocationId` join: `invocationId` is now computed once, from `context` alone, at the top of `prepareManagedInvocationRequest` in `runtime-tool.ts` (the function at the center of the internal-Slice-5 H1/H2 findings) instead of ~460 lines later inside the recursive "already-admitted" call, and is threaded onto `CanonicalManagedEconomicLifecycleEvent`/`OperatorCockpitEconomicAttemptProjection` as an optional, best-effort cross-reference. The change is a pure hoist - identical value, no behavior change to the non-economic path - proven by the full existing suite passing unchanged, plus a new assertion in `economic-route-capability-admission.test.ts` showing the recorded event's `invocationId` survives even when the recursive realization that would normally reach that computation fails. CLI/TUI/GUI rendering was deliberately not changed to nest `economicAttempts` under an invocation yet: older sessions won't have `invocationId` on their events, and that UI decision is separate from this plumbing change.

A fifth and sixth piece landed in `6b03a0a8` and `ce4a228b`: projection totality. The operator cockpit projection previously discarded any event whose evidence body violated its own declared contract - silently, with no rejection, counter, or diagnostic - so a degraded cockpit was indistinguishable from a complete one and the Slice 6 replay termination rule was unfalsifiable. `OperatorCockpitEvidenceRejection` and `unprojectableEvidence` now name that residual, carrying the offending field's name but never its value, and separating evidence that is merely absent from evidence that is present and malformed. Both were an unnamed `null` before, which is why neither was testable. The economic path was made total first (`transition` narrowed to the `OperatorManagedEconomicLifecycleTransition` union that `frames.ts` already defined and the projection was discarding; the `addPrimitiveItems` denylist dump deleted from `economicLifecyclePresentation` so unanticipated payload fields can no longer reach an operator without a decision), then the ten composite readers outside the economic class followed. CLI, TUI, and GUI all render a non-empty rejection list as a visible degraded state. See `docs/architecture/surfaces/native-operator-surface.md` for the three-disposition contract.

Still outstanding: managed-job V7 unification (a structurally separate headless/CLI job-queue subsystem, explicitly out of scope - see the Slice 6 plan); the canonical `managed-economic-lifecycle` fixture, versioned envelope fields, and the `stage` rejection discriminator (Slice 6 items 1-3); cross-surface fixture parity (item 4), which is blocked on an unratified scope decision for Native/SDK/MCP; and two named residuals of the projection work itself - `readOptionalStringList` still discards malformed items and non-array values silently across 8 call sites, and `readWorktreeReview`/`readWorktreeConflict` remain unconverted. Roadmap Slice 5 (this doc's Slice 5, Cross-Path Account Authority Convergence, issue #39) is **not** yet unblocked: its ratified entry gates require internal Slice 5 and Slice 6 closeout recorded on #34, and neither is recorded.
Created: 2026-07-23

> Managed jobs dispatch only through an issue #34 economic commitment. Runtime
> atomically selects and reserves one route/account identity, persists the
> dispatch fence before adapter or credential materialization, and accepts only
> typed settlement bound to that identity and fence. Missing or ambiguous
> post-fence settlement remains capacity-consuming. This is Kiln-local
> reservation authority, not provider-global exclusivity.

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
- Provider-neutral approval evidence for structured or headless managed writes.
- Deterministic and bounded live verification.

## Non-Goals

- No ambient credential pooling or hidden round-robin.
- No quota evasion, subscription rotation, or retry across accounts after provider commitment.
- No harness-local job store or route policy.
- No Model Gateway service lifecycle or native picker projection.
- No `--yes`, environment-variable, prompt-text, or output-mode path that
  converts a non-interactive write into implicit approval.

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
basis. Managed-job V7 is the sole persisted contract and durably pins a
namespaced `economicAttemptId`, `adoptedDecisionAt`, objective, and canonical
terminal handoff. The operator-approved reset in issue #43 retired every
pre-V7 reader without a compatibility path.

One project-runtime SQLite writer performs route capacity, account-backed or
accountless selection, reservation, and commitment synchronously in one
immediate transaction. Its versioned schema, live owner generation, exact
replay, identity/revision conflict, dispatch fence, conservative recovery,
proven pre-fence release, release-failure evidence, and explicit reconciliation
formed the Slice 4 authority that Slice 5 now uses for dispatch. SQLite remains
authoritative while job JSON is a projection. POSIX database artifacts are
owner-only.

The old managed-invocation account-only writer and port are deleted. Direct
account-leased invocation outside the economic job path fails closed. The
credentialless config contract requires an exact zero-account virtual economics
route when used by an economic policy; runtime-selected account policy remains
supported. A committed route mismatch emits sanitized evidence before adapter
construction.

Issue #34 internal Slice 5 wires committed dispatch and typed settlement for
managed jobs and policy-bearing managed runtime/orchestration calls. That
internal sequence is separate from Roadmap 02 Slice 5 below, which converges
the managed-job authority with Model Gateway ingress.

**Internal Slice 5 remediation.** Delivery commit `1c4f0f19` shipped without a
PR or independent review. A subsequent independent review found the managed
dispatch surface was strictly weaker after that commit than before it: a
`managed_agent_invoke` call omitting `agentProfile` - which the tool's own
guidance recommends when no profile matches - skipped economic commitment
entirely and dispatched through the legacy fixed-route branch whenever the
target route's adapter was already constructed (H1, High), and for routes
uncovered by any economic policy that adapter was built eagerly at
config-composition time, materializing credentials and MCP connections before
any commitment existed (H2, High). Five further Medium/Low findings covered a
pre-fence-abort capacity leak, untested quota-rejection and ceiling-scope
edges, dead authority methods, and the missing-review process gap itself.

All seven findings are closed, each independently reviewed and verified before
merge:

- `0f070c1f` - H1/H2: direct-provider routes now require a durable economic
  commitment unconditionally; adapter construction can no longer be eager for
  any direct route regardless of profile or policy coverage.
- `51a2f721` - M1: an already-aborted pre-fence dispatch now releases its held
  commitment instead of leaking capacity.
- `e238262f` - M3/L1/L2: the provider proof fixture now proves the actual
  strict-quota rejection scenario through the real evidence producer instead
  of an unreachable derived case; ceiling scope is documented and an
  incompatible-unit comparison now fails as a typed rejection instead of an
  untyped throw; three authority methods with no production consumer were
  deleted.
- `59e73ea5` - M2: real canonical `managed_economic_lifecycle` session events
  are now emitted from production code in the dispatch coordinator and proven
  across the Runtime persistence boundary and the Gateway-contracts frame
  boundary - not the fixture-local instrumentation the three provider proof
  tests previously asserted against. This is a deliberately bounded piece of
  internal Slice 6 (Runtime + one representative consumer only); the full
  cross-surface `managed-economic-lifecycle` fixture and CLI/GUI/TUI/Native/
  SDK/MCP presentation parity remain unstarted.

### Slice 5 - Cross-Path Account Authority Convergence

Status: Queued after managed economic commitment and dispatch proof.

Unify capacity and affinity authority when Model Gateway ingress and managed
jobs target the same configured accounts. Replace the ingress
`LocalModelGatewayStore` lease deletion and last-writer-wins affinity behavior
with the same stable-capacity, settlement-conservative, fenced semantics,
without importing gateway process recovery into managed invocation.

### Slice 6 - Governed Structured Write Approval

Status: Research deferred behind Slice 5. Implementation requires an explicit
operator priority decision.

Define one provider-neutral approval-evidence contract for approved managed
writes initiated through structured or headless surfaces. Interactive
`kiln run` already handles `approval_requested`; non-interactive and
`--output json` execution must continue failing closed until this slice is
promoted. Output format, requested authority, pairing, possession of a session
token, and parent-model text are not approval evidence.

The research slice must specify:

- an authenticated approver identity and immutable approval identifier;
- exact binding to the work item or invocation, route, authority profile,
  workspace scope, proposed effect, and relevant config/evidence revisions;
- issuance, expiry, revocation, one-time consumption, replay rejection, and
  mismatch semantics;
- a secret-free durable record and resource URI that CLI, GUI, TUI, SDK, MCP,
  replay, and managed-job projections consume without creating surface-local
  approval owners; and
- pre-effect atomic validation, terminal evidence, cleanup, rollback, and
  recovery behavior when approval becomes stale or execution settlement is
  unknown.

Admission requires synthetic portable fixtures followed by one explicitly
authorized bounded live write against a disposable repository fixture. The
proof must show that matching evidence permits exactly one scoped write, while
missing, expired, revoked, broadened, replayed, or cross-route evidence denies
before provider effect. Remote pairing from Roadmap 08 may authenticate the
approver session, but never grants write approval by itself.

## Promotion Gates

- Managed economic jobs use the one Runtime SQLite commitment writer; no
  account-only compatibility writer remains.
- Every committed job records one explicit account-backed or accountless
  selection and releases proven pre-fence interim work correctly.
- Missing or stale usage is `unknown`, never fabricated.
- No provider commitment triggers hidden account retry.
- Structured or headless writes remain fail-closed unless Runtime consumes one
  current, exact, single-use approval record before provider effect.
- Interactive and structured surfaces project the same canonical approval
  lifecycle; no CLI-, SDK-, MCP-, GUI-, TUI-, or harness-local approval owner
  exists.
- Focused tests, workspace typecheck, package builds, and teardown are reliable.

## Verification

Focused Core/Runtime/CLI tests, injected-clock integration tests, clean
output-tree typecheck/build, full affected-package tests, `git diff --check`,
and independent review. The authorized bounded live probe remains Slice 3 and
is not evidence for Slice 2. Slice 6 additionally requires replay, expiry,
revocation, scope-broadening, cross-route, crash-recovery, and exactly-once
approval-consumption tests before its bounded disposable-repository live proof.

## Completion Criteria

Managed jobs have deterministic, explainable, replayable economic route and
account-backed or accountless commitment, fenced dispatch, typed settlement,
and conservative recovery with no harness-specific policy owner.
Structured/headless approved writes remain unavailable until Slice 6 supplies
canonical approval evidence; fail-closed structured output is the required
interim behavior. Model Gateway authority convergence remains Roadmap 02 Slice
5.
