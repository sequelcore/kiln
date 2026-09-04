# Context Efficiency Diagnostic v1

Status: Slice 2 replacement diagnostic collected on 2026-09-04 with fresh
registered-Plus-only account evidence. A post-collection review found that its
warm gate validated only top-level requests when managed-child observations
were also expected. It is retained as `diagnostic-only`, not as a final
baseline. Its source contract also describes an intermediate uncommitted
working tree over the declared starting commit, so the current repaired tree
intentionally differs from the recorded source digest.

The replacement collection retained 33 valid rows, zero invalid rows, all 11
preregistered cells at three samples, and 155 content-free physical-request
observations. The top-level requests in all 15 cold/immediate-warm pairs shared
the same observed cache partition, but managed-child partition lineage was not
retained and is unverified. Provider-reported cache reads totaled 844,800 tokens. The target
policy admitted only the two registered Plus accounts; retained execution
bindings name `codex-04dc1471` and no Free or ProLite account. The content-free
private artifact digest is
`sha256:e3368f37dcedbd3ca08a846d4772c7f9e8cc07e6183bf063262e38f0008c4e4d`.
It is bound to protocol digest
`sha256:b6dd869d0a7bc32ae33acc421b730b50a8346aa4dadf9ba71f7f793913d2c0e7`,
source digest
`sha256:1d5d05b586843c2258dee8492736fd375afc48f5a0887637aa26d4c4885d4242`,
and configuration revision
`sha256:55139b5925e5443742278f7132f597cd78689283709f61b808d702a3bbf82008`.

The artifact is historical diagnostic evidence, not a valid reproducible
benchmark or a successful quality run:
22 of 33 valid denominator rows failed a terminal, task-oracle, or authority
gate. Those failures remain in the denominator. The completed collection is
therefore evidence about bottlenecks and correctness defects, not evidence that
the measured workflows are production-ready. The highest justified verdict
remains `diagnostic-only`.

Median provider input was largest for repository reading: 229,550 tokens cold
and 229,730 immediate-warm, with eight requests in both conditions. Tool-result
heavy input increased from 90,935 cold to 104,334 warm while request count fell
from five to four; bounded implementation and managed-child warm conditions
also used more median input than cold. These descriptive observations identify
ownership targets, but three repetitions do not support population or tail
claims.

Retained failed attempts in the manifest document the target-evidence,
session-owner, request-projection, authority-oracle, host-sandbox,
capability-count, description-materialization, write-authority, and
managed-route, stale capability-provenance cache partition, and unloaded
Runtime-build defects corrected before this cohort. They are not mixed into the
frozen cohort.

## Claim and decision

This diagnostic asks which request regions and lifecycle costs dominate six
representative Kiln task classes before managed deferred projection is fixed.
The evaluated object is the complete Kiln direct Runtime path on the frozen
`codex-luna` execution target, not the model in isolation. The result may guide
which existing owner receives optimization work; it cannot support a public
performance, provider-economics, or cross-harness claim.

The highest possible verdict for this pre-fix cohort is `diagnostic-only`.
Every later candidate must be compared with the post-fix control, not only with
this intentionally drifted baseline.

## Frozen protocol

The machine-readable record is [manifest.json](manifest.json). It freezes the
replacement cohort's working-tree source identity and explicitly retains the
independent-reproduction limitation above. A replacement run is invalid if its
protocol, input, or source contract digest; canonical
configuration revision; route; model; deliberation level; authority; tool
projection; task input; cache condition; or limits differ from the manifest.
The diagnostic CLI path passes `--disable-mcp`; canonical MCP configuration is
not loaded or admitted, while built-in governed repository tools remain
available to tasks that require them.
The runner must use the ordinary CLI/Runtime session path and the
canonical `provider_request_observed`, tool, cost, continuity, and terminal
events. Benchmark-only prompts, tools, retry paths, or authority are forbidden.

Trials execute sequentially with no concurrency. Each task-condition cell has
three repetitions. The first valid request in a fresh canonical session is
`cold`; `immediate_warm` is the next identical request under the same declared
cache partition and, where the strategy supports continuation, the same
canonical session; `long_session` uses the declared scripted turns in one
canonical session. A provider contract that cannot express a condition records
that cell as unsupported; it is not silently omitted or treated as zero.

Replacement runs must also prove that cold and immediate-warm observations have
the same opaque Runtime cache-partition identity for every top-level and
managed-child request lineage. That partition includes the
selected account. Live dispatch fails closed unless fresh, unexpired usage
evidence identifies the registered Plus accounts and the target account policy
contains exactly that allowlist; internal benchmark commands receive the same
explicit account list.

Each trial is bounded to eight provider requests, 32 tool calls, one managed
child, 500,000 cumulative input tokens, 50,000 cumulative output tokens, and
180 seconds. Across 33 scheduled repetitions plus at most one invalid retry per
cell, the absolute ceiling is 44 trials and 352 provider requests. Reaching a
limit records the governed pause/failure and is never success.

The provider-request ceiling counts physical model-transport attempts,
including 401 authentication replays and transient retries. The frozen
exact-account route does not refresh credentials after execution admission; a
refresh-required credential fails before model dispatch and records an invalid
infrastructure attempt. Ordinary and internal-benchmark trials share one
Runtime-owned physical-attempt authority across the parent and any managed
direct child. Each scripted conversation turn receives one attempt from the
trial's eight-attempt allocation. The internal benchmark disables its own
invalid retry because this protocol owns the single allowed cell retry.

One invalid retry is allowed only for infrastructure, route, transcript, or
collector failure. Provider/model/task failures remain in the denominator.
Timeouts remain failures. Fallback makes a fixed-route trial invalid. No trial
is excluded after its result is observed.

## Tasks and oracles

The six task definitions are frozen in the manifest:

1. `trivial_exact` checks an exact `OK` response without tools.
2. `repository_read_only` requires repository evidence and the canonical owner
   names `RuntimeSessionOrchestrator`, `DefaultContextGovernor`, and
   `Capability Fabric`, with no mutation.
3. `bounded_implementation` runs only in a disposable fixture workspace and is
   scored by its committed test command plus an allowed-path diff check.
4. `tool_result_heavy` requires declared read/search calls over fixed fixture
   files and an exact checksum answer; large model-facing tool results are part
   of the measured path.
5. `ordinary_conversation_heavy` uses eight fixed no-tool turns in one session
   and checks the final nonce and all declared obligations.
6. `managed_agent_enabled` uses the normal managed-capability surface and
   requires one governed read-only child settlement with retained route,
   authority, and handoff evidence.

The fixture content and implementation verifier must be committed before live
collection. Until then those cells are `not_run`, not omitted.

## Evidence and accounting

Every physical request must retain:

- session, turn, logical request, physical attempt, retry, fallback, route,
  provider, model, selected deliberation level, and content-free requested,
  admitted, and completeness authority evidence;
- measured system, message, and tool-schema bytes plus tool count;
- estimated required-prompt, governed-context, tool-schema, conversation, and
  tool-result tokens, reconciled to provider input or an explicit unknown
  remainder;
- provider-reported input, output, cache-read, and cache-write tokens when
  available;
- output reserve, context-window authority, total estimated capacity,
  remaining capacity, and overflow or `capacity_unknown`;
- tool calls and durations, total wall time, terminal disposition, success
  oracle, authority evidence, retries, compactions, and residual unknowns.

The unit of analysis is one task-condition repetition. Report every row, then
per cell report sample count, failures, invalids, unsupported rows, median, and
p95 using the nearest-rank rule. With only three repetitions, tail summaries
are descriptive and no population or uncertainty claim is permitted. Quality,
authority, safety, and terminal truth are gates; tokens, cache, calls, rounds,
and latency remain a metric vector rather than one composite score.

`sampleCount` counts valid denominator rows; `attemptCount` also includes
retained infrastructure-invalid attempts. `failureCount` counts valid rows
whose terminal or task oracle gate failed. Each metric reports observed and
unknown counts, the conventional median, and nearest-rank p95. Input/output
tokens, latency, provider rounds, tool calls, managed children, physical region
bytes, provider-reported cache reads/writes, and observed retries are
aggregated. Compaction remains explicitly unknown until the ordinary path emits
canonical compaction evidence; absence of that evidence is never reported as
zero.

## Privacy and retention

Persist no raw prompt, message, tool schema, tool result, credential, private
absolute path, or caller-supplied provenance label. Private content correlation
must be omitted or use a bounded session/project-scoped keyed digest whose key
is never persisted. Exact task and fixture text may be retained only because it
is committed benchmark-owned public input. Full canonical operator transcripts
remain in their normal private store and are referenced by opaque evidence
identity; the report contains only the content-free projection.

## Required commands

Before collection:

```text
bunx tsc -b packages/core packages/gateway-contracts packages/runtime packages/cli packages/gui
bunx vitest run tests/session/runtime-session-effective-prompt-events.test.ts
bun scripts/context-efficiency-diagnostic.ts verify --manifest docs/benchmarks/context-efficiency-diagnostic-v1/manifest.json --repository-root .
```

The offline verifier must return
`{"status":"ready","providerQuotaUsed":false}` immediately before collection.
After explicit operator authorization for the declared ceiling, run:

```text
bun scripts/context-efficiency-diagnostic.ts execute --manifest docs/benchmarks/context-efficiency-diagnostic-v1/manifest.json --repository-root . --output <operator-private-output-path> --acknowledge-provider-quota
```

The acknowledgment flag records that authority was obtained; it does not grant
authority by itself. Store the report beneath the canonical operator-private
project benchmark namespace, never in the repository.
