status: complete

# Artifact Quality Evidence

## Decision

This decision-oriented review closed on 2026-08-26. It asked which anti-slop
practices are reliable enough for a deterministic Kiln producer and which must
remain contextual review. Community rankings, installation counts, and author
claims were discovery evidence, not effectiveness evidence. The review sampled
the supplied skills, their upstream repositories, empirical papers, large-lab
deployments, adverse evidence, and the operator's existing global skills and
Sequel doctrine.

Kiln admits `quality_analyze` as an opt-in static producer. The first profile is
`type-integrity/v1`; it contains only chained type assertion and
widen-then-assert diagnostics. The tool is facts-only, candidate-bound, and
agent-invocable once configured. It does not identify AI authorship, compute a
quality score, repair code, gate completion, or map itself to Assurance.

## Community evidence

The supplied anti-slop lists mix three mechanisms:

- mechanically detectable code patterns, such as type laundering;
- contextual review signals, such as structural growth, serial orchestration,
  non-atomic updates, patch minimality, and test smells;
- prose preferences, such as avoiding filler, fabricated facts, repetitive
  cadence, or a particular punctuation mark.

Skills.sh ranks installation telemetry, not successful use or output quality.
Several listed skills share sources and rules, so rank is not independent
replication. `dmmulroy/anti-slop` is useful rule discovery and explicitly favors
vendoring/adaptation, but Oxlint's JavaScript plugin API is alpha and lacks
TypeScript type awareness. Kiln therefore owns the admitted rule behavior and
fixtures rather than executing the upstream plugin.

The Thermo-Nuclear review is valuable as a high-intensity contextual review,
especially for simplification and non-atomic update risks. Its global 1,000-line
red line and similar thresholds are not calibrated universal hard rules.
Complexity is likewise a signal for human or model investigation, not a defect
by itself. Brian Lovin's later public withdrawal of endorsement for a listed
`deslop` skill is adverse evidence against treating popularity as qualification.

Writing packs converge on useful goals such as truth, specificity, voice
preservation, and removal of filler. Their hard bans on em dashes, passive
voice, adverbs, examples, or rhetorical forms have language- and
domain-dependent false positives. Kiln's existing `clear-writing` profile owns
inferential prose quality. Those rules do not belong in the static TypeScript
producer.

## Benchmark readiness

The claim "anti-slop profiles improve agent output across models" is currently
**diagnostic-only**. No reviewed source supplies a controlled, paired,
cross-model evaluation of these exact profiles.

Slopkit's benchmark is candid about its limits: its scorer is self-authored,
the comparison measures parity rather than ranking, and 23 of 25 cases were
exact five-way ties. Its earlier 0.92 win rate was withdrawn after ties were
credited to the first-listed tool. The reusable contribution is its
preservation and false-positive corpus pattern, not its leaderboard.

SlopCodeBench reports long-horizon quality erosion and verbosity in an
iterative Python benchmark. Its public revisions disagree on corpus size (the
abstract snapshot reports 20 problems and 93 checkpoints while a later page
reports 36 and 196), so future comparison must pin the paper revision. METR's
blinded maintainer study found that passing benchmark tests materially
overstates merge readiness, but it involved four maintainers and three
repositories. Both support measuring accepted repairs, churn, and trajectory
quality rather than using test pass or line count alone.

LAMP's 1,057 professionally edited LLM paragraphs support span-level writing
feedback while also showing subjective categories and only moderate annotator
agreement. OpenAI retired its AI-text classifier after reporting 26% true
positive and 9% false positive performance on its challenge set. Kiln therefore
must not expose an AI-authorship score.

## Profile boundaries

- `type-integrity`: deterministic TypeScript syntax; admitted now.
- `complexity`: possible later signal profile, never a universal hard gate.
- `test-integrity`: possible later profile after language-specific calibration.
- structural erosion and patch minimality: repository/diff/trajectory review,
  not a single-file parser concern.
- prose and research quality: inferential domain profiles with preservation
  checks, not static code diagnostics.

Community additions are reviewed Kiln contributions. A proposed rule needs
source and license provenance, a precise observable, positive defects,
accepted-reference controls, a holdout, false-positive measurement, overlap
analysis, stable messages, and a profile revision. It ships through the normal
Kiln release. There is no external runtime plugin ecosystem to support.

## Required paired evaluation

Promotion beyond opt-in diagnostic evidence requires the same tasks, models,
routes, harness, budgets, and acceptance oracles with and without the tool.
Record actual invocation, operator-confirmed defects, accepted repairs,
typecheck/tests, churn, latency, tool calls, false positives, and independent
labels on a holdout corpus. Popularity and anecdotal large deletions are not
substitutes.

## Sources

- Skills.sh telemetry semantics: https://www.skills.sh/docs
- anti-slop: https://github.com/dmmulroy/anti-slop
- Oxlint JavaScript plugin status: https://oxc.rs/docs/guide/usage/linter/js-plugins.html
- Oxlint complexity rule: https://oxc.rs/docs/guide/usage/linter/rules/eslint/complexity
- Thermo-Nuclear review: https://www.skills.sh/shaneholloman/cursor-plugins/thermo-nuclear-code-quality-review
- Slopkit benchmark: https://github.com/ehmo/slopkit/blob/main/skills/slopbeth/BENCHMARKS.md
- LAMP: https://arxiv.org/abs/2409.14509
- OpenAI classifier withdrawal: https://openai.com/index/new-ai-classifier-for-indicating-ai-written-text/
- SlopCodeBench: https://arxiv.org/abs/2603.24755
- METR maintainer study: https://metr.org/notes/2026-03-10-many-swe-bench-passing-prs-would-not-be-merged-into-main/
- CodeSmellEval: https://arxiv.org/abs/2412.18989
- LLM-generated test smells: https://arxiv.org/abs/2410.10628
- Google AutoCommenter: https://arxiv.org/abs/2405.13565
