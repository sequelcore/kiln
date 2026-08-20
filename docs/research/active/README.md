# Active Research

This directory contains unresolved, owner-backed investigations.

Every note must name or link:

- the open question;
- its roadmap track or issue owner;
- the evidence cutoff;
- the target architecture, ADR, guide, configuration, or evaluation surface;
- the condition under which the note is promoted or deleted.

## Investigations

- [Configuration Surface Inventory](configuration-surface-inventory.md)
  supports [Roadmap 12](../../roadmap/12-configuration-experience.md) with the
  current reader, writer, field, evidence, projection, mutation, and
  verification map required before the schema and mutation ADR.
- [Prompt Component and Response Governance](prompt-component-governance.md)
  supports [Roadmap 06](../../roadmap/06-prompt-governance-plane.md).
- [Provider-Neutral Communication Governance](provider-neutral-communication.md)
  records the current provider/harness evidence and the evaluation work that
  remains before any communication default or prompt fallback can be promoted.
- [Remote Operator Connection](remote-operator-connection.md) supports
  [Roadmap 08](../../roadmap/08-remote-operator-pairing.md) and
  [Roadmap 08.5](../../roadmap/08.5-remote-operator-connectivity.md) with the
  current product, standards, transport, and repository evidence for
  `Kiln Connect`.
- [Visual Work Abstraction](visual-work-abstraction.md) and
  [General Work Contracts](general-work-contracts.md) retain issue-backed
  evidence but still need explicit documentation promotion targets.

- [Bounded-Work Authority Benchmark](bounded-work-benchmark.md) holds the paired
  design for [issue #19](https://github.com/sequelcore/kiln/issues/19). The
  contract it tests is already canonical in
  [`bounded-work-authority.md`](../../architecture/core/bounded-work-authority.md);
  only the measurement remains open.

Research without an active owner does not remain here.
