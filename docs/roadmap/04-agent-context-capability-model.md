# Agent Context Capability Model

Status: Active
Opened: 2026-05-07

## Objective

Implement the canonical agent-context model across Kiln surfaces: operator
identity, instruction profiles, agent profiles, skills, and managed child
context.

This work turns existing partial surfaces into one governed context pipeline.
It must not create a monolithic personality prompt, duplicate schemas per
surface, or bake community prompt packs into product defaults.

## Scope

- Promote `docs/architecture/agent-context.md` as the canonical doctrine.
- Make global identity an admitted prompt-context source instead of passive
  config.
- Replace partial CLI agent shapes with a canonical agent profile contract.
- Ensure `kiln run --agent` resolves default skills through `SkillRegistry` and
  context admission.
- Extend managed child invocation to request and admit `agentProfile`,
  `skills`, and `contextMode`.
- Emit canonical profile, skill, context, route, model, and authority evidence
  across GUI, TUI, CLI, SDK/widget, and gateway session events.
- Project agent and skill contracts into Claude Code, Codex, and OpenCode only
  through harness capability declarations.

## Non-Goals

- Do not create a broad `personality` string.
- Do not make child agents inherit the full parent transcript by default.
- Do not make skills grant tool or filesystem authority.
- Do not move credentials into agent profiles.
- Do not install any third-party skill or agent catalog by default.
- Do not add compatibility versions for internal contracts without real
  consumers.

## Acceptance Criteria

- `docs/architecture/agent-context.md` is linked from the architecture index.
- `docs/guides/global-config.md` distinguishes identity, instruction profiles,
  agents, skills, and managed child context.
- `KilnGlobalIdentity` is either used as admitted prompt context or removed
  from the schema; passive config is not allowed.
- One canonical agent profile type is used by CLI, runtime, managed
  invocation, and native projection.
- Agent default skills are resolved through `SkillRegistry` and admitted
  through the context governor.
- `managed_agent.invoke` supports requested `agentProfile`, `skills`, and
  `contextMode`, and fails closed when they cannot be admitted.
- Session events expose admitted and denied profile/skill/context evidence.
- GUI, TUI, and CLI render equivalent managed child evidence.
- Focused tests cover identity projection, agent skill admission, managed child
  profile/skill admission, and surface event parity.
- Full quality gates pass.

## Follow-Up Slices

1. Add guarded install/import for third-party skills and agent packs with trust
   metadata, static scanning, and provenance.
2. Add an operator-facing configuration wizard that creates a minimal personal
   Kiln setup from canonical profiles and skills.
3. Add evaluation harnesses that compare task success with and without selected
   skills before recommending defaults.
