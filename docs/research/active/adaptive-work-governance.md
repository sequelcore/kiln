# Adaptive Work Governance: Scouting, Decomposition, and Delegation

Status: baseline promoted; comparative benchmark remains incomplete
Owner: [issue #94](https://github.com/sequelcore/kiln/issues/94)
Evidence cutoff: 2026-08-20
Research mode: decision-oriented
Promotion targets:
[`work-governance.md`](../../architecture/core/work-governance.md),
[`coordination.md`](../../architecture/coordination/coordination.md), the
Sequel instruction profiles, `orchestration-workflow`, configuration defaults,
and a versioned evaluation record
Exit condition: the benchmark defined here produces a reviewed promotion
decision, or the candidate policy is rejected and the negative result is
retained.

## Decision

Determine when Kiln should keep repository scouting and execution in the
primary agent, delegate a bounded investigation, or select a coordinated
multi-agent topology. The decision must also establish a useful decomposition
unit and distinguish independent review from objective verification.

The production contract supports direct, sequential, centralized, and
independent-review topologies. Direct execution is now the smallest safe global
default; the unresolved question is which measured task structures justify
explicit delegation triggers and whether those policies improve results enough
to earn their coordination cost.

This investigation defines the evidence required before any broader
orchestration trigger or adaptive topology policy is promoted.

## Scope and Definitions

- **Orientation** is the minimum primary-agent inspection needed to identify the
  owner, formulate bounded questions, and retain integration responsibility.
- **Scouting** maps repository ownership, dependencies, affected verification,
  and material uncertainty. It may run in the primary context or a delegated
  context.
- **Delegation** assigns one bounded objective to another agent and requires a
  typed handoff; it is not equivalent to parallelism.
- **Topology** is direct, sequential, centrally coordinated, or independent
  work under the existing runtime contract.
- **Decomposition unit** is a result that can be completed, verified, reviewed,
  and adopted without relying on hidden context. File count, LOC, and elapsed
  minutes are observations, not this semantic boundary.
- **Oracle** is external evidence such as tests, typecheck, lint, builds,
  invariants, exact-format validation, or candidate-bound inspection. An LLM
  reviewer proposes findings but is not an oracle merely because it is
  independent.

## Method

The search began with first-party laboratory and product guidance, then papers
with controlled or process-oriented measurements, followed by reproducible
creator artifacts and adverse practitioner experience. Claims are classified
below as measured evidence, first-party operational guidance, or practitioner
observation. The search stopped after covering single-versus-multi-agent
architecture, repository retrieval, verifier behavior, coding practice,
context isolation, and orchestration failure modes; further sources repeated
the same conditional result rather than changing the decision.

Searched surfaces include OpenAI, Anthropic, Google Research/DeepMind,
Microsoft Research, arXiv papers, maintained open-source orchestration methods,
and experienced creator reports. No controlled public study was found that
compares primary-agent repository scouting with same-model and cheaper-model
delegated scouts while holding task, harness, context, and budget fixed. That
comparison remains the highest-value local experiment.

## Findings

### 1. Multi-agent value depends on task structure

OpenAI's operational guidance recommends starting with a single agent and
adding multi-agent complexity only when needed. Anthropic similarly recommends
the simplest composable workflow that meets the task, using parallelization for
independent subtasks and orchestrator-workers for dynamic decomposition.
Neither source publishes a controlled coding comparison for cheap delegated
scouting.

Google Research evaluated 180 configurations across five architectures, three
model families, and four benchmarks with standardized budgets. Centralized
coordination improved a parallelizable finance task, while every multi-agent
variant degraded the sequential PlanCraft benchmark by 39–70%. Its predictive
model selected the best tested architecture in 87% of held-out configurations,
but the four-benchmark scope does not establish a universal repository policy.

Anthropic reports a 90.2% internal gain for a lead Opus 4 plus Sonnet workers
over single-agent Opus 4 on breadth-first research. Anthropic also attributes a
large share of performance variance to token use and reports much higher chat
token consumption. The result supports independent breadth-first search, not
budget-matched coding delegation; Anthropic explicitly notes that coding often
has fewer parallelizable branches and more dependencies.

### 2. Scouting delegation is plausible but unproven as a default

Anthropic's Claude Code practice starts with Explore-Plan-Code and recommends
subagents for particular investigations, especially early in complex tasks, to
preserve primary context. Simon Willison publishes a concrete Explore-subagent
transcript and recommends subagents primarily for context-heavy operations and
independent file work.

ContextBench instead finds only marginal retrieval gains from sophisticated
agent scaffolds across 1,136 issues from 66 repositories and eight languages;
agents explored more context than they used and favored recall over precision.
It does not isolate a cheap scout condition, but it cautions against treating
more exploration or more scaffolding as retrieval quality.

Armin Ronacher reports that subagents work for investigation and basic
parallelization but produce poor results for coupled read/write work; he often
prefers a new session with directly supplied context. This is sustained
practitioner experience with a disclosed informal three-run acceptance method,
not a controlled benchmark.

Together these sources support a bounded hypothesis: the primary agent should
perform cheap orientation, then delegate only specific independent or
context-heavy questions. They do not support `delegate-first`, `root-only`, or
`cheap-scout` as universal policy.

### 3. Dependency and mutable ownership dominate file count

Google's sequential penalty and tool-coordination trade-off, Anthropic's
parallelization guidance, and creator experience converge on the same
qualitative boundary: parallel work needs independent state and non-overlapping
mutable ownership. A multi-file change can be tightly coupled; several
read-only questions can be independent.

Addy Osmani's published demonstration makes Data and Validation parallel and
API work dependent on both. It documents manual dependency management, missing
shared state, and file-scope conflict risk. The reported token count has no
single-agent baseline or repetitions, so the demo illustrates a workable graph
rather than cost-effectiveness.

Superpowers makes each task independently testable and reviewable and uses a
fresh child contract. Its two-to-five-minute planning steps are an operating
method, not comparative evidence for a universal duration threshold. Kiln
should adopt the semantic deliverable boundary for evaluation without copying
the fixed time heuristic.

### 4. Review roles do not guarantee verification

TeamBench evaluates 851 templates and 931 instances under OS-enforced role
separation. Teams helped weaker models but hurt stronger ones; verifier agents
approved 49% of submissions that failed the deterministic grader, and removing
the verifier improved mean partial score in its ablation. Prompt-only and
enforced teams also had similar pass rates even though prompt-only verifiers
attempted to edit code 3.6 times more often.

The result is direct adverse evidence against a mandatory
Planner-Executor-Verifier topology. It supports Kiln's separation between an
independent reviewer that raises hypotheses and candidate-bound oracles that
establish observable properties.

Google reports that independent agents amplified errors by as much as 17.2
times, while centralized coordination limited amplification to 4.4 times in
its tested conditions. A central integrator is therefore the stronger candidate
when several outputs affect one final decision, but it is still not proof that
an LLM manager detects defects reliably.

### 5. Durable state and limits address real operational failures

Gas Town's beads demonstrate durable, versioned work units that survive context
loss and process failure. Its creator also reports duplicated and lost work,
hands-on operation, and high cost. The evidence supports externalizing task
identity, decisions, acceptance, and terminal state; it does not establish that
deep hierarchies or high fan-out are efficient.

Issue reports for native agent recursion and context-fork failures are useful
failure fixtures, not population estimates. They justify tested limits on
fan-out, depth, retries, and total coordination budget, plus a curated child
contract that separates established context from the active task.

## Contradictions and Resolution

- Anthropic's large research gain and Google's sequential degradation concern
  different task structures and budgets. Breadth-first independent research is
  not equivalent to stateful coding.
- Anthropic and Willison emphasize context preservation; ContextBench questions
  the retrieval value of sophisticated scaffolding. Kiln must measure retained
  root context and useful retrieved context separately.
- Superpowers favors fresh isolated children; Ronacher often favors rich direct
  context. The likely moderator is contract stability and hidden coupling, not
  one universally superior context strategy.
- Centralization limits propagation in Google's benchmark, while TeamBench
  shows weak verifier judgment. Coordination and verification are different
  functions and require separate measures.
- Large orchestrators demonstrate throughput but openly accept duplication,
  cost, and operator load. Throughput cannot substitute for accepted work,
  correctness, or cost-effectiveness.

## Candidate Policy Hypotheses

The benchmark should test, not assume, these rules:

1. Direct execution is the baseline. Delegation requires a named source of
   expected value: parallelism, specialization, context isolation, or
   independent evidence.
2. The primary agent performs minimum orientation and remains accountable for
   synthesis, integration, and closeout.
3. Delegate scouting only for bounded questions whose search breadth or output
   would materially consume the primary context, or for genuinely independent
   evidence branches.
4. Decompose by independently completable, testable, and reviewable outcome.
   Avoid fixed file, LOC, or minute thresholds as the semantic rule.
5. Serialize dependency-bearing work, overlapping writes, high-risk effects,
   and tasks requiring one evolving state.
6. Prefer a central integrator when multiple results affect one decision.
   Independent agents are appropriate only when the evidence itself must be
   independent.
7. Treat LLM review as a source of findings. Require external oracles for every
   available completion claim they can establish.
8. Give every child a bounded contract: objective, non-goals, established
   decisions, mutable ownership, dependencies, allowed tools and sources,
   expected output, verification, stop condition, and uncertainty.
9. Limit fan-out, depth, retries, and coordination budget. Persist progress and
   adoption state outside conversational memory.

## Benchmark Design

Use real replayable Kiln tasks stratified by dependency shape, write overlap,
tool count, repository familiarity, expected context volume, risk, and
single-agent baseline competence.

Evaluate meaningful cells across:

- scouting: primary orientation, same-model scout, cheaper-model scout;
- execution: direct/sequential, centralized manager-worker, independent
  parallel work;
- verification: external oracles only, reviewer plus external oracles;
- child context: full fork, curated envelope, isolated task plus durable
  resource references.

Run fixed-budget and unconstrained observations with at least three to five
repetitions per admitted cell. Pre-register cells excluded for invalid
semantics, such as parallel mutation of the same file. Record deterministic
success first, followed by escaped defects, total provider token classes,
coordinator turns, latency, retries, rework, merge conflicts, duplicated
exploration, context and handoff loss, false approvals, child count and depth,
and operator intervention. Unknown usage remains unknown.

Promotion requires a policy based on observable task properties, not a global
`orchestrate` label or a benchmark-wide average that hides a material stratum
regression.

## Relationship to Configuration Ownership

The canonical configuration boundary owns the schema, descriptors, scopes, precedence, activation,
effective-state projection, and governed mutation of `workGovernance`. It does
not own the coordination algorithm or ratify policy defaults. Configuration may
represent the current contract, but a schema migration must not fossilize the
current default or add compatibility aliases around a policy superseded by this
evaluation.

## Non-Claims and Residual Uncertainty

- No searched evidence establishes that delegated scouting is better than
  primary-agent scouting for Kiln repositories.
- No evidence establishes that a cheaper scout lowers total cost once extra
  turns, retries, integration, and rework are counted.
- The Google and TeamBench results are controlled but cover limited benchmark
  families and do not determine Kiln's exact thresholds.
- Creator demonstrations and issue reports inform fixtures and failure modes;
  they do not establish incidence or causal superiority.
- The optimal task granularity, context envelope, and competence threshold
  remain empirical questions.

## Sources

Primary and first-party:

- OpenAI, [A practical guide to building
  agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/).
- OpenAI, [How OpenAI uses
  Codex](https://openai.com/business/guides-and-resources/how-openai-uses-codex/).
- Anthropic, [Building effective
  agents](https://www.anthropic.com/engineering/building-effective-agents).
- Anthropic, [Claude Code best
  practices](https://www.anthropic.com/engineering/claude-code-best-practices).
- Anthropic, [How we built our multi-agent research
  system](https://www.anthropic.com/engineering/multi-agent-research-system).
- Google Research, [Towards a science of scaling agent
  systems](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/),
  with the [paper](https://arxiv.org/abs/2512.08296).
- Kim et al., [TeamBench](https://arxiv.org/abs/2605.07073).
- Li et al., [ContextBench](https://arxiv.org/abs/2602.05892).

Practitioner and reproducible method artifacts:

- Simon Willison, [Subagents](https://feeds.simonwillison.net/guides/agentic-engineering-patterns/subagents/).
- Armin Ronacher, [Agentic Coding Things That Didn't
  Work](https://lucumr.pocoo.org/2025/7/30/things-that-didnt-work/).
- Addy Osmani, [The Code Agent
  Orchestra](https://addyosmani.com/blog/code-agent-orchestra/).
- obra, [Superpowers writing
  plans](https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md?plain=1)
  and [subagent-driven
  development](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md?plain=1).
- Steve Yegge, [Welcome to Gas
  Town](https://yegge.ai/essays/welcome-to-gas-town/).
