# ADR-009: Agent context surfaces

**Status:** Accepted (2026-05-07)
**Date:** 2026-05-07
**Author:** Ricardo Armenta
**Scope:** `packages/core/src/context/`, `packages/core/src/engine/`,
`packages/core/src/tools/`, `packages/runtime/src/gateway/`,
`packages/runtime/src/agents/managed-invocation/`, `packages/cli/src/config/`,
`packages/gui/`, `packages/tui/`, `docs/architecture/agent-context.md`,
`docs/architecture/managed-agents.md`, `docs/architecture/config-projection.md`,
`docs/guides/global-config.md`, `docs/guides/skills.md`
**Supersedes:** none
**Follows:** ADR-004 (Budgeted Sufficient Context Orchestration), ADR-008
(Memory Lattice governed memory graph)

---

## Context

Kiln already has several partially overlapping context surfaces:

- global config `identity`
- global and project agent definitions under `.kiln/agents`
- global and project skills under `.kiln/skills`
- runtime active skills projected through `SkillRegistry`
- managed child invocation requests
- native harness projections for Claude Code, Codex, and OpenCode

Those concepts are useful, but they are not one concept. Treating them as one
large "personality" prompt would create hidden coupling, unbounded context
growth, unclear precedence, and weak auditability. It would also conflict with
Kiln's control-plane doctrine: context is governed, budgeted, and replayable,
not blindly concatenated.

Current market and research signals converge on the same separation:

- Claude Code separates scoped memory files, subagents, skills, hooks, plugins,
  MCP servers, and permissions.
- Codex uses `AGENTS.md` as scoped project instructions and skills as
  progressive-disclosure reusable context.
- OpenCode separates primary agents, subagents, permissions, and on-demand
  skills.
- Community systems such as Everything Claude Code, Gentle AI, Hermes, and
  OpenClaw package agents, skills, commands, rules, hooks, and memory as
  distinct installable surfaces.
- Recent context-engineering research treats context as an engineered runtime
  environment with relevance, sufficiency, isolation, economy, and provenance,
  not just prompt text.

Kiln must become the canonical control plane for these surfaces instead of
copying any one harness format.

## Decision

Kiln will model agent context as **five distinct but composable canonical
surfaces**:

1. `OperatorIdentity`
   Stable operator metadata such as name, timezone, locale, and operator-facing
   UI preferences. It is not an executable agent and does not grant authority.

2. `InstructionProfile`
   Governed behavioral doctrine such as engineering standards, product
   principles, communication preferences, and organization policy. It is
   immutable prompt-context input with precedence and provenance.

3. `AgentProfile`
   Executable role configuration: name, role, goal, description, instructions,
   preferred routes/models, allowed tools, default skills, and authority
   constraints. Primary agents, subagents, managed children, CLI agents, GUI
   personas, and native harness projections consume this same contract.

4. `SkillPackage`
   Reusable procedural context and optional resources/scripts loaded through
   progressive disclosure. Skills are capabilities, not identities and not
   permissions. Skill access is governed separately from tool and filesystem
   authority.

5. `ManagedInvocationContext`
   The admitted child-run context assembled for one governed child invocation:
   selected agent profile, admitted skills, resource URIs, context mode,
   authority profile, provider route, credential route, memory scope, timeout,
   and result handoff contract.

These surfaces may share lower-level `ContextCandidate` and
`InstructionBlock` primitives, but they must remain separate domain concepts.

## Native Kiln Responsibilities

The following behavior is native to Kiln and must be available consistently
from GUI, TUI, CLI, SDK/widget, gateway apps, and managed child invocation:

- context-source precedence and provenance
- budgeted context admission through the context governor
- global/project/local scope resolution
- agent profile schema and validation
- skill discovery, capability filtering, and admission evidence
- managed child context assembly
- session events that record selected profile, admitted skills, denied skills,
  provider route, model, authority, and resource links
- native harness projection derived from canonical Kiln contracts
- fail-closed behavior when a requested profile, skill, route, or authority
  cannot be proven

Native Kiln must not bake in a community prompt pack, a vendor-specific swarm
topology, or a default team of arbitrary specialists. Those are user,
workspace, organization, or template content.

## Personalizable Responsibilities

The following remain personalizable:

- operator name, timezone, locale, communication preferences, and UI theme
- the actual text of personal/team/product standards
- which agent profiles exist
- which skills are installed or enabled
- which skills a specific agent may use
- route/model preferences inside policy bounds
- whether a child invocation runs isolated, with selected resources, or with a
  policy-approved fork of parent context
- project-local overrides for standards, agents, skills, routes, and managed
  profiles

Personalization never bypasses admission. A personal preference can request a
tool, route, skill, or model, but Kiln still validates authority, availability,
and context budget.

## Managed Child Context

Managed child invocations must not inherit the full parent transcript by
default. The default child context is isolated and assembled from:

- child task
- selected `AgentProfile`
- admitted `SkillPackage` summaries or full content as budget allows
- explicit `resourceUris`
- necessary environment facts
- admitted memory/context candidates
- authority and route metadata needed for the child to understand its boundary

Future `managed_agent.invoke` input should support explicit child context
selectors:

```ts
managed_agent.invoke({
  routeId: "codex-oauth-readonly",
  profile: "foundation-readonly-plan",
  agentProfile: "architecture-reviewer",
  skills: ["clean-architecture", "ddd-review"],
  contextMode: "isolated",
  task: "Inspect the managed-agents architecture and report risks."
})
```

`agentProfile`, `skills`, and `contextMode` are requests. The runtime resolves
and admits them. Tool output and session activity must show the admitted result,
not merely the requested value.

## Skill Admission

Skills are high-leverage and high-risk. Kiln therefore treats skills as
governed procedural context:

- discovery may expose only skill names and descriptions initially
- loading full skill content requires policy admission
- skill content contributes to context budget
- agent skill allowlists are final when explicitly configured
- incompatible, unavailable, unsafe, or denied skills are hidden or rejected
- third-party skills require provenance and trust metadata before install
- child invocations record admitted and denied skills for replay

The `SkillRegistry` remains the runtime discovery primitive, but managed
invocation and `kiln run --agent` must use the same admission path. Native
harness sync is projection, not the source of truth.

## Precedence

Canonical resolution order is:

1. Managed policy or organization doctrine
2. Project doctrine
3. Project-local scoped overrides
4. User/operator defaults
5. Agent profile defaults
6. Session mode and explicit user request
7. Managed invocation request

Higher-precedence safety and architectural constraints cannot be weakened by a
lower-precedence profile, skill, or user preference. Lower-precedence entries
may narrow authority or add task-specific context when admitted.

## Consequences

Positive:

- avoids prompt soup and duplicate native/projection schemas
- gives every surface the same agent and skill semantics
- makes child invocation more capable without ambient parent authority
- keeps context budget, provenance, and replay intact
- lets Kiln project into Claude Code, Codex, OpenCode, and future harnesses
  without becoming any one of them

Negative:

- requires a real schema and admission pipeline before richer personalization
- native harness projection remains necessary where harnesses cannot read Kiln
  config directly
- advanced skills need trust, scanning, and provenance work before broad import

## Non-Goals

- Do not create a monolithic `personality` string.
- Do not make every parent instruction automatically visible to every child.
- Do not make skills a permission mechanism.
- Do not make agent profiles own credential routing.
- Do not hardcode community prompt packs as product defaults.
- Do not add compatibility versions for internal contracts that have no real
  consumers.

## References

- Claude Code memory, subagents, skills, hooks, plugins, and MCP are separate
  extension surfaces: https://code.claude.com/docs/en/features-overview
- Claude Code subagents use separate context windows, tool restrictions, and
  custom prompts: https://code.claude.com/docs/en/sub-agents
- Codex project instructions use scoped `AGENTS.md` files and size limits:
  https://developers.openai.com/codex/guides/agents-md
- Codex skills use progressive disclosure and a bounded initial skill list:
  https://developers.openai.com/codex/skills
- OpenCode agents and skills separate agent mode, permissions, and skill
  loading: https://opencode.ai/docs/agents/ and https://opencode.ai/docs/skills/
- Anthropic's context-engineering guidance frames context as finite and
  actively curated: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- `Configuring Agentic AI Coding Tools` identifies context files, skills, and
  subagents as separate mechanisms and notes `AGENTS.md` as an emerging
  interoperable standard: https://arxiv.org/abs/2602.14690
- `Context Engineering: From Prompts to Corporate Multi-Agent Architecture`
  defines relevance, sufficiency, isolation, economy, and provenance as context
  quality criteria: https://arxiv.org/abs/2603.09619
