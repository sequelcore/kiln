# Recorder Roadmap Closeout

Status: completed on 2026-05-14.

## Objective

Retire the completed Agent QA Showcase Recorder roadmap by moving its stable
doctrine into canonical documentation, deleting the active roadmap file,
compacting the remaining roadmap numbers, and updating references.

## Scope

- Add canonical recorder architecture documentation under `docs/architecture/`.
- Update architecture and roadmap indexes to point at the canonical recorder
  doc.
- Delete the completed recorder roadmap file.
- Rename remaining roadmap files from `01-05` to `00-04`.
- Update filename and numeric references in roadmap and research docs.
- Commit only files related to this closeout and the completed recorder work.

## Non-Goals

- No implementation changes.
- No new roadmap scope.
- No changes to native browser or benchmark acceptance criteria beyond
  numbering/reference updates.
- No staging unrelated local configuration or unrelated test timeout edits.

## Verification

- Confirm no references remain to the retired recorder roadmap filename.
  - Passed on 2026-05-14.
- Confirm no references remain to old roadmap filenames after renumbering.
  - Passed on 2026-05-14.
- Confirm `docs/roadmap` contains only compacted active/deferred roadmap files
  plus `README.md`.
  - Passed on 2026-05-14.
- Run docs/reference checks and `git diff --check`.
  - Passed on 2026-05-14 with line-ending warnings only.
- Run focused recorder implementation tests.
  - `bun run --filter @kilnai/core test -- capture-manifest` passed on
    2026-05-14.
  - `bun run --filter @kilnai/runtime test -- recorder` passed on
    2026-05-14.
  - `bun run --filter @kilnai/gui test -- transcript` passed on 2026-05-14.
- Run project typecheck before commit.
  - Passed on 2026-05-14.
- Reviewer pass before commit.
  - Passed on 2026-05-14.
