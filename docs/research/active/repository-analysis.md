# Repository Analysis Evaluation

Status: active investigation
Decision owner: operator
Evidence cutoff: 2026-09-04
Implementation authority: opt-in TypeScript reference prototype and local
fixtures authorized; production integration is not admitted
Promotion target: a dedicated roadmap track only after a reviewed promotion
decision
Exit condition: retain a dated promote, defer, or reject evaluation; then move
accepted contracts to their natural owners and delete this note when it has no
unique evidence

## Decision Question

Does a TypeScript-first repository analyzer materially improve verified task
outcomes, relevant file and span discovery, affected-test identification, or
total execution efficiency over the universal `rg`, targeted-read, and Git
baseline?

A favorable experiment does not authorize production integration. It supports
only a proposal that names the current consumer, minimum contract, measured
benefit, complexity, recovery path, and affected owners.

## Ownership Boundary

Repository Analysis means revision-bound acquisition of facts about the current
workspace. It does not own context admission, capability selection, durable
memory, artifact retention, or provider request assembly.

- Repository Analysis owns fact meaning, analyzer identity, supported queries,
  source locations, freshness, provenance, and completeness.
- [Capability Fabric](../../roadmap/11-capability-fabric.md) owns capability
  identity, implementation selection, materialization, invocation binding, and
  settlement if a production implementation is later admitted.
- [Context Governance](../../architecture/context/context-governance.md) owns
  optional model-visible context admission and deferral.
- The context resource plane owns retained artifacts and retrieval handles.
- Memory Lattice owns durable cross-session knowledge. It is not a symbol index,
  AST store, diagnostic database, or analyzer cache.
- Runtime owns workspace-read authority, execution, cancellation, limits, and
  adapter lifecycle.

An explicit model request may return a typed repository artifact. Automatic
orientation is a different workflow: it would create a repository context
candidate that still requires Context Governor admission. The experiment covers
only explicit invocation.

## Current Repository Evidence

- `code_intelligence` already exposes provider-neutral definition, reference,
  hover, symbol, diagnostic, implementation, and call-hierarchy operations
  through an adapter boundary.
- The current result does not establish a canonical workspace revision,
  analyzer capability set, completeness state, or enough provenance to prove
  absence or freshness across a dirty worktree.
- `rg`, bounded reads, and Git evidence remain available without a persistent
  index and form the required baseline and fallback.
- Capability Fabric already supplies catalog contribution, search, description,
  immutable generations, next-round materialization, portable invocation, and
  settlement. Repository Analysis must not recreate those mechanisms.
- Typed artifact reduction and exact resource retrieval already exist. An
  analyzer must reuse them rather than introduce a private result store.

## Experimental Contract

The first bounded experiment is
[TypeScript Reference Discovery v1](repository-analysis-reference-protocol.md).
It begins in Kiln's own repository. Java analysis and predecessor migration are
later work if the prototype demonstrates value; they do not block this slice.
The local development corpus does not close the broader evaluation below.
The [first reference results](repository-analysis-reference-results.md) record
the fixture-complete prototype, diagnostic measurements, and remaining gates.
The [configured-project results](repository-analysis-project-results.md) extend
that evidence to real operator-appearance source under its owning configuration.
That phase remains diagnostic and does not establish agent-task efficiency.
The [production/test results](repository-analysis-test-project-results.md)
extend exact reference coverage to the owning test configuration. Direct test
references remain distinct from behaviorally affected tests.
The [projection results](repository-analysis-projection-results.md) now record
compact initial context and exact in-process retrieval through Core's existing
owners. Full retrieval exceeds original response bytes; task-level efficiency remains open.
The [durable retrieval results](repository-analysis-durable-results.md) verify
file-store reopen and paginated Core resource reads in fresh processes.
The [local workflow results](repository-analysis-local-results.md) now connect
save/read/check with restart-time reanalysis and explicit historical/current
status. The broader task-efficiency and production-admission decisions remain open.
The [task-comparison preparation](repository-analysis-task-comparison-readiness.md)
now supplies five real-package tasks, source-bound outcome oracles and verified
reference edits. Live arm execution still requires a valid control, solver
isolation and an admitted execution manifest; no provider comparison has run.

The first experiment uses the repository-resolved TypeScript compiler API and
the existing `CodeIntelligenceAdapter` seam where it preserves the required
evidence. It remains opt-in, ephemeral, and outside the canonical production
request path.

Limit the requested fact classes to task-proven needs:

- symbol definitions and references;
- imports and dependency edges;
- implementations and call relations;
- diagnostics; and
- affected-test candidates.

Every result must identify:

- canonical workspace identity;
- committed revision plus bounded dirty and untracked fingerprints;
- analyzer and compiler identity with exact version;
- requested operation and supported capability set;
- observed paths and spans with source hashes where required;
- complete, partial, unsupported, or failed disposition;
- latency, cold or warm state, and fallback reason.

The experiment creates no durable repository index. Any cache is disposable,
bounded, revision-bound, and removed after the run. The analyzer has no direct
memory mutation authority.

## Benchmark

Preregister the protocol before comparative results are inspected. Freeze the
task corpus, repository revisions, dirty-worktree policy, expected files and
spans, success oracles, model and provider revision, prompt scaffold, tool
permissions, budgets, run counts, timeout treatment, aggregation, and promotion
thresholds.

Compare:

1. `rg` plus targeted reads and Git evidence;
2. the TypeScript analyzer;
3. the analyzer with baseline fallback; and
4. oracle context where feasible.

Measure verified task resolution, file and span precision and recall, affected
tests identified, provider input tokens, tool calls, provider rounds, latency,
startup and warm cost, memory, freshness, provenance completeness, and fallback
correctness. Provider input is not proof that the model semantically used an
individual fact.

## Promotion Decision

The dated evaluation must end in one of these states:

- **Promote:** propose a dedicated Repository Analysis roadmap with an actual
  consumer, minimum contract, integration boundary, migration, verification,
  and rollback.
- **Defer:** preserve the evidence and the missing prerequisite without keeping
  experimental production code.
- **Reject:** remove disposable analyzer code and state; retain only the dated
  evaluation when it remains useful.

Production promotion requires a separate operator decision. Cross-language
analysis, a supervised language-specific process, private prototype migration,
and destructive retirement of another repository each require additional,
explicit authority and are outside this investigation.

## Verification

- Adapter, revision, dirty-state, completeness, fallback, and no-direct-memory-
  mutation tests.
- Preregistered comparison against the exact baseline.
- Capability Catalog, artifact restoration, and Context Governor boundaries if
  a later production proposal is admitted.
- `bun run docs:check` for research and roadmap cross-reference changes.
