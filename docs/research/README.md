# Research

Research records the evidence and rationale behind Kiln's architecture. It is
not the source of truth for current behavior.

Use:

- [Architecture](../architecture/README.md) for stable system contracts;
- [Guides](../README.md#guides) for user and operator procedures;
- [ADRs](../adr/README.md) for accepted structural decisions;
- [Roadmap](../roadmap/README.md) for admitted but unfinished work;
- [Evaluations](../evaluations/README.md) for dated experiments, route
  assessments, and smoke evidence;
- [Changelog](../changelog.md) and [release notes](../releases/README.md) for
  completed delivery.

## Lifecycle

A research note must be either a durable foundation or an active investigation.

- A **foundation** explains durable evidence or mechanism lineage that remains
  useful after implementation.
- An **active investigation** has an explicit owner, open question, evidence
  cutoff, promotion target, and exit condition.
- Stable conclusions are promoted to architecture, guides, configuration, or
  an ADR.
- Dated empirical results move to `docs/evaluations/` when they retain value.
- Implementation status and delivery history move to the roadmap, changelog,
  or release notes.
- Once its unique evidence has been promoted or preserved, the obsolete
  research note is deleted. Git history is the archive.

When research conflicts with canonical architecture, architecture wins.

## Foundations

Durable research lives under [`foundations/`](foundations/README.md):

- Kiln research synthesis
- cybernetic foundations
- biological mechanisms
- memory systems
- safety defense
- regulation and adaptation
- context governance
- tool execution and trust
- coordination intelligence
- work governance and verification
- skill capability governance
- engineering review practice
- agent security and authority
- communication standards
- governance and reproducibility
- instruction and doctrine evidence

## Active Investigations

Open, owner-backed research lives under [`active/`](active/README.md):

- configuration surface inventory — Roadmap 12 Slice 0
- remote operator connection — Roadmaps 08 and 08.5
- prompt component governance — Roadmap 06
- visual work abstraction — issue-backed research awaiting an explicit
  documentation promotion target
- general work contracts — issue-backed research awaiting an explicit
  documentation promotion target
- bounded-work authority benchmark — issue #19; the contract is canonical, only
  the measurement remains open
