# Native Operator Surface Foundation Closeout Plan

Status: completed on 2026-05-14.

## Objective

Close `docs/roadmap/02-native-operator-surface-foundation.md` end to end by
shipping the native foundation, absorbing durable doctrine into canonical
architecture/ADR docs, and retiring the active roadmap file.

## Scout Summary

- `@kilnai/gateway-contracts` is the shared boundary for operator surface
  capabilities, session-event projection, theme projection, and renderer-facing
  presentation data.
- `@kilnai/native` must be a first-class surface over gateway contracts, not a
  wrapper around `@kilnai/gui` and not an importer of `@kilnai/core` or
  `@kilnai/runtime`.
- ADR-006 rejects Electron as the general web GUI substrate but already permits
  a focused native operator surface/browser-host exception when runtime
  ownership remains in gateway contracts.
- Existing unrelated dirty files remain out of scope:
  `.kiln/kiln.yaml` and `packages/gui/tests/memory-lattice-panel.test.tsx`.

## Delivered Slices

### Slice 1 - Shared Surface Capability Contract

Files:

- `packages/gateway-contracts/src/operator-surface-capability.ts`
- `packages/gateway-contracts/src/index.ts`
- `packages/gateway-contracts/src/frames.ts`
- `packages/gateway-contracts/tests/operator-surface-capability.test.ts`
- `packages/gui/src/lib/ws-client.ts`

Result:

- Added shared operator surface vocabulary including `native`.
- Added surface capability snapshots, unsupported-capability states, and helper
  functions.
- Updated session-event source validation to accept native-originated projected
  events.

### Slice 2 - Native Package Foundation

Files:

- `packages/native/package.json`
- `packages/native/tsconfig.json`
- `packages/native/tsconfig.main.json`
- `packages/native/tsconfig.renderer.json`
- `packages/native/vite.config.ts`
- `packages/native/index.html`
- `packages/native/src/main/main.ts`
- `packages/native/src/shared/native-surface.ts`
- `packages/native/src/renderer/main.tsx`
- `packages/native/src/renderer/native-surface-app.tsx`
- `packages/native/src/renderer/styles.css`
- `packages/native/tests/native-boundary.test.ts`

Result:

- Added `@kilnai/native` as an Electron main process plus React 19/Vite
  renderer.
- Hardened the Electron renderer with disabled Node integration, enabled
  context isolation, enabled sandbox, enabled web security, no preload bridge,
  denied popups, and local-only navigation until a governed runtime policy
  exists.
- Kept native shared logic in `src/shared/native-surface.ts` so main process,
  renderer, and tests use one capability/projection/telemetry implementation.
- Proved the package does not depend on `@kilnai/core` or `@kilnai/runtime`.
- Added an Electron smoke mode that opens the built native surface, records
  baseline telemetry, prints machine-readable proof, closes cleanly, and exits.

### Slice 3 - Workspace Wiring And Canonical Docs

Files:

- `package.json`
- `tsconfig.json`
- `bun.lock`
- `docs/adr/ADR-006-gui-stack-and-binding-contract.md`
- `docs/architecture/operator-surfaces.md`
- `docs/architecture/runtime-surfaces.md`
- `docs/changelog.md`
- `docs/roadmap/README.md`
- `docs/roadmap/03-embedded-browser-host-capability.md`
- `docs/roadmap/04-embedded-browser-operator-surface.md`
- `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`

Result:

- Added native to workspace `test`, `typecheck`, and `build`.
- Kept root TypeScript ambient types constrained to Bun so Electron transitive
  Node typings do not perturb Bun-oriented packages.
- Updated ADR-006 and architecture docs so Electron is accepted only for
  `@kilnai/native` and later embedded-browser host work, not as the web GUI
  substrate.
- Retired roadmap `02`; active/deferred sequencing now starts at roadmap `03`.

## Verification

- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-surface-capability`.
- Passed `bun run --filter @kilnai/gateway-contracts test`.
- Passed `bun run --cwd packages/native test`.
- Passed `bun run --cwd packages/native typecheck`.
- Passed `bun run --cwd packages/native build`.
- Passed `bun run --cwd packages/native smoke`.
- Passed `bun run typecheck`.
- Passed `bun run test`.
- Passed `bun run build`.

Final documentation-only edits still require `git diff --check` and a focused
post-closeout test/typecheck pass before commit.
