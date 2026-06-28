# Clear Writing Skill Research

Status: accepted implementation basis for the native `clear-writing` skill.

## Question

Kiln needs high-quality writing behavior for more than programming. The design
question is whether a writing-quality skill should be native Kiln product
doctrine, user/global config, a Sequel-specific voice profile, or an optional
pack.

## Sources

- ISO 24495-1:2023, Plain language - Part 1: Governing principles and
  guidelines:
  <https://www.iso.org/standard/78907.html>
- PlainLanguage.gov, Federal Plain Language Guidelines:
  <https://www.plainlanguage.gov/guidelines/>
- GOV.UK, Writing to GOV.UK standards:
  <https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/>
- Google developer documentation style guide:
  <https://developers.google.com/style>
- Agent Skills specification, progressive disclosure and skill packaging:
  <https://agentskills.io/specification>

## Findings

Plain-language guidance is broader than software documentation. ISO 24495-1 is
framed for many languages and sectors, including public, technical, legal, and
consumer-facing communication. PlainLanguage.gov and GOV.UK emphasize
reader-task orientation, findability, short useful structure, active wording,
and concrete language. Google developer documentation guidance adds a useful
constraint for technical content: clarity must not remove precision.

The community GOV.UK-style skill discussed by the operator demonstrates useful
practice, but it should not be copied into Kiln core. The gist has no explicit
license in the artifact we evaluated, is partly UK-public-sector specific, and
contains absolute stylistic rules that can conflict with legal, academic,
regulatory, brand, multilingual, or domain-specific constraints.

Agent skill systems support packaging reusable procedures as progressive
context rather than always-on global prompt text. That matches Kiln's existing
skill model: a writing procedure can be admitted when the task needs prose
quality without turning it into universal personality doctrine.

## Decision

Kiln ships an original first-party `clear-writing` built-in skill. It is:

- neutral product content, not Sequel voice.
- useful across reports, research, support, product copy, education, public
  content, internal communication, and technical documentation.
- procedural context only; it grants no tool, filesystem, provider, network, or
  config mutation authority.
- subordinate to stricter brand, legal, regulatory, academic, locale, and
  project-specific constraints.

Global config should not contain the full writing procedure. Config may enable
or narrow built-ins and hold stable operator preferences. Organization voice
belongs in instruction profiles or scoped skills. Optional regional, brand, or
sector-specific writing packs can be added later as installable content.

## Non-Goals

- Do not copy or vendor the GOV.UK-style gist into Kiln.
- Do not make Sequel's brand voice native Kiln doctrine.
- Do not auto-admit the skill for every message.
- Do not infer a new writing task class inside provider routing until Kiln has
  a separate task taxonomy and tests for cross-domain writing workflows.
