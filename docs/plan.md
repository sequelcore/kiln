# Embedded Browser Host Capability Closeout Plan

Status: completed on 2026-05-14.

## Objective

Close `docs/roadmap/03-embedded-browser-host-capability.md` by choosing and
proving the native embedded browser host substrate without building the full
operator browser product surface.

## Scout Summary

- `@kilnai/native` owns the native host proof.
- `@kilnai/gateway-contracts` owns cross-surface browser transport vocabulary.
- `@kilnai/gui` validates inbound browser session frames and must accept the
  same transport labels as gateway contracts.
- Runtime/browser authority remains in existing browser session contracts;
  native host code proves lifecycle, input dispatch, observation projection,
  and evidence shape, but does not own policy, session truth, provider routing,
  credentials, or replay.
- Existing unrelated dirty files remain out of scope:
  `.kiln/kiln.yaml` and `packages/gui/tests/memory-lattice-panel.test.tsx`.

## Delivered Slices

### Slice 1 - Browser Host Transport Contract

Files:

- `packages/gateway-contracts/src/frames.ts`
- `packages/gateway-contracts/tests/browser-session-state.test.ts`
- `packages/gui/src/lib/ws-client.ts`
- `packages/gui/tests/ws-client.test.ts`

Result:

- Added `electron-webcontents` to the shared browser transport union.
- Proved gateway-contract frames and GUI inbound parsing accept native host
  browser session state.

### Slice 2 - Native Host Boundary Helpers

Files:

- `packages/native/src/shared/native-surface.ts`
- `packages/native/src/shared/native-browser-host.ts`
- `packages/native/tests/native-boundary.test.ts`

Result:

- Marked `embedded-browser-host` available after the Electron proof.
- Added deterministic host policy, isolated ephemeral web preferences,
  navigation admission, gateway-shaped browser session projection, sanitized
  evidence projection, and ownership-gated runtime/operator action helpers.

### Slice 3 - Electron WebContentsView Proof

Files:

- `packages/native/src/main/embedded-browser-host.ts`
- `packages/native/src/main/main.ts`
- `packages/native/proof/browser-host-proof.html`
- `packages/native/package.json`

Result:

- Added an Electron `WebContentsView` host adapter.
- Denied popups, permission prompts, downloads, and unapproved navigation.
- Used isolated/sandboxed web preferences and smoke-only isolated user-data
  directories.
- Used Electron `webContents.debugger` for CDP observation and wheel dispatch.
- Added `browser-host:smoke` proof that loads a deterministic local page,
  dispatches pointer/text/wheel input, observes URL/title/viewport/scroll state,
  records `electron-webcontents` evidence, and shuts down cleanly.

### Slice 4 - Canonical Docs And Roadmap Closeout

Files:

- `docs/adr/ADR-006-gui-stack-and-binding-contract.md`
- `docs/architecture/README.md`
- `docs/architecture/agent-qa-showcase-recorder.md`
- `docs/architecture/developer-tools.md`
- `docs/architecture/operator-surfaces.md`
- `docs/changelog.md`
- `docs/research/14-live-browser-operator-surface.md`
- `docs/roadmap/README.md`
- `docs/roadmap/04-embedded-browser-operator-surface.md`
- `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`
- `packages/gateway-contracts/README.md`

Result:

- Absorbed stable host decision and security/evidence doctrine into canonical
  docs.
- Retired roadmap `03`; remaining native/browser sequence starts at roadmap
  `04`.

## Verification

- Passed `bun run --filter @kilnai/gateway-contracts test -- browser-session-state`.
- Passed `bun run --filter @kilnai/gateway-contracts test`.
- Passed `bun run --filter @kilnai/gateway-contracts build`.
- Passed `bun run --cwd packages/gui test:run -- ws-client`.
- Passed `bun run --cwd packages/native test`.
- Passed `bun run --cwd packages/native typecheck`.
- Passed `bun run --cwd packages/native build`.
- Passed `bun run --cwd packages/native smoke`.
- Passed `bun run --cwd packages/native browser-host:smoke`.
- Passed `bun run typecheck`.
- Passed `bun run test`.
- Passed `bun run build`.
- Passed `git diff --check`.
