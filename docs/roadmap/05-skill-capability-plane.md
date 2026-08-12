# 05 - Skill Capability Plane

Status: Active research track
Execution: Research - define shared skill evidence before automatic admission or operations.
Created: 2026-07-03

## Objective

Make skills small, versioned, inspectable, task-admitted capabilities rather
than duplicated routers, template dumps, or always-loaded prompt context.

## Goals

- Inventory skills across Codex, OpenCode, Claude Code, `.agents`, repo shims,
  and project-local skill sources without treating any projection as authority.
- Normalize skill identity, source, version, compatibility, resources,
  dependencies, and validation status.
- Replace legacy manual routing skills with native Kiln skill recommendation,
  admission, and status evidence.
- Admit skills by task, risk, and evidence so model context only receives the
  smallest useful procedural knowledge.
- Detect duplicate, stale, broken, oversized, or cross-harness-invisible
  skills.
- Measure whether a skill improves result quality, token use, time, and replay
  evidence before promoting it as default behavior.

## Ownership

This track owns skill identity, provenance, health, compatibility, trust,
recommendation, admission, and operations. Prompt loading after admission belongs
to Roadmap 06. Exact technology versions belong to Roadmap 07.

## Scope

- Built-in, user, project, and native-projected skill inventory.
- Recursive resource health, provenance, compatibility, freshness, and size.
- Broken local references, missing bundled resources, and format validation.
- Provider-neutral task recommendation and admission evidence.
- Value evaluation and explicit install/update/remove operations.
- Repo-context authoring that updates canonical project context, never
  generated shims directly.

## Non-Goals

- No bulk installation or hidden loading.
- No harness-local router as policy owner.
- No exact framework/package version authority in skill prose.
- No deletion or overwrite of operator skills without explicit approval.
- No skill may write durable doctrine directly into generated repo shims such
  as `AGENTS.md` or `CLAUDE.md`.
- No benchmark or marketing claims without reproducible eval evidence.
- No hidden skill loading that makes replay or cost attribution opaque.

## Research Basis

- Public skill tooling (e.g. `skills.sh`) frames skills as reusable agent
  capabilities installable through a shared ecosystem and CLI, with global and
  agent-specific installation, update checks, and discovery.
- Skill availability does not guarantee useful skill use; skill value depends
  on model, harness, task, quality, and governance — admission and value
  evaluation must be evidence-based, not popularity-based.
- Sequel standards require no dead code, no legacy hacks, no duplicate owners,
  no unsupported compatibility shims, and no untested completion claims.

## Ordered Slices

### Slice 0 - Catalog Consolidation

Status: Complete.

Frontend and backend catalogs were consolidated, obsolete duplicates retired,
and recursive native projection with drift/backups implemented. Remaining local
repairs are defects, not an open architecture slice.

### Slice 1 - Skill Evidence Contract

Status: In progress.

Define identity, source, version, compatibility, freshness, resource health,
context cost, trust, and stable diagnostics. Model task-to-skill
recommendation as evidence produced by Kiln, not as a user-maintained
prompt-routing skill. Surfaces must render shared evidence and fail closed for
missing, stale, oversized, or broken capabilities; no harness-specific skill
classifier may own policy independently.

The first implementation increment defines provider-neutral native catalog
visibility (`implicit`, `explicit-only`, and `disabled`), translates it through
capability-aware harness adapters, and exposes translation evidence in shared
status. Shared `.agents` and plugin inventory, measured per-harness catalog
budgets, duplicate/source evidence, and task-admission evaluation remain in
this slice until their promotion gates are met. Research basis:
[`../research/34-skill-catalog-governance-2026.md`](../research/34-skill-catalog-governance-2026.md).

The second increment inventories canonical, shared-agent, native, system, and
enabled-plugin sources without changing admission. It assigns portable source
identity, hashes complete packages, distinguishes expected managed projections
from independent duplicates and collisions, and reports exact per-harness
description bytes. Native token budgets remain unknown unless a versioned
harness or tokenizer authority supplies comparable evidence.

### Slice 2 - Task Admission

Status: Queued behind Slice 1.

Model task-to-skill recommendation and admission without prompt routing
tables. Record why a skill was admitted or omitted and keep parent/managed-child
semantics aligned.

### Slice 3 - Value Evaluation

Status: Research after Slice 2.

Compare representative tasks with and without a skill. Attribute quality, tool
trajectory, latency, token use, environment, and operator intervention across
engineering, research, UI, document, marketing, or benchmark workflows. Do not
promote from popularity or anecdote — evals must compare with and without the
skill on realistic tasks, and public claims require reproducible fixtures.

### Slice 4 - Governed Operations

Status: Queued behind evaluation.

Add doctor/status and explicit curated install/update/remove workflows.
Provide native skill discovery/recommendation so operators can ask "what
capability should handle this?" without relying on stale harness-local router
prompts. Preserve local modifications, backups, inspectability, and exact
ownership; no automatic update may overwrite locally modified operator skills
without evidence and explicit approval.

### Slice 5 - Repo Context Authoring

Status: Planned.

Scout repository facts and propose canonical `.kiln/project-context.md`
changes; projection to `AGENTS.md`/`CLAUDE.md` remains owned by normal sync.
The skill must not recommend direct manual edits to generated repo shims;
generated shims must remain traceable back to `.kiln/project-context.md` plus
active instruction profiles. Cover missing package-manager evidence, ambiguous
test commands, generated-file drift, and stale repo-shim status.

## Promotion Gates

- One provider-neutral contract owns skill evidence and admission.
- Skills never own stack versions, provider routing, permissions, or generated
  shims.
- Full skill content is loaded only after Roadmap 06 activation rules admit it.
- Inventory and health evidence are available from CLI and at least one
  operator surface.
- Skill admission is provider-neutral and harness-neutral.
- Broken-resource and oversized-skill checks are automated.
- Value evaluation can prove when a skill is worth its context cost.
- Operations are explicit, reversible, and preserve operator-owned changes.
- Canonical docs explain how Kiln uses skills to reduce cloned repos and large
  template piles.

## Verification

- Contract tests, link/resource fixtures, recursive projection/drift tests.
- Local skill inventory check and broken local Markdown link scan.
- Frontmatter validation for `name` and `description`.
- Cross-harness visibility tests for `.codex`, `.agents`, and repo-projected
  skills.
- Focused eval fixtures for any Kiln contract, CLI, Gateway, GUI, or TUI
  changes; workspace typecheck; `git diff --check`.

## Completion Criteria

Every supported surface can explain available, admitted, omitted, broken,
stale, and removable skills from shared evidence, and prompt context receives
only the smallest admitted capability. Operators can install or update curated
skills with evidence instead of guesswork. Agents receive fewer, better
instructions for the current job. Completed doctrine is promoted into
canonical architecture/operator docs, and this roadmap is deleted after
closeout.
