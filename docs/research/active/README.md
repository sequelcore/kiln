# Active Research

This directory contains unresolved, owner-backed investigations.

Every note must name or link:

- the open question;
- its roadmap track or issue owner;
- the evidence cutoff;
- the target architecture, ADR, guide, configuration, or evaluation surface;
- the condition under which the note is promoted or deleted.

## Investigations

- [Prompt Component and Response Governance](23-prompt-component-governance.md)
  supports [Roadmap 06](../../roadmap/06-prompt-governance-plane.md).
- [Provider-Neutral Communication Governance](42-provider-neutral-communication-2026.md)
  records the current provider/harness evidence and the evaluation work that
  remains before any communication default or prompt fallback can be promoted.
- [Remote Operator Connection](43-remote-operator-connection-2026.md) supports
  [Roadmap 08](../../roadmap/08-remote-operator-pairing.md) and
  [Roadmap 08.5](../../roadmap/08.5-remote-operator-connectivity.md) with the
  current product, standards, transport, and repository evidence for
  `Kiln Connect`.
- [Visual Work Abstraction](31-visual-work-abstraction-2026.md) and
  [General Work Contracts](32-general-work-contracts-2026.md) retain issue-backed
  evidence but still need explicit documentation promotion targets.

- [Bounded-Work Authority Benchmark](bounded-work-benchmark.md) holds the paired
  design for [issue #19](https://github.com/sequelcore/kiln/issues/19). The
  contract it tests is already canonical in
  [`bounded-work-authority.md`](../../architecture/core/bounded-work-authority.md);
  only the measurement remains open.

Research without an active owner does not remain here.
