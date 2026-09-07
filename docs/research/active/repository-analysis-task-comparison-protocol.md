# Repository Task Comparison Pilot v1

Status: offline preparation authorized; live collection not admitted, 2026-09-05.
Owner: [Repository Analysis Evaluation](repository-analysis.md).
Predecessor: [Local workflow results](repository-analysis-local-results.md).

## Decision and population

Determine whether the TypeScript reference prototype improves verified task
outcomes or total execution efficiency over search plus targeted reads and Git.
This first task pilot uses one real package and already-exposed developmental
sources. It is not representative of the whole repository, held out, or an
independent replication. Passing supports a broader evaluation proposal only.

Freeze the five prompts and evaluator-only expected spans in
`scripts/repository-analysis/task-comparison-corpus.ts` before comparative
collection. Freeze nine source hashes via `test-project-corpus.ts`, plus actual
package/root configs, package manifests and test configuration in the prepared
manifest. Two discovery tasks and three mechanical edits are included:

| Task | Final outcome oracle |
| --- | --- |
| Rename private channel parameter | Exactly four occurrences in one helper changed; unrelated channel symbols untouched |
| Rename recursive test helper | Declaration, recursive callback and invocation changed |
| Find direct resolver test calls | Six call sites; import/export/declarations excluded |
| Explain indirect contrast test impact | Zero direct test references; indirect impact acknowledged; production call and three intermediate test calls identified |
| Rename exported resolver in configured scope | Ten declarations/calls/re-exports changed across the configured source/test set |

Edit tasks return final changed-file contents. Evaluate the resulting source,
not a required tool trajectory: exact scoped rename, no unrelated changes,
owning test-tsconfig typecheck and the package's existing tests. Since these
tasks are deliberately mechanical, formatting-only changes fail their narrow
scope oracle. Report that constraint; do not extrapolate to general refactoring.
Discovery tasks require exact identifier spans. Never equate direct test
references with all behaviorally affected tests.

## Solver isolation and four arms

The public packet contains prompts, answer format and source/configuration
identities only. Solver workspaces must contain the frozen source inputs and
necessary dependency environment, excluding oracle modules, this protocol,
prepared reports and expected answers. Exposing those invalidates a trial.
The preparation script's public manifest is not a security sandbox; the live
runner must enforce isolation and authority before any dispatch.

All arms share prompts, sources, output contracts, write authority and budgets:

1. Baseline: ordinary rg, bounded targeted reads and Git.
2. Analyzer: explicit reference queries, compact evidence and exact retrieval;
   the same targeted source reads/Git remain available, but no lexical search.
3. Analyzer with fallback: both tool sets, with fallback reasons recorded.
4. Oracle context: source evidence selected by the evaluator, no expected final
   edits or answers; a capability ceiling, not a deployable competitor.

Unsupported operations, partial results, refusal and recovery count. The analyzer
has no supported call-hierarchy operation: the indirect-impact task needs source
reasoning even if references help. No extra benchmark-only production capability
or bypass is admitted. Each arm still uses ordinary governed Runtime surfaces.

## Proposed live design, pending executable freeze

Five tasks x four arms x three fresh-session repetitions = 60 paired trial rows.
Proposed limit: eight physical provider requests, 32 tool calls, 180 seconds,
500,000 cumulative input tokens and 50,000 output tokens per trial; no children,
no retries. Total proposed ceiling: 480 physical requests, not authorized here.
Rotate arm order deterministically by task/repetition. Stop at the first terminal
outcome or budget boundary; never turn failure into success by extending budgets.

Provider/model/route revisions, reasoning setting, executable authority, approval
handling, analyzer exposure, tool catalogs, dependency/compiler identities,
budgets and usage reconciliation must be frozen before execution. Match the
admitted control's target and settings; these are unresolved live prerequisites,
not defaults this preparation silently chooses.

Primary metric: verified task success per task/arm/repetition. Keep every failed,
unsupported and invalid row, with uncertainty explicit. Report task-level paired
differences and all rows; three repeats on five related tasks do not support a
broad significance claim. Secondary metrics: total provider input/output tokens,
tool calls, provider rounds, elapsed time, capture/reanalysis/retrieval overhead,
and observed memory. Provider economics remain unknown unless measured.

Count compact context and every later full retrieval, retries or rechecks in
total usage. Initial byte reduction alone is not savings. Candidate progress
requires no task-success regression, no authority/freshness/integrity violations
and lower paired total input on this pilot. Even then, broader task diversity
and separate production admission remain required.

## Authority reconciliation and preparation gate

The durable post-fix collection-2 evidence does not establish a valid control.
It reconciles 313 requests used. The subsequent private next-admission proposal
records explicit operator approval for a corrected control: 665 cumulative
maximum, 313 consumed, 352 remaining. This budget belongs to that control and
is not transferable to the repository task comparison. On 2026-09-05 the
operator instructed ?start it. use plus accounts?; the bounded workflow is
underway. A valid control, isolated solver execution and an exact admitted
comparison manifest remain required before comparison dispatch.

Offline acceptance: all frozen spans match source bytes; reference solutions
pass their outcome oracles; known wrong/partial/overbroad answers fail; each edit
solution typechecks and passes the existing package tests in isolated copies.
Retain hashes and all verification exits. These results validate instruments
and solvability, not any model or comparison arm.

Run `bun run scripts/repository-analysis/prepare-task-comparison.ts` to emit the
preparation report, including the public packet. Live dispatch is intentionally
absent. Provider-backed collection requires a valid control and an admitted,
reviewable execution manifest through the existing workflow.
