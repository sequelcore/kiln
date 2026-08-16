# CI Test Suite Performance (2026)

Status: incomplete
Owner: Kiln engineering
Evidence cutoff: 2026-08-15
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
documentation. Local timings are single-machine observations on Windows 11,
12 CPU, Bun 1.3.14, Vitest 4.1.10. They are not hosted-CI claims.

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

### The CLI lane was reading the operator's home directory

The CLI lane is execution-bound rather than import-bound: a full run measured
1244s with 822s in test bodies and only 152s in imports. The cause was a
hermeticity violation, not test volume.

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

- One green hosted run of the matrix workflow, which is also the first per-job
  timing sample for the current design.
- On hosted CI, collect p50/p95 timings for every job — installation, compile,
  validation and typecheck, each test lane, startup profile, build, and overall
  critical path with queue time where available — and compare against the
  462–493s single-job baseline. Report p50 and p95.
- Add a focused Windows CLI verification lane. The main test lanes run on Linux
  while the reported slowness and the resolved hermeticity defects were all
  observed on Windows.

## Remaining Work

- The CLI lane still imports the `@kilnai/runtime` root barrel from 21 test
  files at roughly 6.8s each. Only 3 of the 17 symbols those tests use are owned
  by an existing `runtime/src` context barrel, so closing this means introducing
  bounded-context boundaries in `runtime` and publishing them through its
  exports map, exactly as `@kilnai/core` now is. It is an architecture slice with
  its own review, not a test edit.
- Five CLI test files concentrate most of the remaining lane time. Repair them by
  cause rather than by timeout: `benchmark.test.ts` shells out to real `git`, and
  `gui-dashboard-availability.test.ts` uses `vi.mock` with `importOriginal` to
  load whole packages only to override pieces.

## Known Open Defects
- Production code reaches the user home through `homedir()` fallbacks that no
  test can observe. The synthetic home closes this for the CLI suite, but the
  fallback itself remains untested authority: a caller that forgets to pass
  `userHome` silently reads operator state in production too.
- `resolveProjectRoot` escapes into ancestor repositories. `findAncestor` walks
  to the filesystem root, and `hasGitMarker` suppresses only the single case
  where the candidate is exactly `homedir()`. Any directory nested under a
  git-tracked parent therefore resolves to that parent. This surfaced when the
  synthetic home stopped matching the guard on a machine whose home directory is
  itself a git repository, and it applies to production equally: running Kiln
  from a temporary or nested directory under a git-tracked home selects the wrong
  project root. The guard suppresses one symptom rather than bounding the walk.
- Test sources are largely untypechecked. Package build configs use
  `include: ["src"]` and exclude `src/**/*.test.ts`, while suites live in
  `tests/`, so type drift between tests and source has been invisible. The
  `typecheck:tests` gate now exists and admits packages one at a time; only
  `@kilnai/tools` currently qualifies.

  Measured backlog, compiling each package's `src` and `tests` together with
  `rootDir` at the package root:

  | Package | Errors |
  | --- | --- |
  | tools | 0 |
  | gateway-contracts | 16 |
  | sdk | 90 |
  | tui | 129 |
  | cli | 280 |
  | core | 488 |
  | native | 596 |
  | runtime | 1092 |

  The `native`, `tui`, and `sdk` counts are inflated by configuration rather
  than drift: `native` reports mostly `TS17004` because the probe config does
  not enable JSX, and `tui` and `sdk` report `TS6059` for paths outside their
  `rootDir`. Those need a per-package config before their real counts are known.

  The remainder are genuine. Samples: `content` asserted on `IncomingMessage`
  which no longer declares it; `expiresAt` on a route-capability snapshot that
  no longer declares it; `"session_started"` used where `OperatorSessionEventKind`
  no longer admits it; `.sort()` called on a `readonly` array. These tests pass
  because the extra properties are ignored at runtime, so they assert against
  contracts that no longer exist. The defect fixed in
  `managed-agent-route-catalog.test.ts` during this work — calling `.some()` on
  an optional `agentHealth` — is the same class and would have been a compile
  error under this gate.

## Sources

- Bun, [workspace filtering and parallel script execution](https://bun.sh/docs/pm/filter)
- Bun, [install and cache paths](https://bun.sh/docs/pm/cli/install)
- Vitest 4.1.10, [improving performance](https://vitest.dev/guide/improving-performance)
- Vitest 4.1.10, [test projects](https://vitest.dev/guide/projects)
- Vitest 4.1.10, [reporters](https://vitest.dev/guide/reporters) for `blob` and `--merge-reports`
- GitHub, [dependency caching](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/caching-dependencies-to-speed-up-workflows)
- Oven, [setup-bun](https://github.com/oven-sh/setup-bun)
