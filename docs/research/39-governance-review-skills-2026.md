# Governance Review Skills (2026)

Status: accepted research basis
Cutoff: 2026-08-12

## Decision

Four remaining built-ins become evidence contracts rather than generic
checklists:

- config projection review consumes shared ownership and drift status and never
  mutates during review;
- benchmark review separates validity, reproducibility, external evaluation,
  and public claims;
- repo-context review resolves conflicting durable facts without confusing
  canonical content with generated projection state;
- action-first communication orders information without inventing brevity,
  certainty, urgency, or a next action.

## Config projection

Terraform separates preview from apply and exposes drift; Kubernetes
Server-Side Apply records field ownership and conflicts; SLSA and reproducible
builds bind artifacts to source and build evidence.
[Terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan),
[Kubernetes field management](https://kubernetes.io/docs/reference/using-api/server-side-apply/),
[SLSA provenance](https://slsa.dev/spec/v1.2/provenance),
[reproducible builds](https://reproducible-builds.org/docs/definition/).

These are analogies and standards for ownership/provenance, not measured proof
of Kiln's design. Kiln's adopted policy is to use its typed shared status,
classify canonical/current/missing/stale/drifted/unmanaged state, preserve
unmanaged bytes and fields, block ambiguous or authority-sensitive repair, and
route mutations through canonical edit or proposal/approval/apply followed by
projection sync.

## Benchmark readiness

- tau-bench introduced pass^k and found repeated-run reliability remained low
  for strong agents in its domains. The result is domain/model/version-specific.
  [Paper](https://arxiv.org/abs/2406.12045)
- NIST AI 800-2's initial public draft requires construct/objective definition,
  benchmark fit, run validation, uncertainty, implementation detail, and
  qualified claims. It is not yet a final standard.
  [Draft](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.800-2.ipd.pdf)
- NIST AI 800-3 treats benchmark results as uncertain estimates and distinguishes
  fixed-benchmark from generalized accuracy. Its statistical methods are
  conditional on model assumptions. [Report](https://doi.org/10.6028/NIST.AI.800-3)
- ACM distinguishes artifact availability/functionality/reusability from
  independently reproduced results.
  [Badging policy](https://www.acm.org/publications/policies/artifact-review-and-badging-current)

Kiln therefore records a frozen route and protocol, retains every typed trial
including failed/unsupported/unknown rows, validates scorer and artifact
identity, reports denominators and uncertainty, separates pass^k from pass@k,
and uses four verdicts: blocked, internal-baseline-ready,
external-evaluation-ready, and public-claim-ready.

## Repository context

Repository-level benchmarks and retrieval research support relevant multi-file
context, while long-context research shows that merely adding more context does
not guarantee use of the right facts.
[SWE-bench](https://proceedings.iclr.cc/paper_files/paper/2024/hash/edac78c3e300629acfe6cbe9ca88fb84-Abstract-Conference.html),
[RepoCoder](https://aclanthology.org/2023.emnlp-main.151/),
[Lost in the Middle](https://arxiv.org/abs/2307.03172).
GitHub's instruction guidance also distinguishes repository and path-scoped
facts, but harness precedence is not a universal contract.
[Guidance](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions).

Kiln resolves direct manifest, lockfile, workspace, CI, and build evidence
before prose when they conflict; preserves supported human notes; records
unknowns; and updates only `.kiln/project-context.md`. Projection ownership and
drift remain the config-projection skill's responsibility.

## Action-first communication

Eye-tracking research finds top-heavy scanning tendencies, while CDC, WCAG, and
GOV.UK guidance support important information first, descriptive headings,
textual error identification, and actionable correction.
[NN/g](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/),
[CDC plain language](https://www.cdc.gov/health-literacy/php/develop-materials/plain-language.html),
[WCAG headings](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels),
[GOV.UK errors](https://design-system.service.gov.uk/components/error-message/).

This evidence does not directly prove assistant-chat outcomes. Action-first
therefore remains explicit response shaping. It yields to findings-first,
safety, accuracy, and requested formats; makes applicable work state visible;
and never fabricates certainty, urgency, completion, or a call to action.
