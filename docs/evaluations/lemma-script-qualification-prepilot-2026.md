# LemmaScript Qualification Prepilot 2026

Date: 2026-08-20

Verdict: `DIAGNOSTIC_ONLY`

## Decision

Kiln can mechanically run a narrow TypeScript-to-Dafny qualification chain and
compare the exact staged TypeScript with the generated Dafny over this
fixture's complete four-input domain. The calibrated executable translation
mutation was detected. Do not yet start a comparative benchmark, expose this as
a supported product capability, or connect its result to Assurance.

Both stages remain facts-only. Qualification reports
`semanticEquivalence: "unresolved"`; the differential runner may report only
`equivalent_for_enumerated_domain`. Both report `benchmarkReady: false`.

## Evaluated object

The prepilot fixture is one pure, total access decision over two booleans and a
closed `"allow" | "deny"` result. Its four-input domain is enumerated separately
to check fixture/reference consistency.

The qualification and differential runners:

- stages the exact initially read TypeScript bytes;
- observes LemmaScript and Dafny versions from the invoked tools;
- records source, generated proof, proof, and tool entrypoint digests;
- accepts only a fail-closed TypeScript subset with non-empty typed contracts;
- rejects unsupported constructs and known trust routes;
- requires generated and proof Dafny bytes to be identical;
- requires at least one Dafny correctness effort and all efforts to pass;
- rejects diagnostics, missing logs, mutations, timeouts, and stale tool bytes;
- publishes process roles and output digests without machine-local paths.
- executes the exact staged TypeScript in an isolated Bun child;
- compiles and executes derived Dafny through explicitly declared Java tools;
- compares both outputs with an independently parsed four-case manifest;
- applies exactly one executable `&&` to `||` translation mutation;
- counts the mutant as killed only when it compiles, executes, emits four valid
  observations, and differs from the manifest;
- re-reads the candidate, manifest, evaluator, and all tool entrypoints before
  returning a semantic observation.

It is an external qualification script under `scripts/`. It does not import or
modify Work Governance, Assurance, `formal_verify`, or benchmark policy.

## Observed result

The live differential run used LemmaScript `0.6.0`, Dafny `4.11.0`, and the
co-located Java, `javac`, and `jar` tools at `25.0.3`.

| Observation | Result |
| --- | --- |
| Pipeline | `pipeline_passed` |
| Qualification policy | eligible |
| Dafny correctness efforts | 1 passed, 0 failed, 0 inconclusive |
| Diagnostics | 0 |
| Source digest | `sha256:98b39abfdd4f3e293ac4304542214bfc6da5f450cf1603a5d2f9304b02a39cd1` |
| Case manifest digest | `sha256:db6b61380c1bb0314eabbc55d6f49e0d303e5bf3ea9ab0d618a6d128ead4087b` |
| Generated/proof digest | `sha256:8d8605b8d77cab79e9a2ef1e74dd94ce262bb7260ce753eaaa76464b0e5bd659` |
| TypeScript observations | 4/4 valid and matched expected |
| Dafny observations | 4/4 valid and matched expected |
| Semantic equivalence | `equivalent_for_enumerated_domain` |
| Calibrated mutation | killed; `false,true` and `true,false` differed |
| Benchmark readiness | false |

Verification at this revision:

- focused qualification and differential tests: 79 passed;
- script TypeScript check: passed;
- repository typecheck: passed;
- documentation check: passed;
- live TypeScript/LemmaScript/Dafny/Java differential execution: passed with
  complete observations and a validly killed mutant.

The broad script suite passed 214 tests and retained two unrelated working-tree
failures: two CLI tests import the Core root barrel, and one CLI fixture contains
a machine-specific path. Neither file is part of this evaluation slice.

## Complexity disposition

Required invariant: a formal result must remain bound to exact source,
generated proof, proof, and observed tool facts, and must not acquire acceptance
authority.

The materially simpler alternative was to reuse separate handwritten Dafny or
trust LemmaScript's successful exit. It cannot show that the proof concerns the
executed TypeScript and cannot detect empty verification, trust escapes, or
artifact substitution.

The prepilot adds only external qualification and differential runners, a
fail-closed policy, and a synthetic fixture. It adds no durable product state,
lifecycle, configuration, or compatibility path. The differential oracle is
finite-domain and fixture-specific by design; it is not a generic TypeScript
semantics owner.

## Blocking unknowns

Before a comparative pilot:

1. Bind the installed LemmaScript dependency tree, not only its entrypoint and
   observed version.
2. Replace or independently validate the lexical Dafny trust scan if proof
   additions or a broader language profile are admitted.
3. Define private held-out tasks, intent oracles, mutations, and invalid-run
   accounting before a comparative pilot.
4. Qualify additional private task families and translation mutations; one
   complete boolean fixture does not establish wider translator correctness.

Residual implementation risks remain explicit: endpoint hashes cannot detect a
tool replaced and restored during one invocation, and a pathological descendant
process might outlive hard timeout settlement. Neither risk is hidden by the
successful qualification result.

## Claim boundary

Supported claim:

> Under the recorded tool versions and narrow four-input fixture, Kiln observed
> matching TypeScript, generated-Dafny, and independent expected results, and
> detected one calibrated executable translation mutation.

Unsupported claims include that LemmaScript generally preserves TypeScript
semantics, that arbitrary TypeScript applications are correct, that the
pipeline improves coding outcomes, or that its evidence can satisfy Assurance.
