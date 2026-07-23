# 05 - Skill Capability Plane

Status: Active research track
Execution: Research - define shared skill evidence before automatic admission or operations.
Created: 2026-07-03

## Objective

Make skills small, versioned, inspectable, task-admitted capabilities rather
than duplicated routers, template dumps, or always-loaded prompt context.

## Ownership

This track owns skill identity, provenance, health, compatibility, trust,
recommendation, admission, and operations. Prompt loading after admission belongs
to Roadmap 06. Exact technology versions belong to Roadmap 07.

## Scope

- Built-in, user, project, and native-projected skill inventory.
- Recursive resource health, provenance, compatibility, freshness, and size.
- Provider-neutral task recommendation and admission evidence.
- Value evaluation and explicit install/update/remove operations.
- Repo-context authoring that updates canonical project context, never generated shims directly.

## Non-Goals

- No bulk installation or hidden loading.
- No harness-local router as policy owner.
- No exact framework/package version authority in skill prose.
- No deletion or overwrite of operator skills without explicit approval.

## Ordered Slices

### Slice 0 - Catalog Consolidation

Status: Complete.

Frontend and backend catalogs were consolidated, obsolete duplicates retired,
and recursive native projection with drift/backups implemented. Remaining local
repairs are defects, not an open architecture slice.

### Slice 1 - Skill Evidence Contract

Status: Research; next admissible work.

Define identity, source, version, compatibility, freshness, resource health,
context cost, trust, and stable diagnostics. Surfaces must render shared evidence
and fail closed for missing, stale, oversized, or broken capabilities.

### Slice 2 - Task Admission

Status: Queued behind Slice 1.

Model task-to-skill recommendation and admission without prompt routing tables.
Record why a skill was admitted or omitted and keep parent/managed-child semantics aligned.

### Slice 3 - Value Evaluation

Status: Research after Slice 2.

Compare representative tasks with and without a skill. Attribute quality, tool
trajectory, latency, token use, environment, and operator intervention. Do not
promote from popularity or anecdote.

### Slice 4 - Governed Operations

Status: Queued behind evaluation.

Add doctor/status and explicit curated install/update/remove workflows. Preserve
local modifications, backups, inspectability, and exact ownership.

### Slice 5 - Repo Context Authoring

Status: Planned.

Scout repository facts and propose canonical `.kiln/project-context.md` changes;
projection to `AGENTS.md`/`CLAUDE.md` remains owned by normal sync.

## Promotion Gates

- One provider-neutral contract owns skill evidence and admission.
- Skills never own stack versions, provider routing, permissions, or generated shims.
- Full skill content is loaded only after Roadmap 06 activation rules admit it.
- Operations are explicit, reversible, and preserve operator-owned changes.

## Verification

Contract tests, link/resource fixtures, recursive projection/drift tests,
cross-harness visibility tests, focused eval fixtures, workspace typecheck, and
`git diff --check`.

## Completion Criteria

Every supported surface can explain available, admitted, omitted, broken, stale,
and removable skills from shared evidence, and prompt context receives only the
smallest admitted capability.
