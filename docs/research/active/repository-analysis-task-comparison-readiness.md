# Repository Task Comparison Readiness v1

Status: diagnostic-only; offline preparation complete, live comparison pending.
Date: 2026-09-05.
Protocol: [Repository Task Comparison Pilot v1](repository-analysis-task-comparison-protocol.md).
Owner: [Repository Analysis Evaluation](repository-analysis.md).

## Outcome

Five real-package tasks now have frozen prompts, source identities and executable
outcome checks: three scoped renames, direct test-call discovery and indirect
test-impact reasoning. The public packet omits evaluator-only expected spans
and answers. Live solver isolation is still an execution requirement, not a
property guaranteed merely by having separate packet fields.

The [preparation report](../fixtures/repository-analysis/task-comparison-v1/preparation-run.json)
records all five reference solutions passing their outcome oracles. Each of the
three edit solutions was applied in its own disposable copy, passed the owning
test-tsconfig typecheck, and passed all eight existing package tests. Real source
was unchanged. Source/config hashes remained current through preparation.

Nine focused verifier tests reject incomplete/unsupported answers, missed
recursive uses, unrelated file edits, omitted calls, imports passed off as calls,
repository-wide completeness claims and unsupported no-test-impact conclusions.
These checks validate instruments and solvability; no model solved a task in
this phase and no comparison-arm success rate or token saving was measured.

## Comparison design and limitations

The protocol separates search plus targeted reads/Git, analyzer-assisted reads,
analyzer with lexical fallback, and oracle context. It measures final task
success alongside total input/output, tools, rounds and elapsed time, including
retrieval and reanalysis. Proposed live size is 60 trials and at most 480 physical
provider requests, pending executable freeze. The operator subsequently instructed
"start it. use plus accounts"; this authorizes starting the bounded workflow,
with Plus-only routing. A valid control and admitted comparison runner remain prerequisites.

This is a single-package developmental pilot with previously exposed source.
It is not a representative repository benchmark or held-out evidence. Exact
rename checks intentionally reject unrelated formatting changes. Success here
would justify a broader evaluation proposal, not automatic analysis or production
promotion. Oracle context is a ceiling rather than a deployable product arm.

## Remaining live prerequisites

The durable [collection-2 evidence](../../benchmarks/context-efficiency-post-fix-v1/collection-2.md)
still does not establish the required valid Runtime control. It reconciles 313
of 352 requests used; the remaining 39 belong to that existing scope. The edited
post-fix protocol's larger budget is not authority for this new comparison.
At preparation time, no quota was repurposed, configuration changed or provider request dispatched. The subsequent authorized control runs are recorded below.

Before live collection: settle the valid control, implement/admit ordinary
governed arm exposure and solver isolation, freeze exact execution identities
and budgets, and bind the operator's authorization to the executable comparison manifest.
No runner was added that can dispatch provider calls from this preparation.

Scripts typecheck and all 47 focused research tests pass; documentation and
whitespace checks pass. Earlier reports remain unchanged. Repository Analysis's
broader promote/defer/reject decision, production admission and Criba replacement
remain open.

## Live admission progress (2026-09-05)

The earlier private next-admission proposal already records operator approval
for the field-specific `luna-scout` authority-profile correction and 313 additional
control requests: 665 cumulative maximum, 313 previously consumed, 352 remaining.
The older collection-2 handoff predates that approval. Its frozen report remains
unchanged.

The missing ordinary CLI mutation handler is implemented. It preserves all other
agent bytes, requires approval, fences source/config revisions, shares global
locks and lineage across projects, rejects directory links, and supports exact
rollback. Independent risk review found no remaining high or medium findings
after repairs. All 86 focused CLI tests pass in the working tree and an isolated
committed checkout; CLI source/test typechecks and isolated compilation pass.

The canonical profile correction committed. Native reconciliation reported
preexisting drift in `ddd-validator` and `spring-boot-reviewer`; their files were
not overwritten. Direct Runtime benchmark execution consumes the canonical
agent definition, not these native projections. The isolated control source is
commit `a1a417b1` in `kiln-live-context-control-20260905`. Private admission evidence
records the same three source-file grants relocated to that checkout, unchanged
disposable-fixture patterns, Plus account checks and the governed rollback token.
Control collection 3 stopped at the first implementation attempt. Twelve rows
have valid evidence records, with seven task failures; the thirteenth attempt
has unknown dispatch. The report retains 22 observed requests plus an eight-request
reservation. All temporary grants were restored to exact prior global bytes.

The isolated checkout had acquired explicit read-only project restrictions during
onboarding; these blocked the write preflight. Repository reads were separately
blocked because the grant CLI expects comma-separated paths but was given JSON,
which retained quotes/brackets in the actual patterns. Those extra project
restrictions were reset and the grant invocation corrected through the
ordinary CLI; inherited write preflight now passes with on-request approval kept.
A separate control-4 protocol caps collection at 322 requests, keeping 335 known
cumulative requests plus eight reserved plus 322 available within the approved
665 total. No successful control or repository-comparison result is claimed.

Control 4 permission preflight now verifies the exact 16 intended canonical grants,
allows every named path and the read tool, and keeps unmatched paths at ask. It
ran under a separate freeze and the conservative 322-request cap.

## Terminal control outcome (2026-09-05)

Control 4 stopped with 13 attempts, 12 valid evidence records, eight task
successes, four task failures, one uncertain implementation attempt and 20
missing scheduled rows. All three warm repository reads passed; all three cold
repository reads exhausted their request limit. The control remains incomplete
and diagnostic-only. No repository-analysis comparison arm ran.

Control 4 consumed 47 observed requests with eight reserved for its uncertain
attempt. Together with control 3 and the earlier 313 requests, cumulative known
consumption is 382. Two uncertain attempts reserve 16 requests and a startup
probe conservatively reserves one more: 399 maximum accounted against 665,
leaving 266 safely available. Both collections retain immutable private reports.
All temporary file grants were rolled back to exact prior global bytes; no
unreleased managed leases remained at terminal reconciliation.

A one-request-capped startup probe retained the implementation failure: audited
admission included approval-gated `write` without the required capability tag.
Independent review rejected a tag-only repair because the declared write effect
still exceeds audited authority and the shell envelope remains unknown. The CLI
repair excludes these higher-authority candidates; Runtime validation remains
unchanged. A regression exercises real tool projection, authority facets, bundle
validation and transcript persistence, including admitted `edit` and `patch`.

The frozen coding task also requires the model to run project tests through the
shell. That operation is not supported by its audited tool authority. A new
control protocol must explicitly move test execution to the host evaluator or
use an admitted bounded verification capability, then freeze and validate that
contract before another provider call. Do not silently rewrite the old prompt,
relax Runtime guards, or treat available quota as proof of readiness. The live
comparison runner and solver isolation still remain to be implemented after a
valid control exists. Criba replacement and production promotion remain open.
The final admission repair passed 79 focused tests, CLI test typechecking,
compilation and documentation checks. Independent risk review found no high or
medium authority defects. Commit `e4be4f50` retains the repair in the isolated
checkout; it has not been used for another live run. A private repair-review
addendum supersedes the earlier provisional tag-only repair status without
changing frozen reports or terminal-review evidence.

## Long-term control repair (2026-09-05)

The pending protocol now uses the dedicated bounded implementation profile and
host-observed function results. Its scorer no longer relies on managed-child
handoffs or pre-completed milestones. The dataset owns the only solver prompt.
The verifier executes only the import-free synchronous function inside a pinned,
restricted container; the host owns expected results, diff validation and scoring.
It rejects counterfeit completion, unsupported imports, loops and out-of-scope
changes. Shared container lifecycle replaces the unsandboxed Bun process path.
See the [current methodology](../../benchmarks/context-efficiency-post-fix-v1/methodology.md)
for ownership, constraints and reproducibility requirements.

The revised verifier has now run in [Control 5](../../benchmarks/context-efficiency-post-fix-v1/collection-5.md): all six coding trials passed. Overall, 13 of 27 valid trials passed; managed-child trials remained invalid. The run consumed 150 requests, leaving 116 after preserving earlier uncertainty reservations. Temporary file grants were restored exactly. Two global economic-capacity leases initially remained held; source-bound operator reconciliation subsequently released both through the canonical owner, preserving the denial evidence and fences. The request-preparation repair removes recursive fixed-route admission and realizes the committed request before fencing. Another cohort requires the repaired source to pass its gates and receive a new clean freeze. The analyzer comparison still requires its own runner, solver isolation and valid control.

Verification: 301 focused tests passed across CLI admission/execution, real
container verification, Core scoring/tool execution and diagnostic scripts.
Core, CLI and scripts test typechecks, compilation, documentation and whitespace
checks passed. Independent risk review found no remaining high or medium issues
within the documented bounded oracle. No verifier containers remained running.
