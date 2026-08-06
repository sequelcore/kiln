# Domains

This guide is now a transitional note on the current domain system.

Domains remain an implementation mechanism for stack-aware defaults, tooling,
and quality gates. They are not part of Kiln's architectural identity.

## What Domains Are

Domains are a configuration-time or runtime convenience layer used to:

- detect project or stack characteristics
- surface relevant tools or gates
- apply stack-aware context

They should be understood as local adaptation aids, not as first-class
architectural primitives.

## What Domains Are Not

- not bounded contexts in the DDD sense
- not the core unit of Kiln identity
- not a reason to keep old abstraction layers alive

## Canonical Placement

If domains remain in the system long term, they belong under the broader
adaptation and execution-policy story:

- they can influence what is appropriate to expose
- they can tune what checks or tools are relevant
- they must not outrank safety, context governance, or architectural invariants

Relevant docs:

- [Adaptation](../../architecture/core/adaptation.md)
- [Context Governance](../../architecture/context/context-governance.md)
- [Safety](../../architecture/safety/safety.md)

## Transitional Status

Older versions of this guide described a large package/distribution model for
domains in a way that implied they were central to the system design. That
framing is being retired.

If detailed install and packaging mechanics are still required during refactor,
they should be restored later as narrow operational docs, not as conceptual
centerpieces.
