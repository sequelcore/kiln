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

## Active Investigations

Open, owner-backed research lives under [`active/`](active/README.md):

- remote operator connection — Roadmaps 08 and 08.5
- prompt component governance — Roadmap 06
- visual work abstraction — issue-backed research awaiting an explicit
  documentation promotion target
- general work contracts — issue-backed research awaiting an explicit
  documentation promotion target

## Promotion Backlog

The files remaining at this directory root predate the lifecycle above. They
mix research evidence with implementation status, accepted decisions, or
delivery history. They are retained temporarily to avoid losing evidence while
each dossier is reconciled against architecture, ADRs, guides, configuration,
and the changelog.

They are not active architecture and must not receive new implementation-status
updates. Process each dossier by bounded concern:

1. preserve unique evidence in a foundation or evaluation when useful;
2. promote stable contracts and accepted decisions to their owning documents;
3. record completed delivery in the changelog or release notes;
4. delete the residual dossier and repair its consumers.
