# Production and Test Reference Results v1

Status: diagnostic-only, 2026-09-05.
Protocol: [Production and Test Reference v1](repository-analysis-test-project-protocol.md).
Owner: [Repository Analysis Evaluation](repository-analysis.md).

## Outcome

The unchanged TypeScript reference adapter resolves references across production
and test sources under `packages/operator-appearance/tsconfig.test.json`.
All 18 cold/warm observations match the preregistered exact locations, with all
nine expected root files, current inputs, no error diagnostics, and no partial
or failed results. The [retained collection](../fixtures/repository-analysis/test-project-v1/first-run.json)
contains nine task/repetition rows and one shared manifest of 247 captured
workspace/configuration/declaration inputs, plus separate compiler-library identity.

| Query | Total identifier occurrences | Occurrences in test source | Analyzer precision / recall | rg precision / recall |
| --- | --- | --- | --- | --- |
| Resolver queried from its test import | 10 | 7: one import and six calls | 1 / 1 | 1 / 1 |
| Recursive test helper | 3 | 3: declaration, recursive callback, invocation | 1 / 1 | 1 / 1 |
| Contrast function | 5 | 0 | 1 / 1 | 1 / 1 |

The test-source subset scores also pass in every observation. These are
identifier counts, not counts of individual test cases. Test-file membership
comes from the explicit frozen corpus, not a general test-framework detector.

The zero-reference case illustrates the boundary: the tests call
`validateSemanticAdjacencyContrast`, which calls `operatorContrastRatio`.
Direct symbol references therefore cannot establish that no tests are affected.
No behavior-impact graph or safe selective-test execution was implemented.

## Cost and evidence limits

Lexical search was already exact for every case in this cohort. This extends
configured coverage but provides no evidence of improved retrieval accuracy
over rg for these three symbols. The lexical arm still excludes targeted reads
and agent reasoning; no provider requests or task-efficiency evaluation ran.

Cold durations including capture/construction were 1.97-2.55 seconds; warm
queries took 1.43-1.96 seconds. Lexical candidate operations took 0.23-0.26
seconds. All include freshness checking and are diagnostic local timings.

Full adapter responses occupied 44,519-46,566 bytes; reference entries occupied
846-2,893 bytes. Capturing test dependencies increased the input manifest from
172 inputs in the predecessor to 247 here. The report deduplicates that manifest,
but the adapter still returns it in full. These are serialized bytes, not
measured model tokens or provider savings.

The corpus is developmental, one package and one test file; two symbols overlap
the preceding cohort. No held-out evaluation or independent reproduction has
occurred. External consumers, multi-project reference coverage, native process
crash/hang/cancellation settlement, and production integration remain unproven.

## Delivery and verification

The evaluator now accepts `--tests`, records the explicit test-file list and
exact test-source subset scores, and preserves the production-only default.
The new source oracle was inspected and frozen before running the analyzer.
No adapter, production package, test configuration, or Criba source changed.

23 focused adapter/capture/scorer tests and the scripts typecheck pass. The
additional scorer case rejects invented direct references when none are
expected. Collection reconciliation verifies all nine rows and all cold/warm
test-source subset scores. Documentation validation and whitespace checks pass.

Next bounded work should evaluate a compact model-facing reference projection
through Kiln's existing artifact reduction and exact retrieval contracts.
Keep source freshness, scope, omissions and failures visible while retaining
full provenance for retrieval. This phase supports that proposal, not automatic
analysis or a production-readiness decision. Java/Criba replacement remains
later work; this result does not close that obligation or the broader research.

Continuation: the [projection experiment](repository-analysis-projection-results.md)
has completed the compact-context step, retaining exact full evidence and
separately reporting the added cost of full retrieval.
