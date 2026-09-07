# Durable Reference Retrieval Results v1

Status: diagnostic-only, 2026-09-05.
Protocol: [Durable Reference Retrieval v1](repository-analysis-durable-protocol.md).
Owner: [Repository Analysis Evaluation](repository-analysis.md).

## Outcome

All three saved reference artifacts survived file-store reopen in a separate
Bun process. The reader verified each original canonical hash and reassembled
the exact resource text from five two-line pages through Core's ordinary
artifact resource provider. Verification-retained evidence survived session
artifact churn; only the newest transient artifact remained beside it.

The [retained collection](../fixtures/repository-analysis/durable-v1/first-run.json)
binds the predecessor report by its frozen hash and retains the full child-reader
output, expected text digests, implementation hashes and per-case verdicts.
This is historical replay; the analyzer did not run again.

| Artifact | Exact resource text bytes | Resource response JSON bytes | Pages |
| --- | ---: | ---: | ---: |
| Resolver from test import | 49,328 | 58,939 | 5 |
| Recursive test helper | 47,071 | 56,262 | 5 |
| Contrast function | 47,632 | 56,943 | 5 |

Response bytes include the provider's JSON wrapping and page metadata. The
deliberately small page limit exercises continuation and adds overhead; these
are not default-pagination or provider-token measurements. The canonical
evidence is an escaped JSON string, so line pagination also does not impose
a small byte ceiling on its longest line.

## Integrity and limits

Negative tests reject absent evidence, malformed persisted JSON, wrong expected
hashes, valid same-size content tampering and cursors from changed content.
Same-size tampering can remain a structurally valid stored artifact: detection
depends on checking the original source hash retained with the projection.
The research reader performs that check before returning verified content.
Ordinary file reopen alone is not an authenticity or integrity guarantee.

The reader verifies historical artifact integrity, not current source freshness.
Changes to the analyzed workspace after capture still require revalidation.
The previous in-process capture callback cannot simply survive a process exit;
no restart-time source-freshness mechanism was added here.

Runtime's existing file store owns persistence; Core's existing service and
resource provider own verification and retrieval. Only research scripts and
documentation changed. Storage was isolated under temporary OS directories,
checked before cleanup and removed after collection. The report retains the
evidence; its temporary artifact handles no longer resolve.

No live Gateway/harness integration, crash/power-loss recovery, concurrent
writer behavior, provider calls, or task-efficiency comparison was exercised.
Three developmental replays do not establish production readiness or token
savings.

## Verification and next boundary

33 focused research tests and scripts typecheck pass. Four new retrieval tests
exercise fresh-process reopen, retention churn, exact resource text, missing
and malformed evidence, tampering, wrong hashes and stale cursors. Documentation
validation and whitespace checks pass.

The next bounded step should connect opt-in research query, durable projection
and retrieval into one local workflow, with explicit historical/current status.
Current use after restart must freshly validate the analyzed project and compare
its evidence identities; an intact saved artifact is insufficient. Reuse the
owning capture/compiler machinery rather than a second filesystem-freshness
implementation. Keep production registration and provider-backed efficiency
evaluation behind their existing admission boundaries. Broader repository
analysis and Criba replacement remain open.

Continuation: the [local workflow](repository-analysis-local-results.md) now
connects save/read/check and revalidates current use through fresh analysis.
