---
name: repo-context-review
description: Review generated Kiln project context against real repository evidence before adoption or sync.
tools:
  - read
  - grep
  - glob
  - bash
tags:
  - kiln
  - project-context
  - repo-shims
---

# Repo Context Review

Use this skill when a parent asks for project context adoption, repo instruction
generation, or review of generated `AGENTS.md` / `CLAUDE.md` shims.

## Workflow

1. Inspect deterministic evidence first:
   - `kiln project scout --json`
   - `package.json`
   - canonical docs listed by the scout output
2. Compare `.kiln/project-context.md` against that evidence.
3. Report only durable repo facts, not personal workflow preferences.
4. Recommend changes to `.kiln/project-context.md` when evidence is missing or
   misleading.
5. Do not edit generated `AGENTS.md` or `CLAUDE.md` directly. They are
   projections.

## Review Criteria

- Project name, package manager, scripts, workspaces, and canonical docs match
  the repository.
- Guidance points to canonical architecture/docs instead of duplicating them.
- No local absolute paths, secrets, machine-specific state, or legacy provider
  instructions are introduced.
- Any proposed addition is backed by a file path, script, or architecture doc.

## Output

Return:

- `status`: `valid`, `needs_changes`, or `blocked`
- `evidence`: concise file/script references
- `recommendedChanges`: concrete edits for `.kiln/project-context.md`
- `projectionImpact`: whether `kiln sync --repo-shims` should be rerun
