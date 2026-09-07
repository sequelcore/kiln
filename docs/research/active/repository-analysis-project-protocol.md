# Configured Project Reference Protocol v1

Status: preregistered local development experiment, 2026-09-05.
Owner: [Repository Analysis Evaluation](repository-analysis.md).
Predecessor: [Selected-file reference experiment](repository-analysis-reference-results.md).

## Decision and scope

Can the reference adapter preserve exact reference identity on real Kiln source
while using the owning tsconfig, inherited configuration, package metadata, and
installed declaration dependencies? The first configured project is
`packages/operator-appearance/tsconfig.json`: eight production source files,
NodeNext modules, inherited ES2023/Bun types, and strict package-specific options.
Tests and consumers in other packages are outside this configured project's
scope. Neither a package result nor an exported declaration proves global
reference completeness.

Use the installed TypeScript 7.0.2 API to interpret configuration and resolve
modules. Do not implement a competing tsconfig inheritance or module resolver.
The compiler receives only read-only, bounded, captured filesystem callbacks.
Every read input is content-hashed; absence, realpath resolution, and directory
enumerations are revalidated before a result is current. No repository script,
emit, dependency installation, provider request, or network operation is run.

Capture limits: 4096 files, 32 MiB total content, 32768 filesystem observations,
and 4096 entries per enumerated directory; refuse overflow. Source/config and
installed dependencies must resolve within the workspace; default libraries
from the exact pinned compiler are the explicit read-only exception and have
their own content digest. Project-reference
traversal is not promoted by this experiment; retain partial coverage if such
references are encountered. The existing 15-second query timeout applies.
Native crash/hang/cancellation settlement remains an explicit research limit.

## Independent oracle

The source hashes and literal coordinates are frozen in
`scripts/repository-analysis/project-corpus.ts` before the first configured
analyzer trial. They are derived from source inspection, not analyzer output.
Coordinates below are one-based identifier spans. Changed source or a changed
root-file set invalidates the cohort; do not silently move an oracle.

| Task | Query | Exact expected identifiers |
| --- | --- | --- |
| contrast-function | colors.ts 86:17 | colors.ts 86:17; contrast.ts 1:30, 152:19, 197:30; index.ts 22:3 |
| channel-parameter | colors.ts 42:28 | colors.ts 42:28; colors.ts 43:10, 43:41, 43:59 |
| appearance-resolver | resolve.ts 85:17 | resolve.ts 85:17, 129:10; index.ts 32:3 |

All paths in that table are relative to `packages/operator-appearance/src/`.
The parameter case distinguishes the helper's parameter from same-spelling
parameters in other functions and callbacks. Definitions and re-exports count;
comments, strings, and distinct symbols do not.

## Measurements and advancement gate

Run three fresh instances per task and two queries per instance (cold/warm):
18 analyzer observations. Preserve every failed/partial row. Compare the same
root files with `rg --no-config --json --fixed-strings --word-regexp` lexical
candidates. This is still not the full search + targeted-read agent baseline.
No agent-success, provider-token, or cost claim is admissible from this phase.

Record protocol/implementation digests, Git revision and dirty-state digest,
root-file and transitive-input hashes, compiler identity/options, selected
project, denied accesses, diagnostics, exact-span precision/recall,
cold/warm agreement, total elapsed time including capture/construction,
evidence/location bytes, and runtime/platform/rg versions. Timings are
diagnostic; no speed threshold is set.

Advancement requires precision = recall = 1 on every task and repetition,
no partial/failure result, identical cold/warm locations, and negative tests
proving inherited options and package metadata are actually consumed,
include/exclude behavior is preserved, stale configuration and new source files
invalidate captured evidence, missing dependencies remain partial, and outward
symlink/path escapes cannot read outside the workspace. Retain earlier reports
unchanged. Fix implementation defects without changing the oracle to fit them.

Passing admits only a proposal for wider real-project coverage. The broader
research decision remains open, with Java/Criba work later and separately
scoped if the TypeScript experiment proves useful.

## Execution

`bun run research:references:project:evaluate` emits the frozen development
comparison as JSON. Repeated input manifests are retained once by digest in
`inputSets`; each row references its exact set. `evidenceBytes` measures the
full adapter result before that report-only deduplication.

For an explicit project query, run:

```sh
bun run research:references --project packages/operator-appearance/tsconfig.json packages/operator-appearance/src/colors.ts 86 17
```

Line and column arguments are one-based. No source-file list or compiler-option
override is accepted in project mode. Reports go to stdout and should be
retained as UTF-8 when redirected by a Windows shell.
