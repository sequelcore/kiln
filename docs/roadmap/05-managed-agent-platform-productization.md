# Managed Agent Platform Productization

Status: Active
Opened: 2026-05-07

## Objective

Turn Kiln's current managed-agent foundation into a coherent product platform,
not a wrapper around provider CLIs.

Kiln's differentiator is the governed control plane: canonical configuration,
direct providers and harnesses under one contract, managed child invocation,
bounded authority, traceable evidence, reusable agent identity, and equivalent
operator behavior across GUI, TUI, CLI, SDK/widget, and future surfaces.

This roadmap tracks the productization work needed to make that thesis obvious
in day-to-day use without weakening the architecture into prompt hacks,
surface-specific behavior, or provider compatibility glue.

## Current Differentiators

- Canonical Kiln config is the source of truth and native provider files are
  projections.
- Direct providers and CLI harnesses can participate in the same managed
  invocation contract.
- Managed child invocations carry explicit profile, provider, model, route,
  context, authority, and result evidence.
- GUI already renders child execution evidence instead of hiding delegation in
  prose.
- Canonical agent profiles have stable ids plus operator-facing display names
  and aliases across Kiln, Claude Code, Codex, and OpenCode projections.
- Runtime admission fails closed when profiles, skills, resource context, or
  route authority are not actually configured.

## Scope

- Make managed child invocation natural enough that a parent can choose the
  appropriate configured child agent without the operator spelling out every
  route detail.
- Keep agent/team identity canonical in Kiln while projecting only the subset
  each harness can safely consume.
- Improve child result presentation through the presentation-intent contract
  rather than ad hoc markdown or GUI-only rendering.
- Harden evidence and replay around immutable capability snapshots captured at
  admission time.
- Convert the best first-party agent/profile defaults from the local Sequel
  configuration into professional Kiln defaults after evaluation proves they
  improve outcomes.
- Convert personal/team workflow doctrine into canonical instruction profiles
  so Kiln understands how the operator works instead of merely forwarding
  prompts to providers.
- Add write-capable managed child routes for implementation profiles once their
  authority, approval, diff evidence, rollback, and replay contracts are proven.
- Keep live proof, health diagnostics, and route eligibility visible so users
  understand why a child agent was selected, denied, or skipped.
- Add a canonical setup/configuration surface that lets operators inspect and
  edit Kiln config, provider health, routes, agents, skills, memory authority,
  themes, and projection status without making GUI the only source of control.
- Simplify operator chrome so session controls, tabs, chat, activity, memory,
  and configuration each have clear homes instead of a dense persistent topbar.

## Non-Goals

- Do not make Kiln depend on Claude Code, Codex CLI, OpenCode, or any single
  provider as the source of truth.
- Do not let provider-native subagent concepts define Kiln's managed invocation
  contract.
- Do not add personality boilerplate or monolithic prompts as a substitute for
  canonical agent profiles, skills, and instruction profiles.
- Do not ship Kiln as an empty control plane that lacks opinionated first-party
  workflow defaults.
- Do not expose arbitrary model-authored UI, HTML, or executable presentation.
- Do not add community/third-party agent packs until first-party defaults and
  trust policy are stable.
- Do not broaden child authority just to make delegation easier.
- Do not make all agents read-only by product doctrine; use read-only as the
  safe default and add bounded write authority where the role and approval
  policy require it.

## First Implementation Slices

1. Complete presentation-intent support from
   `docs/roadmap/04.5-presentation-intent-contract.md` so multi-agent
   comparison, risk reports, diagnostics, and resource bundles render as
   validated semantic output across all surfaces.
2. Add immutable managed-invocation capability snapshots at admission time:
   route health, provider/model proof, adapter descriptor, authority profile,
   context mode, resource-plane availability, and projected child identity.
3. Use those snapshots for invocation records, replay, resource reads, GUI
   Activity, CLI/TUI output, and SDK/widget contracts instead of recomputing
   live mutable capability state.
4. Add evaluated first-party defaults for agent/team selection after live
   harnesses compare configured agents against fixed rubrics for quality,
   evidence use, permission compliance, cost, duration, and actionable output.
5. Promote the Sequel engineering doctrine shape into a canonical first-party
   instruction-profile contract: clean architecture, DDD, no dead code, no
   redundancy, TDD, review gates, verification gates, and delegated workflow.
6. Improve parent tool guidance so operators can ask for delegated work in
   natural language while the model sees a bounded catalog of admissible agents,
   skills, routes, and context modes.
7. Add bounded write-capable managed routes for implementation roles:
   `foundation-workspace-write-implementation`,
   `foundation-approved-patch`, or equivalent names after the authority model is
   finalized. These routes must produce diff/write evidence and require
   approval according to policy.
8. Design the cross-surface configuration surface:
   - GUI: dedicated Settings/Setup surface or sidebar mode.
   - TUI: equivalent command/screen.
   - CLI: deterministic `kiln config/status/sync` commands.
   - SDK/widget: read-only config/status descriptors first, mutation later
     behind explicit authority.
9. Move theme selection and provider/setup diagnostics out of the always-visible
   chat topbar once the configuration surface exists; keep only controls that
   are needed for the active operator workflow.

## Acceptance Criteria

- A GUI, TUI, CLI, and SDK/widget consumer can observe the same canonical child
  invocation identity: provider, model, route, agent profile, display name,
  context mode, authority, and evidence links.
- Parent sessions can delegate to a configured child agent without requiring
  the operator to specify low-level route fields, while still failing closed for
  unavailable routes or unknown profiles.
- Child result presentation is semantic and validated, not surface-specific
  markdown.
- Replay and audit use immutable admission snapshots, so later provider health
  drift does not rewrite what happened.
- First-party defaults are backed by repeatable evaluations, not personal taste
  or community prompt-pack cargo culting.
- Kiln can project the same operator/team doctrine into GUI, TUI, CLI,
  SDK/widget, Claude Code, Codex, and OpenCode without duplicating the doctrine
  text across every native file.
- Implementation-capable agents can be admitted through bounded write profiles
  with approval and evidence instead of being limited to analysis-only children.
- Native provider files remain projections of Kiln config; deleting or changing
  a harness file cannot silently change Kiln's canonical truth.
- GUI chrome does not duplicate configuration responsibilities: persistent
  navigation stays focused on work surfaces, while setup/configuration lives in
  a first-class cross-surface contract.

## Deferred

- Public third-party agent/skill catalogs with provenance, scanning, and trust
  metadata.
- Team-wide/cloud profile distribution.
- Marketplace-style presentation packs.
- Autonomous conductor planning, fan-out/fan-in scheduling, and durable
  workflow execution.
