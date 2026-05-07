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
- Expose model and route task-affinity metadata so parent agents can choose
  providers by demonstrated capability, not just availability or cost. For
  example, frontend design, backend refactoring, architecture review, long
  context research, patch application, and mechanical edits may prefer different
  model/provider/skill combinations.
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

1. Completed 2026-05-07: add immutable managed-invocation capability snapshots
   at admission time. Snapshots capture route health, provider/model proof,
   adapter descriptor, authority profile, context mode, resource-plane
   availability, and projected child identity. Runtime records, session events,
   managed tool metadata, and operator presentation details now carry the
   admitted snapshot.
2. Completed 2026-05-07: extend snapshot consumption to resource-read and
   external consumer contracts. Managed invocation transcripts and diagnostics
   include the admitted snapshot, gateway contracts export the operator-facing
   snapshot payload shape, and the React SDK re-exports those types for
   downstream surfaces. Widget event rendering remains deferred until the widget
   grows operator-session event support.
3. Add evaluated first-party defaults for agent/team selection after live
   harnesses compare configured agents against fixed rubrics for quality,
   evidence use, permission compliance, cost, duration, and actionable output.
4. Completed 2026-05-07: promote the Sequel engineering doctrine shape into a
   canonical first-party instruction-profile contract. Instruction profiles now
   support structured `doctrine` facets for principles, workflow, quality
   gates, review posture, and delegation while preserving markdown as the
   human-readable body. Context assembly and native projection summaries expose
   those facets without duplicating doctrine into harness-specific files.
5. Started 2026-05-07: add a route/model capability catalog. Static
   `ModelCapabilityRegistry` evidence now exposes task suitability for
   `frontend-design`, `backend-coding`, `architecture-review`, `research`,
   `mechanical-edit`, and `test-writing`, operator/project
   `modelTaskSuitability` overrides supersede static evidence by
   provider/model/task, and managed invocation tool descriptions surface the
   merged evidence to parent sessions. Remaining work: merge live proof,
   evaluation results, and recommended skill pairings into the same evidence
   shape.
6. Improve parent tool guidance so operators can ask for delegated work in
   natural language while the model sees a bounded catalog of admissible agents,
   skills, routes, context modes, and task-affinity hints.
7. Add bounded write-capable managed routes for implementation roles:
   `foundation-workspace-write-implementation`,
   `foundation-approved-patch`, or equivalent names after the authority model is
   finalized. These routes must produce diff/write evidence and require
   approval according to policy.
8. Add canonical project-root resolution and repo-shim projection. `kiln sync`
   currently treats the current working directory as the project root for
   repo-local artifacts such as `AGENTS.md`; that is not a durable contract for
   generated `AGENTS.md`, generated `CLAUDE.md`, nested worktrees, or direct
   harness use from subdirectories. Sync must resolve a project root from an
   explicit `--project`/`--cwd` value, then the nearest `.kiln/kiln.yaml`, then
   the nearest repository root, and fail closed for repo-level shims when the
   root is ambiguous or lacks project identity. Evolve `agents-md` into a
   bounded repo-shims target that generates project `AGENTS.md`, `CLAUDE.md`,
   and future repo instruction shims from the merged canonical Kiln config
   instead of maintaining hand-written repo guidance.
9. Design the cross-surface configuration surface:
   - GUI: dedicated Settings/Setup surface or sidebar mode.
   - TUI: equivalent command/screen.
   - CLI: deterministic `kiln config/status/sync` commands.
   - SDK/widget: read-only config/status descriptors first, mutation later
     behind explicit authority.
10. Move theme selection and provider/setup diagnostics out of the always-visible
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
- Parent agents can inspect admitted route/model capability evidence and skill
  recommendations before choosing a child route for a task.
- Kiln can project the same operator/team doctrine into GUI, TUI, CLI,
  SDK/widget, Claude Code, Codex, and OpenCode without duplicating the doctrine
  text across every native file.
- Repo-level `AGENTS.md` and `CLAUDE.md` are generated from the same resolved
  project root and canonical Kiln doctrine; running sync from a subdirectory
  resolves the same root or refuses to write.
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
