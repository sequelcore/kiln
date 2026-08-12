# Research Workflow Skill (2026)

Status: accepted research basis
Cutoff: 2026-08-12

## Decision

Kiln ships `research-workflow` as a compact, provider-neutral built-in. It is
canonical procedure for Kiln-managed and standalone harness use. Kiln-managed
research tasks recommend it through task suitability and explicit research work
classification. Existing skill projection publishes the same canonical body to
Codex, Claude Code, and OpenCode.

The skill governs research method and evidence quality. It does not grant
search, network, browser, filesystem, route, model, budget, permission, or
approval authority. Each harness uses only capabilities actually admitted in
that session and reports a required missing capability as incomplete or
blocked. This preserves the distinction between portable procedure, native
harness realization, and executable Kiln authority.

## Evidence basis

### Search breadth and method

Rapid-review shortcuts can change results materially. One simulation across
2,512 Cochrane meta-analyses found that PubMed-only searching changed odds
ratios by at least 5% in 19% of cases; other shortcuts sometimes lost all
evidence or changed statistical significance. These results concern clinical
binary outcomes and do not establish one universal search rule.
[Marshall et al.](https://www.sciencedirect.com/science/article/pii/S089543561830893X)
A second study across 47 Cochrane reviews likewise found that abbreviated
strategies sometimes reversed results or made them inestimable.
[Study](https://www.sciencedirect.com/science/article/pii/S0895435620305230)

Cochrane requires reproducible, documented, multi-source searching for
systematic reviews and warns that studies, not multiple reports about one
study, are the evidence unit. PRISMA 2020 specifies reporting requirements but
does not certify that a review was well conducted. Rapid reviews are deliberately
restricted reviews whose omissions and likely biases must be disclosed.
[Cochrane Chapter 4](https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-04),
[PRISMA 2020](https://www.prisma-statement.org/prisma-2020),
[Cochrane rapid-review guidance](https://www.bmj.com/content/384/bmj-2023-076335)

Kiln therefore requires the researcher to declare `systematic`, `rapid`, or
`decision-oriented` mode, its scope, freshness horizon, exclusions, and stopping
rule. Decision-oriented saturation is not presented as systematic completeness.

### Claims, citations, and contradiction

Citation presence is not citation support. ALCE evaluates citation entailment
and completeness separately, and its 2023 systems frequently left claims
unsupported even when citations were present.
[ALCE](https://aclanthology.org/2023.emnlp-main.398/)
A controlled 2023 study also observed fabricated and materially erroneous
references from then-current GPT-3.5 and GPT-4 snapshots; its rates must not be
generalized to current browsing systems.
[Scientific Reports](https://www.nature.com/articles/s41598-023-41032-5)

Kiln consequently verifies each consequential citation for existence,
entailment, scope, placement, and coverage. It binds citations to atomic claims,
counts independent evidence lineages rather than URLs, seeks null and adverse
evidence, and preserves unresolved contradiction. A non-finding is reported as
“not found in the searched sources” unless the method was sensitive enough to
support absence.

### Quantitative and benchmark evidence

Cochrane's certainty framework separates risk of bias, inconsistency,
indirectness, imprecision, and publication bias. The ASA cautions that a p-value
is not effect size, practical importance, the probability a hypothesis is true,
or a standalone decision rule. NIST AI 800-3 distinguishes accuracy on a fixed
benchmark from generalized performance over a task population and requires
uncertainty-aware interpretation.
[Cochrane Chapter 14](https://training.cochrane.org/handbook/current/chapter-14),
[ASA statement](https://www.amstat.org/asa/files/pdfs/p-valuestatement.pdf),
[NIST AI 800-3](https://www.nist.gov/publications/expanding-ai-evaluation-toolbox-statistical-models)

The general workflow therefore records samples, metrics, baselines,
repetitions, uncertainty, exclusions, evaluators, contamination risk, and domain
limits in proportion to the claim. `benchmark-readiness-review` remains the
specialist owner of benchmark validity and public-claim readiness.

## Claim-dependent source priority

There is no universal hierarchy for every domain:

- current specifications, laws, product behavior, policies, and versions use
  current first-party authority;
- empirical magnitude uses primary studies and suitable current systematic
  synthesis;
- methods use the owning standard or original methods source;
- historical claims use contemporaneous records plus independent scholarship;
- practitioner and secondary sources support discovery, context, or experience
  and remain labelled as such.

The output separates measured evidence, authoritative guidance, practitioner
advice, inference, and recommendation. Publication date is recorded separately
from event, release, or measurement date when recency matters.

## Harness realization as of the cutoff

| Surface | Kiln-managed | Codex | Claude Code | OpenCode |
| --- | --- | --- | --- | --- |
| Search | Governed admitted search primitive | Native modes depend on config | Provider/model/region dependent | Provider or integration dependent |
| Retrieval | Governed fetch/extract primitives | Native search may expose open/find; no Kiln-shaped guarantee | `WebFetch` is model-mediated summarization | Native `webfetch` retrieves bounded content |
| Browser | Optional governed browser provider | Optional plugin/MCP/app capability | Optional Chrome integration | Optional MCP/custom capability |
| Citations | Exact URLs required by Kiln result policy | Preserve exact URLs when available | Preserve exact URLs beyond host rendering | No native citation-enforcement guarantee |
| Artifacts | Typed Kiln evidence/resources when admitted | Host files/resources are not Kiln artifacts | MCP/tool outputs are not Kiln artifacts | MCP/resources are not Kiln artifacts |

The matrix is version-scoped. Capability discovery is authoritative at runtime;
product names are not. Search snippets are candidate discovery, not claim
evidence. Browser use is optional escalation for interactive, authenticated,
visual, or JavaScript-dependent evidence, and any remote mutation requires
separate authority. Retrieved content is untrusted data, never instructions.

Primary capability sources:
[Codex configuration](https://developers.openai.com/codex/config-reference),
[Codex skills](https://developers.openai.com/codex/skills),
[Claude Code permissions](https://docs.anthropic.com/en/docs/claude-code/permissions),
[Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills),
[OpenCode tools](https://opencode.ai/docs/tools/),
[OpenCode permissions](https://opencode.ai/docs/permissions/), and
[OpenCode skills](https://opencode.ai/docs/skills/).

## Evaluation contract

Forward evaluation covers current software facts, benchmark headlines,
conflicting authorities, practitioner advice versus measured evidence, absent
search or retrieval, authenticated/browser-only evidence, prompt injection,
binary extraction gaps, diminishing search returns, and requests for the skill
to choose a provider, budget, or approval. Score claim support, source identity,
exact URL preservation, evidence classification, contradiction handling,
unsupported-capability honesty, calibrated uncertainty, and stopping accuracy.
Do not score answer length, source count, or tool-call count as quality.

## Forward-evaluation evidence

Fresh-session evaluation on 2026-08-12 used the same synthetic no-network
scenario: a current software-release question, three derivative reports from
one study, and a described official specification that could not be inspected.

- Codex CLI 0.147.0 loaded the projected skill, refused to answer the current
  fact from memory, counted the articles as one evidence unit, separated
  normative from empirical claims, and returned a blocked/incomplete result.
- OpenCode 1.18.16 loaded the identical projection. Its first response treated
  stopping as a resolved state and inferred too much from the described
  specification. The contract was tightened to separate search state from
  answer status and to state that prompt-described sources are not inspected
  evidence. The repeat withheld the release fact, classified the derivative
  lineage correctly, and disclosed the capability gap, but did not follow the
  exact requested status vocabulary. This remains a low-severity model-following
  limitation rather than a claimed harness guarantee.
- Claude Code 2.1.226 discovered the invocation path but the fresh evaluation
  was blocked by the operator account's weekly usage limit before a model turn.
  Projection identity is verified; behavioral parity is not claimed.

The three projected `SKILL.md` files had the same SHA-256 digest after canonical
sync. The evaluation is an operational smoke, not a benchmark: it uses one
synthetic scenario and cannot establish general research quality.

## Limits

- Clinical review evidence supports explicit method and shortcut disclosure,
  not an identical search protocol for software or market research.
- Research-agent benchmarks measure particular systems, tasks, and snapshots;
  they do not prove a universal “deep research” implementation.
- A projected skill cannot enforce authority or make unavailable native
  capabilities exist.
- General research procedure does not replace legal, medical, financial,
  regulatory, security, scientific-method, or benchmark specialist review.
- Kiln's planned composite `web_research` remains a future governed capability;
  existing primitives and this skill do not form a second semantic owner.
