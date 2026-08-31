---
name: concept-modeling
description: Model an unclear domain or technical concept before it becomes a cross-surface contract. Use only when evidence shows ambiguous or overloaded terms, duplicated semantic owners, collapsed independent dimensions, or conflicting meanings across surfaces. Do not use merely because a concept is new, for a mechanical local rename, or to confirm an already coherent contract.
metadata:
  kiln.harnessPortability: agnostic
  kiln.disconnectedExecution: supported
  kiln.requiredCapabilities: none
tools:
  - read
  - grep
  - glob
tags:
  - architecture
  - concepts
  - terminology
  - contracts
---

# Concept Modeling

Use this skill when evidence shows ambiguous or overloaded terms, duplicated
semantic owners, collapsed independent dimensions, or conflicting meanings
across surfaces. Do not use it merely because a concept is new, for a purely
mechanical rename, or to confirm a concept contract that is already coherent.

## Model before naming

1. Start with representative scenarios and observable behavior. Identify what
   varies, what must remain invariant, and which distinctions users or
   implementers need before choosing a name.
2. Define the concept's owner, audience, lifecycle, boundaries, and authority.
   Separate dimensions that can vary independently instead of hiding them in
   one overloaded label or optional-field bag.
3. Test the proposed model against counterexamples and repository evidence.
   Distinguish confirmed facts, inferences, contradictions, and unknowns.
4. Use one familiar canonical term for one concept within an owning context and
   different terms for materially different concepts. Prefer the shortest term
   that preserves the necessary distinction; shorter is not automatically
   clearer.
5. Permit different terms across bounded contexts, locales, audiences, or
   platform syntax when their meanings genuinely differ. Name the translation
   owner and make the mapping explicit.

## Trace the contract

Inspect only the active surfaces relevant to the concept: owning types,
configuration, schemas, tools, APIs, runtime branches, persistence, events,
UI, tests, fixtures, documentation, prompts, and generated projections.

Record a compact concept contract using only fields that exist:

- definition and representative scenarios;
- canonical term and machine identifier;
- owner, lifecycle, audience, and boundaries;
- independently varying dimensions and invariants;
- deliberate translations;
- active consumers and contract-evolution risk.

Treat public, persisted, serialized, or model-facing names as contracts.
Identify compatibility policy, migration or replacement path, version impact,
and generated artifacts before changing them. Do not retain aliases without an
active consumer or explicit migration requirement.

## Put knowledge in its natural owner

Persist durable knowledge where it can remain authoritative:

- types, schemas, and configuration own allowed vocabulary and structure;
- code and tests own behavior and invariants;
- canonical documentation owns non-derivable meaning and context translation;
- an ADR owns a surprising, consequential decision that is difficult to
  reverse and exists because of a real tradeoff;
- repository guidance points to the owner instead of copying its content.

Do not require a glossary, `CONTEXT.md`, ADR, registry, wrapper, or new type when
an existing owner already represents the knowledge. Prefer executable
enforcement through closed types, schemas, mappings, contract tests, or config
constraints when possible.

## Boundaries

- DDD review owns business capabilities, bounded contexts, aggregates, and
  domain invariants when that complexity is justified.
- Clean-architecture review owns modules, dependency direction, and technical
  boundary shape.
- Product-copy review owns user-facing phrasing after the concept is sound.
- API-contract review owns external API compatibility.
- Refactoring-safety owns execution of behavior-preserving migrations.
- This skill owns concept discovery and the cross-surface semantic contract.

Do not invent user evidence, impose one context's vocabulary on another, turn
terminology preference into authority, or normalize unrelated legacy language.

## Output

Lead with the decision or highest-impact finding. Report the scenarios and
evidence used, concept definition, canonical term and owner, affected surfaces,
translations, evolution risk, enforcement, verification, and residual
uncertainty. Say explicitly when the current model is already coherent and no
change or new artifact is warranted.
