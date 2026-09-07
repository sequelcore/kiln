# Configured Project Reference Results v1

Status: diagnostic-only, 2026-09-05.
Protocol: [Configured Project Reference v1](repository-analysis-project-protocol.md).
Owner: [Repository Analysis Evaluation](repository-analysis.md).

## Outcome

The adapter finds the exact preregistered references in Kiln's real
operator-appearance package while consuming its owning tsconfig, inherited
settings, ESM package metadata, and installed Bun/Node declarations. All eight
expected production root files are present; other packages and tests are not
claimed as covered.

| Task | Expected occurrences | Analyzer precision / recall | Lexical rg precision / recall |
| --- | --- | --- | --- |
| Cross-file contrast function and exports | 5 | 1 / 1 | 1 / 1 |
| Private helper's channel parameter | 4 | 1 / 1 | 4/13 / 1 |
| Appearance resolver and export | 3 | 1 / 1 | 1 / 1 |

The [first collection](../fixtures/repository-analysis/project-v1/first-run.json)
contains nine task/repetition rows and 18 cold/warm analyzer observations. All
match the exact oracle and configured root-file set, with no error diagnostics
or partial results. One shared manifest captures 172 repository/configuration/
dependency inputs. Pinned compiler libraries have a separate digest included
in compiler-input identity.

These real cases do not show uniform advantage over search: lexical search was
already exact for both uniquely named functions. The analyzer's advantage in
this corpus is excluding nine unrelated occurrences of the parameter spelling.
The lexical arm does not include targeted reading or agent reasoning.

## Overhead and limits

In the first collection, cold query durations including capture/construction
were approximately 1.78-2.17 seconds; second queries on the same instance were
1.43-1.56 seconds. The lexical candidate operation took approximately
0.24-0.27 seconds. These durations include evidence freshness checks and are
not isolated compiler or search-engine timings.

Full analyzer evidence was about 31 KB per result, of which only 0.8-1.4 KB
was reference locations. Most remaining bytes are provenance and input hashes.
The report deduplicates identical input manifests by digest, but the current
adapter response itself retains the full manifest. It has not been integrated
with compact model-facing projection and exact artifact retrieval.

Consequently this phase establishes reference correctness for one small real
configured package, not lower task cost, lower provider tokens, better agent
outcomes, or a reason to make analysis automatic. The corpus is developmental,
not held out or independently reproduced. Multi-project references, external
consumers, native crash/hang/cancellation settlement, and production authority
remain unproven. Possible project-reference keys are conservatively reported
as a coverage limitation; this is not a general project-graph implementation.

## Verification and closeout

22 focused tests and the scripts typecheck pass. They cover the original
selected-file cases plus owning include/exclude rules, inherited strictness,
package module type, missing declarations, changed configuration/new sources,
symlink escape, input budgets, and byte-exact freshness. The project-mode CLI
also completed a real parameter-reference query.

Final capture hardening disables configured Git fsmonitor hooks and optional
Git locks during identity checks. A positive-control test demonstrates that
the fixture's hook executes under ordinary Git status but does not execute
during capture. The
[validation collection](../fixtures/repository-analysis/project-v1/validation-run.json)
records the final implementation separately; the first collection is retained
unchanged. All 18 validation observations also pass the exact reference and
root-file oracles. Documentation validation and diff whitespace checks pass.

Next admissible work: preregister queries spanning production and test sources
within an owning test tsconfig, with independent test-location expectations.
Keep test references distinct from a claim that every behaviorally affected
test was identified. Broader project-reference support and model-facing
projection need separately bounded experiments. A full agent-efficiency
comparison still requires the valid Runtime control and its live-run authority.

Continuation: the [production/test experiment](repository-analysis-test-project-results.md)
has now completed that bounded reference-coverage step. Its separate collection
retains the test-reference versus behavioral-impact distinction.
