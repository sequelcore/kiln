# Reference Evidence Projection Protocol v1

Status: preregistered local development experiment, 2026-09-05.
Owner: [Repository Analysis Evaluation](repository-analysis.md).
Predecessor: [Production/test reference results](repository-analysis-test-project-results.md).

## Bounded decision

Can the research adapter offer fewer model-facing bytes while preserving
reference locations, dispositions, reasons, diagnostics, scope and freshness,
and retrieve its full serialized evidence exactly? This is a deterministic
representation experiment, not an agent-efficiency or production promotion gate.

Reuse Core's `ReversibleContextProjectionService`, `reduceTypedArtifact`,
`ArtifactResourceStore` and `DefaultContextGovernor`. Keep all implementation
under `scripts/repository-analysis`; do not change shared contracts or register
the analyzer in production. No provider requests or new dependencies.

Store the exact serialized adapter response in a supported JSON artifact,
alongside the query and projection-time freshness. The serialized response
avoids introducing a second reference-evidence schema and preserves its exact
JSON bytes. Measure the ordinary lossless reducer as well; do not claim it
compresses the opaque reference-evidence string into columnar reference data.

The reversible option retains Core's omission/retrieval disclosure and appends
all adapter fields except the project's input manifest. Keep manifest identity
and deferred input count visible. Required candidates remain full through the
governor. Canonical hash verification proves artifact integrity, not current
workspace state; verify both through the existing capture freshness callback.

## Frozen cases and accounting

Use the three cases and nine source hashes in `test-project-corpus.ts` without
changing their reference oracles. One fresh query per case; timing is incidental.
Freeze this protocol before collection. Retain every partial, failed, or mismatched
case; no retries. Abort before collection on source/oracle drift. Record protocol,
implementation and source-report identities, exact full artifacts and projected
content, all oracle scores, and retrieval verification results.

Primary gate per case: exact reference oracle, complete/current source evidence,
governor selects the reversible option, all non-manifest fields remain equal,
canonical retrieval returns the exact serialized response, and reversible UTF-8
bytes are fewer than minified adapter-response bytes. Report both minified
adapter and full governor-block bytes to avoid attributing pretty-print removal
to semantic projection. Count reversible bytes plus exact retrieved artifact
bytes separately: retrieval may erase initial savings. No token estimates or
provider savings claims. Report lossless reduction mode and bytes separately.

Negative tests must preserve partial/failed/unsupported state and diagnostics,
reject missing or mismatched canonical evidence, and reject workspace staleness
even when canonical hashes still match. Required-context overflow must preserve
the full evidence rather than force compaction. Existing source-capture tests
own detecting actual filesystem mutations; the projection tests inject their
freshness result, not another filesystem checker.

Use an isolated in-memory Core artifact store with verification retention.
Retrieval handles are valid only during this experiment's process; retained
report artifacts are the durable evidence, not those ephemeral handles. Durable
store reopen, live retrieval routing, and production admission remain outside
this experiment. Run focused research tests, scripts typecheck, and documentation
validation. Passing supports a later integration proposal only.

## Execution

`bun run scripts/repository-analysis/evaluate-projection.ts` emits UTF-8 JSON.
Retain stdout in `docs/research/fixtures/repository-analysis/projection-v1/`.
