# Engineering Review Practice

Evidence cutoff: 2026-08-12.

This foundation preserves the evidence behind Kiln's scouting, planning, and
architecture-review procedures. Current behavior belongs to the admitted skills
and to [`work-governance.md`](../../architecture/core/work-governance.md).

The three procedures rest on one finding: repository evidence beats proximity
and ceremony, and every technique that narrows work has a measured blind spot
that must stay visible rather than be argued away.

## Bounding a change

Repository-native graphs are stronger than filename proximity. Bazel exposes
reverse dependencies, Nx combines Git changes with a project graph, Pants can
include direct or transitive dependents, and GitHub symbol navigation separates
definitions and references from plain-text matches. Verified dependency-graph
work formalizes traversal while separating that proof from graph construction:
correct traversal cannot recover an edge the model never captured.

- [Bazel query](https://bazel.build/versions/9.0.0/query/quickstart),
  [Bazel dependencies](https://bazel.build/concepts/dependencies)
- [Nx affected](https://nx.dev/docs/features/ci-features/affected),
  [Pants `changed`](https://www.pantsbuild.org/stable/reference/subsystems/changed)
- [GitHub code navigation](https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github)
- [Fully Verified Transformation of Dependency Graphs](https://pmc.ncbi.nlm.nih.gov/articles/PMC7480691/)

Selective testing reduces cost and detection together. A 2022 comparison of four
Java regression-test-selection tools reported a 40.49% average end-to-end time
reduction alongside 8.75% lower fault-detection ability than the original
suites. An ASE 2024 hybrid study documents misses from semantic classification,
dynamic binding, uninstrumented languages, and external-library callbacks.
Vitest documents that its module graph cannot see arbitrary filesystem reads,
templates, runtime JSON, or build-produced artifacts without extra triggers.
The conclusion is neither "always run everything" nor "affected tests are
enough": affected tests are a fast layer whose authority and fallback gates must
be stated.

- [Kazmi et al., JSS 186 (2022)](https://doi.org/10.1016/j.jss.2021.111174)
- [Chen et al., ASE 2024](https://zbchen.github.io/files/ase2024.pdf)
- [Vitest watch triggers](https://main.vitest.dev/guide/recipes/watch-templates.html)

Large-lab selection results depend on infrastructure a manual scout lacks. Meta
reported catching more than 99.9% of regressions while running roughly a third
of transitively dependent tests — using historical outcomes, probabilistic
calibration, flake handling, and retraining. Google's 2026 multi-architecture
study reports about 25% machine-cost savings across 44,000 projects at the cost
of a few delayed detections per day. These show risk-calibrated selection can
work at scale; they do not license an unevaluated name-search heuristic.

- [Meta predictive test selection](https://engineering.fb.com/2018/11/21/developer-tools/predictive-test-selection/)
- [Taming the Variants, ICST 2026](https://research.google/pubs/taming-the-variants-multi-architecture-continuous-testing-at-google/)

Repository-level benchmarks support localization as its own phase.
[SWE-bench](https://arxiv.org/abs/2310.06770) issues often require coordinated
multi-file change; [Agentless](https://arxiv.org/abs/2407.01489) separates
localization, repair, and validation and stays competitive without elaborate
orchestration; [RepoBench](https://openreview.net/forum?id=pPjZIOuQuF) measures
cross-file retrieval apart from generation;
[SWE-Explore](https://arxiv.org/abs/2606.07297) ranks repository regions under
fixed line budgets, though its trajectory-derived ground truth may encode agent
and tool bias. These support the phase boundary, not a performance claim.

## Planning a change

Planning helps most when changes are interdependent. CodePlan used incremental
dependency and impact analysis across 2–97 file tasks and passed validity checks
on five of six repositories where no-planning baselines passed none — but across
only two task families and six repositories, which does not justify mandatory
planning for every edit.

Long-horizon execution stays brittle. LongCLI-Bench's 20 sequential tasks left
evaluated agents below 20% pass rate, most stalling before 30% completion, with
human plan injection helping more than self-correction. A 2026 planning
benchmark measures planning errors separately and reports better downstream
execution after plan-focused refinement across 400 transferred tool-use tasks.
SWE-RPG, a new preprint over 163 Python and Java tasks with assisted ground
truth, reports implicit requirement recovery as a leading failure source. Taken
together these support inspectable, revisable plans — not an authoritative first
plan.

- [CodePlan](https://arxiv.org/abs/2309.12499),
  [LongCLI-Bench](https://aclanthology.org/2026.findings-acl.1497/)
- [Agent Planning Benchmark](https://arxiv.org/abs/2606.04874),
  [SWE-RPG](https://arxiv.org/abs/2608.09072)

Delivery guidance converges on coherent small batches with valid intermediate
states, explicit dependency order for stacked changes, verification between
stages, and real recovery for stateful change — but supplies no universal file
or line threshold. A slice is therefore atomic by behavior and recoverability,
not by size. Agent guidance separately argues against ritual process: start with
the simplest system, and accept that complex multi-file work cannot always
predict every required file in advance.

- [Google small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html),
  [DORA small batches](https://dora.dev/capabilities/working-in-small-batches/)
- [SRE canarying](https://sre.google/workbook/canarying-releases/),
  [Anthropic, building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Spec Kit, evolving specs](https://github.github.com/spec-kit/guides/evolving-specs.html)

## Reviewing a boundary

Clean Architecture and DDD review stay separate, and neither rewards ceremony.
A port, aggregate, event, or versioned contract is justified only by real
volatility, invariants, coupling, or active consumers.

Measured support concerns coupling rather than any named method. Dependency
cycles have been associated with greater defect proneness; a systematic review
relates coupling, complexity, and size to fault proneness while warning that
definitions and causal interpretations vary; DORA observes that loosely coupled
architectures and teams predict better delivery outcomes, as correlational
survey evidence. A 2025 review of 36 DDD studies reports benefits around
ubiquitous language, bounded contexts, domain events, and decomposition, but
finds weak empirical evaluation across much of the literature and meaningful
expertise costs.

- [Cycles and defect proneness](https://www.sciencedirect.com/science/article/abs/pii/S0164121213001878),
  [systematic review](https://arxiv.org/abs/1601.01447)
- [DORA loosely coupled teams](https://dora.dev/capabilities/loosely-coupled-teams/),
  [2025 DDD review](https://www.sciencedirect.com/science/article/pii/S0164121225002055)

The design tradition supplies the vocabulary: the dependency rule points source
dependencies toward stable policy; a bounded context delimits one internally
consistent model and language; an aggregate is a consistency boundary reached
through its root, started from business invariants and transactions and
distinguished from a deployable service. SEI treats propagation cost, cycles,
conformance, and quality-attribute tradeoffs as architecture evidence.

- [The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html),
  [SEI measurement framework](https://sei.cmu.edu/blog/developing-an-architecture-focused-measurement-framework-for-managing-technical-debt/)
- [Bounded Context](https://martinfowler.com/bliki/BoundedContext.html),
  [DDD Aggregate](https://martinfowler.com/bliki/DDD_Aggregate.html),
  [Microsoft domain model guidance](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/microservice-domain-model)

## Non-claims

- Static reachability is not behavioral impact, and an affected-test set is not
  proof of complete coverage.
- Vendor and lab benchmark results are not Kiln performance measurements.
- Clean Architecture and DDD remain design traditions with incomplete direct
  causal evidence; conformance to a brand is not evidence.
- None of the cited planning work validates Kiln's plan format.
