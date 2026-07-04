# 05 - Skill Capability Plane

Status: Active research and configuration-hardening track
Created: 2026-07-03

## Objective

Make skills a governed Kiln capability plane: small, versioned,
task-admitted instruction bundles with measurable value, instead of large
template dumps, cloned reference repositories, or always-loaded context.

## Goals

- Inventory skills across Codex, OpenCode, Claude Code, `.agents`, repo shims,
  and project-local skill sources without treating any projection as authority.
- Normalize skill identity, source, version, compatibility, resources,
  dependencies, and validation status.
- Replace legacy manual routing skills with native Kiln skill recommendation,
  admission, and status evidence.
- Admit skills by task, risk, and evidence so model context only receives the
  smallest useful procedural knowledge.
- Detect duplicate, stale, broken, oversized, or cross-harness-invisible skills.
- Measure whether a skill improves result quality, token use, time, and replay
  evidence before promoting it as default behavior.

## Scope

- Skill discovery and status surfaces.
- Skill metadata, lockfile, provenance, and health checks.
- Broken local references, missing bundled resources, and format validation.
- Cross-harness compatibility evidence for Codex, Claude Code, OpenCode,
  Cursor-compatible `.agents`, and future harnesses.
- Optional curated installation recommendations based on operator needs and
  measured value.
- Curated project-context authoring skills that help create high-quality
  repo-level `AGENTS.md` and `CLAUDE.md` projections through Kiln-owned
  canonical context instead of manual shim edits.

## Non-Goals

- No bulk installing every popular skill.
- No prompt-only policy that bypasses Kiln contracts.
- No skill may write durable doctrine directly into generated repo shims such
  as `AGENTS.md` or `CLAUDE.md`.
- No resurrecting legacy "generate a prompt for another harness" workflows as
  first-class skill behavior.
- No deleting operator skills without explicit approval.
- No benchmark or marketing claims without reproducible eval evidence.
- No hidden skill loading that makes replay or cost attribution opaque.

## Legacy Skill Decisions

- `phase-prompt-generator` is removed from active governed and native skill
  roots. Its old purpose was manual prompt construction for cross-harness
  execution; Kiln should express that work through plans, managed agents,
  admission evidence, and reproducible verification instead.
- `skill-router` is removed from active governed and native skill roots. The
  underlying problem remains valid, but the solution should be native Kiln
  capability discovery: a provider-neutral view of built-in, user, project, and
  native-projected skills with health, trust, compatibility, cost/context
  impact, and task admission evidence.
- `handoff` remains active for now as an operator-requested summary skill, but
  it should be reviewed for overlap with `clear-writing` and Kiln's canonical
  handoff/memory/documentation flows. It must not create durable loose
  documents or commits by default once Kiln owns the workflow natively.
- A future repo-instruction authoring skill should not replace Kiln repo shim
  projection. Kiln already owns generated repo `AGENTS.md` and `CLAUDE.md`;
  the skill should help discover repository facts, draft canonical
  `.kiln/project-context.md` updates, identify missing commands or references,
  and then rely on `kiln sync --repo-shims` to project harness entrypoints.

## Research Basis

- `skills.sh` frames skills as reusable agent capabilities installable through
  a shared ecosystem and CLI.
- Public skill tooling now supports global and agent-specific installation,
  update checks, security summaries, and skill discovery.
- Recent skill research argues that skill availability does not guarantee useful
  skill use; skill value depends on model, harness, task, quality, and
  governance.
- Sequel standards require no dead code, no legacy hacks, no duplicate owners,
  no unsupported compatibility shims, and no untested completion claims.

## Delivery Slices

### Slice 1 - Installed Skill Inventory

Status: Started

Goals:

- Enumerate installed skills by harness-visible root.
- Compare current skills against known backups and lockfiles.
- Report missing, duplicate, stale, oversized, or broken skills.
- Separate user-global skills from Kiln built-in skills and repo-projected
  skills.

Gates:

- Inventory must include source path, skill name, frontmatter validity, resource
  count, and local-link health.
- No mutation is allowed during inventory.

### Slice 2 - Local Skill Repair

Status: Started

Goals:

- Repair objectively broken local skill resources.
- Preserve operator skills unless explicit deletion is approved.
- Prefer restoring missing bundled resources from known-good backups or current
  global installs before rewriting instructions.

Gates:

- Repairs must be narrow and traceable.
- Broken local references must be rechecked after every repair.
- Third-party skills may be patched only to remove false local promises or
  restore missing packaged resources.

### Slice 3 - Skill Admission Contract

Status: Not started

Goals:

- Add a Kiln contract for skill capability evidence.
- Model skill source, version, compatibility, freshness, health, size, resource
  dependencies, and operator trust.
- Model task-to-skill recommendation as evidence produced by Kiln, not as a
  user-maintained prompt-routing skill.
- Fail closed when a skill is missing, stale, too broad, or has broken local
  resources.

Gates:

- No harness-specific skill classifier may own policy independently.
- Gateway/operator surfaces must render shared evidence instead of recomputing
  skill health.

### Slice 4 - Skill Value Evaluation

Status: Not started

Goals:

- Evaluate whether selected skills improve engineering, research, UI, document,
  marketing, or benchmark workflows.
- Attribute outcomes to skill use, model behavior, tool availability,
  environment, and operator intervention.
- Promote only skills with reproducible value under bounded token and time
  budgets.

Gates:

- Evals must compare with and without the skill on realistic tasks.
- Public claims require reproducible fixtures and no benchmark-only prompt
  paths.

### Slice 5 - Governed Skill Operations

Status: Not started

Goals:

- Provide doctor/status commands for skill health.
- Provide native skill discovery/recommendation so operators can ask "what
  capability should handle this?" without relying on stale harness-local router
  prompts.
- Support curated install/update recommendations without bulk context bloat.
- Document operator policy for personal skills versus Kiln built-ins.

Gates:

- No automatic update may overwrite locally modified operator skills without
  evidence and explicit approval.
- Every installed skill must remain inspectable and removable.

### Slice 6 - Repo Instruction Authoring Skill

Status: Planned

Goal: provide a curated skill for creating the best possible repo-level
agent-facing context while preserving Kiln as the owner of generated
`AGENTS.md` and `CLAUDE.md` shims.

Work:

- define a built-in skill, tentatively `repo-instruction-authoring`, that
  scouts repository evidence before drafting guidance;
- make the skill author or patch canonical `.kiln/project-context.md` and
  supporting reviewed notes, not generated repo shims;
- require evidence for package manager, commands, architecture references,
  test gates, domain boundaries, generated-file rules, and known local
  conventions;
- keep global doctrine out of repo context and keep executable routing,
  provider, model, agent, and permission policy in Kiln config;
- add diagnostics that explain when repo shims are stale and should be
  regenerated through Kiln sync.

Gates:

- the skill cannot recommend direct manual edits to generated `AGENTS.md` or
  `CLAUDE.md`;
- generated repo shims can be traced back to `.kiln/project-context.md` plus
  active instruction profiles;
- tests or fixtures cover missing package manager evidence, ambiguous test
  commands, generated-file drift, and stale repo shim status;
- the skill proves value through clearer repo context, fewer duplicated
  instructions, and fewer harness-specific markdown patches.

## Promotion Gates

- Inventory and health evidence are available from CLI and at least one operator
  surface.
- Skill admission is provider-neutral and harness-neutral.
- Broken-resource and oversized-skill checks are automated.
- Value evaluation can prove when a skill is worth its context cost.
- Canonical docs explain how Kiln uses skills to reduce cloned repos and large
  template piles.

## Verification

- Local skill inventory check.
- Broken local Markdown link scan.
- Frontmatter validation for `name` and `description`.
- Cross-harness visibility check for `.codex`, `.agents`, and repo-projected
  skills.
- Focused tests for any Kiln contract, CLI, Gateway, GUI, or TUI changes.

## Completion Criteria

- Kiln can show which skills are available, healthy, stale, broken, duplicate,
  or unsuitable for a task.
- Operators can install or update curated skills with evidence instead of
  guesswork.
- Agents receive fewer, better instructions for the current job.
- Completed doctrine is promoted into canonical architecture/operator docs, and
  this roadmap is deleted after closeout.
