# Native Operator Surface Foundation Plan

Status: active.

## Objective

Start `docs/roadmap/02-native-operator-surface-foundation.md` with a bounded
contract-first slice. Establish shared native surface capability vocabulary
before scaffolding an Electron package.

## Scout Summary

- `@kilnai/gateway-contracts` is the shared boundary for GUI, TUI, SDK/widget,
  and future native surface contracts.
- `packages/gateway-contracts/src/frames.ts` currently has surface source
  labels for `cli`, `tui`, `gui`, `ide`, `gateway`, and `runtime`; it does not
  yet name `native`.
- `packages/gui/src/lib/ws-client.ts` duplicates that surface enum for inbound
  session-event validation.
- Browser session contracts already model snapshot and frame-stream transports,
  but not the native foundation capability vocabulary.
- Existing unrelated dirty files remain out of scope:
  `.kiln/kiln.yaml` and `packages/gui/tests/memory-lattice-panel.test.tsx`.

## Slice 1 - Shared Surface Capability Contract

Files:

- `packages/gateway-contracts/src/operator-surface-capability.ts`
- `packages/gateway-contracts/src/index.ts`
- `packages/gateway-contracts/src/frames.ts`
- `packages/gateway-contracts/tests/operator-surface-capability.test.ts`
- `packages/gui/src/lib/ws-client.ts`

Deliverables:

- Add shared operator surface kind vocabulary including `native`.
- Add capability snapshot schema for surface negotiation.
- Include native-first capabilities for gateway attach, session projection,
  browser host slot, native window lifecycle, and performance telemetry.
- Add helper functions for capability availability and unsupported states.
- Update existing session-event source validation to accept `native`.

Verification:

- `bun run --filter @kilnai/gateway-contracts test -- operator-surface-capability`
- `bun run --filter @kilnai/gateway-contracts test`
- `bun run typecheck`

Current results:

- Passed `bun run --filter @kilnai/gateway-contracts test -- operator-surface-capability`.
- Passed `bun run --filter @kilnai/gateway-contracts test`.
- Passed `bun run typecheck`.

## Out Of Scope For This Slice

- No `packages/native` scaffold yet.
- No Electron dependency yet.
- No embedded browser host implementation.
- No runtime gateway changes beyond shared contract vocabulary.
- No Rust/WASM/sidecar module.
