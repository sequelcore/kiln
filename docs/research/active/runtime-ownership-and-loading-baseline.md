# Runtime Ownership And Loading Baseline

Status: active; S0 evidence frozen
Owner: Kiln engineering
Evidence cutoff: 2026-08-28 at commit
`2cce142cf660c8a0a1fbac42d18ed37b97b93a1a`
Promotion targets: Core and Runtime architecture, CLI composition, performance
evaluations, and the CI test-suite investigation
Exit condition: every retained ownership or loading change has an independently
reviewable owner, comparable measurements where performance is claimed, and a
promoted architecture or evaluation record; this note is then deleted.

## Question

Which remaining Core execution boundaries, package-root imports, startup edges,
and agent-turn controls require change before Kiln can make an evidence-backed
decision about a native kernel?

## Method And Evidence Tiers

The committed analyzer reads TypeScript and package manifests from immutable Git
blobs rather than from the working tree:

```bash
bun run report:architecture-baseline --ref 2cce142c
```

It classifies exact `@kilnai/core` and `@kilnai/runtime` root imports by consumer,
source/test surface, and eager/type-only/non-eager load. It also follows literal
eager workspace edges from `packages/cli/src/index.ts`. The scanner is a narrow
ESM lexical analyzer, not a TypeScript compiler. It masks comments and template
literals, understands multiline imports and re-exports, and deliberately groups
type-position `import()` with other non-eager import expressions. Computed,
aliased, conditionally resolved, and non-literal edges require a runtime trace.

Evidence in this note has three tiers:

1. The immutable static report is decision-ready for selecting the next scouting
   boundary at the recorded commit.
2. Existing Vitest and startup investigations are supporting repository evidence
   with the limitations recorded in their owning research notes.
3. Fresh-process timings below use a warm filesystem and are diagnostic only.
   They are not cold-cache, CI, or product-performance claims.

S0 changed no production code, package exports, durable state, or `~/.kiln/`
content. It added only the analyzer, its tests, this research record, and a root
script entry.

## Frozen Import And CLI Graph

At the evidence commit, the CLI entrypoint's eager static workspace graph
contains 882 modules:

| Package | Modules |
| --- | ---: |
| `@kilnai/core` | 361 |
| `@kilnai/runtime` | 335 |
| `@kilnai/cli` | 133 |
| `@kilnai/gateway-contracts` | 45 |
| `@kilnai/operator-appearance` | 7 |
| `@kilnai/tools` | 1 |

The graph has 197 exact Core/Runtime root edges, 123 literal non-eager
`import()` edges, 29 external specifiers, and zero unresolved workspace edges.
The zero-unresolved result is an analyzer integrity gate, not proof that the
static graph observes runtime resolution.

Production root-import inventory:

| Target | Consumer | Load | Files | Occurrences |
| --- | --- | --- | ---: | ---: |
| Core | CLI | eager | 94 | 94 |
| Core | CLI | type-only | 69 | 80 |
| Core | CLI | non-eager | 11 | 25 |
| Core | Runtime | eager | 137 | 144 |
| Core | Runtime | type-only | 174 | 201 |
| Core | Runtime | non-eager | 18 | 35 |
| Core | React | type-only | 5 | 5 |
| Core | TUI | eager | 1 | 1 |
| Runtime | CLI | eager | 39 | 41 |
| Runtime | CLI | type-only | 23 | 25 |
| Runtime | CLI | non-eager | 12 | 22 |

These counts reject a repository-wide import rewrite. A migration must select
one demonstrated product owner, prove the full transitive path is narrower, and
retain the change only with behavior parity. Root removal follows completed
consumer migration; it is not the first step.

## CLI Startup Finding

CLI command selection already uses literal dynamic imports. The startup defect
candidate is different: `packages/cli/src/index.ts` is both the executable
entrypoint and the package's broad public facade, so its top-level re-exports
instantiate Core and Runtime before command selection can help.

The next startup design candidate is therefore one executable composition entry
separate from the existing public facade. It must reuse the current command
resolution and must not add a second registry. No production change is admitted
until the startup measurement contract records CLI cold/warm `--help`, a simple
command, and a heavy command independently from GUI production and Vite
development startup.

Fresh-process, warm-filesystem diagnostics on Windows 11 Pro, Ryzen 5 5600X,
Bun 1.4.0, 20 samples each:

| Operation | p50 | p95 | Range |
| --- | ---: | ---: | ---: |
| Empty Bun process | 28.98ms | 33.09ms | 22.64-33.22ms |
| Core root import | 574.51ms | 678.38ms | 488.67-963.52ms |
| Runtime root import | 771.41ms | 900.38ms | 693.38-1,201.35ms |
| CLI source `--help` | 965.46ms | 1,099.39ms | 824.66-1,218.64ms |

These timings identify a measurable candidate only. They do not attribute the
latency or establish an optimization claim.

## Closed Core Execution Candidate Inventory

The following sixteen candidates are the complete S1 scouting queue at the
evidence commit. They are candidates, not preauthorized extractions. Each must
either be deleted as unconsumed, retained with an explicit provider-neutral
reason, or moved in its own behavior-preserving slice.

| ID | Candidate | Current evidence and required disposition |
| --- | --- | --- |
| S1A | models.dev fetch/cache client | No productive external consumer found; prove and delete, or identify the owner. Runtime has an independent source. |
| S1B | SQLite checkpoint store | Only Core tests found; prove and delete, or identify a productive lifecycle. |
| S1C | SQLite field store | No productive constructor found; prove and delete, or identify a productive lifecycle. |
| S1D | JSONL audit log | Concrete implementation exported from Core with no external constructor found. |
| S1E | SQLite memory repository | Completed 2026-08-28: Core retains the pure `MemoryRepository` contract and Runtime owns one private SQLite adapter/factory; Runtime, CLI, and GUI consumers pass explicit database paths. Concrete-backed integration tests moved to Runtime. |
| S1F | AES file secret store | Productive CLI and Runtime consumers; Runtime must own file persistence if moved. |
| S1G | file artifact resource store | Productive benchmark consumer; preserve the provider-neutral artifact contract. |
| S1H | trusted-execution receipt persistence | CLI trust/integrity consumer; preserve semantic receipt rules while assigning JSONL I/O. |
| S1I | domain registry filesystem discovery | CLI startup consumer; split parsing and identity from host discovery only if the dependency direction remains singular. |
| S1J | package filesystem loading and hashing | Preserve deterministic parsing/hash semantics; assign directory and file execution to an operational owner. |
| S1K | skill filesystem loading and materialization | Runtime carries the registry; prove the owner of directory discovery and materialization separately from skill semantics. |
| S1L | MCP SDK client transports | Concrete network/process lifecycle in Core with Runtime and CLI consumers; preserve provider-neutral MCP contracts. |
| S1M | MCP developer-tools server | Concrete SDK server lifecycle; do not combine with the client merely because both use the MCP SDK. |
| S1N | verification and quality process adapters | Concrete process/filesystem adapters for quality gates; retain semantic observations and injected ports in Core. |
| S1O | default web-fetch implementation | Native fetch fallback is concrete I/O; the injected web search/extract/interactive contracts remain provider-neutral. |
| S1P | builtin developer-tool host execution | File/process/search/native execution is concrete, but canonical developer-tool architecture currently assigns behavior to Core. Resolve that doctrine conflict before moving code. |

S1P is a hard stop, not an inferred migration. The developer-tools architecture
states that Core owns schemas and execution behavior, while credential
governance states that Core is I/O-free for secrets and provider SDKs. These
statements can coexist for pure contracts but do not settle general host-tool
execution. Any change must first update the owning architecture decision without
creating a second tool registry or implementation.

Cross-cutting host-path and environment reads (`kiln-home`, sandbox
canonicalization, environment lookup) remain attached to their current
capability candidates; they are not a speculative global utility slice.

## Runtime Module And Public-Surface Disposition

Runtime already has visible vertical areas including sessions, gateways,
provider adapters, execution kernel, voice, work governance, and agent tasks.
S0 found no evidence supporting a blanket file reorganization or package split.
Future internal changes must name the independently changing decision and state
or lifecycle it owns.

No Runtime subpath is admitted by S0. A candidate must have a productive
cross-package consumer, expose a stable contract rather than composition or a
concrete adapter, and load at least 30% fewer workspace modules than the root in
the same trace. If none qualifies, Runtime retains only `.`.

The root-import queue is closed by the immutable analyzer output, but its slice
count is intentionally not guessed from directories. Syntax identifies edges,
not bounded contexts. Each next S2 slice must select one existing owner from
that closed inventory and record its consumer and transitive graph before edits.

## Agent-Turn Goal Correction

The proposed convergence slices S7-S10 describe mechanisms already present at
the evidence commit:

- Core `turn-convergence.ts` owns deterministic limits and precedence.
- Runtime `runtime-execution-envelope.ts` supplies finite defaults for provider
  requests, tool rounds and calls, cumulative input, elapsed/active time,
  recovery, and no-progress.
- Runtime observes and reserves before further provider or tool work through
  `runtime-turn-convergence-observation.ts` and the session orchestrator.
- `runtime-turn-progress-classifier.ts` classifies structured no-progress
  evidence.
- Core `conversation-projection.ts` performs deterministic tool-result
  compaction and Runtime records its evidence before dispatch.
- `runtime-completion-obligations.ts`, Core terminal dispositions, the event
  ledger, and response assemblers gate and project honest terminal outcomes.

Those slices are removed from the implementation queue. The remaining work is a
fixture-based gap audit reproducing the reported long trajectory: provider
requests, tool calls/failures, empty searches, cumulative input, projected
context, elapsed time, verification evidence, and terminal disposition. A new
concept is admitted only if that observable audit proves an uncovered failure.

## Startup And Test Evidence

The existing startup profiler already separates GUI development and production,
gateway readiness, Vite readiness, browser readiness, and first usable state.
It records commit and environment state. It does not yet provide comparable
CLI command classes or repeat aggregation, so those are the bounded additions
required before changing CLI composition.

The CI test-suite investigation remains the owner of suite-performance claims.
Its strongest existing evidence is that Runtime fell from 197.4s to 67.6s after
narrow Core imports, while the CLI lane remains dominated by import time. S0's
repeated lane runs freeze a same-machine baseline; results are added only after
all repetitions pass under the same commit and environment.

### Repeated baseline: Windows blocked, isolated Linux runner complete

The first repeated Foundation attempt exposed a non-hermetic test in
`tool-environment.test.ts`: two cases launched real host binaries and one timed
out after five seconds. Micro-commit `2cce142c` replaced those host calls with
the existing synthetic executor. The focused file then passed 20 consecutive
runs and the Core test project typechecked. This is test-signal repair, not a
performance change.

A detached worktree at that exact commit then completed a forced frozen install
with Bun 1.4.0 and a forced TypeScript build. Windows security blocked the newly
emitted `packages/core/dist/security/dangerous-command-detector.js`: TypeScript
emitted its declarations and source map, but the JavaScript file was unavailable;
`Get-FileHash` reported that the file contained a virus or potentially unwanted
software, and importing the Core package failed with `EUNKNOWN`. No security
exception or bypass was attempted.

That host intervention still prevents a comparable isolated Windows baseline.
No security exception or bypass was attempted. Instead, the repeated S0
baseline ran in Docker Desktop's Linux environment from a clean, detached clone
at exact commit `2cce142cf660c8a0a1fbac42d18ed37b97b93a1a`.

The Windows test blockade was resolved later without changing Defender policy.
Threat history identified `Trojan:Script/ObfusScript.A!ml` against the single
dense download-and-execute regular expression in the emitted detector. Kiln
replaced that expression with explicit pipeline segmentation and manual ASCII
word-boundary evaluation while retaining the same deny/ask outcomes, including
the prior boundary edge cases. A forced Core compile followed by a custom
Defender scan produced no new detection and left the emitted JavaScript
readable. On the Windows host, the full Core suite then passed 280 files and
3,430 tests; the full Runtime suite passed 312 files and 3,866 tests with five
skips, plus its Bun/SQLite probes; eight selected CLI MCP and native-projection
files passed 93 tests. These are correctness gates, not replacement measurements
for the isolated Linux baseline above.

The runner used:

- Docker image `node:24-bookworm`, Node 24.20.0, Git 2.39.5, digest
  `sha256:be23f54a88d34e8824c741b19b91064094f92c1c97b194144bfc8b50d67258e2`;
- the exact Bun 1.4.0 binary from `oven/bun:1.4.0`, digest
  `sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6`;
- `bun install --force --frozen-lockfile --ignore-scripts`, a forced TypeScript
  compile, and `npm rebuild better-sqlite3` under Node 24;
- the repository's committed Vitest isolation and worker settings unchanged;
- one warm Docker volume, with no other intentionally scheduled heavy work,
  reused across samples. Container startup is excluded from the timings.

The Node image is intentional. The official Bun image aliases `node` to Bun in
this environment, which changed the test runner's Node compatibility behavior.
The mixed runner preserves Bun 1.4.0 for package scripts while providing an
actual Node 24 process for Vitest and native module rebuilding.

Fresh Bun child-process diagnostics, 20 samples each on the warm volume:

| Operation | p50 | p95 | Range |
| --- | ---: | ---: | ---: |
| Empty Bun process | 6.65ms | 7.94ms | 6.33-8.20ms |
| Core root import | 649.01ms | 807.38ms | 577.96-966.15ms |
| Runtime root import | 852.19ms | 916.37ms | 773.25-934.06ms |
| CLI source `--help` | 908.31ms | 989.54ms | 833.46-1,016.89ms |

Repeated complete lane results use the arithmetic midpoint for p50 with ten
samples and nearest-rank p95, which is the maximum sample at `n=10`:

| Lane | Passed | p50 | p95 | Range |
| --- | ---: | ---: | ---: | ---: |
| Foundation | 10/10 | 30.623s | 49.277s | 26.287-49.277s |
| Runtime | 10/10 | 96.293s | 124.261s | 88.607-124.261s |
| CLI | 10/10 | 368.071s | 411.694s | 306.308-411.694s |

Raw elapsed seconds, in execution order:

| Lane | Samples |
| --- | --- |
| Foundation | 26.287, 27.570, 44.488, 37.137, 49.277, 31.136, 30.110, 31.194, 29.560, 28.680 |
| Runtime | 111.886, 94.620, 90.690, 88.607, 102.068, 94.481, 101.300, 124.261, 97.965, 94.499 |
| CLI | 316.720, 306.308, 309.424, 321.355, 370.027, 366.114, 383.864, 411.694, 406.955, 375.905 |

A separate CLI validation run passed 250 files and 2,669 tests in 276.72s:
11.93s transform, 211.13s import, 30.73s test bodies, 2.31s setup, and
25ms environment. A separate Runtime validation passed 303 files and 3,786
tests in 76.12s, including the Bun/SQLite durability, fencing, recovery,
permissions, and startup-cleanup probes. The full Foundation gate passed 289
Core files and 3,531 Core tests plus 413 gateway-contract, 11 tools, and 8
operator-appearance tests before its repeated series.

These results are a reproducible within-runner baseline, not a cross-platform,
cold-filesystem, CI, or product-performance claim. The upward drift visible in
the CLI series is retained rather than discarded; any later comparison must use
the same runner contract and report sample order, failures, p50, and p95. The
Windows false positive remains a platform-specific measurement limitation.

## Revised Promotion Sequence

1. Scout and promote one S1 candidate at a time; do not absorb another ID.
2. Migrate one proven Core root-import owner at a time from the closed analyzer
   inventory.
3. Add the missing CLI measurement classes, then test the single-entrypoint
   separation candidate.
4. Run the long-turn gap audit against existing convergence, compaction, and
   closeout owners; add no mechanism unless the audit fails.
5. Remeasure imports, lanes, startup, and the deterministic turn fixture.
6. Profile local CPU/allocation/serialization only after avoidable loading and
   provider-loop work is removed.

Rust remains rejected unless one local deterministic kernel accounts for at
least 25% and 100ms of product p95, has a stable TypeScript port and parity
fixtures, improves kernel p95 by at least 2x and end-to-end p95 by at least 20%,
and regresses no startup, tests, or CI gate by more than 5%. It may own no
routing, credentials, approvals, configuration, memory, lifecycle, or closeout.

## Residual Risk

Static reachability cannot prove runtime initialization order, bundler behavior,
conditional exports, or filesystem cache state. Source searches can also
undercount construction hidden behind the canonical builtin tool surface.
Performance attribution therefore requires runtime traces and comparable
process measurements before promotion. Architecture remains authoritative when
this research note conflicts with a canonical decision.
