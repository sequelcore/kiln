# Runtime Ownership And Loading Closeout 2026

Status: internal-decision-ready for the bounded ownership and CLI composition
decisions; GUI repetition diagnostic-only

Evidence dates: 2026-08-28 to 2026-08-30

Evaluated object: Kiln repository, Bun/TypeScript runtime, CLI source
composition, and existing turn-control implementation

## Decision

The residual Core host effects moved behind Runtime-owned adapters. The
existing turn-control owners passed a deterministic long-turn audit without a
new control mechanism. A separate CLI executable composition was tested and
rejected because it did not meet every predeclared retention threshold. No
additional package-root import batch, Runtime reorganization, Rust kernel, or
Capability Fabric Slice 3 work is admitted by this evaluation.

These results support bounded internal repository decisions only. They are not
cold-operating-system-cache, CI, cross-platform, or public performance claims.

## Retained Ownership Changes

| Commit | Decision |
| --- | --- |
| `1606423d` | Core retains quality-gate semantics and the verification loop; Runtime owns shell process execution through `QualityGateCommandExecutor`. |
| `c1ccebe4` | Core retains lexical sandbox policy and denial results; Runtime owns physical filesystem canonicalization through `PhysicalPathResolver`. Read/write validation fails closed without it. |
| `84d2beb2` | Core owns the pure Kiln-home precedence rule; Runtime owns environment and host-home discovery, with lazy home lookup. |
| `36aa843d`, `4f46f65d` | Runtime gains a deterministic long-turn convergence and closeout audit; no production mechanism changed. |
| `4c2147a8` | The stable ownership and Rust decisions are promoted to architecture and roadmap. |

Focused Core, Runtime, CLI, script, typecheck, and build gates passed during
each slice. Final workspace gates are reported in the delivery commit history.
No retained change migrated or rewrote operator-private state.

## Loading Disposition

At final retained commit `d461ca88ea91751ea6931d7fe4a271b77ea4fc3d`,
the immutable analyzer reports:

| Measurement | Result |
| --- | ---: |
| CLI eager workspace graph | 898 modules |
| CLI -> Core eager production files | 87 |
| Runtime -> Core eager production files | 145 |
| CLI -> Runtime eager production files | 56 |
| Unresolved workspace edges | 0 |

The admitted Kiln-home subpaths have productive consumers and remain narrow in
the same module trace: the Core root loaded 353 workspace modules while
`@kilnai/core/kiln-home` loaded 1; the Runtime root loaded 359 while
`@kilnai/runtime/kiln-home` loaded 1. Both reductions are 99.72%.

No other root-import batch or Runtime public/internal boundary change was
admitted. The counts identify future candidates but do not justify a broad
rewrite or package split.

## CLI Baseline

Commit `4f46f65d38b8e27232f7b0b018f9b8c6e3ba89e7` supplied the
predeclared comparison. Environment: Windows `win32 10.0.26200 x64`, Bun
1.4.0, Bun's Node compatibility version 26.3.0. The protocol used 20
repetitions per class and state, one fresh Bun process per sample, isolated
synthetic cold state, one reused synthetic warm root per class, and sequential
class/state/repetition order. It made no operating-system page-cache claim.
All 120 samples succeeded with zero timeout.

| Class | State | p50 | p95 |
| --- | --- | ---: | ---: |
| Help | cold | 3099.28ms | 3351.34ms |
| Help | warm | 1186.80ms | 1301.17ms |
| Simple (`target`) | cold | 3129.34ms | 3363.76ms |
| Simple (`target`) | warm | 1236.46ms | 1305.76ms |
| Heavy (`config read`) | cold | 3196.93ms | 3381.56ms |
| Heavy (`config read`) | warm | 1281.82ms | 1749.22ms |

The first warm sample in each class remained in the ordered evidence even when
it was a cold-like outlier. p50 uses the arithmetic midpoint and p95 uses the
nearest-rank observation.

## Rejected CLI Executable Experiment

Sol review admitted one experiment only. Retention required all of these gates:

- eager graph at most 628 modules;
- help p95 at most 2681.07ms cold and 1040.94ms warm;
- simple p95 at most 2691.01ms cold and 1044.61ms warm;
- heavy p95 at most 3550.64ms cold and 1836.68ms warm;
- 120/120 success, zero timeout, and exact behavior parity.

Commit `c0104535c5dda0774ee8e9f44cf0548cc8af3633` separated the bin
from the package facade and used one ordered command registry. Its executable
graph contained 3 eager workspace modules, no eager package-root import, and no
unresolved edge. The identical 120-sample protocol completed without failure:

| Class | State | p50 | p95 | Gate |
| --- | --- | ---: | ---: | --- |
| Help | cold | 51.35ms | 55.57ms | pass |
| Help | warm | 30.11ms | 32.73ms | pass |
| Simple (`target`) | cold | 2973.32ms | 3231.92ms | fail |
| Simple (`target`) | warm | 1198.67ms | 1359.81ms | fail |
| Heavy (`config read`) | cold | 3099.02ms | 3251.51ms | pass |
| Heavy (`config read`) | warm | 1271.74ms | 1849.01ms | fail |

Because the gates were conjunctive, the graph and help improvements did not
authorize retention. Commit `d461ca88` reverted the complete experiment. No
flag, alias, compatibility path, second registry, Runtime subpath, or dead
candidate code remains.

## Long-Turn Audit

The Runtime fixture executes exactly 10 provider requests and 23 tool calls,
including 5 failures, 4 typed empty catalog searches, and 346,355 cumulative
input tokens. It proves monotonic counters, structured progress/no-progress
evidence, decision and verification preservation through compaction, and an
idempotent canonical terminal event. Missing `formal_verify` evidence remains
`not_run`; attempted closeout projects `paused` with
`required_producer_not_run`, never `completed`.

This is correctness evidence, not a latency benchmark or CPU profile.

## Test-Lane Evidence

The frozen isolated Linux baseline remains the comparable repeated lane record
at commit `2cce142cf660c8a0a1fbac42d18ed37b97b93a1a`. It used ten
sequential repetitions per lane on one warm Docker volume:

| Lane | Passed | p50 | p95 |
| --- | ---: | ---: | ---: |
| Foundation | 10/10 | 30.623s | 49.277s |
| Runtime | 10/10 | 96.293s | 124.261s |
| CLI | 10/10 | 368.071s | 411.694s |

The Windows Defender false positive that originally blocked emitted Core code
was resolved without changing Defender policy. The dense expression was
replaced with equivalent explicit evaluation, the emitted file remained
readable after a custom scan, and the affected correctness suites passed. The
Linux lane remains the performance baseline; Windows correctness runs do not
replace it.

## GUI Startup Limitation

GUI production profiling at `d461ca88` was not repeatable enough for a
comparison. The first diagnostic reached `gui-url-ready` at 26,682ms. Three
subsequent ten-sample attempts each produced 2 successes and 8 startup-child
exits before the health check, including attempts with unique gateway ports and
with unique gateway/GUI port pairs plus a two-second settlement interval. A
single verbose diagnostic with unique ports succeeded at 10,510ms.

The failed and successful rows are retained as adverse evidence. The cohort is
diagnostic-only: no GUI p50 or p95 is reported as decision-ready, and no CLI,
Runtime, Rust, or release decision depends on it. A future GUI performance
claim needs a profiler-owned repeated-run protocol that records child stderr
and proves process/port settlement.

## Rust Decision

No Rust, WASM, N-API, or sidecar slice is admitted. The measured startup work
has no runtime trace that attributes latency to a local CPU path. The long-turn
fixture is a semantic audit. No local deterministic kernel on repository HEAD
is shown to account for both 25% and 100ms of product p95 after TypeScript
cleanup. Roadmap 09 therefore remains a guardrail; a future candidate still
needs a module-specific owner, TypeScript port, parity fixtures, bridge-cost
evidence, fallback behavior, and cross-platform packaging evidence.

## Evidence Verdict

The ownership moves, long-turn audit, loading disposition, CLI baseline, and
negative executable decision are internal-decision-ready for their bounded
repository decisions. The GUI repeated-run evidence is diagnostic-only. No
part of this evaluation is public-claim-ready.
