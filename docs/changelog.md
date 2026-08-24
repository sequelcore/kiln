# Changelog

This changelog separates current unreleased source changes from historical
public releases beginning with the Kiln 2.0 baseline. Active and deferred
execution tracks live in
[`docs/roadmap/`](roadmap/README.md); stable doctrine lives in
[`docs/architecture/`](architecture/README.md); curated release notes live in
[`docs/releases/`](releases/README.md).

## Unreleased source

This section describes current source behavior. It is not a release note or
publication record. The former `3.0.0-beta.1` candidate was not published and
is preserved as historical prerelease evidence. No supported installable
release currently represents this repository state; rebranding, new package
coordinates, additional live validation, and a new release decision remain
future work.

- Extended managed-agent execution with background and parallel lifecycle
  evidence, bounded result resources, recovery, dependency-aware orchestration,
  and governed heterogeneous teams.
- Added one Runtime-owned, user-scoped SQLite authority for managed economic
  commitment and shared Gateway/managed-job account capacity, affinity,
  dispatch fencing, settlement, recovery, and replay evidence.
- Added exact, expiring, single-use approval receipts for structured managed
  writes, consumed before provider effect and projected consistently through
  status, result, replay, CLI, GUI, TUI, SDK, and MCP surfaces.
- Added provider-neutral route eligibility, trusted-execution evidence, and
  action-effect governance across direct-provider and native-harness paths.
- Replaced legacy durable trusted-execution grants with a process-local,
  session-owned attended lease for interactive CLI `run` and foreground
  `managed_agent.invoke` on the Codex OAuth direct route. Runtime binds the
  exact invocation tree and rechecks Kiln-owned child effects before execution;
  genuine provider and operating-system attestation remains open, so this path
  does not yet make `current-verified` reachable.
- Added an operator workspace projection, target-aware resource inspection, and
  shared managed-execution evidence for CLI, GUI, and TUI surfaces.
- Improved GUI execution continuity with canonical activity ownership,
  structured tool output, long-thread navigation, restored-session
  deduplication, and reduced-motion behavior.
- Promoted the operator-validated GUI execution presentation invariants to
  [`docs/architecture/gui-execution-presentation.md`](architecture/surfaces/gui-execution-presentation.md);
  routine visual improvements no longer remain a release-debt roadmap track.
- Added deterministic CLI output contracts and provider-neutral benchmark,
  efficiency, cost, and verification evidence.
- Added governed native developer-tool resolution for `rg`, `fd`, and `jq`.
- Completed cross-harness integration across Codex, Claude Code, and OpenCode:
  canonical route admission and lifecycle evidence, native picker and
  control-plane projection, exact Claude entitlement and MCP proofs, a governed
  Codex-to-OpenCode write, listener lifetime and cancellation ownership, and
  recovery-safe native projection lifecycle. Retained provider outcomes remain
  secret-free and fail closed; the historical dispatch-fenced OpenCode outcome
  remains explicitly unknown and capacity-consuming because no authoritative
  terminal evidence exists.
- Completed the provider-neutral skill capability plane: portable package
  identity and recursive health evidence, fail-closed external exposure and
  task admission, progressive loading, paired value gates, reversible governed
  lifecycle operations, portable orchestration and research workflows, shared
  status surfaces, canonical cross-harness projection, and dated fresh-session
  acceptance evidence. The single-fixture pairs do not establish general
  quality or cost improvement.

Historical candidate details and its unresolved promotion gates are recorded in
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
