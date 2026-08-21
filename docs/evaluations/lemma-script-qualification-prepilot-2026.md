# LemmaScript Qualification Prepilot 2026

Date: 2026-08-20

Kiln revision: `b04f6bcd`

Verdict: `BLOCKED_FOR_BENCHMARK`

## Decision

Kiln can mechanically run a narrow TypeScript-to-Dafny qualification chain,
but it cannot yet claim that the generated Dafny is semantically equivalent to
the TypeScript that would execute. Do not start a comparative benchmark, expose
this as a supported product capability, or connect its result to Assurance.

The qualification result is facts-only. Even a successful run reports
`semanticEquivalence: "unresolved"` and `benchmarkReady: false`.

## Evaluated object

The prepilot fixture is one pure, total access decision over two booleans and a
closed `"allow" | "deny"` result. Its four-input domain is enumerated separately
to check fixture/reference consistency.

The qualification runner:

- stages the exact initially read TypeScript bytes;
- observes LemmaScript and Dafny versions from the invoked tools;
- records source, generated proof, proof, and tool entrypoint digests;
- accepts only a fail-closed TypeScript subset with non-empty typed contracts;
- rejects unsupported constructs and known trust routes;
- requires generated and proof Dafny bytes to be identical;
- requires at least one Dafny correctness effort and all efforts to pass;
- rejects diagnostics, missing logs, mutations, timeouts, and stale tool bytes;
- publishes process roles and output digests without machine-local paths.

It is an external qualification script under `scripts/`. It does not import or
modify Work Governance, Assurance, `formal_verify`, or benchmark policy.

## Observed result

The live qualification used LemmaScript `0.6.0` and Dafny `4.11.0`.

| Observation | Result |
| --- | --- |
| Pipeline | `pipeline_passed` |
| Qualification policy | eligible |
| Dafny correctness efforts | 1 passed, 0 failed, 0 inconclusive |
| Diagnostics | 0 |
| Source digest | `sha256:98b39abfdd4f3e293ac4304542214bfc6da5f450cf1603a5d2f9304b02a39cd1` |
| Generated/proof digest | `sha256:8d8605b8d77cab79e9a2ef1e74dd94ce262bb7260ce753eaaa76464b0e5bd659` |
| Semantic equivalence | unresolved |
| Benchmark readiness | false |

Verification at this revision:

- qualification tests: 96 passed;
- script TypeScript check: passed;
- repository typecheck: passed;
- live LemmaScript/Dafny qualification: passed twice with the same source and
  generated/proof digests.

## Complexity disposition

Required invariant: a formal result must remain bound to exact source,
generated proof, proof, and observed tool facts, and must not acquire acceptance
authority.

The materially simpler alternative was to reuse separate handwritten Dafny or
trust LemmaScript's successful exit. It cannot show that the proof concerns the
executed TypeScript and cannot detect empty verification, trust escapes, or
artifact substitution.

The prepilot adds only a qualification runner, a fail-closed policy, and a
synthetic fixture. It adds no durable product state, lifecycle, configuration,
or compatibility path. Its main residual complexity is deliberately exported
to the next experiment gate: an independent semantic oracle.

## Blocking unknowns

Before a comparative pilot:

1. Build an independent TS-to-Dafny differential oracle for the admitted
   subset and demonstrate that translation mutations are detected.
2. Bind the installed LemmaScript dependency tree, not only its entrypoint and
   observed version.
3. Replace or independently validate the lexical Dafny trust scan if proof
   additions or a broader language profile are admitted.
4. Define private held-out tasks, intent oracles, mutations, and invalid-run
   accounting only after the semantic gate passes.

Residual implementation risks remain explicit: endpoint hashes cannot detect a
tool replaced and restored during one invocation, and a pathological descendant
process might outlive hard timeout settlement. Neither risk is hidden by the
successful qualification result.

## Claim boundary

Supported claim:

> Under the recorded revisions and narrow fixture, Kiln reproduced a
> candidate-bound LemmaScript-to-Dafny pipeline and observed one passing Dafny
> correctness effort without known trust routes.

Unsupported claims include that LemmaScript preserves TypeScript semantics,
that the TypeScript application is correct, that the pipeline improves coding
outcomes, or that its evidence can satisfy Assurance.
