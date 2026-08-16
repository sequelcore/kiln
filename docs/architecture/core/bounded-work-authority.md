# Bounded Work Authority

## Thesis

Bounded work is an authority boundary, not an instruction-only expectation. An
agent does not stay inside its scope because it was asked to; it stays inside
because Runtime denies, pauses, or stops the effects that leave it.

This contract extends [`work-governance.md`](work-governance.md) and is executed
by the outer loop in
[`governed-work-execution.md`](governed-work-execution.md). It does not create a
second workflow, task database, route owner, or evidence ledger.

The contract keeps four questions separate, because conflating them is what
turns a limit into a suggestion:

1. Is this effect inside the semantic scope of the work?
2. Which resource or state ceilings may Runtime deny or stop?
3. Which configurable signals should cause a review or pause?
4. Which observations are merely diagnostic, because they establish neither
   authority nor completion?

## Ownership

| Boundary | Owns |
| --- | --- |
| Core (`@kilnai/core`) | The immutable, content-digested contract revision; scope, limits, tripwire, and policy value types; candidate and evidence identity; the admission and closeout decision functions. Core decides; it never records. |
| Runtime (`@kilnai/runtime`) | Project-scoped reservation, accounting, state transitions, and terminal truth in a SQLite authority. Runtime records and enforces; it never redefines the contract. |
| Surfaces | Projection and capability reporting only. A surface reports bounded-work state; it never establishes it. |

Core's decision functions are pure: `decideBoundedWorkAdmission` and
`decideBoundedWorkCloseout` take a revision, an accounting snapshot, and the
observed capability, and return a typed decision. Runtime supplies the snapshot
and durably applies the outcome. Neither can be bypassed by the other.

## The contract

A bounded-work contract carries schema `kiln.bounded-work-contract/v1` and four
parts.

**Intent** states the objective, the acceptance criteria, and the non-goals.
Non-goals are part of the contract because scope is defined as much by what is
excluded as by what is permitted.

**Scope** is the effect envelope: the permitted effects and surfaces, the
allowed and denied roots, the admitted work-item identifiers, and three separate
change authorities — refactor, migration, and dependency — each of which is
`none`, `scoped`, or `unrestricted`. They are separate because a change that is
safe to refactor is not automatically safe to migrate.

**Limits** are the ceilings Runtime may deny against: execution attempts,
managed invocations, concurrent managed invocations, child depth, review rounds,
and remediation rounds are always bounded. Tool calls and active duration are
optional, because a harness that cannot report them cannot be held to them.

**Tripwires** are configurable review signals — changed files, changed lines,
active duration, tool calls. A tripwire produces a diagnostic. It never, by
itself, denies work. That separation is the difference between a limit and a
signal, and it is deliberate.

**Policy** binds the three responses: whether scope expansion is denied outright
or requires approval, whether budget exhaustion pauses or stops, and the minimum
harness capability the work requires.

### Revisions are immutable

A contract revision is content-digested and frozen. Changing scope produces a
new revision that names its predecessor through `parentRevisionDigest`; it never
mutates the one in force, so the lineage of an envelope stays reconstructable
from any point in it. A revision also carries the `accountingLineageId` that
cumulative limits are counted against, which is why a route, provider, harness,
or session change does not reset a budget. Every
reservation, accounting snapshot, candidate, and decision carries the
`contractRevisionDigest` it was made under, so a decision can always be
attributed to the exact scope that authorized it. Runtime rejects work presented
against a superseded revision with `stale_contract_revision`.

## Admission

`decideBoundedWorkAdmission` returns one of five typed outcomes:

- `admitted`, with the reserved amounts and any tripwire diagnostics;
- `pause_budget_exhausted`, naming the exhausted limits and a continuation;
- `stop_budget_exhausted`, naming the exhausted limits with no continuation;
- `pause_capability_unavailable`, naming the metrics the harness cannot report;
- `pause_scope_revision_required`, naming the scope violations.

Whether budget exhaustion pauses or stops is the contract's own
`budgetExhaustion` policy, not a Runtime default.

Reservations are typed by what they consume, and carry the evidence that makes
them checkable: a `review_round` carries the candidate digest under review, and
a `remediation_round` carries both the candidate and the previous candidate it
remediates. A remediation that cannot name what it is remediating is not a
remediation.

### Unknown capability is not zero

Tool calls and active duration are measured values that can be unknown. An
unmeasurable limit does not silently pass. If the contract sets a ceiling the
harness cannot report, admission returns `pause_capability_unavailable` and
names the metric. Capability evidence is evaluated at admission from source,
observation time, and route identity; see
[`harness-integration-capabilities.md`](../surfaces/harness-integration-capabilities.md).
Missing evidence is never upgraded into an assumption of compliance.

## Reservation and settlement

Runtime's authority is `SqliteBoundedWorkAuthority`, one store per project
runtime at `<runtime>/bounded-work-authority.sqlite`, composed by the CLI
through `createProjectBoundedWorkAuthority`. Project scoping is inherited from
the existing project-runtime boundary; bounded work does not introduce a second
isolation model.

A reservation moves through `reserved` → `dispatched` → `settled`, with
`released` for a reservation abandoned before dispatch, and
`reconciliation_required` for one whose terminal truth is not yet known. Every
transition is compare-and-swap against a reservation revision, so a lost update
surfaces as `reservation_revision_conflict` rather than silently double-spending
a budget.

Settlement is explicit and total. `settleTerminal` records `completed`, `failed`,
or `cancelled` with its evidence digest. `settleUnknown` moves a reservation to
`reconciliation_required` instead of guessing an outcome. A reservation whose
result cannot be established is never quietly returned to the budget.

Every failure mode is a typed error rather than a silent fallback:
`idempotency_conflict`, `stale_contract_revision`, `reservation_not_found`,
`reservation_revision_conflict`, `reservation_state_conflict`,
`dispatch_identity_conflict`, and `accounting_conflict`.

## Candidates and evidence

A candidate is the reviewable artifact of an attempt — a git worktree, an
artifact, or captured external state. Candidate identity binds the goal run,
work item, contract revision, accounting lineage, baseline identity, and content
digest into a single `candidateDigest`, and links the previous candidate when it
supersedes one.

Evidence binds to a candidate digest, never to a work item in the abstract.
Verification, review, and acceptance evidence each name the exact candidate
content they observed. This is what makes acceptance checkable: closeout
requires that every acceptance criterion be satisfied by evidence bound to the
candidate being closed.

`decideBoundedWorkCloseout` therefore returns either
`stop_acceptance_complete`, or `pause_acceptance_incomplete` naming the missing
criteria. Candidate completion is not acceptance, and an attempt that ran to
exhaustion is not a satisfied criterion.

## Invariants

- Core decides and Runtime records; neither role is performed by a surface.
- A contract revision is immutable and content-digested; scope changes create a
  new revision.
- Every decision, reservation, and candidate names the contract revision digest
  that authorized it.
- Limits deny; tripwires only diagnose.
- An unmeasurable limit pauses; it never passes.
- Terminal state is settled explicitly or marked for reconciliation; it is never
  inferred.
- Evidence binds to a candidate digest, not to a work item.

## Benchmark

Scope fidelity and overengineering control are not yet measured. The paired
control-versus-bounded-authority experiment, its frozen task definitions, and
its limitations remain research and are recorded in the
[bounded-work research record](../../research/41-bounded-work-authority-2026.md)
under the evidence contract in
[`benchmark-validation.md`](../quality/benchmark-validation.md). Nothing in this
document claims an efficiency, parity, or quality result.
