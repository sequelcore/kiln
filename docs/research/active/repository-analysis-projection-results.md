# Reference Evidence Projection Results v1

Status: diagnostic-only, 2026-09-05.
Protocol: [Reference Evidence Projection v1](repository-analysis-projection-protocol.md).
Owner: [Repository Analysis Evaluation](repository-analysis.md).

## Outcome

The research composition uses Core's artifact store, reversible projection
service, typed reducer and context governor without changing those owners.
All three real reference queries match their frozen location oracles. The
governor selects the compact option; every adapter field except the deferred
input manifest remains visible, and exact canonical retrieval passes with
current workspace verification.

The [retained collection](../fixtures/repository-analysis/projection-v1/first-run.json)
contains full serialized evidence, projected content, source and implementation
identities, scores and retrieval audits for each case.

| Query | Minified adapter bytes | Compact context bytes | Compact plus full retrieval bytes |
| --- | ---: | ---: | ---: |
| Resolver from test import | 46,557 | 5,119 | 54,409 |
| Recursive test helper | 44,510 | 3,072 | 50,105 |
| Contrast function | 45,030 | 3,592 | 51,186 |

Initial context is approximately 89-93% smaller by UTF-8 bytes. This defers
the 247-input provenance manifest; it does not reduce the analyzer's capture
work or demonstrate token, cost, latency, or agent-success improvements.
Locations retain their source hashes and zero-based UTF-16 coordinates.
Scope, root files, source/compiler/input identities, diagnostics, reasons,
omissions and projection-time freshness remain visible.

## Retrieval cost and limits

Retrieving the full artifact makes the combined payload larger than the
original adapter response in every case. The canonical envelope stores the
exact adapter JSON string and query, adding JSON escaping and metadata bytes.
Thus initial compaction is useful only to the extent that consumers can defer
full retrieval. Core's disclosure still requires retrieval before absence
claims, exact citations or sensitive actions; this experiment does not relax it.
The combined column counts minified artifact bytes and excludes transport
wrapping, so it is not a complete live retrieval cost measurement.

The ordinary lossless reducer saves only 40 bytes per canonical artifact here.
Its exact decoder passes, but the adapter evidence is an opaque JSON string
inside that artifact; this does not test columnar encoding of reference rows.
The substantial initial reduction comes from disclosed deferred evidence.

Artifact integrity and source freshness are separate checks. An artifact can
still be intact after workspace inputs change. The research verification helper
requires both Core canonical-hash verification and the existing capture's
freshness check. Projection-time freshness is explicitly historical, never a
permanent guarantee.

The experiment uses an isolated in-memory Core store with verification retention.
Its handles were tested during the run and no longer resolve after process exit.
The retained report contains the full canonical artifacts. Durable store reopen,
live resource routing, production context admission and native process lifecycle
remain unproven. These are three developmental cases from one package, not
held-out cases or independent reproduction.

## Verification and next boundary

29 focused research tests and the scripts typecheck pass. Six new projection
cases cover exact retrieval, visible partial/failed/unsupported state, omitted
counts and diagnostics, missing evidence, hash mismatch, stale workspace state,
and required-context overflow preserving full evidence. Existing capture tests
own real filesystem invalidation. Documentation and whitespace checks pass.

Only research scripts and research documentation changed in this phase. The
prototype is not production-registered and no provider requests ran.

The next bounded experiment should verify durable artifact reopen and ordinary
resource retrieval for this projection using the existing store/provider owners,
with temporary isolated storage and no new persistence mechanism. Then measure
retrieval frequency in task-level comparisons before claiming total efficiency.
Production admission and provider-backed evaluation still need their existing
governance; this result does not close broader repository analysis or Criba
replacement work.

Continuation: the [durable retrieval experiment](repository-analysis-durable-results.md)
has completed file-store reopen and ordinary provider retrieval in fresh reader
processes. Historical artifact integrity remains separate from source freshness.
