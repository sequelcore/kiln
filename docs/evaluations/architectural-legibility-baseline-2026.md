# Architectural Legibility Baseline 2026

Date: 2026-08-20
Scope: Kiln repository orientation and generated context
Evaluation type: deterministic repository audit; no live-model quality claim

## Baseline failures

- `.kiln/project-context.md` persisted package manager, scripts, workspaces, and
  documentation lists already owned by repository files. Its stored `test` and
  `typecheck` commands disagreed with live repository evidence, so the
  supposedly canonical context could misorient a fresh maintainer.
- Repo shims copied that persisted material, multiplying drift across Codex,
  Claude Code, and OpenCode entrypoints.
- `CONTRIBUTING.md` attributed TUI status to ADR-005, whose actual subject is the
  Memory Lattice. This was a discoverability failure with a false rationale.
- The active-research indexes omitted an admitted CI test-performance record,
  making the investigation harder to find.

## Candidate disposition

Project context version 2 stores only reviewed, repo-specific knowledge that
cannot be derived safely. Package manager, workspaces, scripts, and canonical
documents are read from their executable repository owners whenever a shim is
projected. Legacy version 1 context fails validation instead of silently
remaining a competing source. The false ADR attribution was removed and the
research index repaired.

Focused tests verify version admission, legacy rejection, live-fact rendering,
and consistent Codex/Claude/OpenCode projection. These checks establish source
ownership and deterministic projection, not human or model comprehension.

## Fresh-maintainer protocol

For future material architecture candidates, use a fresh supported session only
when uncertainty remains. Give it a bounded scenario and ask it to identify the
behavior owner and non-owner, inputs and outputs, authority, canonical versus
derived state, invariants, failure behavior, verification, change location, and
rationale. Record incorrect assumptions, unnecessary context inspected, turns
to orientation, and clarification requests. Repair the narrow canonical
artifact first; do not promote a permanent evaluator or documentation mandate
without measured lift.
