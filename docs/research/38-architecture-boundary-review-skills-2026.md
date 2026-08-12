# Architecture Boundary Review Skills (2026)

Status: accepted research basis
Cutoff: 2026-08-12

## Decision

Kiln keeps Clean Architecture and DDD review separate. Clean Architecture
reviews dependency shape, policy/mechanism separation, composition, public
contracts, and the quality a boundary protects. DDD reviews business language,
invariants, lifecycle ownership, bounded-context relationships, and consistency.

Neither skill should reward ceremony. A port, aggregate, event, or versioned
contract is justified only by real volatility, invariants, coupling, or active
consumers.

## Evidence

Measured evidence:

- Dependency cycles have been associated with greater defect proneness in
  empirical component studies. [Journal of Systems and Software](https://www.sciencedirect.com/science/article/abs/pii/S0164121213001878)
- A systematic review finds coupling, complexity, and size related to fault
  proneness, while warning that definitions and causal interpretations vary.
  [Review](https://arxiv.org/abs/1601.01447)
- DORA repeatedly observes that loosely coupled architectures and teams predict
  better delivery outcomes. This is correlational survey evidence, not proof
  that a named layering method causes performance.
  [DORA capability](https://dora.dev/capabilities/loosely-coupled-teams/)
- A 2025 review of 36 DDD studies reports benefits around ubiquitous language,
  bounded contexts, domain events, and decomposition, but finds weak empirical
  evaluation in much of the literature and meaningful expertise costs.
  [Journal of Systems and Software](https://www.sciencedirect.com/science/article/pii/S0164121225002055)

Authoritative and practitioner guidance:

- The Clean Architecture dependency rule places source dependencies toward
  stable policy. [Canonical article](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- SEI treats propagation cost, cycles, conformance, and quality-attribute
  tradeoffs as architecture evidence.
  [Measurement framework](https://sei.cmu.edu/blog/developing-an-architecture-focused-measurement-framework-for-managing-technical-debt/)
- A bounded context delimits one internally consistent model and language; an
  aggregate is a consistency boundary reached through its root.
  [Bounded Context](https://martinfowler.com/bliki/BoundedContext.html),
  [DDD Aggregate](https://martinfowler.com/bliki/DDD_Aggregate.html).
- Microsoft guidance starts aggregate boundaries from business invariants and
  transactions and distinguishes a bounded context from a deployable service.
  [Domain model guidance](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/microservice-domain-model)

## Adopted contract

Clean Architecture review must:

- map policy owners, dependencies, runtime composition, and public contracts;
- inspect static and hidden coupling through configuration, registration,
  reflection, generation, persistence, callbacks, events, and shared state;
- distinguish source dependency from runtime control flow;
- name cycles, duplicated ownership, contract leakage, and correction direction;
- evaluate the quality and tradeoff the boundary exists to protect;
- reject behavior-free abstraction and route domain/security judgments to their
  owning reviews.

DDD review must:

- establish capability, stakeholders, language, invariants, lifecycle, and
  change authority from domain evidence;
- distinguish contexts from packages, services, databases, and deployments;
- place aggregates at the smallest atomic invariant boundary;
- name context direction, translation ownership, contract, consistency, and
  active consumers;
- detect leaked meanings, shared persistence, oversized aggregates, temporal
  coupling, and compatibility without consumers;
- reject tactical DDD ceremony for simple data-maintenance domains.

## Limitations

Clean Architecture and DDD remain design traditions with incomplete direct
causal evidence. The strongest measured support concerns coupling, cycles,
change isolation, and delivery autonomy. The adopted workflows therefore demand
repository and domain evidence rather than asserting conformance to a brand.
