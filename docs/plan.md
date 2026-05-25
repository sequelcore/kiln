# Slice 7O Plan - Gateway Stream Terminal Failure Parity

## Objective

Prove managed-child terminal failure evidence streams through the shared
gateway `session_event` frame boundary without GUI/TUI-local remapping,
dropping lifecycle evidence, or creating a second managed-agent projection.

## Non-Goals

- Do not add a surface-local lifecycle store.
- Do not change runtime managed invocation terminal semantics unless the
  gateway frame tests expose a real defect.
- Do not expand this slice into new live provider routes or real timeout/stale
  timers.
- Do not add compatibility shims for legacy worker paths.

## Scout Map

- `packages/runtime/src/gateway/operator-session-event-frame.ts` is the shared
  canonical-session-event to gateway-frame translator used by operator
  surfaces.
- `packages/runtime/src/gateway/gui-gateway.ts` forwards managed-agent control
  terminal evidence through that same frame translator.
- `packages/runtime/tests/gateway/operator-session-event-frame.test.ts`
  currently covers work-item adoption-gate frame enrichment but not terminal
  managed-child failure evidence.
- `packages/runtime/tests/gateway/gui-gateway.test.ts` currently covers
  managed-agent cancel and join control, but not gateway-stream parity for
  timed-out, stale, or ordinary failed managed children.
- `packages/gateway-contracts/tests/operator-cockpit-view-state.test.ts`
  already defines the shared projection oracle for `timed_out`, `stale`, and
  `failed` managed-agent attention states.

## Implementation Steps

1. Add tests in `packages/runtime/tests/gateway/operator-session-event-frame.test.ts`
   proving `toOperatorSessionEventFrame` preserves terminal managed-agent
   failure payloads, including `lifecycleState`, `errorCode`, diagnostics,
   result handoff resource URIs, and nested resource-lease evidence.
2. Add a deterministic GUI websocket integration regression in
   `packages/runtime/tests/gateway/gui-gateway.test.ts` that starts and joins
   synthetic managed children returning `timed_out`, `stale`, and `failed`
   records, then asserts streamed frames project through the shared cockpit
   view-state as the expected attention states.
3. Patch only shared gateway/frame or managed-invocation session-event code if
   the tests expose dropped evidence. Keep projection logic owned by
   `@kilnai/gateway-contracts`.
4. Update `docs/roadmap/01-background-parallel-agent-surface.md` with Slice 7O
   completion evidence after verification.

## Verification

```bash
bun run --cwd packages/runtime test -- tests/gateway/operator-session-event-frame.test.ts
bun run --cwd packages/runtime test -- tests/gateway/gui-gateway.test.ts
bun run --cwd packages/runtime test -- tests/session/managed-invocation-session-events.test.ts
bun run --cwd packages/gateway-contracts test -- tests/operator-cockpit-view-state.test.ts
bun run typecheck
```

## Residual Risk

This slice hardens deterministic gateway frame parity for terminal failure
states. It does not run real provider timeout/stale timers or fully matrix
every pre-invocation unavailable/denied route over websocket transport; those
remain separate hardening targets if future slices expose a live-surface gap.
