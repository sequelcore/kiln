---
version: "1"
source: deterministic-repo-scout
projectName: kiln
packageManager: bun
scripts:
  build: bun run --filter '*' build
  test: bun run --filter @kilnai/gateway-contracts test && bun run --filter
    @kilnai/core test && bun run --filter @kilnai/runtime test && bun run
    --filter @kilnai/cli test && bun run --filter @kilnai/react test && bun run
    --filter @kilnai/widget test && bun run --filter @kilnai/tui test && bun run
    --filter @kilnai/native test && bun run --filter @kilnai/studio test && bun
    run --filter @kilnai/gui test
  test:e2e: bun run --cwd packages/gui test:e2e
  test:managed-agents:live: vitest run packages/runtime/tests/managed-agent/*.live.test.ts --maxWorkers=1
  typecheck: tsc -b packages/gateway-contracts packages/core packages/runtime
    packages/sdk packages/cli packages/tui packages/native && tsc -p
    packages/widget/tsconfig.json --noEmit && tsc -p
    packages/studio/tsconfig.json --noEmit && tsc -p packages/gui/tsconfig.json
    --noEmit
workspacePackages:
  - packages/*
canonicalDocs:
  - README.md
  - docs/architecture/README.md
  - docs/architecture/engineering-standards.md
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
- `test`: `bun run --filter @kilnai/gateway-contracts test && bun run --filter @kilnai/core test && bun run --filter @kilnai/runtime test && bun run --filter @kilnai/cli test && bun run --filter @kilnai/react test && bun run --filter @kilnai/widget test && bun run --filter @kilnai/tui test && bun run --filter @kilnai/native test && bun run --filter @kilnai/studio test && bun run --filter @kilnai/gui test`
- `test:e2e`: `bun run --cwd packages/gui test:e2e`
- `test:managed-agents:live`: `vitest run packages/runtime/tests/managed-agent/*.live.test.ts --maxWorkers=1`
- `typecheck`: `tsc -b packages/gateway-contracts packages/core packages/runtime packages/sdk packages/cli packages/tui packages/native && tsc -p packages/widget/tsconfig.json --noEmit && tsc -p packages/studio/tsconfig.json --noEmit && tsc -p packages/gui/tsconfig.json --noEmit`

## Canonical References

- README.md
- docs/architecture/README.md
- docs/architecture/engineering-standards.md
- docs/research/README.md
- docs/roadmap/README.md

## Agent Review Notes

Add governed repo-specific notes here after review. Keep them factual,
durable, and backed by repository evidence.
