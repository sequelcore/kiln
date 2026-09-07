# TypeScript Reference Discovery Protocol v1

Status: preregistered local development experiment, 2026-09-05.
Owner: [Repository Analysis Evaluation](repository-analysis.md).

## Decision and scope

Determine whether an opt-in TypeScript reference adapter is accurate enough to
justify a wider experiment inside Kiln. This is a model-free development corpus,
not a held-out evaluation or a production promotion. It uses the installed
TypeScript 7.0.2 `typescript/unstable/async` API, whose exact version is a refusal
boundary. No Java work, persistent index, production registration, or provider
requests are part of this experiment.

The consumer is an explicit `CodeIntelligenceAdapter` reference request over a
bounded, immutable set of TypeScript source files. Completeness is only relative
to that selected set under the declared compiler options. It never means that
all references in Kiln, other projects, generated code, or dynamic consumers
were found. External package resolution and project-reference traversal are
unsupported in this first prototype. Missing dependencies produce partial
evidence, not proof of absence.

## Frozen corpus and oracle

Sources live in `../fixtures/repository-analysis/v1/`. Coordinates below are
one-based line/column pairs at identifier starts; spans cover the identifier.
Returned API coordinates are zero-based UTF-16. Declarations, import/export
names, alias bindings, and uses are included; comments, strings, and unrelated
same-name symbols are excluded. This deliberately tests alias continuity, not
merely same-spelling matches.

| Task | Query | Expected occurrences |
| --- | --- | --- |
| exported-score | origin.ts 1:17 | origin.ts 1:17; direct.ts 1:10, 2:23; alias.ts 1:10, 1:19, 2:24; barrel.ts 1:10, 1:19; consumer.ts 1:10, 2:23 |
| shadowed-score | shadow.ts 1:26 | shadow.ts 1:26, 2:10 |
| unrelated-score | unrelated.ts 1:17 | unrelated.ts 1:17, 4:26 |

The fixture source and this protocol are written before the first analyzer
trial. Every report binds their content digests, the experiment implementation
digest, compiler version, Git HEAD, bounded selected-source hashes, and a
content-free Git dirty-state digest. Source contents are captured immutably;
post-query revalidation rejects changed/deleted inputs. New files are not
silently added to a captured set: a new set requires a new snapshot identity.
No claim is made that Git HEAD alone identifies uncommitted experiment code.

## Comparison and measurement

Run three fresh analyzer instances per task. Each instance receives the same
snapshot twice, recording cold and warm observations separately. A warm result
must equal the corresponding cold result. No result is dropped because it is
slow, partial, or incorrect. Report per-task exact-span precision/recall,
false positives/negatives, returned location bytes, full evidence bytes,
elapsed milliseconds, and process memory observations where available.

Run `rg --json --fixed-strings --word-regexp` for the queried spelling over
exactly the same files. Retain every matching span, including comments and
strings, and score it against the same oracle. This is the lexical candidate
stage of the required `rg` + targeted-read + Git baseline, not a substitute
for that complete workflow. Raw bytes and candidate precision/recall are
diagnostic; no task-cost or agent-quality superiority claim follows from them.
Targeted-read effort, agent task outcomes, provider tokens, and fallback-arm
comparisons require a later preregistered phase with a valid Runtime control.

Runtime: repository-pinned Bun; compiler: exact admitted installed TypeScript;
network/model calls: zero; source budget: 128 files and 2 MiB; library budget:
16 MiB; returned entries: at most 1000; per-request timeout: 15 seconds. Record
the actual OS/runtime and `rg` version. Timeouts/errors remain failed rows.
No speed or token-saving threshold is adopted in this development phase.

## Gates and negative cases

Advancing to a wider local experiment requires precision = 1 and recall = 1
for all three tasks and all repetitions, deterministic cold/warm locations,
and these negative tests:

- unsupported operations and invalid coordinates do not produce success;
- a missing dependency is partial, even if some locations were found;
- result truncation is partial with an explicit omitted count;
- changed, deleted, and newly selected source content changes identity;
- stale captured inputs cannot be reported as current evidence;
- path escape/symlink escape and file/byte budget violations are refused;
- compiler access is restricted to captured sources/config and pinned libraries;
- API instances close after success/failure and no analysis is registered in
  production or given memory-write authority.

Failures require a retained diagnostic result and repair or defer disposition.
Do not revise the oracle to match an analyzer result. Correct demonstrable
oracle errors explicitly, version the protocol, and retain prior observations.
Passing this gate admits only a proposal for broader evaluation. The owning
research decision remains open until the full comparison settles.

## Execution

The opt-in script and tests live under `scripts/repository-analysis/`.
`bun run research:references:evaluate` runs the frozen corpus and emits JSON.
`bun run research:references <query-path> <line> <column> <source-path> [...]`
queries an explicitly selected source set from the repository root, using
one-based line/column input. It uses the experiment's fixed strict ES2022 /
NodeNext options, not the selected files' owning tsconfig. Missing dependencies
or unsupported project assumptions must therefore remain partial evidence.
`bun run test:scripts scripts/repository-analysis/` runs the focused tests.
Reports go to stdout;
retained canonical summaries belong under this research owner. Disposable
working files use the operating-system temporary directory, never `.kiln`.
