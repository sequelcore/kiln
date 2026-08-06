# Safety

## Safety Doctrine

Safety protects the operational envelope from unsafe content, unsafe actions,
unsafe outputs, and unsafe recovery behavior.

It is a layered system with explicit defaults and explicit exceptions.

## Layer Model

### Barrier Layer

Fast perimeter control such as:

- auth
- visitor sanitization
- rate limiting

### Detection Layer

Fast deterministic scanning such as:

- PII detection
- content classification
- prompt injection Tier 1
- dangerous command detection

### Analysis Layer

Slower contextual analysis such as:

- grounding checks
- Guardian review
- prompt injection Tier 2

## Default Behavior

The architecture must stop being ambiguous here:

- fast safety and deterministic detection should be fail-closed
- any fail-open behavior must be explicit, narrow, and justified
- the doctrine must not claim two opposite defaults at once

## Danger Signals

Useful explicit signal classes include:

- `DAMP_PII`
- `DAMP_INJECTION`
- `DAMP_DANGEROUS_CMD`
- `DAMP_EGRESS`
- `DAMP_DATA_LOSS`

Signals should map to response protocols, not just generic “unsafe” labels.

## Escalation

Safety escalation must be deterministic:

- block
- escalate
- mode shift
- human review
- override with rationale

No hidden bypass path should exist when the escalation path is unavailable.

## Threat Memory

Threat memory should store confirmed attack signatures with TTL and use recall
to elevate future sensitivity.

This is one of the strongest research-to-architecture mappings and should be
treated as a first-class future addition, not a side note.

## Anti-Autoimmunity

Safety should reduce false positives without weakening the envelope.

Useful design principle:

- expensive analysis alone should not become silent permanent lockdown
- layered confirmation or human override should exist where appropriate

## Invariants

- every block is audited
- fail-open is explicit, never assumed
- destructive action review is enforceable
- indirect injection scanning applies to tool results before reinjection
