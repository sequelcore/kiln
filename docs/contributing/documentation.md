# Documentation guide

Kiln documentation is a public product surface. Write for a reader who has the
repository but does not have access to maintainer conversations, operator-local
configuration, or historical context.

## Audience and language

The documentation serves two primary audiences:

- users evaluating or operating Kiln from source; and
- contributors changing code, configuration, tests, or documentation.

English is the canonical and only maintained documentation language. Use
standard American English and explain Kiln-specific terms near first use.

## Start with the reader's task

Every page should have one dominant purpose. Use these content types as a
decision tool:

| Reader need | Content type | Writing approach |
| --- | --- | --- |
| Learn by completing a safe first experience | Tutorial | Lead the reader through a reproducible sequence and state the expected result. |
| Complete a real task | How-to guide | Assume basic competence, name prerequisites, and give goal-oriented steps. |
| Look up exact behavior | Reference | Describe contracts, fields, commands, and limits precisely without narrative detours. |
| Understand why the system works this way | Explanation | Connect concepts, decisions, constraints, and tradeoffs. |

Do not force the directory tree into four literal folders. Classify the page by
reader need, then place it near the product concern that owns it. Split a page
when competing purposes make the next action unclear.

## Documentation hierarchy

Use the following sources for their stated purpose:

| Surface | Owns | Does not own |
| --- | --- | --- |
| `README.md` | Public identity, development status, shortest source path, and navigation | Exhaustive architecture or command reference |
| `docs/getting-started.md` | Safe source-first tutorial | Provider-specific setup or complete verification policy |
| `docs/guides/` | User and operator tasks | Canonical architectural authority |
| `docs/configuration/` | Application and gateway configuration reference | Tutorials or design rationale |
| `docs/architecture/` | Current system boundaries, invariants, and ownership | Work status or speculative research |
| `docs/adr/` | Accepted structural decisions and their consequences | Mutable how-to instructions |
| `docs/research/` | Evidence and unresolved investigation | Current behavior or delivery status |
| `docs/evaluations/` | Dated experiments and observations | General performance or quality guarantees |
| `docs/roadmap/` | Admitted unfinished work and blockers | Completed feature documentation |
| `docs/releases/` and `docs/changelog.md` | Historical publication records and verified release changes | Current source behavior unless explicitly identified as unreleased |

When two documents conflict, fix the conflict. Do not ask readers to infer
which statement is newer.

## Page structure

Use the smallest structure that supports the task. Most pages should include:

1. one descriptive level-one heading;
2. an opening paragraph that states the page purpose and intended reader;
3. prerequisites or scope when the reader could otherwise act unsafely;
4. content organized under short, descriptive headings;
5. expected results for commands or procedures; and
6. a specific next step when the reader journey continues elsewhere.

Use sentence case for headings. Do not skip heading levels. A reader should be
able to understand the page outline by scanning headings alone.

## Style

- Lead with the outcome or decision.
- Address the reader as `you` in tutorials and task guides.
- Prefer active voice and concrete verbs.
- Keep paragraphs short and focused on one idea.
- Use numbered lists for ordered procedures and bullets for unordered sets.
- Put conditions before the instruction they qualify.
- Remove hype, filler, throat-clearing, and claims that evidence cannot support.
- Keep exact technical terms when simplification would change the contract.
- Use descriptive link text; never use `click here`, `here`, or `read more` as
  the link label.
- Give every informative image meaningful alternative text.

## Commands and examples

A command is a behavioral claim. Verify it against the current source before
publishing it.

- State the working directory and prerequisites.
- In user guides, use `kiln` as the concise logical command only when the page
  links to the source-entrypoint convention in Getting Started. Use the full
  source command when exact working-directory behavior matters.
- Prefer commands already exercised by CI or a focused test.
- Show placeholders as `<descriptive-name>` and explain them nearby.
- State whether a command reads state, writes files, starts a service, consumes
  provider quota, or requires credentials.
- Include the expected success signal and the most likely actionable failure.
- Never include operator-specific paths, credentials, capability URLs, account
  identifiers, or raw incident payloads.
- Use synthetic portable values in committed examples.

Do not use `command --help` as evidence that a subcommand is side-effect free.
Verify the actual command boundary.

## Status and release language

The current repository is source-only and has no supported installable release.
The project name and package coordinates are provisional until the planned
rebranding and release work is complete.

- Do not add package-install commands to current tutorials or guides.
- Keep old release notes as historical records, clearly labeled as such.
- Describe repository behavior as current source behavior, not as shipped or
  generally available.
- Describe a candidate as a candidate only when an active release process still
  targets it. Otherwise preserve it as historical prerelease evidence.
- Do not announce future names, dates, versions, or availability without a
  canonical product decision and release evidence.

## Accessibility

- Use one informative page title and a logical heading hierarchy.
- Make link purpose understandable from its label and nearby sentence.
- Do not rely on color, position, or an image alone to convey meaning.
- Add alt text that communicates an image's relevant information or function.
- Keep tables small enough to scan; use prose or lists when relationships are
  not genuinely tabular.
- Avoid directional instructions such as “see above” when a section or link
  name is clearer.

## Review checklist

Before submitting a documentation change, confirm that:

- the page has a named audience and dominant reader task;
- current behavior is supported by code, tests, configuration, or dated
  evidence;
- commands were verified at the documented boundary;
- terminology and status agree with canonical architecture and project state;
- local links resolve and link labels describe their destination;
- headings form a meaningful hierarchy;
- examples contain no local identity or secret material;
- related indexes and navigation paths were updated; and
- obsolete or contradictory text was removed rather than retained as a second
  explanation.

Run `bun run docs:check` from the repository root, then run any focused
verification owned by the behavior you documented.

## Standards used

Kiln's documentation practice is informed by these public sources:

- [Diátaxis](https://diataxis.fr/start-here/) for distinguishing tutorials,
  how-to guides, reference, and explanation by reader need;
- [GitHub Docs content model](https://docs.github.com/en/contributing/style-guide-and-content-model)
  for maintainable public developer-documentation types;
- [Google developer documentation style guide](https://developers.google.com/style/highlights)
  for clear technical language and formatting; and
- [W3C writing for web accessibility](https://www.w3.org/WAI/tips/writing/)
  for meaningful titles, headings, links, instructions, and image alternatives.

These sources guide judgment. Repository evidence remains authoritative for
Kiln's actual behavior.
