# TypeScript Reference Discovery v1 Results

Status: diagnostic-only, 2026-09-05.
Protocol: [Reference Discovery v1](repository-analysis-reference-protocol.md).
Owning decision: [Repository Analysis Evaluation](repository-analysis.md).

## Outcome

The first opt-in TypeScript prototype passes the three hand-authored reference
oracles across three fresh instances per task and a cold/warm query pair per
instance: 18 exact analyzer observations per collection. It resolves renamed
imports and re-exports while excluding unrelated same-name identifiers, strings,
and comments. No production tool or model route was changed.

| Task | Expected locations | Analyzer precision / recall | Lexical rg precision / recall |
| --- | --- | --- | --- |
| Exported symbol through aliases/re-exports | 10 | 1 / 1 | 5/11 / 5/10 |
| Shadowed parameter | 2 | 1 / 1 | 2/11 / 1 |
| Unrelated same-name function | 2 | 1 / 1 | 2/11 / 1 |

The lexical arm returned 11 same-spelling candidates per task. It has no
semantic disambiguation or targeted-read reasoning. These numbers do not prove
that an agent using search plus reads would miss the same references or perform
worse. Provider tokens, task correctness, cost, and comparative task latency
remain unmeasured.

## Evidence and development history

- [First collection](../fixtures/repository-analysis/v1/first-run.json) retains
  nine task/repetition rows, each with cold and warm observations and a lexical
  observation. All reference oracles passed.
- [Validation collection](../fixtures/repository-analysis/v1/validation-run.json)
  repeats all rows after strengthening UTF-8 source capture. All reference
  oracles still pass. That collection ran concurrently with focused validation,
  so its timings are not an isolated performance measurement.
- Reports bind protocol and implementation digests, source hashes, installed
  compiler inputs, Git revision and dirty-state digest, runtime/platform,
  measured durations, output sizes, and every observed location and scorer
  difference. The checkout was dirty; these are not release-candidate records.
- Before collection, initial development tests detected missing native-package
  library loading and whole-declaration spans where identifier spans were
  required. A subsequent integration test caught unavailable AST helper
  exports. The adapter was repaired; the fixture oracle was unchanged.

Verification: 13 focused tests pass, scripts typecheck passes, the explicit
query command completes against a selected fixture in the Kiln checkout, and
documentation validation passes. Tests include missing imports, truncation,
stale/changed/deleted/newly selected sources, malformed UTF-8, file/byte bounds,
symlink escape, unsupported requests, concurrent requests, and UTF-8-to-UTF-16
coordinate conversion for the lexical scorer.

## Limits and next admissible work

- This is a small development corpus, with no held-out or independent
  reproduction claim. The broad research decision is still open.
- The adapter only sees explicitly captured TypeScript files under fixed
  strict ES2022/NodeNext options. It does not load Kiln's project configuration,
  resolve external packages, traverse project references, or prove whole-repo
  completeness. Such missing evidence is reported as partial.
- TypeScript 7.0.2's API is explicitly unstable. A different version is not
  admitted automatically. The prototype uses its native subprocess and closes
  the API after use. Native-process crash/hang/cancellation settlement is not
  independently proven; production lifecycle admission remains outstanding.
- No persistent index, artifact-store integration, memory mutation, Java
  migration, or production capability registration was added.

Next: preregister representative queries on real Kiln source modules and the
minimum owning-tsconfig/dependency support they need. Keep the same independent
span oracles and explicit partial/failure semantics. A full agent-task comparison
must separately include targeted reads, the fallback arm, a valid Runtime
control, and its own live-run authority before making efficiency claims.

Continuation: the [configured-project experiment](repository-analysis-project-results.md)
now records the first real-package results. The limitations above describe the
selected-file mode and its original collections.
