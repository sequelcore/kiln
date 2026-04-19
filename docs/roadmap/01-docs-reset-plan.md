# Docs Reset Plan

This document is the canonical plan for the documentation reset. It replaces
the former split between a policy doc and a nearly identical execution-plan doc.

## Objective

Turn Kiln's mixed documentation tree into a single coherent system aligned to
the control-plane doctrine.

The plan covers:

- target information architecture
- file disposition rules
- slice order and dependencies
- review gates, deletion gates, and audits

## Scope

This plan covers documentation only:

- root docs: `README.md`, `CLAUDE.md`, `STRATEGY.md`, `CONTRIBUTING.md`,
  `HOTFIX.MD`
- `docs/architecture.md` and `docs/architecture/*`
- `docs/research/*`
- `docs/guides/*`
- `docs/configuration/*`
- `docs/sdk/*`
- `docs/adr/*`
- `docs/roadmap/*`

No runtime code changes are in scope.

## Principles

- One source of truth per concern.
- No legacy framing kept alive in parallel.
- No backward-compatibility narrative carried only out of sentiment.
- Research explains mechanisms; architecture defines the product; guides explain
  usage.
- Root docs must reflect the current identity, not historical labels.
- Superseded docs are deleted once replacement content exists and links are
  updated.

## Target Information Architecture

### Canonical doc roles

- `docs/architecture/*`: canonical architecture doctrine split by concern.
- `docs/research/*`: synthesized mechanism and mapping research rooted at
  `docs/research/`.
- `docs/guides/*`: operational workflows and usage.
- `docs/roadmap/*`: planning, sequencing, and delivery tracking.
- `docs/adr/*`: decisions only.

### Canonical outputs

- root docs: `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `STRATEGY.md`,
  `HOTFIX.MD`
- docs index: `docs/README.md`
- modular architecture under `docs/architecture/`
- synthesized research under `docs/research/`
- terminology-clean guides under `docs/guides/`
- normalized ADR set under `docs/adr/`
- numbered roadmap docs under `docs/roadmap/`

## Current Status

As of 2026-04-18:

- taxonomy and naming freeze completed
- modular architecture extraction substantially completed
- root-level research synthesis substantially completed
- root docs rewritten to the control-plane identity
- guide and config cleanup in progress
- ADR cleanup and final deletions still pending

## Execution Slices

### Slice 1: Freeze taxonomy

Dependencies: none.

Status: completed.

Deliverables:

- final documentation map
- canonical terminology list
- file-by-file disposition for active Markdown files
- roadmap index for the refactor artifacts

Exit criteria:

- every in-scope Markdown file has one declared fate
- no old identity labels remain in the active taxonomy

Deletion gate:

- no deletions before taxonomy is frozen

### Slice 2: Extract architecture

Dependencies: Slice 1.

Status: substantially completed.

Progress recorded:

- modular docs created under `docs/architecture/`
- `docs/architecture.md` reduced to a transitional entrypoint
- `docs/README.md` updated to point at the modular architecture

Exit criteria:

- the architecture story is complete without reading the old monolith
- `docs/architecture/*` stands as the active source of truth

Deletion gate:

- do not delete `docs/architecture.md` until modular docs exist and links are
  updated

### Slice 3: Synthesize research

Dependencies: Slice 1. Slice 2 naming preferred.

Status: substantially completed.

Progress recorded:

- root-level research synthesis created under `docs/research/`
- useful content from `docs/research/biological-kiln/*` absorbed into root docs
- old research subtree still pending final deletion

Exit criteria:

- no final synthesis remains under `biological-kiln`
- research is organized by theme, not by prompt sequence

Deletion gate:

- delete the old research subtree only after content is absorbed and links are
  rewritten

### Slice 4: Rewrite root docs

Dependencies: Slices 2 and 3.

Status: completed.

Progress recorded:

- `README.md`, `CLAUDE.md`, and `STRATEGY.md` rewritten to the control-plane
  identity
- `docs/getting-started.md` and `docs/concepts.md` rewritten away from the old
  framing

Exit criteria:

- root docs agree on Kiln identity
- no entry doc depends on the old framing

### Slice 5: Clean guides and ADRs

Dependencies: Slices 2 through 4.

Status: in progress.

Progress recorded:

- high-conflict guide and config surfaces rewritten or demoted
- guide taxonomy is cleaner, but final terminology cleanup remains
- ADR cleanup and numbering normalization are still pending

Exit criteria:

- guides explain usage and operations only
- ADR titles and numbering are consistent
- guides no longer act as shadow architecture docs

Deletion gate:

- remove superseded guide or ADR files only after replacement files exist and
  links are updated

### Slice 6: Final cleanup

Dependencies: Slices 2 through 5.

Status: not started.

Deliverables:

- delete superseded docs and empty placeholders
- update internal links across root docs, `docs/*`, ADRs, and roadmap docs
- run a final consistency audit

Exit criteria:

- every current Markdown file has one intended state
- no parallel old and new narrative remains

Deletion gate:

- final deletions happen only after the link audit and consistency audit pass

## Naming Rules

- Replace old names instead of aliasing them.
- Prefer control terms over metaphor terms.
- Use canonical names consistently across docs and code references.

Examples:

- `Router` -> `IngressGovernor`
- `ContextFormatter` -> `ContextGovernor`
- `ThresholdAllocator` -> `DemandAllocator`
- `CascadeController` -> `ChainGovernor`
- `TaskChannel` -> `TaskRegistry`
- `SwarmStore` -> `CoordinationStore`

## Audits

### Link audit

Run after each major slice and again at the end:

- root README links
- docs index links
- architecture cross-links
- research cross-links
- guide cross-links
- ADR references
- strategy references

### Consistency audit

Run after each major slice and again at the end:

- identity language is consistent across entry docs
- deprecated framing is removed from active docs
- architecture ownership is not duplicated
- research, architecture, guides, roadmap, and ADRs do not overlap in role

## Definition Of Done

The documentation reset is complete when:

- Kiln has one canonical identity across all entry docs
- `docs/architecture/` is the active architecture source of truth
- `docs/research/` contains the synthesized research at root level
- `docs/guides/` is operational and terminology-clean
- `docs/adr/` is normalized and current
- no superseded doc remains active as a parallel source of truth
- the link audit and consistency audit pass
