# Embedded Browser Operator Surface Plan

Status: completed on 2026-05-14.

## Objective

Complete and retire the embedded browser operator surface roadmap by turning
the proven Electron `WebContentsView` host into the first native product
operator surface for embedded browser work.

## Scout Summary

- `@kilnai/native` owns the first real embedded browser operator surface.
- `@kilnai/gateway-contracts` already carries browser session state,
  `electron-webcontents` transport labels, operator input frames, and evidence
  event shapes.
- `@kilnai/gui` can parse `electron-webcontents` as projected browser state,
  but the real embedded browser view is native-only because it is an Electron
  child view, not a React component.
- The native host proof already loads a deterministic local page, dispatches
  pointer/text/wheel input, observes through CDP, and emits sanitized evidence.
- Existing unrelated dirty files remain out of scope:
  `.kiln/kiln.yaml` and `packages/gui/tests/memory-lattice-panel.test.tsx`.

## Implementation Slices

### Slice 1 - Native Operator Surface Contract

Files:

- `packages/native/src/shared/native-browser-operator-surface.ts`
- `packages/native/tests/native-boundary.test.ts`

Deliverables:

- Define the native browser region layout calculation.
- Define ownership/input admission rules for the operator surface.
- Define a closeout projection that shows embedded-browser transport, target,
  ownership, evidence, and release/resume state without inventing runtime truth.

### Slice 2 - Main Process Surface Controller

Files:

- `packages/native/src/main/embedded-browser-host.ts`
- `packages/native/src/main/embedded-browser-operator-surface.ts`
- `packages/native/src/main/main.ts`

Deliverables:

- Add explicit ownership transitions to the host adapter.
- Add runtime dispatch after release through the host control channel.
- Add a surface controller for open, resize, takeover, input, release, resume,
  state projection, evidence collection, and cleanup.
- Add `embedded-browser-surface:smoke` proof that uses the same controller.

### Slice 3 - Renderer Product Surface

Files:

- `packages/native/src/preload/native-api.ts`
- `packages/native/src/renderer/native-surface-app.tsx`
- `packages/native/src/renderer/styles.css`
- `packages/native/tsconfig.main.json`

Deliverables:

- Add a narrow preload bridge for native browser operations only.
- Render an embedded browser panel with real reserved host region, transport,
  ownership, session target, evidence status, and controls.
- Keep the renderer as an operator projection; it sends intents and displays
  state, while the Electron main process owns native host actions.

### Slice 4 - Canonical Docs And Roadmap Closeout

Files:

- `docs/architecture/operator-surfaces.md`
- `docs/architecture/developer-tools.md`
- `docs/changelog.md`
- `docs/research/14-live-browser-operator-surface.md`
- `docs/roadmap/README.md`
- `docs/roadmap/05-native-operator-cockpit-and-projection-performance.md`

Deliverables:

- Absorb stable embedded browser operator surface doctrine into canonical docs.
- Retire roadmap `04`; leave `05` deferred as the later high-density cockpit
  and projection-performance track.

## Verification

- Passed `bun run --cwd packages/native test`.
- Passed `bun run --cwd packages/native typecheck`.
- Passed `bun run --cwd packages/native build`.
- Passed `bun run --cwd packages/native smoke`.
- Passed `bun run --cwd packages/native browser-host:smoke`.
- Passed `bun run --cwd packages/native embedded-browser-surface:smoke`.
- Passed `bun run typecheck`.
- Passed `bun run test`.
- Passed `bun run build`.
- Passed `git diff --check`.

## Closeout

- Implemented the native embedded browser operator surface in `@kilnai/native`.
- Absorbed stable doctrine into canonical architecture, research, roadmap, and
  changelog documents.
- Retired `docs/roadmap/04-embedded-browser-operator-surface.md`; remaining
  native roadmap work is only the deferred `05` cockpit/performance experiment.
