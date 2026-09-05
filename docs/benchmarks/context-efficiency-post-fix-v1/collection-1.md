# Post-Fix Control v1: First Collection

Verdict: **diagnostic-only**. This cohort is not a promotion control. All six
bounded-implementation rows lack a valid terminal result.

Collected through the ordinary CLI/Runtime path on 2026-09-04 (local time), with
explicit operator authorization and no Kiln MCP use during collection. The
selected target was `codex-luna`, `codex-oauth/gpt-5.6-luna`, low deliberation,
Plus-only account policy, fallback disabled, MCP disabled by strategy, and
concurrency one.

## Frozen identity

- Source: `7479f5bf05d4e59bc227f8f028a05467690347c7`.
- Configuration: `sha256:1e1d7cf0595519e8866f79fe6230f6fe3809ea6ad829fd53e752422fe91644a2`.
- Protocol: `sha256:c60e41c9926fb5db39868514dd6b55ff1518e19868c5888ab4b615167d2d2fda`.
- Content-free report: `sha256:0ac57380c02c0170301e8cd8cb5d9b2a5fcefaef0bf297614187c142dc637a9e`.

The immutable execution manifest and report remain in the canonical private
project benchmark namespace as `context-efficiency-post-fix-v1-frozen.json`
and `context-efficiency-post-fix-v1-collection.json`. The current
[protocol template](protocol.json) may describe a later proposed collection;
it does not replace this frozen identity.

## Reconciled results

| Task | Valid attempts | Invalid attempts | Oracle passes |
| --- | ---: | ---: | ---: |
| Trivial exact | 6 | 0 | 6 |
| Repository read-only | 6 | 0 | 0 |
| Bounded implementation | 0 | 8 | 0 |
| Tool-result heavy | 6 | 0 | 0 |
| Conversation heavy | 3 | 0 | 0 |
| Managed-agent enabled | 6 | 0 | 0 |

Thirty-five attempts cover all 33 scheduled rows, including the two permitted
invalid retries used by bounded implementation. Twenty-seven attempts are valid;
eight are infrastructure-invalid. All 27 valid rows passed the recorded
authority check. Valid task failures remain in the denominator.

Physical accounting is complete: **124 requests**, zero unknown reservations,
zero unsettled transports, zero request overruns, and observed token totals.
Independent review found no sequence, duplicate, missing-schedule, or retry-limit
defects. All 162 recomputed base-metric medians and nearest-rank p95 values match.
Privacy review found no raw answers, prompts, messages, transcripts, tool
payloads, credentials, or secret-pattern values in the report.

The collector correctly exited with code 1 and partial reconciliation because
six scheduled rows never obtained a valid terminal sample. Physical settlement
is complete; baseline validity is not.

## Permission diagnosis and next gate

Canonical tool-level admission permits reads, but ordinary invocation admission
also evaluates the concrete file path. Unmatched paths under `on-request`
require approval, and JSON/noninteractive CLI runs have no approval handler.
The resulting tool denial explains the observed repository-read failures and
bounded implementation's unsuccessful sessions, subsequently classified as
`route-unavailable`. The fixture verifier correctly fails unchanged source.

Independent policy review confirms this intersection is intentional and covered
by permission-evaluator tests. Tool permission must not override file-level ask
or deny. Do not weaken the oracle, change approval to `never`, or add a
benchmark-only approval callback. This diagnosis does not by itself explain or
excuse every conversation or managed-task failure.

A changed-policy rerun requires a concrete scoped file-access decision and a
new frozen configuration/source identity through ordinary CLI capabilities.
No changed-policy run is authorized or started by this report. Of the operator's
352-request ceiling, **228 remain**. Any later collection must reserve each
full attempt within that remaining ceiling and remain a separate cohort.
