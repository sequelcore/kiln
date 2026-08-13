---
version: "1"
source: deterministic-repo-scout
projectName: kiln
packageManager: bun
scripts:
  build: bun run --filter '*' build
  test: bun run test
  test:e2e: bun run --cwd packages/gui test:e2e
  test:benchmark-verifiers:live: bun run --cwd packages/cli test:live
  test:managed-agents:live: bun run scripts/run-managed-agent-live-tests.ts
  typecheck: tsc -b packages/gateway-contracts packages/tools packages/core
    packages/runtime packages/sdk packages/cli packages/tui packages/native && tsc -p
    packages/widget/tsconfig.json --noEmit && tsc -p packages/gui/tsconfig.json
    --noEmit && tsc -p scripts/tsconfig.json --noEmit
workspacePackages:
  - packages/*
canonicalDocs:
  - README.md
  - docs/architecture/README.md
  - docs/architecture/core/engineering-standards.md
  - docs/research/README.md
  - docs/roadmap/README.md
---

# Project Context

This file is canonical Kiln project context. Edit this file or regenerate it
through `kiln project adopt`; do not put durable repo guidance directly in
`AGENTS.md` or `CLAUDE.md`.

## Project

- Name: kiln
- Package manager: bun
- Workspace package: `packages/*`

## Commands

- `build`: `bun run --filter '*' build`
- `test`: `bun run --filter @kilnai/gateway-contracts test && bun run --filter @kilnai/core test && bun run --filter @kilnai/runtime test && bun run --filter @kilnai/cli test && bun run --filter @kilnai/react test && bun run --filter @kilnai/widget test && bun run --filter @kilnai/tui test && bun run --filter @kilnai/native test && bun run --filter @kilnai/gui test`
- `test:e2e`: `bun run --cwd packages/gui test:e2e`
- `test:managed-agents:live`: `vitest run packages/runtime/tests/managed-agent/*.live.test.ts --maxWorkers=1`
- `typecheck`: `tsc -b packages/gateway-contracts packages/core packages/runtime packages/sdk packages/cli packages/tui packages/native && tsc -p packages/widget/tsconfig.json --noEmit && tsc -p packages/gui/tsconfig.json --noEmit`

## Canonical References

- README.md
- docs/architecture/README.md
- docs/architecture/core/engineering-standards.md
- docs/research/README.md
- docs/roadmap/README.md

## Agent Review Notes

Add governed repo-specific notes here after review. Keep them factual,
durable, and backed by repository evidence.

### No External Consumers

Kiln is published to npm and has no external consumers; the operator is the
only one. Breaking changes therefore need no migration shim, deprecation
window, or compatibility variant. Replace contracts outright and delete the old
path in the same change.

The operator's durable local state under `.kiln/` and `~/.kiln/` is the one
exception, and it is a data-migration question decided per change, not a reason
to keep an API compatibility layer. Discarding local state with no
future-useful evidence is an admitted outcome.

Canonical statement and full rules: `docs/architecture/core/engineering-standards.md`,
section "Consumer Surface".
