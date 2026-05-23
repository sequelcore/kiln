# Slice 5K Plan - Native Gateway-Mediated Managed-Agent Cancel

## Objective

Add native managed-agent cancellation as a gateway-mediated control request
over the existing native `/gui/ws` cockpit attach.

## Non-goals

- No native-local lifecycle mutation or cancellation evidence synthesis.
- No direct runtime-service construction from the native renderer.
- No new native-only cancellation contract or endpoint.
- No join, transcript paging, or adoption/diff workflow in this cut.
- No worktree/diff/adoption behavior before Slice 6 defines that contract.

## Surface Map

- Native gateway attach/control helper:
  `packages/native/src/renderer/native-gateway-cockpit.ts`
- Native renderer shell: `packages/native/src/renderer/native-surface-app.tsx`
- Native managed-agent panel:
  `packages/native/src/renderer/managed-agent-cockpit-panel.tsx`
- Native boundary tests: `packages/native/tests/native-boundary.test.ts`
- Native panel tests:
  `packages/native/tests/managed-agent-cockpit-panel.test.tsx`
- Roadmap: `docs/roadmap/01-background-parallel-agent-surface.md`,
  `docs/roadmap/README.md`

## Implementation Steps

1. Add failing native tests for typed cancel frame construction and panel
   enablement when a live control callback exists.
2. Add a native helper that creates the shared `managed_agent_control` cancel
   frame and fails closed on missing `sessionId` or `invocationId`.
3. Wire the native renderer to keep the existing cockpit WebSocket as the only
   control channel and send the typed cancel frame only while it is open.
4. Enable panel cancellation only when the live gateway control callback is
   present; otherwise keep disabled/read-only UI.
5. Keep native state updates sourced from gateway `session_event` frames and
   ignore acknowledgement frames for lifecycle projection.
6. Update roadmap Slice 5 status and remaining-work bullets.

## Verification

- Focused native boundary and panel tests.
- Native package typecheck/test/build.
- Full workspace typecheck/test/build plus `git diff --check` before closeout.
