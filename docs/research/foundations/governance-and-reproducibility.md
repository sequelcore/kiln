# Governance and Reproducibility

Evidence cutoff: 2026-08-12.

This foundation preserves the evidence behind Kiln's config-projection review,
benchmark-readiness review, and repository-context review. Current behavior
belongs to
[`config-projection.md`](../../architecture/surfaces/config-projection.md),
[`benchmark-validation.md`](../../architecture/quality/benchmark-validation.md),
and the project-context contract in
[`agent-context.md`](../../architecture/context/agent-context.md).

The shared thread is provenance: each procedure decides what a system may claim
about state it did not fully author.

## Ownership and drift are prior art

Terraform separates preview from apply and exposes drift. Kubernetes
Server-Side Apply records field ownership and conflicts. SLSA and reproducible
builds bind artifacts to source and build evidence.

These are analogies and standards for ownership and provenance, not measured
proof of Kiln's design. What Kiln takes from them is the shape: a typed shared
status that classifies canonical, current, missing, stale, drifted, and
unmanaged state; preservation of unmanaged bytes and fields; blocking ambiguous
or authority-sensitive repair; and routing mutations through canonical edit, or
proposal, approval, and apply followed by projection sync. Review never mutates.

- [Terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Kubernetes field management](https://kubernetes.io/docs/reference/using-api/server-side-apply/)
- [SLSA provenance](https://slsa.dev/spec/v1.2/provenance),
  [reproducible builds](https://reproducible-builds.org/docs/definition/)

## A benchmark result is an estimate, not a fact

tau-bench introduced pass^k and found repeated-run reliability remained low for
strong agents in its domains — a domain-, model-, and version-specific result.
NIST AI 800-2's initial public draft requires construct and objective
definition, benchmark fit, run validation, uncertainty, implementation detail,
and qualified claims; it is not yet final. NIST AI 800-3 treats benchmark
results as uncertain estimates and distinguishes fixed-benchmark from
generalized accuracy, with statistical methods conditional on model assumptions.
ACM separates artifact availability, functionality, and reusability from
independently reproduced results.

Kiln therefore records a frozen route and protocol, retains every typed trial
including failed, unsupported, and unknown rows, validates scorer and artifact
identity, reports denominators and uncertainty, keeps pass^k distinct from
pass@k, and grades readiness in four verdicts: blocked, internal-baseline-ready,
external-evaluation-ready, and public-claim-ready.

- [tau-bench](https://arxiv.org/abs/2406.12045)
- [NIST AI 800-2 draft](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.800-2.ipd.pdf),
  [NIST AI 800-3](https://doi.org/10.6028/NIST.AI.800-3)
- [ACM artifact review and badging](https://www.acm.org/publications/policies/artifact-review-and-badging-current)

## More context is not better context

Repository-level benchmarks and retrieval research support relevant multi-file
context, while long-context research shows that adding context does not
guarantee the right facts are used. GitHub's instruction guidance distinguishes
repository-scoped from path-scoped facts, but harness precedence is not a
universal contract.

Kiln resolves direct manifest, lockfile, workspace, CI, and build evidence
before prose when they conflict; preserves supported human notes; records
unknowns; and updates only the bound private project `context` artifact under
`<Kiln home>/projects/<project-id>/`. Generated `AGENTS.md` and `CLAUDE.md`
remain sync projections and are never the durable authoring target.
Projection ownership and drift stay with config-projection review.

- [SWE-bench](https://proceedings.iclr.cc/paper_files/paper/2024/hash/edac78c3e300629acfe6cbe9ca88fb84-Abstract-Conference.html),
  [RepoCoder](https://aclanthology.org/2023.emnlp-main.151/)
- [Lost in the Middle](https://arxiv.org/abs/2307.03172)
- [GitHub repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions)

## Public evidence is directional, not representative

Social and public-web evidence can reveal observed pain, language, workarounds,
and emerging demand. It is not a sample. Public posts overrepresent people who
post publicly, highly engaged communities, loud or repeated voices,
platform-specific demographics, and topics that are easy to express in public.
Bots, coordinated activity, deleted content, private conversations, and API
access limits distort it further, and synthetic user-generated content is now a
named contamination risk rather than a hypothetical one.

Kiln therefore records sampling limitations alongside any collected evidence,
keeps collection separate from review and decision, and re-checks a candidate
against other evidence before a high-impact roadmap or architecture decision
depends on it.

- [Social Data: Biases, Methodological Pitfalls, and Ethical Boundaries](https://pmc.ncbi.nlm.nih.gov/articles/PMC7931947/)
- [Hargittai, Potential Biases in Big Data: Omitted Voices on Social Media](https://www.mkoganresearch.com/assets/hargittai.pdf)
- [The Generation, Identification, and Mitigation of AI-Fabricated UGC](https://arxiv.org/html/2403.14706v1)

## Accepted separations

- **Canonical content is not generated projection state.** A projection is
  evidence of a sync, never the authoring target or the authority.
- **Availability, functionality, and reproduction are three claims.** An
  artifact that exists and runs has not thereby been independently reproduced.
- **Preview is not apply, and review is not mutation.** A procedure that can
  change what it inspects cannot report on it.
- **An unknown is retained, not dropped.** Failed, unsupported, and unknown
  trials stay in the denominator.

## Non-claims

- The cited ownership and provenance systems are prior art for shape, not
  validation of Kiln's projection model.
- No cited benchmark result transfers to Kiln workflows without local paired
  evaluation.
- NIST AI 800-2 remains a draft, and its requirements are not a compliance
  claim.
