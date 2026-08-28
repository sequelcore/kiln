status: complete

# Verification Producer Evidence

## Decision and method

This decision-oriented review was completed on 2026-08-26. It asked which
documented strengths of Dafny, Oxlint, and Gentle AI should change Kiln's
candidate-bound verification producers. It inspected first-party contracts and
guidance, published benchmarks, reproducible project benchmarks, ecosystem CI,
and concrete community failure reports. It did not attempt a systematic review
of every verifier, measure live binaries, or compare review-model accuracy.

The stopping rule was met when each producer had an authoritative capability
source, applicable empirical or operational evidence, a searched adverse case,
and a bounded Kiln disposition. Popularity, author reputation, and promotional
speed claims were treated as discovery signals rather than adoption evidence.

## Dafny

Dafny's strongest contribution is deterministic proof of explicit contracts,
not general defect discovery. Its maintainers recommend machine-readable logs,
resource units rather than wall-clock time for proof difficulty, isolated
assertion batches when diagnosing brittle proofs, and repeated random-seed
`measure-complexity` runs for stability analysis. They recommend a resource
coefficient of variation below 20% as a general diagnostic target, while noting
that absolute resource limits remain project-dependent.

DafnyBench demonstrates that verifier feedback can materially help models
construct proof hints, but its programs and specifications do not establish
whole-system correctness. DafnyCOMP reports that local proof success does not
compose cleanly to larger multi-component specifications. These results support
Kiln's selective obligation model and reject treating a green proof as generic
software acceptance.

Kiln disposition:

- retain structured JSON diagnostics, CSV proof efforts, per-symbol outcomes,
  duration, and resource count;
- fail closed on signalled processes and bounded-output overflow;
- do not enable `--isolate-assertions` in the ordinary producer because its
  per-batch output would change the current one-check-per-symbol contract;
- keep repeated complexity measurement in benchmark/qualification workflows,
  not in every `formal_verify` invocation.

## Oxlint

Oxlint's demonstrated strengths are fast native parsing and broad
JavaScript/TypeScript lint diagnostics. Its own performance claims are
maintainer-produced and are not independently sufficient, but its ecosystem CI
does exercise projects including VS Code, Preact, Kibana, and DefinitelyTyped.
Current type-aware linting covers most typescript-eslint type-aware rules, but
requires the separate `oxlint-tsgolint` executable, TypeScript project
resolution, built dependency declarations, and a materially wider workspace
boundary.

Oxlint documents that inline disable comments override configuration. That is
appropriate for developer lint policy but not for an observation whose subject
controls its own bytes. Kiln therefore rejects source containing an Oxlint or
ESLint disable token before invocation. This is intentionally conservative: a
token in documentation or a string also makes the producer unavailable for
that candidate rather than risking a falsely clean observation.

Kiln disposition:

- retain an immutable single-file profile of explicit native rules and JSON
  output; the admitted profile is `oxlint.sequel-typescript/v1`;
- reject candidate-controlled inline suppression;
- keep general correctness, safety, and structural budgets in Oxlint without
  duplicating Kiln Quality's cast, complexity, or test-integrity rules;
- do not add fixes, JavaScript plugins, project configuration, or type-aware
  linting to this producer;
- evaluate type-aware analysis later as a distinct project-bound producer if a
  concrete Assurance consumer justifies its extra executable and dependency
  graph.

### Agent-quality rules and anti-slop

`dmmulroy/anti-slop` is a concrete example of useful agent-quality checking.
Its published rules reject patterns such as chained type assertions,
widen-then-assert, unknown-heavy public contracts, unsafe dictionary types,
runtime `typeof` dispatch, module mocking, and assertions without a safety
comment. Those are maintainability and evidence-quality heuristics. They can
detect recognizable agent-generated failure patterns such as type laundering,
but they do not prove program semantics and a clean result is not evidence that
code is free of "slop" in general.

The project deliberately asks consumers to vendor and adapt the rules rather
than depend on an immutable package. Oxlint can execute the rules through its
ESLint-compatible JavaScript plugin API, but that API is currently documented
as alpha and JavaScript plugin rules cannot use TypeScript type awareness.
This makes the plugin promising for a separate, explicitly versioned
agent-quality producer, not an undisclosed expansion of the deterministic
single-file `static_analyze` profile.

Kiln disposition:

- do not install or enable all anti-slop rules as an acceptance gate from
  anecdotal community evidence alone;
- if admitted, vendor a reviewed rule revision and identify it in every
  observation so rule changes invalidate prior evidence;
- calibrate individual rules on representative accepted changes and seeded
  low-quality changes, recording false positives and rule overlap;
- expose the result as facts-only quality-review evidence until a named
  Assurance criterion demonstrates that a bounded subset can establish it.

## Gentle AI

Gentle AI's public v2 integration contract is strongest at target identity,
lineage, replayability, and explicit next-transition state. Its shipped
benchmark measures operational friction such as prompts, blocks, commands, and
recovery round trips. It explicitly does not measure review correctness,
wall-clock performance, or a composite quality score.

The immutable `v2.5.0-rc.1` prerelease intentionally closes review at the last
causal evidence event. Terminal success burns the lineage and its artifacts;
there is no later FINALIZE, terminal receipt, or delivery gate. Ordinary
repository policy owns commit, push, PR, release, and archive. The same release
keeps capabilities v2.2 and status v5 identifiers while changing their admitted
feature and status shapes, so consumers must negotiate and validate the current
contract instead of treating schema names as proof of 2.4 semantics.

A community report showed that a v2.1/v2.2 capability bootstrap command could
advertise a borrowed Claude Code runtime identity to other consumers. Kiln does
not execute provider-advertised bootstrap commands or claim a runtime identity;
it independently invokes the closed read-only `review.status` operation. The
report nevertheless reinforces strict capability parsing and the rule that
provider output is data, not executable authority.

Kiln disposition:

- require every mandatory feature entry to be well formed and reject unknown
  mandatory features whether marked supported or unsupported;
- pin package version, release channel, executable digest, contract, schemas,
  active lineage, target identity, and candidate trees;
- remain a read-only status observer and keep `findings` and `establishes`
  empty;
- remove receipt and delivery-gate concepts rather than carrying a compatibility
  interpretation into the new minor line;
- do not use Gentle AI's friction benchmark as evidence of review accuracy or
  as grounds for an Assurance mapping.

## Residual uncertainty

The official Gentle AI `v2.5.0-rc.1` Windows AMD64 binary was checked against
the release SHA-256 manifest and exercised against an isolated Git repository.
Capabilities v2.2 omitted the retired receipt/delivery features, status v5
omitted `receipt`, and an active lineage returned a provider-bound collect
transition. This establishes contract compatibility, not review accuracy. The
next valuable evidence is producer-specific:
Dafny proof-stability runs on representative obligations, Oxlint calibration on
real candidate changes, anti-slop rule-by-rule calibration, and an independently
scored Gentle AI review corpus.

## Sources

- Dafny verification optimization and resource-count guidance:
  https://dafny.org/v4.9.1/VerificationOptimization/VerificationOptimization
- DafnyBench: https://arxiv.org/abs/2406.08467
- DafnyCOMP: https://openreview.net/forum?id=y4kAMUBqLq
- Oxlint CLI and inline directives:
  https://oxc.rs/docs/guide/usage/linter/cli.html and
  https://oxc.rs/docs/guide/usage/linter/ignore-comments.html
- Oxlint type-aware architecture:
  https://oxc.rs/docs/guide/usage/linter/type-aware.html
- Oxlint JavaScript plugin status and limits:
  https://oxc.rs/docs/guide/usage/linter/js-plugins.html
- Oxc ecosystem CI: https://github.com/oxc-project/oxc-ecosystem-ci
- anti-slop source, rules, and vendoring contract:
  https://github.com/dmmulroy/anti-slop
- Gentle AI integration contract and benchmark:
  https://github.com/Gentleman-Programming/gentle-ai/blob/main/docs/review-integration.md
  and https://github.com/Gentleman-Programming/gentle-ai/blob/main/bench/README.md
- Gentle AI 2.4.0 immutable release and provenance:
  https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v2.4.0
- Gentle AI 2.5.0-rc.1 immutable prerelease and atomic lifecycle:
  https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v2.5.0-rc.1
- Gentle AI 2.5.0-rc.1 review integration contract:
  https://github.com/Gentleman-Programming/gentle-ai/blob/v2.5.0-rc.1/docs/review-integration.md
- Gentle AI bootstrap identity report:
  https://github.com/Gentleman-Programming/gentle-ai/issues/2243
