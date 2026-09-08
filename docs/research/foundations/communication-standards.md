# Communication Standards

Evidence cutoff: 2026-09-08 for the issue/PR and clear-writing reviews below;
earlier sections retain their August 20 evidence basis unless stated otherwise.

This foundation preserves the evidence behind Kiln's writing and
response-shaping procedures — the `clear-writing` built-in and the action-first
communication contract. Current behavior belongs to those admitted skills and to
[`communication-governance.md`](../../architecture/context/communication-governance.md).

## Plain language is broader than developer documentation

ISO 24495-1:2023 is framed for many languages and sectors, including public,
technical, legal, and consumer-facing communication. PlainLanguage.gov and
GOV.UK emphasize reader-task orientation, findability, short useful structure,
active wording, and concrete language. Google's developer documentation guidance
adds the constraint that matters most for technical prose: clarity must not
remove precision.

That breadth is why the procedure is neutral product content rather than a house
voice. It is useful across reports, research, support, product copy, education,
public content, internal communication, and technical documentation, and it
stays subordinate to stricter brand, legal, regulatory, academic, locale, and
project constraints.

- [ISO 24495-1:2023](https://www.iso.org/standard/78907.html)
- [Federal Plain Language Guidelines](https://www.plainlanguage.gov/guidelines/)
- [Writing to GOV.UK standards](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/)
- [Google developer documentation style guide](https://developers.google.com/style)

Community style packages demonstrate useful practice without being safe to
vendor. The GOV.UK-style skill evaluated during this work carried no explicit
license in the artifact observed, is partly UK-public-sector specific, and
contains absolute stylistic rules that conflict with legal, academic,
regulatory, brand, and multilingual constraints. Kiln therefore ships original
first-party content and does not copy it.

## Ordering information first is shaping, not a proven outcome

Eye-tracking research finds top-heavy scanning tendencies. CDC, WCAG, and GOV.UK
guidance support important information first, descriptive headings, textual
error identification, and actionable correction.

This evidence does not directly prove assistant-chat outcomes, so action-first
remains explicit response shaping rather than a measured result. It yields to
findings-first, safety, accuracy, and requested formats; it makes applicable
work state visible; and it never fabricates certainty, urgency, completion, or a
call to action.

- [NN/g F-shaped reading pattern](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/)
- [CDC plain language](https://www.cdc.gov/health-literacy/php/develop-materials/plain-language.html)
- [WCAG headings and labels](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels)
- [GOV.UK error messages](https://design-system.service.gov.uk/components/error-message/)

## Accepted separations

- **Product doctrine, house voice, and installable packs are different things.**
  A writing procedure is neutral built-in content; organization voice belongs to
  instruction profiles or scoped skills; regional, brand, and sector packs are
  optional installable content.
- **Procedure grants no authority.** The writing skill is procedural context
  only; it confers no tool, filesystem, provider, network, or config mutation
  authority.
- **Global config holds preferences, not procedures.** Config may enable or
  narrow built-ins and hold stable operator preferences; it does not carry the
  full writing procedure.
- **Communication and engineering doctrine have independent owners.** Response
  detail and presentation can change without altering correctness, authority,
  or architecture rules. The global communication profile therefore remains
  separate and concise; resolved `communication.responseDetail` carries the
  operator's actual verbosity choice.

## Native response-detail controls

Claude Code exposes a built-in `Concise` output style through `outputStyle` in
settings. User settings at `~/.claude/settings.json` apply across projects,
output style changes take effect after `/clear` or a new session, and the
TypeScript Agent SDK accepts the same setting through its inline `settings`
object. Kiln therefore projects canonical global
`communication.responseDetail: concise` intent to that native field instead of
copying more prompt doctrine into every repository. The native style applies
only to the main conversation, so it is not evidence that Claude subagents
inherit concise behavior.

- [Claude Code output styles](https://code.claude.com/docs/en/output-styles)
- [Claude Code settings scopes](https://code.claude.com/docs/en/settings)
- [Claude Agent SDK system-prompt configuration](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)

## Issue and PR authoring

The September 8, 2026 decision-oriented review inspected HumanLayer skills at
`3c2629142c5d437428269b1b722b08c0b87f574d` and Matt Pocock skills at
`3cca18b368ae95cdbdebbff572ccafa662551015`, plus Warp's current PR-writing
procedure and an operator-supplied Luke Parker screenshot. Theo's exact
`file-a-pr` source was not found in the searched sources and was not evaluated.

- [HumanLayer show-me](https://github.com/humanlayer/skills/blob/3c2629142c5d437428269b1b722b08c0b87f574d/plugins/show-me/skills/show-me/SKILL.md)
  contributes selection of a small useful representation rather than mandatory
  diagrams. Schematic diffs and narrative visuals are explanations, not observed
  verification. Its platform-specific HTML opener is not part of Kiln's procedure.
- [Grilling](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/productivity/grilling/SKILL.md)
  distinguishes discoverable facts from user decisions and orders dependent
  questions. Kiln narrows interviewing to material uncertainty and does not copy
  exhaustive questioning or a universal confirmation gate.
- [Domain modeling](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/domain-modeling/SKILL.md)
  contributes concrete counterexamples and sparing tradeoff records. Kiln retains
  existing semantic owners instead of imposing a new `CONTEXT.md` structure.
- [Wayfinder](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/wayfinder/SKILL.md)
  has a separate multi-session planning and tracker lifecycle. It is not imported
  into the writing procedures. [Issue 999](https://github.com/mattpocock/skills/issues/999)
  reports reopening questions answered in prior unmerged work; it supports an
  explicit evidence survey, not a quantified failure-rate claim.
- [Warp PR writing](https://github.com/warpdotdev/common-skills/blob/main/.agents/skills/write-pr-description/SKILL.md)
  separates authoring from creation, checks inherited claims, and preserves
  verification limits while scaling the description. This was a mutable source
  observed on the cutoff date, not a pinned release or an effectiveness study.

Kiln's procedures are original first-party guidance. The screenshot's useful
emphasis on final aggregate changes and concrete comparisons does not justify
its blanket omission of test reporting. Evidence should be relevant and concise,
but failed checks and material gaps must remain visible. Narrated videos remain
optional presentation, not a prerequisite or a correctness oracle.

Existing Kiln content was also evaluated: the fixed-section PR renderer forced
empty headings and repeated metadata. The replacement separates structured
evidence from proportional presentation, while retaining deterministic checks.
The [writing evaluation](../../evaluations/writing-skills-2026.md) records the
bounded verification surface. This review provides design rationale, not causal
evidence of improved reviewer performance.

## Clear-writing reassessment, September 8, 2026

Status: research complete; the procedure replacement below was subsequently
implemented on September 8. Comparative reader evaluation remains unperformed.
This decision-oriented review asks which changes merit testing against Kiln's
current built-in. It compares source instructions, established technical-writing
guidance, and primary writing research. Existing Kiln instructions are a candidate
design, not evidence that the design works.

Discovery used the named Matt Pocock repository, skills.sh writing listings,
upstream skill sources, Google technical-writing guidance, Anthropic engineering
articles, and searches for LAMP and WritingBench. Representative queries included
`WritingBench comprehensive benchmark writing`, `effective context engineering`,
and `Generative AI enhances individual creativity`. This is a purposive sample,
not an exhaustive community ranking or systematic literature review. Derivative
skill copies do not count as independent evidence. Search stopped after covering
community practice, technical guidance, empirical editing, evaluation design, and
counterevidence to adding more instructions.

### Community comparison

Directory adoption was observed on September 8, not measured independently:
[copy-editing](https://www.skills.sh/coreyhaines31/marketingskills/copy-editing)
displayed 122.4K installs,
[humanizer](https://www.skills.sh/blader/humanizer/humanizer) 6.1K, and
[writing-clearly-and-concisely](https://www.skills.sh/obra/the-elements-of-style/writing-clearly-and-concisely)
1.7K. These are discovery signals, not unique-user counts or effectiveness trials.

| Source inspected | Useful contribution | Limit for Kiln |
| --- | --- | --- |
| [Matt Pocock writing-for-agents](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/productivity/writing-for-agents/SKILL.md) | Explicit completion criteria, branch-specific context, one owner, removal of instructions that do not change behavior | This is agent-document authoring, not general human prose. Claims about negation priming are practitioner advice, not demonstrated here. |
| [Cursor pstack unslop](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md) | Detect empty attribution, unstable terminology, inflated phrasing, and excessive compression | Universal punctuation and vocabulary bans encode taste. Technical terms can be the clearest choice. Mutable source observed on the cutoff date. |
| [blader humanizer v3.0.0](https://github.com/blader/humanizer/blob/9862685f575c65a8247f90369951df1b3416e3d6/SKILL.md) | Paragraph-level diagnosis, supported-claim preservation, voice samples, and a conservation check | Human-sounding appearance is not comprehension. Default draft/audit/final output adds ceremony; rigid punctuation rules should not become universal doctrine. |
| [obra writing-clearly-and-concisely](https://github.com/obra/the-elements-of-style/blob/main/skills/writing-clearly-and-concisely/SKILL.md) | Concrete language, related words kept together, parallel construction | Broad activation and a roughly 12,000-token reference requirement are disproportionate for routine edits. English conventions are not multilingual policy. Mutable source observed on the cutoff date. |
| [Corey Haines copy-editing v2.0.0](https://github.com/coreyhaines31/marketingskills/blob/main/skills/copy-editing/SKILL.md) | Focused clarity, voice, and proof passes; edits with identifiable reasons | Conversion, emotional intensity, and risk reversal belong to marketing. Numeric specificity must come from evidence. Seven recursive sweeps and simulated expert scores are not validated necessities. Mutable source observed on the cutoff date. |

Matt's inspected canonical path is `writing-for-agents`; search results retaining
`writing-great-skills` should not determine the current contract. These sources
suggest original design improvements, not wholesale vendoring or an adoption
decision based on download counts.

### Guidance and measured evidence

[Google's audience guidance](https://developers.google.com/tech-writing/one/audience)
makes audience analysis operational: supply the knowledge needed for the task
that the reader does not already possess. Role alone is insufficient; familiarity
with this project and topic matters. This supports diagnosing missing context and
explaining necessary terminology, rather than simply shortening the text. It is
technical-writing guidance, not a trial of a Kiln skill.

[Anthropic's September 2025 guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
recommends concise, concrete instructions and representative examples, refined
from observed failures. Its [July 2026 update](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models)
reports removing over 80% of Claude Code's system prompt without measurable loss
on its coding evaluations, and cautions that examples can constrain exploration
for newer models. This is vendor evidence from coding, with limited published
experimental detail, not proof about writing or all harnesses. The practical
implication is to compare a minimal skill and a version with selective examples;
do not assume that more instructions or more examples improve results.

[LAMP, Chakrabarty et al. (2024)](https://arxiv.org/html/2409.14509v1)
studies professional edits of 1,057 generated paragraphs in creative-writing
domains. Its preference experiment used 200 paragraph triplets, with three expert
judgments per triplet. Expert edits ranked above automated edits, which ranked
above original generations; inter-annotator agreement was moderate (Kendall's
W = 0.505). This supports testing targeted revision and retaining human evaluation.
It does not validate any community skill or establish comprehension gains for
technical documentation, contemporary models, or Spanish prose.

[WritingBench, Wu et al. (2025)](https://arxiv.org/abs/2503.05244)
proposes query-dependent evaluation across six writing domains and 100 subdomains,
using a criteria-aware critic. The abstract and benchmark description support
using task-specific criteria rather than one universal style score. This review
does not independently validate the critic or reproduce the benchmark; model
scores alone are not a reader-performance oracle.

The evidence categories must remain separate: community recipes are practitioner
advice; Google provides writing guidance; Anthropic reports vendor engineering
experience; LAMP supplies an empirical editing study. Agreement across these
categories does not turn the proposed Kiln changes into a measured improvement.

### Repository diagnosis and replacement

The current `clear-writing` owner is `packages/core/src/skill/builtin-skills.ts`.
The previous procedure protected evidence, domain constraints, and voice. Its principal
weakness was that broad principles repeated in the editing workflow without making
diagnosis or completion sufficiently concrete. The fixed
`context, point, evidence, action` sequence also sits awkwardly beside the earlier
instruction to state the main point early. The replacement removes that fixed
outline and the duplicated principles/workflow structure.

The refactored procedure follows these decisions:

1. Infer the reader's task, prior knowledge, genre, language, and requested edit
   scope from available context. Ask only when missing information materially
   changes the result. A proofreading request does not authorize a new argument.
2. Identify claims and constraints that must survive: quantities, units,
   negation, conditions, uncertainty, causal strength, attribution, quotations,
   identifiers, and required terminology. Editing preserves supported meaning;
   suspected factual errors are flagged or checked, not silently strengthened.
3. Repair the reader's path before polishing sentences. Find the buried point,
   missing prerequisite, unexplained consequence, misplaced caveat, and repeated
   paragraph. Choose order for the artifact's purpose.
4. Resolve ambiguous subjects and pronouns, keep modifiers close to what they
   qualify, and connect sentences through stable terms. Cut empty wording while
   retaining explanations and transitions that help the intended reader.
5. Compare the revision with the source for semantic changes. Preserve a passage
   that already works. Return the requested artifact or concrete review findings;
   expose unresolved factual uncertainty only when relevant.

For example, changing “The worker may retry twice after a timeout if the request
is idempotent” to “The worker retries failed requests twice” loses uncertainty,
the timeout trigger, and the idempotency condition. A preservation check needs
to catch that even if the revision sounds smoother. This is an original test
example, not an observed Kiln failure.

Keep general clarity in this skill; artifact requirements remain in
`writing-issues` and `writing-pr`, factual investigation in `research`,
and house voice in its existing owner. Avoid a second humanizer skill, mandatory
punctuation bans, fixed paragraph lengths, detector scores, or a prescribed number
of editing sweeps. Optional examples should earn their context cost in evaluation.

### Evaluation needed before claiming improvement

Compare three conditions on the same tasks: no clear-writing skill, the current
built-in, and the replacement. Keep model, surrounding instructions, source
material, and generation settings comparable; retain exact prompts and outputs.
Use repeated generations and held-out cases rather than tuning against every
evaluation example. Evaluate a selective-example variant only if it addresses
observed failures.

Include issue descriptions, PR explanations, support replies, research summaries,
onboarding docs, UI messages, and English/Spanish material. Include negative
controls: already-clear text, precise passive voice, useful specialist vocabulary,
intentional author voice, and a narrow proofreading request.

Check factual preservation against explicit source constraints. Have blinded
readers answer task-specific questions or identify the required action; measure
correctness and time alongside preference. Randomize presentation order and
allow ties or rejection of both versions. Track unnecessary edits, lost caveats,
voice mismatch, and generation cost. Calibrate any automated judge against human
judgment; self-assigned scores are not independent validation.

The existing issue/PR smoke evaluation does not establish these outcomes. No
comparative clear-writing experiment was run in this research pass. Confidence is
high in the identified design gaps, moderate in the proposed remedy, and unknown
in its measured advantage over current model behavior. Multilingual reader
testing and cross-model replication remain especially valuable follow-ups.

## Documentation lifecycle

Repository documentation needs a reader, an owner, an appropriate audience, and
a retention reason. [Google's documentation practices](https://google.github.io/styleguide/docguide/best_practices.html)
support small maintained collections, deletion of dead documentation, and avoiding
duplicate explanations. [Diataxis](https://diataxis.fr/) organizes documentation
around reader needs, not a mandatory directory tree.
[Anthropic's file-creation guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#reduce-file-creation-in-agentic-coding)
acknowledges temporary agent files and recommends cleaning them up. These are
practice recommendations, not a measured guarantee that a skill prevents clutter.

Kiln's documentation-hygiene procedure owns document placement and lifecycle;
repository-text-hygiene owns Git, encoding, and line-ending diagnosis. Their
Sequel-specific predecessors mixed useful procedures with imposed folder trees,
English-only preferences, and blanket configuration choices. The neutral
procedures retain evidence-based disposition and safe repair while letting
repository conventions own those choices. Operator preferences remain in the
global profile. Neither file age nor a clean Git status proves useful cleanup.

## Evidence limits

- Plain-language standards are written for human readers and sectors, not
  validated for assistant response quality.
- Scanning research does not establish that a given response order improves task
  outcomes in chat.
- Clarity guidance never licenses removing precision, hedging that is accurate,
  or a fabricated next action.
