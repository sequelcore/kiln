# Local Reference Workflow Results v1

Status: diagnostic-only, 2026-09-05.
Protocol and commands: [Local Reference Workflow v1](repository-analysis-local-protocol.md).
Owner: [Repository Analysis Evaluation](repository-analysis.md).

## Delivered workflow

`bun run research:references:local` now connects three opt-in actions:

- `save <tsconfig> <path> <line> <column>` analyzes a configured project, persists
  canonical evidence and returns a compact result with its handle and hash.
- `read <handle> <hash>` verifies integrity and returns the saved artifact,
  explicitly labeled historical. It makes no current-workspace claim.
- `check <handle> <hash>` verifies integrity, reruns the original query and
  compares the saved evidence with fresh evidence. Only complete, current,
  matching evidence earns a current verdict, valid at that check time.

The canonical CLI project-state resolver places artifacts beneath the private
project's `evidence/repository-analysis` directory. Runtime's file store,
Core's reversible service and context governor retain their existing roles.
The original raw query command remains available; the durable workflow is a
separate research entry point and has no production registration.

Every persisted evidence field participates in comparison except elapsed query
time and cache state. This includes workspace/revision/dirty state, source,
compiler/configuration/input identities, roots, actual locations, diagnostics
and limitations. Mismatches retain historical status and identify changed
top-level fields. Incomplete original evidence is never promoted by check.
Malformed or unavailable canonical evidence returns unavailable.

## Verification

The [real-package smoke report](../fixtures/repository-analysis/local-v1/first-run.json)
records separate processes for the resolver query under operator-appearance's
test tsconfig: save returned current, check returned current, and read returned
historical with an exact canonical hash. All three commands exited successfully.
Temporary XDG configuration storage exercised the private project resolver
without writing operator production state; it was checked and removed afterward.
The report retains outputs, but its temporary handles no longer resolve.

38 focused research tests and scripts typecheck pass. Five new workflow tests
cover separate read/check processes, private placement, unchanged evidence,
same-file mutation after an already-dirty save, changed compiler configuration,
new included source, wrong hashes, corrupted storage and incomplete originals.
Historical evidence remains retrievable and unchanged after source mutation.
Documentation validation and whitespace checks pass.

The initial unchanged-project test failed because live compiler option objects
can contain undefined properties that disappear in saved JSON. Both sides now
use their serialized JSON representation before comparison. Only timing/cache
fields are excluded; source/configuration identities are not weakened. The
failure occurred during development before the retained smoke collection.

## Limits and next decision

Rechecking requires a fresh compiler analysis, so this is not cheap freshness
validation or demonstrated task-efficiency improvement. Unrelated Git status
changes may conservatively mark an artifact historical. Current verdicts are
point-in-time and cannot prevent subsequent workspace edits. Durable retention
capacity remains bounded by the existing store; exhaustion can fail new saves.

One real-project smoke and synthetic mutation tests do not establish broad
language coverage, independent reproduction, concurrent-writer or crash safety,
Gateway integration, or automatic test selection. No provider requests ran.

The bounded local prototype now supports query, compact projection, durable
retrieval and restart-time reanalysis. The broader decision still requires the
owning research protocol's representative task comparison against search plus
targeted reads, including retrieval overhead and verified task outcomes. Any
provider-backed evaluation remains dependent on its existing baseline and live
authority. Production admission and eventual Criba replacement remain open.

Continuation: [task-comparison preparation](repository-analysis-task-comparison-readiness.md)
now provides five real-package pilot tasks and verified reference solutions.
