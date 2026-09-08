# Research Skill Verification

Evidence cutoff: 2026-09-08.

## Scope

This records source and integration verification of the research procedure
refactor. It is not a controlled model evaluation or evidence of better research
answers. The [research foundation](../research/foundations/skill-capability-governance.md#research-reassessment-september-8-2026)
records the inspected sources and design rationale.

The replacement scales planning to the question, introduces an adaptive search
loop, preserves claim support through summaries, and separates evidence synthesis
from recommendations. It removes the universal planning declaration and mandatory
status prefix. Citation, uncertainty, quantitative appraisal, and untrusted-content
boundaries remain explicit.

## Verification surface

- Core catalog checks cover the evidence and authority obligations.
- Work classification and CLI selection checks cover the canonical skill selected
  for external or provided evidence, including mixed repository/external scope.
- Native projection checks compare complete canonical rendered content across
  Codex, Claude Code, and OpenCode.
- Workspace typechecking and documentation validation cover integration and links.

These are contract checks. Matching instruction text does not demonstrate that a
model follows it. No live research-quality comparison was run for this refactor.

## Results

The canonical name is now `research`. Classification, selection, configuration,
and current documentation use that name; the previous name has no compatibility
alias. Historical smoke records retain the name and digest actually evaluated.

39 focused Core tests and 66 focused CLI tests passed across catalog,
classification, selection, configuration, and native projection. Workspace
typechecking and documentation validation passed. The managed sync installed
the source-matching research body across all three harnesses, removed the old
managed skill, and updated referring writing skills. A second preview required
no further skill writes. Unrelated Codex external-plugin catalog fingerprint
drift remained blocked and unchanged.

## Behavioral evaluation still needed

Compare no skill, the previous procedure, and the replacement under the same model,
tools, source material, and resource limits. Preserve prompts, outputs, retrieval
traces, source versions, and observation dates; repeat generations and hold back
cases from prompt tuning. Use dated fixtures for reproducibility and separate live
search cases for current-fact behavior.

| Case | Required outcome |
| --- | --- |
| One API version fact | Correct scoped answer with inspected support and proportional effort. |
| Inaccessible decisive source | Supported partial answer with the exact limitation, without pretending access. |
| Several articles derived from one study | One evidence lineage, not independent corroboration. |
| Conflicting product versions | Identify the version difference before choosing the applicable claim. |
| Unsupported citation or evidence lost in a summary | Repair or withdraw the claim using original support. |
| Plausible false page contradicted by records | Reconcile the conflict instead of accepting an answer-shaped assertion. |
| Stale reference answer | Check the observation date; do not mark a current supported answer wrong automatically. |
| Unanswerable question | State the unresolved evidence gap without inferring nonexistence from failed searches. |

Evaluate supported correctness, material coverage, citation entailment and coverage,
appropriate abstention, and effort. Use human review to examine automated-judge
disagreements. Source count, report length, and self-assigned confidence are not
success criteria. Formal-review methodology needs a separate specialist evaluation.
