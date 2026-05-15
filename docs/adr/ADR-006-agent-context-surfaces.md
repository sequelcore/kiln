# ADR-006: Agent Context Surfaces

## Status

Accepted

## Context

Kiln separates product doctrine, operator preferences, executable agent
profiles, reusable skills, and managed child context. Without explicit context
surfaces, instructions leak across agents, child runs receive invented
profiles, and provider-native concepts become the source of truth.

## Decision

Kiln owns canonical agent context through structured surfaces:

- `OperatorIdentity` for operator metadata and presentation identity.
- `InstructionProfile` for durable doctrine, standards, and policy.
- `AgentProfile` for executable role, route, authority, and default context.
- `SkillPackage` for reusable procedural context, references, scripts, and
  resources.
- `ManagedInvocationContext` for one admitted child-agent execution context.

The native Kiln context resolver admits configured profiles, skills,
instruction profiles, resources, provider route, authority profile, and context
mode before execution. Provider-native projections are generated from this
state; they are not the canonical source.

`managed_agent.invoke` exposes only admitted child context choices. Unknown
agent profiles, invented skills, unavailable routes, denied authority, and
unsupported context modes fail closed.

## Context Modes

- `isolated`: default child context; receives admitted profile/skills without
  parent transcript.
- `resources`: child receives explicit `kiln://` resources plus admitted
  profile and skills.
- `fork`: reserved for policy-approved parent-context forking and requires a
  configured context resolver.

## Precedence

Context resolution follows explicit precedence:

1. Runtime safety and authority policy
2. Project instruction profiles
3. User instruction profiles
4. Built-in instruction profiles and skills
5. Agent profile defaults
6. Per-invocation admitted overrides

Lower-precedence content cannot weaken higher-precedence safety or authority
constraints.

## Consequences

Kiln can project clean context into Claude Code, Codex, OpenCode, native
sessions, GUI, TUI, and managed children without treating any provider's local
configuration as truth. The cost is stricter admission and explicit failure for
unknown context references.

## Verification

Professional acceptance for this ADR requires tests that cover:

- instruction profile and skill discovery
- agent profile resolution and aliases
- managed invocation schema narrowing
- fail-closed unknown profiles, skills, and routes
- `isolated`, `resources`, and gated `fork` context behavior
- provider-native projection generated from Kiln context

Canonical architecture reference: `docs/architecture/agent-context.md`.
