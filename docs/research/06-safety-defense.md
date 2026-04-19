# Safety Defense

## Purpose

This document captures the research basis for Kiln's layered safety model using
immune-system concepts only where they yield executable architecture.

## Core Conclusion

The useful immune analogy is layered defense with fast detection, slower
specialized review, danger signaling, threat memory, and controlled escalation.

The useful result is not "Kiln is an immune system." It is that safety should
behave like a defended boundary with memory and regulation.

## Useful Mechanism Families

### Innate Defense

Useful for:

- cheap first-pass detection
- broad pattern recognition
- immediate blocking or degradation
- perimeter and hygiene controls

This maps to scanners, allowlists, input validation, and deterministic policy
checks.

### Adaptive Defense

Useful for:

- refined judgment for ambiguous cases
- better handling of novel threats
- improvement based on observed incidents

This maps to slower contextual analysis, judge models, and future
threat-learning workflows.

### Danger Signals

Useful for:

- reacting to suspicious patterns even when identity is unclear
- escalating when the system sees abnormal combinations of events
- distinguishing routine variation from risky behavior

This is the right research frame for anomaly detection, loop detection, abuse
signals, suspicious tool output, and escalation heuristics.

### Immune Memory

Useful for:

- remembering known attack patterns
- preserving incident lineage
- making future response faster and more consistent

This supports explicit threat-memory storage, not vague "the system learned
something" claims.

## Self, Non-Self, And Trust

The software translation is narrower than biology:

- self: authenticated, policy-conforming actors and permitted execution paths
- non-self: unauthenticated or untrusted external input
- danger: patterns that indicate likely harm even if identity appears valid

This is why trust boundaries, approvals, and egress control belong inside the
safety model rather than beside it.

## Checkpoints And Autoimmunity

The absorbed immune research also points to two design rules:

- do not let one weak signal trigger the heaviest response when a second
  confirming signal is feasible
- design for anti-autoimmunity so the system can suppress overreaction against
  legitimate traffic, users, or tool outputs

This supports layered confirmation, calibrated fail-open or fail-closed
behavior by layer, and explicit review paths for suspicious but ambiguous
cases.

## Direct Kiln Mappings

- authentication and origin checks behave like the outer barrier
- fast scanners and deterministic rails behave like innate defense
- slower contextual judges behave like adaptive review
- audit logs and incident stores are the basis for immune memory
- approval gating is a safety checkpoint, not a convenience feature
- tool-result scanning matters because dangerous content can arrive from inside
  an apparently legitimate tool path

## Design Consequence

Safety should stay layered:

- fast path for cheap broad filtering
- slower path for ambiguous or high-risk decisions
- explicit escalation path when danger signals compound
- explicit threat-memory ownership so knowledge of past attacks persists

## Risks / Misuse

- over-sensitive fast filters will create software autoimmunity
- fail-open behavior without clear limits can turn safety into theater
- threat memory without provenance will become a source of false positives
- identity-only security will miss danger arising from trusted but compromised
  paths

## Where The Analogy Breaks

- software threat actors are intentional and semantic in ways pathogens are not
- self versus non-self is policy-defined, not biologically embodied
- there is no clean biological equivalent to approvals, auditability, or
  regulated egress controls

## Actionable Research Follow-Ups

- formalize Kiln's innate layer, adaptive layer, and danger-signal taxonomy
- define explicit ownership for threat memory
- separate identity trust from behavioral danger signals
- formalize approval gating as a safety checkpoint rather than a UI choice
