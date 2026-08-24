# CI Test Suite Performance (2026)

Status: incomplete
Owner: Kiln engineering
Evidence cutoff: 2026-08-24
Promotion targets: CI workflow and testing guidance
Exit condition: ten post-change CI runs provide p50/p95 timings for compile,
validation, each test lane, startup profile, build, and the overall critical
path.

## Question

Why does the Kiln test suite take about twenty minutes locally, and which
changes reduce that without weakening test isolation or hiding failures?

## Method And Limits

Decision-oriented performance research, not a systematic benchmark. The
investigation combined repository inspection, Vitest JSON profiles already
present in `.kiln/`, fresh local timed runs, GitHub Actions run metadata
retrieved with `gh`, and current first-party Bun, Vitest, and GitHub Actions
documentation. The historical local timings are single-machine observations on
Windows 11, 12 CPU, Bun 1.3.14, Vitest 4.1.10. The current verification line is
Bun 1.4.0. Neither is a hosted-CI claim.

## Repository Evidence

### The suite is import-bound, not execution-bound

The dominant cost is module-graph instantiation per test file, not test
execution. Vitest's default `isolate: true` gives every file a fresh module
registry, so the cost of instantiating a package barrel repeats per file.

| Measurement | Wall | Import | Tests |
| --- | --- | --- | --- |
| Bare test file, no imports | 257ms | 41ms | 3ms |
| One file importing `@kilnai/core` | 3.77s | 3.56s | 3ms |
| One file importing `@kilnai/runtime` | 6.99s | 6.79s | 3ms |
| 20 `tests/gateway/*.test.ts` files | 8.44s | 37.7s | 1.23s |

`.kiln/runtime-vitest-profile.json` shows the same shape at suite scale: 231
files and 3,114 tests summed to 16.0s of file execution across 197.4s of wall
time, with `maxWorkers: "50%"` already enabled. Roughly 92% of the lane was not
test execution.

231 test files imported the `@kilnai/core` root barrel, which re-exports 30
bounded contexts through 105 `export *` lines. A bounded-context barrel costs
the same as a single module (312ms versus 293ms), so the root barrel — not
import depth — was the cost.

### Sleep-based stabilization is not a factor

The largest deliberate delay in any test is 500ms and there are only a handful.
Fake timers are used in 38 files. The suite is not slow because it waits.

### The initial CLI profile was contaminated by operator state

An initial full CLI run measured 1244s with 822s in test bodies and only 152s
in imports. That profile described a hermeticity violation, not the stable cost
of the test suite.

`resolveManagedAgentRoutes` falls back to `context.userHome ?? homedir()`, and
`loadManagedInvocationSkillCatalog` then scans that home. Under test this
resolved to the operator's real home directory. Startup-profile marks show
`managed-route-skills-loaded` at 4,088ms for 61 skills, executed twice per
test — roughly 7.8s per test in every suite that starts the TUI command.

This also explains the instability recorded across profiles: the same
`config-status.test.ts` measured 6.1s on 2026-08-02 and 40.3s on 2026-08-08,
because the result depends on what the operator's machine has installed rather
than on the code under test. Two CLI test files were failing outright on
20-second timeouts for the same reason.

`packages/cli/tests/setup/hermetic-home.ts` now points every home-directory
lookup at an empty synthetic home per test file. The two failing files became
green, and the larger of them fell from roughly 105s to 30.7s.

A related defect was fixed in the same area: eight `afterEach` hooks restored
environment variables with `process.env.NAME = original`, which assigns the
string `"undefined"` when the variable was previously unset. They now delete the
variable instead, matching the guard already used in
`global-config.persistence.test.ts`.

### The matrix workflow could not pass

Commit `8eb9955d` split CI into parallel lanes. The previous single-job workflow
ran `typecheck` before `test`, and `typecheck` was `tsc -b` over `composite`
projects with `outDir: dist` and no `noEmit` — so typechecking was silently the
build step that produced `packages/*/dist`. The lane jobs ran only
`bun install` and `bun run test:<lane>`, while `@kilnai/core` resolves through
its exports map to `./dist/index.js` and `dist/` is gitignored. Removing
`packages/core/dist` and running a runtime test reproduces an immediate import
failure. Lanes without workspace-barrel imports (`scripts`, `foundation`) were
unaffected; `runtime`, `cli`, and `surfaces` were not.

No hosted run exists after 2026-08-01, so the matrix workflow had never
executed.

### Hosted CI history was available

Six green runs retrieved with `gh` completed in 462–493s each. Every one belongs
to the single-job workflow, which ran install, release validation, typecheck,
the complete serial suite, Playwright install, the startup profile, and the
build on one runner with no caching and no parallelism. The operator-reported
twenty minutes describes the local serial `bun run test` chain on Windows, not
the hosted critical path.

## Decision

1. Publish `@kilnai/core` bounded contexts as subpath exports, and import them
   from tests instead of the root barrel. A test names the bounded context it
   exercises.
2. Make the compiled-output dependency explicit: a `compile` job produces
   `packages/*/dist` once, uploads it, and every lane that imports a workspace
   package consumes it. `typecheck` now delegates to `compile` rather than
   emitting as a side effect.
3. Run independent foundation and surface package tests concurrently through
   Bun workspace filters.
4. Cache Bun's package tarballs and Playwright browser data, cancel superseded
   runs, and bound every job with an explicit timeout. Share the setup through
   one composite action instead of repeating it per job.
5. Preserve `fail-fast: false` so failures across independent lanes stay
   observable.

## Measured Outcome

The runtime lane went from 197.4s to 67.6s wall with 253 files and 3,370 tests
passing — a 2.9x reduction from the import change alone. Foundation (315 core
files, 3,965 tests), surfaces, and gateway-contracts lanes remain green.

The clean Windows CLI lane now completes in 370.82–415.44s under Bun 1.4.0.
Current Vitest buckets attribute roughly 235–261s to imports, 86–95s to test
bodies, and 11–12s to transforms. Imports are therefore the largest remaining
measured cost. Issue
[#107](https://github.com/sequelcore/kiln/issues/107) owns current attribution
and improvement; the old 1244s profile is retained only as defect history.

### CLI diagnostic profile (2026-08-24)

A detached clean-head worktree at `5a502dbf` used Bun 1.4.0, a forced frozen
install, the canonical compile command, and the package-owned
`bun run test:profile` command. This is one diagnostic sample, not a p50/p95
claim. Its recoverable Vitest report covered 243 files, 558 suites, and 2,588
tests: 2,587 passed and one live test remained pending. The interval from the
report start to the last completed file was 349.47s. Summed file test-body time
was 69.73s; the five largest files contributed 47.3% of that total:

| File | Test-body time |
| --- | ---: |
| `tests/application/config-status.test.ts` | 14.36s |
| `tests/application/operator-project-agent-tasks-runtime-config.test.ts` | 9.30s |
| `tests/application/private-project-state-cutover.test.ts` | 4.04s |
| `tests/commands/tui-session-persistence.test.ts` | 3.00s |
| `tests/config/managed-agent-routes.test.ts` | 2.31s |

The JSON reporter does not attribute transform and import time per file.
Controlled cold-file runs supplied that missing diagnostic split:

| File shape | Wall | Transform | Import | Tests |
| --- | ---: | ---: | ---: | ---: |
| One assertion over a narrow CLI module | 3.00s | 1.79s | 2.78s | 4ms |
| Config/status integration, 44 tests | 20.91s | 4.59s | 6.27s | 14.42s |
| Managed-task runtime composition, 13 tests | 15.86s | 4.55s | 6.22s | 9.43s |
| Private-state cutover, 6 tests | 10.04s | 4.51s | 6.17s | 3.65s |

This separates two measured candidates: repeated module-graph cost across the
lane and concentrated test-body cost in the first two files. A disposable
test-only substitution from the Runtime root to an existing narrower module
did not improve a representative file (5.61–5.64s versus a 5.64s baseline),
because its production owner still imports the Runtime root. It was reverted
byte-for-byte. Test-only import rewriting is therefore not an admitted fix;
any Runtime subpath must own a real production boundary and win under the full
dependency path.

The first retained body-time change targets production candidate admission,
not the tests. The route-admission owner now loads canonical config first and
discovers only the deduplicated providers present in
`targetCatalog.targets`. It still obtains fresh evidence for every configured
provider and fails closed for missing, unknown, unavailable, or ineligible
targets; it adds no cache, timeout, state, lifecycle, or alias. Unfiltered
callers retain the complete discovery fan-out.

Under the same cold-file command, `config-status.test.ts` remained 44/44 green
and fell from 20.91s wall / 14.42s tests to 11.45s wall / 4.76s tests. Transform
and import time remained approximately flat, so the 9.46s wall and 9.66s
test-body reductions match the removed unrelated provider probes. This is a
focused-file result. A comparable full CLI lane and repeated samples remain
required before claiming a suite-level improvement.

The canonical non-live CLI gate on the integrated worktree then passed 243/243
files, with 2,595 tests passed and one skipped, in 356.82s (11.27s transform,
3.34s setup, 249.86s import, and 60.47s tests). The lower test-body bucket is
directionally consistent with the focused result. This remains a single dirty-
worktree sample containing other Roadmap 00 changes, so it is behavioral gate
evidence, not a comparable full-lane benchmark or p50/p95 result.

The first CLI profile also exposed a profiler defect: passing tests wrote
2,922 characters directly to stdout before the JSON reporter object, so the
stored artifact was not parseable JSON even though the lane passed. The
profiling wrapper now suppresses ordinary passing-test logs, extracts and
validates the reporter object before writing, preserves the previous artifact
when a successful child returns malformed output, and retains raw failure
diagnostics. This repairs evidence integrity; it is not a suite-speed claim.
The direct final write remains non-atomic on an I/O failure, and an unmatched
quote in arbitrary prefix output can make framing fail closed. Neither residual
can commit a malformed report; a neutral shared atomic private-artifact writer
is preferable to coupling this profiler to the live-runner owner.

### Clean-checkout gate (2026-08-23)

A synthetic Windows worktree at commit `4a7bfb99` passed release validation,
documentation validation, root typecheck, build, startup profiling, and the
canonical root test command under Bun 1.4.0. The test lanes reported:

| Lane | Result |
| --- | ---: |
| Scripts | 248 passed |
| Foundation | 4,119 passed |
| Runtime | 3,263 passed, 5 live tests skipped |
| CLI | 2,517 passed, 1 live test skipped |
| Surfaces | 730 passed |

This proof also covered Bun and SQLite runtime probes. It does not replace
hosted CI evidence or authorize a supported source baseline. The clean
worktree's first `bun install --frozen-lockfile` reported no changes while
dependencies were absent; `bun install --force --frozen-lockfile` completed the
installation. Source-stability work must reproduce and explain that behavior
before documenting the ordinary clean-install path.

## Rejected And Deferred

- Sharding the CLI Vitest suite across four CI jobs: rejected for now. Vitest
  shards by file count, and `.kiln/cli-vitest-profile.json` shows 59% of CLI
  execution concentrated in five files, so shards would be badly imbalanced.
  Sharding also multiplies install and compile cost per shard and does nothing
  for local runs. Revisit only from measured lane balance.
- Increasing CLI `maxWorkers`: rejected by the existing contract test and by the
  order-dependent failure recorded in `CI-TEST-SUITE-RESIDUAL-TEMP.md`, which is
  direct evidence of shared state.
- Disabling Vitest isolation or switching to `threads`: `--no-isolate` measured
  only 8.44s to 6.39s on a 20-file subset, which does not justify weakening
  isolation while a known CLI leak is open.
- Bounded-context subpaths for `@kilnai/runtime`: deferred. Only 3 of the 17
  symbols its 21 CLI test consumers use are owned by an existing context barrel,
  so this requires introducing bounded-context boundaries in `runtime/src` — an
  architectural change that belongs in its own reviewed slice, not a test
  performance fix.
- Bounded-context subpaths for `@kilnai/gateway-contracts`: not needed. Its root
  barrel costs 640ms, and its existing subpaths are module-level rather than a
  context decomposition.
- Migrating the 362 non-test source files that import the `@kilnai/core` root
  barrel: deferred. This affects CLI startup and must be judged against
  `test:startup-profile`, not the test suite.

## Verification Required

- Ten green post-change hosted runs of the matrix workflow.
- On those runs, collect p50/p95 timings for every job — installation, compile,
  validation and typecheck, each test lane, startup profile, build, and overall
  critical path with queue time where available — and compare against the
  462–493s single-job baseline. Report p50 and p95.
- Add a focused Windows CLI verification lane. The main test lanes run on Linux
  while the reported slowness and the resolved hermeticity defects were all
  observed on Windows.
- Reproduce the Bun 1.4.0 clean-install no-op and either fix the repository
  cause or document verified upstream behavior before source-baseline
  admission.

## Remaining Work

- [#107](https://github.com/sequelcore/kiln/issues/107) owns profiling and
  reducing the current 370–415s CLI lane. Runtime root-barrel imports and five
  historically expensive files are leads, not accepted solutions; current
  attribution must earn any production boundary change.
- Ten hosted post-change runs remain necessary before this research can report
  stable p50/p95 CI outcomes and satisfy its exit condition.

## Known Open Defects
- Production code reaches the user home through `homedir()` fallbacks that no
  test can observe. The synthetic home closes this for the CLI suite, but the
  fallback itself remains untested authority: a caller that forgets to pass
  `userHome` silently reads operator state in production too.

## Resolved Test Signal Baseline (2026-08-23)

Issue [#85](https://github.com/sequelcore/kiln/issues/85) admitted Runtime tests
to the root `typecheck:tests` gate. The correct Runtime test project initially
reported 821 diagnostics across 118 files; it now reports zero without
`skipLibCheck`, exclusions, baselines, or production-code relaxations. Live test
sources are included in the same compiler project even though live providers
are not invoked by the type gate. The issue is closed. Follow-up commit
`4a7bfb99` removed clean-checkout Windows CRLF/hash failures and made the
affected formal-verification and CLI fixtures independent of global temporary
and operator-home state.

The first mutation pilot targets the consequential media-action claim owner.
The initial eight-test suite killed 67 of 154 mutants, with 66 surviving and 18
uncovered. Mutation evidence exposed one behavior-free test that exercised only
its local mock; that test was deleted. Strengthening the existing owners for the
second cancellation fence, stable effect identity, and single unknown
settlement raised the result to 84 killed, 51 surviving, and 16 uncovered with
only one net additional test (56.49% total score). This is diagnostic evidence,
not a global score target.

Stryker runs as a deliberately bounded pilot: one production owner, one owning
test file, per-test coverage, no incremental baseline, and no break threshold.
TypeScript remains a separate mandatory gate because generated mutants often
violate types. Stryker 10 still calls a compiler API removed in TypeScript 7
while rewriting tsconfig files, so the pilot skips that optional rewrite while
keeping the sandbox. The TypeScript checker plugin is not admitted until the
upstream TypeScript 7 migration is complete.

The supported package inventory is now explicit. Widget includes its four test
sources in `packages/widget/tsconfig.json`. Issue
[#106](https://github.com/sequelcore/kiln/issues/106) added
`packages/gui/tsconfig.test.json`, repaired the 197-diagnostic GUI test backlog,
and admitted that project to the root `typecheck:tests` gate with zero errors.
The admission uses no tolerated baseline, blanket exclusion, or `skipLibCheck`
workaround; the full GUI and supported surface lanes remain the behavioral
oracle for those compiler-driven repairs.

## Sources

- Bun, [1.4 release notes](https://bun.com/blog/bun-v1.4)
- Bun, [workspace filtering and parallel script execution](https://bun.sh/docs/pm/filter)
- Bun, [install and cache paths](https://bun.sh/docs/pm/cli/install)
- Vitest 4.1.10, [improving performance](https://vitest.dev/guide/improving-performance)
- Vitest 4.1.10, [test projects](https://vitest.dev/guide/projects)
- Vitest 4.1.10, [reporters](https://vitest.dev/guide/reporters) for `blob` and `--merge-reports`
- GitHub, [dependency caching](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/caching-dependencies-to-speed-up-workflows)
- Oven, [setup-bun](https://github.com/oven-sh/setup-bun)
- Stryker, [Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/)
- Stryker, [TypeScript 7 tsconfig preprocessing migration](https://github.com/stryker-mutator/stryker-js/issues/6111)
- Stryker, [incremental Vitest result instability](https://github.com/stryker-mutator/stryker-js/issues/6004)
