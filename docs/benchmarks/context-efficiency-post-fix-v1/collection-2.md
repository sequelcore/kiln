# Post-Fix Control v1: Second Collection

Verdict: **diagnostic-only**. This cohort does not establish a valid post-fix
control. The managed-agent task has no valid terminal sample, two of its six
scheduled rows were never dispatched, and only nine of the 27 valid rows pass
their task oracle.

Collected through the ordinary CLI/Runtime path on 2026-09-04 (local time),
with explicit operator authorization and no Kiln MCP use during collection.
The selected target was `codex-luna`, `codex-oauth/gpt-5.6-luna`, low
deliberation, Plus-only account policy, fallback disabled, MCP disabled by
strategy, and concurrency one. Temporary file grants were part of this frozen
configuration and were restored after terminal reconciliation.

## Frozen identity

- Source: `6a9cce7e73db477bcd6db9f5ed782c2f449770d2`.
- Configuration: `sha256:0a53a9e718be65859222657a7a7392a507fd5c53f252b4b5c08387789f22ff85`.
- Source contract: `sha256:8f683eab5ec13cfbd5761ac878ca409957aa7a5d4f018f8c6c527466bcd1fe96`.
- Input contract: `sha256:479dd067e87530870653b9996fe72874b9ad3722ee08157a8f0121402ff74baf`.
- Protocol: `sha256:f6d48a61b4fcade8fd2d627e20d4584a5e266a7dc0afff5bd37637c544a23b8f`.
- Schedule: `sha256:819073712775deab806e9d18bbc3d0a371bf05e232ed6dbb32b5c0bffd61f1df`.
- Execution identity: `sha256:5e83afecc5339b756de62f1bbce1c4f5d2ff4a649e9d2cff244fdfe2f8a12a32`.
- Frozen manifest: `sha256:3e1a4969e455eac2420848359a301a9326ea4d4efd61af142a00c833c9864b5b`.
- Content-free report file: `sha256:8fa96bcb1a0d2f36452cf9ee15098230bc54a2f903bf55ca761b9639eccd2963`.
- Content-free reconciliation receipt: `sha256:1b722c0dcde12a041d5fd2a414c4a9d0b9b85d69f178ca44cb1e82638ecc0965`.

The immutable manifest, report, and supplemental receipt remain in the
canonical private project benchmark namespace as
`context-efficiency-post-fix-v2-frozen.json`,
`context-efficiency-post-fix-v2-collection.json`, and
`v2-reconciliation.json`. The current [protocol template](protocol.json) may
describe later work; it does not replace this frozen identity.

## Reconciled outcomes

| Task | Valid | Invalid | Missing scheduled | Oracle passes | Authority pass/fail/unknown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Trivial exact | 6 | 0 | 0 | 6 | 6/0/0 |
| Repository read-only | 6 | 0 | 0 | 3 | 6/0/0 |
| Bounded implementation | 6 | 1 | 0 | 0 | 0/6/1 |
| Tool-result heavy | 6 | 0 | 0 | 0 | 6/0/0 |
| Conversation heavy | 3 | 0 | 0 | 0 | 3/0/0 |
| Managed-agent enabled | 0 | 6 | 2 | 0 | 1/0/5 |
| **Total** | **27** | **7** | **2** | **9** | **22/6/6** |

Thirty-four attempts cover 31 of 33 scheduled rows. The missing rows are the
managed-agent cold and immediate-warm trials for repetition three. The seven
invalid attempts comprise six infrastructure failures and one collector
failure. The permitted retry was used once in bounded implementation and once
in each managed-agent condition.

The six bounded-implementation samples passed the fixture outcome checks but
failed the authority check and the internal benchmark consistency gate.
The frozen task requests `audited`
authority, while all 42 retained provider observations for this task record
authoritative `destructive` request and admission. That contract mismatch is
the recorded cause of the authority failures. Separately, the failed internal
consistency gate produces `canonical_admission_failed` in the task oracle; that
code does not identify the authority mismatch as its cause. The additional
invalid attempt has unknown authority evidence.

Three repository-read samples passed. The other three lack the required term,
citation, and read-target evidence. All six tool-result-heavy samples lack
answer verification and required read-target evidence; one also misses the
minimum tool-call count. All three conversation samples fail the scripted
conversation obligation.

Five managed-agent attempts are canonically invalid with reason
`route-unavailable`. Private internal artifacts show attempts to use the
`luna-scout` profile with route `codex-luna`, but no configured child route was
resolved and no managed-invocation record was produced. This is a later
artifact-backed diagnosis; the content-free report retains only the invalid
classification. The sixth managed-agent attempt completed its parent run
without invoking a child, so its oracle records `managed_child_count_mismatch`
and `canonical_admission_failed`. The collector then halted because the paired
cold trial had not produced a cache-partition baseline.

## Metrics

Metrics include valid samples only. Values are **median / nearest-rank p95**;
each populated cell has three samples, so uncertainty remains descriptive.
Failure rows that are canonically valid stay in these aggregates.

| Task | Condition | Samples/attempts | Failures | Input tokens | Output tokens | Duration ms | Requests | Tool calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Trivial exact | cold | 3/3 | 0 | 69 / 69 | 5 / 5 | 7,546 / 8,005 | 1 / 1 | 0 / 0 |
| Trivial exact | warm | 3/3 | 0 | 69 / 69 | 5 / 5 | 7,163 / 7,353 | 1 / 1 | 0 / 0 |
| Repository read-only | cold | 3/3 | 1 | 41,270 / 43,943 | 960 / 1,020 | 35,985 / 36,059 | 6 / 8 | 11 / 12 |
| Repository read-only | warm | 3/3 | 2 | 37,172 / 41,159 | 690 / 1,121 | 36,215 / 36,403 | 8 / 8 | 14 / 14 |
| Bounded implementation | cold | 3/4 | 3 | 8,495 / 12,719 | 959 / 1,262 | 32,955 / 38,204 | 5 / 7 | 6 / 7 |
| Bounded implementation | warm | 3/3 | 3 | 8,400 / 13,013 | 841 / 1,009 | 35,236 / 37,647 | 5 / 7 | 6 / 8 |
| Tool-result heavy | cold | 3/3 | 3 | 81,971 / 82,526 | 1,285 / 1,944 | 43,283 / 55,800 | 8 / 8 | 16 / 22 |
| Tool-result heavy | warm | 3/3 | 3 | 51,966 / 58,527 | 1,981 / 2,496 | 56,592 / 66,849 | 8 / 8 | 29 / 29 |
| Conversation heavy | long | 3/3 | 3 | 654 / 654 | 187 / 211 | 69,463 / 69,720 | 8 / 8 | 0 / 0 |
| Managed-agent enabled | cold | 0/3 | 0 | n/a | n/a | n/a | n/a | n/a |
| Managed-agent enabled | warm | 0/3 | 0 | n/a | n/a | n/a | n/a | n/a |

| Task | Condition | Physical bytes | System bytes | Message bytes | Tool-schema bytes | Cache-read tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Trivial exact | cold | 273 / 273 | 177 / 177 | 94 / 94 | 2 / 2 | 0 / 0 |
| Trivial exact | warm | 273 / 273 | 177 / 177 | 94 / 94 | 2 / 2 | 0 / 0 |
| Repository read-only | cold | 306,745 / 328,895 | 3,240 / 4,320 | 126,279 / 126,613 | 176,892 / 235,856 | 10,240 / 19,968 |
| Repository read-only | warm | 312,387 / 336,248 | 4,320 / 4,320 | 95,266 / 96,072 | 235,856 / 235,856 | 10,240 / 15,360 |
| Bounded implementation | cold | 84,651 / 121,738 | 885 / 1,239 | 11,816 / 19,769 | 71,950 / 100,730 | 0 / 1,536 |
| Bounded implementation | warm | 83,894 / 123,713 | 885 / 1,239 | 11,059 / 21,744 | 71,950 / 100,730 | 0 / 0 |
| Tool-result heavy | cold | 557,291 / 559,723 | 2,712 / 2,712 | 318,723 / 321,155 | 235,856 / 235,856 | 12,800 / 15,872 |
| Tool-result heavy | warm | 396,477 / 415,114 | 2,712 / 2,712 | 147,743 / 157,909 | 235,856 / 264,659 | 15,360 / 15,872 |
| Conversation heavy | long | 2,653 / 2,653 | 1,574 / 1,574 | 1,063 / 1,063 | 16 / 16 | 0 / 0 |
| Managed-agent enabled | cold | n/a | n/a | n/a | n/a | n/a |
| Managed-agent enabled | warm | n/a | n/a | n/a | n/a | n/a |

Across all 34 retained attempts, including invalid attempts, the report records
1,377,655 input tokens, 28,036 output tokens, 198,144 cache-read tokens, zero
cache-write tokens, and 9,243,281 physical request bytes. Managed-child count,
cache-write tokens, and retry count have median and p95 zero in every populated
cell. Compaction count remains unknown for all valid samples.

Independent recomputation matched all 220 reported cell-count and metric
fields.

## Physical settlement supplement

The immutable report remains correctly marked **incomplete**: it records 189
observed physical requests, one unknown attempt with five observed requests,
an eight-request reservation, and a protocol-bound range of **189-192**. Do not
rewrite or reclassify that evidence.

Independent reconciliation establishes an exact operational count of **189**.
The final internal artifact
`kiln-managed-child-agent-2026-09-05T01-36-28-156Z.json`
(`sha256:605360972b259aeb83a4cf09b2e85164cc47fcaa57cab565b73f61c201cf2e55`)
binds to the final report row and contains exactly the same five projected
provider observations
(`sha256:bf64a1ba03f34860cda8adb70bbcaa8a2e2512f50530d1444c824e24bcd3b983`).
All five have terminal completed dispatches and known input/output usage. The
internal process succeeded, its canonical trial was valid, and it recorded zero
managed invocations.

The internal process had exited and its artifact had been read before the
collector entered the cache-pair check. No provider dispatch follows that
check. The paired cold sample was invalid, so no cold cache partition existed;
the resulting collector error defaulted to unknown dispatch evidence and
retained the full reservation. The unobserved three-request remainder is
therefore a conservative report bound, not evidence of three additional
dispatches. All 189 retained observations are unique, terminal, and have known
input/output usage.

Collection 1 used 124 requests. The two collections therefore used exactly
**313 of the authorized 352 requests**, leaving **39**. This operational
supplement supports safe cleanup and grant restoration. It does not repair the
missing managed-agent rows, authority mismatch, task failures, or incomplete
report accounting, and it does not establish the required valid control.

## Privacy

The content-free report contains no raw answers, prompts, messages,
transcripts, tool arguments or results, credentials, absolute filesystem paths,
forbidden correlation hashes, or secret-pattern values. The supplemental
receipt retains only identities, digests, counts, terminal booleans, and the
bounded collector diagnosis. Raw benchmark artifacts remain private.
