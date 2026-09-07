# Production and Test Reference Protocol v1

Status: preregistered local development experiment, 2026-09-05.
Owner: [Repository Analysis Evaluation](repository-analysis.md).
Predecessor: [Configured project results](repository-analysis-project-results.md).

## Claim and scope

Evaluate exact symbol references across the nine root files admitted by
`packages/operator-appearance/tsconfig.test.json`: eight production files and
`tests/operator-appearance.test.ts`. Use the existing adapter, actual inherited
configuration and installed declarations. No configuration overrides, emit,
dependency installation, provider calls, or production registration.

This measures identifier occurrences in test sources, including imports and
helper declarations. It does not identify enclosing test cases or every
behaviorally affected test. In particular, `validateSemanticAdjacencyContrast`
calls `operatorContrastRatio`, and tests call the former without directly
referencing the latter. Zero direct references must not imply zero test impact.

## Frozen oracle

Source inspection sets literal coordinates and hashes in
`scripts/repository-analysis/test-project-corpus.ts` before analyzer collection.
The eight production hashes reuse the previous frozen corpus. Paths below are
relative to `packages/operator-appearance`; coordinates are one-based.
The first listed location is the query. Definitions and exports count.

| Task | Expected locations | Test-source occurrences |
| --- | --- | --- |
| resolver-from-test-import | tests/operator-appearance.test.ts 19:3; src/resolve.ts 85:17, 129:10; src/index.ts 32:3; tests/operator-appearance.test.ts 131:19, 138:18, 145:22, 154:20, 165:23, 178:28 | 7 (one import, six calls) |
| recursive-test-helper | tests/operator-appearance.test.ts 26:10, 36:40, 89:27 | 3 (declaration, recursive callback, invocation) |
| contrast-without-direct-test-reference | src/colors.ts 86:17; src/contrast.ts 1:30, 152:19, 197:30; src/index.ts 22:3 | 0 |

These are developmental cases selected by the implementer, not held-out data
or independent reproduction. The resolver and contrast symbols deliberately
overlap the preceding experiment; cohorts are not independent samples.

## Collection and gate

Use the configured-project evaluator with `--tests`. Three fresh instances per
task, two queries each (cold/warm), serial execution: nine rows, 18 observations.
Compare rg lexical candidates over the same nine files. Retain failures and
partial results without retries or exclusions. Source-hash/oracle mismatch
before collection aborts the cohort; root-file mismatch fails its row. Preserve
earlier reports unchanged and retain any failed collection before repairs.

Primary gate: every observation complete, exact-span precision and recall both
one, expected root files present, current inputs, and cold/warm agreement.
Report test-source subsets against the frozen test file list separately;
an empty expected and observed subset scores one, and any false positive fails.
Timing and bytes are diagnostic only. No inference to token savings, speed
advantage, agent success, test selection safety, or production readiness.

Retain protocol/implementation digests, source and transitive-input hashes,
Git revision/dirty state, runtime/compiler/options, rg version, diagnostics,
full locations, subset scores, evidence/location bytes and elapsed times.
The predecessor's capture budgets, exact library exception, 15-second query
timeout, and unresolved native crash/hang/cancellation limitations still apply.
No new graph traversal or implicit filesystem fallback is admitted.

Run focused adapter/scorer tests and scripts typecheck before collecting.
Run documentation and whitespace checks at closeout. Passing admits a proposal
to reduce model-facing evidence through Kiln's existing artifact machinery;
it does not authorize production integration or a provider-backed evaluation.

## Execution

`bun run research:references:project:evaluate --tests` emits JSON. Retain UTF-8
stdout under `docs/research/fixtures/repository-analysis/test-project-v1/`.
Input manifests remain deduplicated in the report, while evidence bytes measure
the full adapter response. Test-source subsets are descriptive reference data,
not executable lists of tests to skip or run.
