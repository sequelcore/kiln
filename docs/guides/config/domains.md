# Domains

This guide describes the current, deliberately narrow domain system.

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

## Scope

Package installation and distribution are outside this contract. If those
mechanics gain a demonstrated consumer, document them as narrow operational
behavior rather than expanding domains into an architectural centerpiece.
