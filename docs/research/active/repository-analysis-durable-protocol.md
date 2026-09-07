# Durable Reference Retrieval Protocol v1

Status: preregistered local development experiment, 2026-09-05.
Owner: [Repository Analysis Evaluation](repository-analysis.md).
Predecessor: [Reference projection results](repository-analysis-projection-results.md).

Replay the three canonical artifacts in the retained projection-v1 first-run
report. Freeze that report's hash in the collection; validate its artifacts
through Core's existing typed reducer and exact decoder. No new analyzer query,
provider request, production registration or persistence mechanism.

Write each artifact with the existing reversible projection service backed by
Runtime's file artifact store. A separate Bun process must reopen the store,
verify the expected canonical hash, and read every page through Core's ordinary
artifact resource provider. Use a two-line page limit to exercise continuation;
reassemble pages with their original newline separators. Compare against the
exact pretty-printed canonical artifact bytes the provider contract supplies.
Record payload and complete resource-response JSON byte counts separately.

Each of three cases must survive ordinary session-artifact churn, preserve
verification retention, and match both canonical hash and exact resource text
after reopen. Negative tests cover absent files, malformed persisted JSON,
valid same-size content tampering, a mismatched expected hash, and a stale
pagination cursor. Reopening and ordinary reads alone are not integrity proof:
the expected hash from the retained projection remains required. No retries or
silent exclusions; keep every failing row. The corpus is developmental replay,
not independent reproduction or a task-efficiency comparison.

Use temporary OS storage with a task-specific prefix, verify its resolved root
before cleanup, and remove only that directory. Retained reports stay in the
research fixture directory; no repository-local `.kiln` or private operator
state is created or modified. Handles expire when temporary storage is removed.
Current workspace freshness after a real restart remains a separate unresolved
integration step: these are historical artifacts, not current reference claims.

Run focused retrieval tests, the research suite and scripts typecheck, then
documentation and whitespace checks. Production crash/power-loss recovery,
concurrent writers, live Gateway routing, and task-level token/cost effects
remain outside this experiment. Passing establishes bounded durable retrieval.

Run `bun run scripts/repository-analysis/evaluate-durable.ts` and retain UTF-8
stdout under `docs/research/fixtures/repository-analysis/durable-v1/`.
