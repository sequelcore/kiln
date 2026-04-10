# Documentation Refactor Execution Plan

## Objective
Execute the documentation refactor defined in `docs/roadmap/documentation-refactor-plan.md` and turn the current mixed doc set into a modular, professional, and internally consistent documentation system for Kiln as a cybernetic control plane.

## Scope
This plan covers only documentation work in the current repository:
- root docs: `README.md`, `CLAUDE.md`, `STRATEGY.md`, `CONTRIBUTING.md`, `HOTFIX.MD`
- `docs/architecture.md`
- `docs/research/*`, including `docs/research/biological-kiln/*`
- `docs/guides/*`
- `docs/adr/*`
- `docs/configuration/*`
- `docs/sdk/*`
- `docs/README.md`, `docs/getting-started.md`, `docs/concepts.md`, `docs/faq.md`
- `docs/roadmap/*`

No runtime code changes are in scope.

## Workstreams
1. Taxonomy and naming freeze.
2. Architecture extraction and modularization.
3. Research synthesis and relocation.
4. Root doc rewrite.
5. Guide and ADR cleanup.
6. Final deletion, link audit, and consistency audit.

## Current Progress

Status snapshot as of 2026-04-10:

- Slice 1: completed
- Slice 2: substantially completed
- Slice 3: substantially completed
- Slice 4: completed
- Slice 5: in progress
- Slice 6: not started

## Execution Slices

### Slice 1: Freeze taxonomy
Dependencies: none.

Status: completed.

Deliverables:
- Create `docs/roadmap/README.md` as the index for roadmap documents.
- Final doc map for `docs/architecture/*`, `docs/research/*`, `docs/guides/*`, `docs/adr/*`, and `docs/roadmap/*`.
- Canonical terminology list for the new Kiln identity.
- File-by-file disposition for every current Markdown file.

Review gate:
- The plan has one destination per current doc.
- No old identity labels remain in the taxonomy.

Commit boundary:
- End Slice 1 with a self-contained docs planning commit or equivalent review checkpoint.

Deletion gate:
- None. No deletions before taxonomy is frozen.

### Slice 2: Extract architecture
Dependencies: Slice 1.

Status: substantially completed.

Progress recorded:
- modular architecture docs created under `docs/architecture/`
- `docs/architecture.md` reduced to a transitional entrypoint
- `docs/README.md` updated to point at the modular architecture

Deliverables:
- Split `docs/architecture.md` into modular files under `docs/architecture/`.
- Create `docs/architecture/README.md` as the entrypoint and index.
- Move identity, control model, subsystems, flows, memory, context governance, safety, coordination, tool execution, adaptation, and invariants into separate docs.
- Reduce or remove `docs/architecture.md` after links are updated.

Review gate:
- The architecture story is complete without reading the old monolith.
- The new modular docs preserve the canonical Kiln identity and control-plane model.

Commit boundary:
- End Slice 2 only when `docs/architecture/*` can stand as the active source of truth even if `docs/architecture.md` still exists temporarily as an entrypoint.

Deletion gate:
- Do not delete `docs/architecture.md` until the modular docs exist and the architecture index resolves all references.

### Slice 3: Synthesize research
Dependencies: Slice 1, Slice 2 naming is preferred but not strictly required.

Status: substantially completed.

Progress recorded:
- root-level research synthesis docs created under `docs/research/`
- key material from `docs/research/biological-kiln/*` and coordination research absorbed into root docs
- old research subtree still pending final deletion

Deliverables:
- Create root-level research docs under `docs/research/`, such as:
  - `docs/research/README.md`
  - `docs/research/kiln-research-synthesis.md`
  - `docs/research/cybernetic-foundations.md`
  - `docs/research/biological-mechanisms.md`
  - `docs/research/current-state-mapping.md`
- Move the useful content from `docs/research/biological-kiln/*` into the new root research docs.
- Consolidate `docs/research/coordination-intelligence.md` into the same root research set.
- Remove the `docs/research/biological-kiln/` subtree after its content is absorbed.

Review gate:
- The research root explains the mechanisms and the mapping to Kiln without depending on the old prompt-sequence folder.
- No final synthesis remains under `biological-kiln`.

Commit boundary:
- End Slice 3 only when `docs/research/*` can be read independently without relying on the old subtree for canonical synthesis.

Deletion gate:
- Delete `docs/research/biological-kiln/*` only after the content is fully absorbed into root research docs and cross-links are rewritten.

### Slice 4: Rewrite root docs
Dependencies: Slice 2, Slice 3.

Status: completed.

Progress recorded:
- `README.md` rewritten to the control-plane identity
- `CLAUDE.md` rewritten to align project contract and references
- `STRATEGY.md` rewritten into the long-term doctrine-aligned roadmap
- `docs/getting-started.md` and `docs/concepts.md` rewritten away from the old primitives/composites framing

Deliverables:
- Rewrite `README.md`, `CLAUDE.md`, and `STRATEGY.md` to the new Kiln identity.
- Rewrite `docs/README.md` so the documentation index matches the new structure.
- Decide and implement the final placement for `docs/getting-started.md`.
- Update `docs/concepts.md` so it does not conflict with the new architecture vocabulary.

Review gate:
- Root docs describe Kiln as a cybernetic control plane, not a meta-orchestrator.
- No entry doc still depends on the old framing.

Commit boundary:
- End Slice 4 only when a new reader can enter through root docs and land on the correct architecture and research paths without being sent through obsolete framing.

Deletion gate:
- Do not delete obsolete phrasing from the old docs until the rewritten versions are present and linked.

### Slice 5: Clean guides and ADRs
Dependencies: Slice 2, Slice 3, Slice 4.

Status: in progress.

Progress recorded:
- rewritten or demoted high-conflict guide/config surfaces:
  - `docs/guides/cli-wrapper.md`
  - `docs/guides/coordination-intelligence.md`
  - `docs/guides/multi-agent.md`
  - `docs/guides/plan-mode.md`
  - `docs/guides/domains.md`
  - `docs/configuration/app-yaml.md`
  - `docs/configuration/gateway-yaml.md`
- ADR cleanup and renumbering still pending
- remaining guide cleanup and final doc deletions still pending

Deliverables:
- Rewrite guides that still carry old terminology or mixed doctrine.
- Normalize the guide taxonomy so each guide is operational, not doctrinal.
- Apply terminology cleanup to `CONTRIBUTING.md`, `HOTFIX.MD`, `docs/faq.md`, `docs/configuration/app-yaml.md`, `docs/configuration/gateway-yaml.md`, `docs/sdk/react-hooks.md`, and `docs/sdk/studio.md`.
- Rework ADR titles and numbering to match the canonical architecture.
- Resolve the duplicate `ADR-002` files into one clean numbering sequence.

Review gate:
- Guides explain usage and operations only.
- ADRs are internally consistent and do not preserve obsolete identity language.

Commit boundary:
- End Slice 5 only when guides no longer act as shadow architecture docs and ADR numbering is stable.

Deletion gate:
- Remove superseded guide or ADR files only after replacement files exist and links are updated.

### Slice 6: Final cleanup
Dependencies: Slices 2-5.

Status: not started.

Deliverables:
- Delete superseded docs and empty placeholders.
- Update all internal links across root docs, `docs/*`, ADRs, and roadmap docs.
- Run a full consistency pass on terminology, file ownership, and cross-reference integrity.

Review gate:
- Every current Markdown file has a single intended state: keep, rewrite, split, merge, relocate, or delete.
- No parallel old/new narrative remains in active docs.

Commit boundary:
- End Slice 6 with a final documentation cleanup checkpoint after link and consistency audits pass.

Deletion gate:
- Final deletions happen only after the link audit and consistency audit pass.

## Rollback And Recovery
- If a slice fails review, stop at the slice boundary.
- Revert only the changes from the current slice commit; do not keep partial old/new docs in parallel.
- Restore the last known good doc state from git, then reapply the slice with narrower scope.
- If a deletion gate was crossed too early, recover by restoring the deleted file from git history, then repeat the slice with the missing replacement in place.

## Link Audit
Run after each major slice and again at the end:
- Verify all links in `README.md`, `CLAUDE.md`, `STRATEGY.md`, `docs/README.md`, `docs/architecture/*`, `docs/research/*`, `docs/guides/*`, and `docs/adr/*`.
- Check for broken links, stale paths, and references to deleted files.
- Verify that the docs index points only to active documents.

## Consistency Audit
Run after each major slice and again at the end:
- Check that Kiln identity is consistent across entry docs.
- Check that `meta-orchestrator`, legacy `Router` language, and other deprecated terms are removed from active framing.
- Check that architecture ownership is not duplicated across docs.
- Check that research, architecture, guides, and ADRs do not overlap in role.
- Check that the modular architecture docs cover the same concerns as the old monolith without preserving the monolith as a second source of truth.

## Definition Of Done
The documentation refactor is complete when:
- Kiln has one canonical identity in all entry docs.
- `docs/architecture/` is the active architecture source of truth.
- `docs/research/` contains the synthesized research at root level.
- `docs/guides/` is operational and terminology-clean.
- `docs/adr/` is normalized and current.
- No superseded doc remains active as a parallel source of truth.
- The full link audit and consistency audit pass.
