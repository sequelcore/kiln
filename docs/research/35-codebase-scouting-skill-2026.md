# Codebase Scouting Skill Research

Status: accepted implementation basis for the native `codebase-scouting` skill.

## Question

Large repositories make exhaustive reading and unconditional full-suite feedback
too expensive for every small change. The design question is what evidence a
scout must collect to bound a change responsibly without pretending that text
search, an inferred dependency graph, or an affected-test subset proves complete
impact coverage.

## Sources

- Bazel query quickstart, including reverse-dependency analysis:
  <https://bazel.build/versions/9.0.0/query/quickstart>
- Bazel dependency model and limits of missing-dependency checks:
  <https://bazel.build/concepts/dependencies>
- Nx, Run Only Tasks Affected by a PR:
  <https://nx.dev/docs/features/ci-features/affected>
- Pants `changed` subsystem, including direct and transitive dependents:
  <https://www.pantsbuild.org/stable/reference/subsystems/changed>
- GitHub, Navigating code, definitions, symbols, and references:
  <https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github>
- Vitest, watching files outside the module graph:
  <https://main.vitest.dev/guide/recipes/watch-templates.html>
- Kazmi et al., *An empirical comparison of four Java-based regression test
  selection techniques*, Journal of Systems and Software 186 (2022):
  <https://doi.org/10.1016/j.jss.2021.111174>
- Chen et al., *Hybrid Regression Test Selection by Integrating File and Method
  Dependences*, ASE 2024:
  <https://zbchen.github.io/files/ase2024.pdf>
- Meta Engineering, Predictive test selection to ensure reliable code changes:
  <https://engineering.fb.com/2018/11/21/developer-tools/predictive-test-selection/>
- Google Research, *Taming the Variants: Multi-Architecture Continuous Testing
  at Google*, ICST 2026:
  <https://research.google/pubs/taming-the-variants-multi-architecture-continuous-testing-at-google/>
- Jimenez et al., *SWE-bench: Can Language Models Resolve Real-World GitHub
  Issues?*, ICLR 2024:
  <https://arxiv.org/abs/2310.06770>
- Xia et al., *Agentless: Demystifying LLM-based Software Engineering Agents*,
  FSE 2025:
  <https://arxiv.org/abs/2407.01489>
- Liu et al., *RepoBench: Benchmarking Repository-Level Code Auto-Completion
  Systems*, ICLR 2024:
  <https://openreview.net/forum?id=pPjZIOuQuF>
- Palmskog, Celik, and Gligoric, *Fully Verified Transformation of Dependency
  Graphs*, TACAS 2020:
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC7480691/>
- Zhang et al., *SWE-Explore: An Exploration Benchmark for Software Engineering
  Agents*, 2026 preprint:
  <https://arxiv.org/abs/2606.07297>

Sources were checked through 2026-08-12. Product documentation describes current
tool behavior; papers and industrial reports provide bounded empirical evidence,
not universal guarantees.

## Findings

Repository-native graphs are stronger than filename proximity. Bazel exposes
reverse dependencies, Nx combines Git changes with a project graph, and Pants
can include direct or transitive dependents. GitHub symbol navigation likewise
separates definitions and references from plain-text matches. These mechanisms
support a causal impact map, but only for relationships their build and language
models represent. The verified dependency-graph work formalizes traversal while
also separating that proof from domain-specific graph construction: correct
traversal cannot recover an edge the model never captured.

Selective testing can materially reduce feedback cost. The 2022 comparison of
four Java regression-test-selection tools reported a 40.49% average end-to-end
time reduction. It also reported 8.75% lower fault-detection ability for selected
tests than for the original suites. The ASE 2024 hybrid study documents missed
tests from semantic classification, dynamic binding, unsupported language
instrumentation, and external-library callbacks. The practical conclusion is
not "always run everything" or "affected tests are enough." Affected tests are a
fast feedback layer whose authority, blind spots, and fallback gates must be
explicit.

Tool-specific related-test modes expose the same boundary. Vitest documents that
its module graph cannot see arbitrary filesystem reads, templates, runtime JSON,
or build-produced artifacts without additional trigger configuration. A scout
must therefore record which graph and Git comparison base produced an affected
set and explicitly inspect dynamic, generated, data, and configuration edges.

Large-lab results depend on infrastructure that a manual scout does not possess.
Meta reported catching more than 99.9% of regressions before trunk visibility
while running roughly one third of transitively dependent tests, but its system
used historical outcomes, probabilistic calibration, flake handling, and regular
retraining. Google's 2026 multi-architecture study reports about 25% machine-cost
savings over 44,000 projects at the cost of a few delayed detections per day.
Those results show that risk-calibrated selection can work at scale; they do not
justify an unevaluated name-search heuristic in an arbitrary repository.

Repository-level coding benchmarks reinforce localization as a distinct task.
SWE-bench issues often require coordinated changes across files and execution
feedback. Agentless separates localization, repair, and validation, showing that
a bounded localization phase can support a simpler workflow. RepoBench measures
cross-file retrieval separately from generation. The 2026 SWE-Explore preprint
evaluates ranked repository regions under fixed line budgets across multiple
languages, but its trajectory-derived ground truth may encode agent and tool
bias. These benchmarks do not measure Kiln's scouting skill directly, so they
support the phase boundary rather than a claimed performance gain.

## Decision

Kiln's first-party scouting procedure must:

- begin from a concrete task, change, failure, symbol, or entry point;
- identify ownership and trace both dependencies and consumers;
- rank graph/build/symbol/runtime evidence above textual or naming proximity;
- classify relationships as direct, transitive, or uncertain;
- inspect common non-static edges such as registration, configuration,
  reflection, generation, plugins, serialization, data, and external contracts;
- map focused and downstream verification while stating that selective tests do
  not prove completeness;
- stop at an explicit evidence threshold and report unsearched surface; and
- hand a bounded impact map to planning without prescribing the implementation.

Broader gates remain proportionate. Public or shared contracts, build and
dependency metadata, dynamic integration, security-sensitive behavior, and
unresolved graph gaps justify wider verification. Repositories with an evaluated
affected-target system should use it; repositories without one must label manual
selection as inference.

## Non-Goals

- Do not require a full repository survey before every change.
- Do not require the full suite after every edit.
- Do not claim that static reachability equals behavioral impact.
- Do not turn scouting into implementation planning, architecture adjudication,
  code review, or generated project-context validation.
- Do not present vendor benchmark results as Kiln performance measurements.
