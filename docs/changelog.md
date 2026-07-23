# Changelog

This changelog tracks supported public changes beginning with the Kiln 2.0
baseline. Active and deferred execution tracks live in
[`docs/roadmap/`](roadmap/README.md); stable doctrine lives in
[`docs/architecture/`](architecture/README.md); curated release notes live in
[`docs/releases/`](releases/README.md).

## Unreleased - 3.0.0-beta.1 candidate

This section describes the current prerelease candidate in the repository. It
is not a publication record. Kiln `2.1.0` remains the supported public package
line until the beta tag, package graph, publish workflow, and registry evidence
have all been verified.

- Extended managed-agent execution with background and parallel lifecycle
  evidence, bounded result resources, recovery, dependency-aware orchestration,
  and governed heterogeneous teams.
- Added provider-neutral route eligibility, trusted-execution evidence, and
  action-effect governance across direct-provider and native-harness paths.
- Added an operator workspace projection, target-aware resource inspection, and
  shared managed-execution evidence for CLI, GUI, and TUI surfaces.
- Improved GUI execution continuity with canonical activity ownership,
  structured tool output, long-thread navigation, restored-session
  deduplication, and reduced-motion behavior.
- Promoted the operator-validated GUI execution presentation invariants to
  [`docs/architecture/gui-execution-presentation.md`](architecture/gui-execution-presentation.md);
  routine visual improvements no longer remain a release-debt roadmap track.
- Added deterministic CLI output contracts and provider-neutral benchmark,
  efficiency, cost, and verification evidence.
- Added governed native developer-tool resolution for `rg`, `fd`, and `jq`.

Candidate details and unresolved promotion gates are recorded in
[`docs/releases/3.0.0-beta.1.md`](releases/3.0.0-beta.1.md). The release
procedure is defined in
[`docs/operations/release.md`](operations/release.md).

## v2.1.0

- Published `@kilnai/gui` as a public static asset package.
- Made `@kilnai/cli` the public global install boundary for CLI, GUI, TUI,
  runtime, gateway contracts, and GUI assets.
- Moved runtime-owned GUI serving to the installed `@kilnai/gui` package and
  removed source-tree GUI discovery from production startup.
- Made `kiln gui` production mode the default from any working directory;
  `--dev` is now explicitly for source-tree GUI development.
- Promoted runtime and TUI internal package imports to direct package
  dependencies instead of peer-only runtime requirements.
- Added `@kilnai/gui` to the npm publish graph before runtime and CLI publish.
- Clarified that Native remains source-only experimental work in this release.

## v2.0.0

- Prepared the workspace for the `2.0.0` public baseline.
- Bumped public and private workspace package metadata to `2.0.0`.
- Aligned internal `@kilnai/*` peer and optional dependency ranges to the
  `2.0.0` package line.
- Kept reserved developer-tool platform packages private until Kiln ships
  actual vendored binaries.
- Reset curated release notes so `docs/releases/` starts at the supported
  `2.0.0` baseline.
- Restricted npm publishing to `v2.*` tags and added tag/package version
  validation before publish.
- Added `@kilnai/gateway-contracts` to the publish graph so public packages do
  not depend on an unpublished workspace package.

Kiln 2.0.0 is the first supported public baseline for the current
biocybernetic control-plane architecture.

### Verification

Release verification:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```
