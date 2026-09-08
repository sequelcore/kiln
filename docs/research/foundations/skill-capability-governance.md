# Skill Capability Governance

Evidence cutoff: 2026-08-13.

This foundation preserves the evidence behind Kiln's skill capability plane.
Current behavior belongs in
[`agent-context.md`](../../architecture/context/agent-context.md) and the
[skills guide](../../guides/agents/skills.md).

## Durable findings

The portable [Agent Skills specification](https://agentskills.io/specification)
defines a skill as a directory package with a required `SKILL.md`, portable
identity metadata, and optional scripts, references, and assets. Harnesses add
different discovery, visibility, permission, and metadata mechanisms. Kiln
therefore separates portable package evidence from host-extension evidence and
does not treat a native projection as authority.

OpenAI Codex, Anthropic Agent Skills, and OpenCode all use progressive
disclosure: compact metadata supports discovery and full instructions load only
after selection. Current
[Codex documentation](https://learn.chatgpt.com/docs/build-skills) bounds the
initial list at two percent of model context, with an 8,000-character fallback
when context is unknown. Other harness budgets remain unknown unless a
versioned authority supplies them.

Availability is not admission or value. A package may be discoverable while
broken, incompatible, untrusted, unauthorized, or ineffective. Anthropic's
[enterprise guidance](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise)
recommends reviewing the complete directory because scripts, network access,
credentials, broad filesystem references, and external tools carry risks that
are not visible from frontmatter alone. SLSA provenance establishes artifact
identity and production lineage when verified against expectations; it does
not prove semantic safety. Kiln accordingly reports provenance and risk
evidence without a misleading `safe` boolean.

Skill retrieval is a distinct empirical problem. SkillRet reports substantial
headroom in large-catalog retrieval; SkillRouter finds that bodies can carry
decisive retrieval signal beyond descriptions; and realistic skill-use
evaluation reports that gains can degrade toward no-skill baselines when the
agent must search a large noisy catalog. See:

- [SkillRet](https://arxiv.org/abs/2605.05726)
- [SkillRouter](https://arxiv.org/abs/2603.22455)
- [How Well Do Agentic Skills Work in the Wild](https://arxiv.org/abs/2604.04323)
- [SkillsBench](https://arxiv.org/abs/2602.12670)

These papers are primary research artifacts, not universal product guarantees.
Their joint implication is narrower: spec validity, install popularity, and
author reputation cannot establish value. Promotion needs paired, task-bound,
model- and harness-versioned evaluation that preserves negative task deltas,
routing mistakes, authority failures, context cost, latency, and replay
evidence.

## Accepted separations

- **identity and provenance** describe which complete package was observed;
- **health** describes structural validity, bounded size, references, and risk signals;
- **compatibility** describes declared and verified host requirements;
- **visibility** describes native discovery behavior;
- **admission** explains whether instructions entered governed context;
- **authority** remains owned by executable tool and work policy;
- **value** is a paired empirical result for a versioned task environment.

No one field substitutes for another. Skills never own provider routing,
permissions, stack versions, repository guidance, or acceptance truth.

## Catalog maintenance

A catalog decays through overlap rather than absence. The 2026-07-22 backend
scout found four skills repeating the same platform doctrine in four Markdown
owners — a test-writing skill and a review skill had each absorbed Spring,
PostgreSQL, security, API, and observability rules already owned elsewhere.
Overlap made updates expensive and let exact version claims drift independently.
The correction was to split by capability so a narrow task does not load an
entire domain, and to retire skills whose only content was duplicated doctrine.

The durable rule that came out of it: **skills hold decision procedures,
invariants, and verification paths; exact framework, runtime, plugin, driver,
and image versions belong in executable stack profiles, manifests, wrappers,
lockfiles, and migration records.** A version pinned in prose is a claim no
build can check, and it goes stale silently.

The same scout captured a platform snapshot — JDK, Spring Boot, Spring Security,
Spring Modulith, Gradle, PostgreSQL, and observability lines current at
2026-07-22. Those observations are deliberately not reproduced here. They were
research evidence for a catalog decision, not durable findings, and the rule
above exists precisely because such facts expire. Resolve the runtime through
repository and stack evidence instead.

- [OpenJDK](https://openjdk.org/projects/jdk/),
  [Spring Boot](https://docs.spring.io/spring-boot/reference/),
  [Spring Boot system requirements](https://docs.spring.io/spring-boot/system-requirements.html)
- [Spring Security](https://docs.spring.io/spring-security/reference/),
  [Spring Modulith](https://docs.spring.io/spring-modulith/reference/),
  [Gradle release notes](https://docs.gradle.org/current/release-notes.html)
- [PostgreSQL](https://www.postgresql.org/docs/current/index.html),
  [Boot observability](https://docs.spring.io/spring-boot/reference/actuator/observability.html),
  [Testcontainers](https://testcontainers.com/guides/)

External catalogs are research input, never admitted verbatim. Popularity is an
adoption signal, not evidence of quality, compatibility, or authority: the
survey weighed repositories from roughly 175 to 36,940 stars and admitted none
of them wholesale. Candidates were downloaded to isolated staging and inspected
before any catalog mutation. Generic framework rules, fixed coverage targets,
universal response envelopes, identifier and persistence defaults, and provider
conventions were rejected wherever they would override repository or domain
evidence.

- [awesome-copilot](https://github.com/github/awesome-copilot),
  [claude-skills](https://github.com/Jeffallan/claude-skills)
- [dr-jskill](https://github.com/jdubois/dr-jskill),
  [spring-boot-skills](https://github.com/rrezartprebreza/spring-boot-skills)

## Harness capability boundary

The current first-party documentation supports a capability matrix, not a
parity claim:

| Concern | Kiln managed | Codex | Claude Code | OpenCode |
| --- | --- | --- | --- | --- |
| Selection | governed recommendation and admission | native metadata and explicit invocation | native metadata and slash invocation | native `skill` tool |
| Child work | Agent Task lifecycle when admitted | native delegation varies by session | native agents/tasks vary by session | native agents/tasks vary by session |
| Search/retrieval | admitted governed primitives | configured native/plugin/MCP capability | model, region, permission, and integration dependent | provider, tool, or MCP dependent |
| Visibility | canonical policy plus evidence | per-skill configuration | frontmatter invocation controls | stable 1.18.16 cannot preserve explicit-only direct invocation |
| Authority and terminal truth | executable Kiln contracts | native harness policy only | native harness policy only | native harness policy only |

Capability discovery at execution time is authoritative. A product name, tool
annotation, projected file, or prompt instruction is not proof that child
invocation, cancellation, browsing, citation artifacts, authority attenuation,
or terminal evidence is available. Unsupported translations remain visible and
fail closed.

Primary capability sources are the current
[Codex skills documentation](https://developers.openai.com/codex/skills),
[Codex configuration reference](https://developers.openai.com/codex/config-reference),
[Claude Code skills documentation](https://docs.anthropic.com/en/docs/claude-code/skills),
[Claude Code permissions documentation](https://docs.anthropic.com/en/docs/claude-code/permissions),
[OpenCode skills documentation](https://opencode.ai/docs/skills/), and
[OpenCode permissions documentation](https://opencode.ai/docs/permissions/).

## Research-method consequence

Claim support is not citation presence. ALCE separates citation entailment and
completeness, while systematic- and rapid-review guidance shows that search
shortcuts can materially change conclusions. Kiln therefore requires an
proportional planning and an honest account of the method performed; claim-dependent source
selection; independent evidence-lineage accounting; contradiction and adverse
evidence handling; citation existence, entailment, scope, placement, and
coverage checks; and an honest stopping rule. See
[ALCE](https://aclanthology.org/2023.emnlp-main.398/),
[PRISMA 2020](https://www.prisma-statement.org/prisma-2020), and
[Cochrane search guidance](https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-04).

Quantitative claims additionally require samples, metrics, baselines,
repetitions, uncertainty, exclusions, evaluator evidence, contamination risk,
and domain limits in proportion to the decision. General research procedure
does not replace specialist legal, medical, financial, regulatory, security,
scientific-method, or benchmark review.

## Research reassessment, September 8, 2026

This decision-oriented review compares the existing procedure with current
community instructions, research-system reports, reporting guidance, and citation
evaluation research. It is a design review, not a systematic literature review
or an effectiveness experiment. The procedure was subsequently refactored around
the decisions below; comparative effectiveness remains untested.

Search covered Matt Pocock's upstream research skill, the installed OpenAI
deep-research artifact skill, Anthropic's research-system engineering report,
OpenAI's deep-research system card, PRISMA, Cochrane rapid-review guidance, ALCE,
and recent deep-research benchmarks. Queries included `deep research agents
benchmark citation faithfulness 2026`, `Cochrane rapid reviews methods guidance
2024`, and `mattpocock skills research SKILL.md`. The review stopped after covering
proportionality, search adaptation, evidence transfer, citation evaluation, and
method-label limitations. It did not rank community popularity or reproduce the
benchmarks. The BMJ full text was inaccessible through the browsing tool;
Cochrane's own overview was inspected instead.

### Contributions and limits of the inspected sources

- [Matt Pocock research](https://github.com/mattpocock/skills/blob/main/skills/engineering/research/SKILL.md)
  is a very small procedure: delegate background reading, trace claims to primary
  owners, and save one cited file using repository conventions. Its economy and
  durable output are useful. Mandatory delegation is a harness choice, and
  primary-only selection is tailored to engineering facts, not a universal rule
  for empirical synthesis. This mutable source was read on the cutoff date;
  no effectiveness study accompanies the inspected instructions.
- The installed OpenAI `deep-research-work` skill, version 0.1.15, improves
  explicit attention to user-provided sources, scope, dates, jurisdiction,
  supersession, and useful artifacts. Its default comprehensive artifact lengths
  and initial clarification flow serve that product workflow, not every Kiln
  lookup. This is a local package observation, not a claim about all OpenAI
  research products or their quality.
- [Anthropic's June 2025 system report](https://www.anthropic.com/engineering/multi-agent-research-system)
  describes adapting searches, scaling effort, tracing execution failures, and
  evaluating factuality, citation accuracy, completeness, and tool efficiency.
  It also reports high resource use and coordination failures. Borrow the
  outcome-oriented evaluation and adaptive search, not fixed agent counts or
  automatic parallel delegation. These are vendor-specific engineering results.
- [OpenAI's deep-research system card](https://cdn.openai.com/deep-research-system-card.pdf),
  section 3.3.6, notes that stale PersonQA reference answers made some accurate
  outputs appear erroneous. Evaluation fixtures need observation dates and
  review of changed facts. This is a documented evaluation limitation, not a
  current-model performance claim.
- [PRISMA 2020](https://www.prisma-statement.org/prisma-2020) is reporting guidance
  for systematic reviews. [Cochrane's rapid-review overview](https://methods.cochrane.org/rapidreviews/cochrane-rr-methods)
  describes a developed methodology for rapid effectiveness reviews. Neither
  supports treating a declared mode or time limit as sufficient methodological
  rigor. An ordinary time-limited web search should be described as such.
- [ALCE](https://aclanthology.org/2023.emnlp-main.398/) distinguishes answer
  correctness and citation quality. [DeepResearch Bench](https://arxiv.org/abs/2506.11763)
  describes adaptive report criteria and citation evaluation across 100 research
  tasks. Their benchmark descriptions inform evaluation dimensions; no published
  model ranking is transferred to Kiln.
- [Hirsch et al., August 2026](https://arxiv.org/abs/2608.24306), reports a method
  for locating faithfulness and citation errors at individual agent invocations.
  Its abstract describes errors introduced during evidence transfer and synthesis.
  [DRNOISE, July 2026](https://arxiv.org/abs/2607.17291), describes a constructed
  benchmark where plausible direct false claims compete with supporting record
  chains. These abstracts motivate handoff and misleading-evidence test cases.
  Full experimental methods were not appraised here, so effect sizes and broad
  claims about deployed systems are not adopted.

### Refactor decisions

Keep claim-dependent source choice, independence accounting, explicit uncertainty,
contradiction handling, quantitative appraisal, and untrusted-content boundaries.
Replace the long universal declaration and rigid `status:` output requirement
with proportional planning and an answer appropriate to the user's request.
Research completion should be stated when useful, without making a presentation
token stand in for verified coverage.

Distinguish a focused lookup, a decision-oriented investigation, and a formal
evidence review. These are effort and method distinctions, not quality rankings.
A lookup can finish when the relevant authoritative fact and version are
verified. A decision investigation needs coverage of material alternatives and
uncertainties. A formal review needs an explicit protocol, search scope,
eligibility criteria, screening, and appraisal; do not imply that naming it
systematic makes it so. Domain methods still belong to specialist procedures.

Use an adaptive loop: identify the unresolved claim, choose a source that could
resolve it, inspect the result, update the evidence, then choose the next query.
After weak results, change terminology, source family, or retrieval route rather
than repeating the same search. Search failure means not found or inaccessible,
not nonexistent. Stop when further feasible searches are unlikely to change the
answer, or report exactly which decisive evidence remains unavailable.

Keep compact evidence notes for substantial investigations: claim, supporting
passage or location, exact source/version/date, evidence lineage, limitations,
and whether support is direct or inferred. Preserve those links through summaries
and delegated work. A worker summary is not itself source verification. Inspect
the original support for consequential final claims; do not treat citation repair
after drafting as a substitute for grounded synthesis.

Make synthesis explicit: compare alternatives using the same criteria, explain
whether apparent conflicts arise from scope or method, and weight evidence by
quality rather than vote count. A vendor owns its API specification but does not
thereby prove a comparative benefit. Separate the factual conclusion from the
recommendation and state what unresolved evidence could change that recommendation.

Evaluate the current skill, a minimal version, and the replacement on matched
tasks before claiming improvement. Include a simple version lookup, inaccessible
source, stale reference answer, copied reports from one study, contradictory
versions, unsupported citation, evidence lost in a summary, plausible misleading
page, and an unanswerable question. Score supported-answer correctness, material
coverage, citation entailment and coverage, appropriate abstention, and effort.
Do not reward length, source count, self-assigned confidence, or checklist wording.
Maintain dated fixtures and inspect automated-judge disagreements with human
review. No such comparison was performed in this pass.

## Operational consequence

Lifecycle operations inspect the complete source, validate health, compute an
immutable digest, refuse unreviewed overwrite, apply atomically, preserve
backups, verify the installed digest, and record ownership. Update and removal
refuse locally drifted content unless the operator explicitly forces the
reviewed operation.

Discovery and recommendation remain native capabilities over compact evidence,
not a reason to clone arbitrary skill repositories or preload large template
piles. Kiln admits the smallest complete package justified by the task and
keeps executable resources and declared tool dependencies visible for review.

The accepted orchestration procedure consumes executable work-governance
evidence, gives children bounded contracts, uses an acyclic work graph, forbids
parallel ownership of shared mutable surfaces, treats child output as an
untrusted proposal, and reports requested, admitted, executed, and adopted work
separately. The procedure cannot manufacture missing delegation capability or
widen route, provider, permission, budget, approval, or lifecycle authority.

Repository-context authoring follows the same boundary. Deterministic scouting
may propose or write the canonical bound private project `context` artifact
under `<Kiln home>/projects/<project-id>/`. Repository `AGENTS.md` and
`CLAUDE.md` are project-owned guidance; Kiln diagnoses and proposes reviewed
changes but does not maintain them as sync projections.

## Non-claims

- A valid, signed, popular, or marketplace-listed skill is not necessarily safe, compatible, authorized, or useful.
- Skills do not always improve outcomes.
- One routing description does not transfer unchanged across models or harnesses.
- The cited benchmark results do not predict Kiln workflows without local paired evaluation.
- No universal cross-harness registry, version contract, or semantic security score was established.
