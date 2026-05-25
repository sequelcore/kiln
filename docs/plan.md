## Slice 7I - Route Unavailable Presentation Parity

## Objective

Continue Slice 7 by making managed route-unavailable outcomes project as
structured, tool-accurate operator evidence before any child invocation starts.

## Decision

Treat route unavailability as a pre-invocation managed tool outcome, not as a
managed child lifecycle event. It must not create child session events,
resource-plane records, or cockpit child rows. It should still produce a
structured presentation intent that survives gateway/operator transcript
rendering and accurately names the managed tool that failed closed.

## Non-Goals

- Do not implement parent interruption semantics in this slice.
- Do not create a synthetic child invocation for unavailable routes.
- Do not add compatibility aliases for older result metadata.
- Do not expose raw route registry internals beyond the bounded failure reason.

## Surface Map

- Runtime managed-agent tool contract:
  - `packages/runtime/src/agents/managed-invocation/runtime-tool.ts`
  - `packages/runtime/tests/gateway/managed-invocation-tool.test.ts`
- Operator event presentation:
  - `packages/gateway-contracts/src/operator-event-presentation.ts`
  - `packages/gateway-contracts/tests/operator-event-presentation.test.ts`
- GUI transcript presentation:
  - `packages/gui/src/components/transcript.tsx`
  - `packages/gui/tests/transcript.test.tsx`
- Roadmap:
  - `docs/roadmap/01-background-parallel-agent-surface.md`

## Expected Behavior

- `managed_agent.invoke` and `managed_agent.start` unavailable-route failures
  return `metadata.status: "unavailable"` and a comparison-table
  `presentationIntent`.
- The presentation intent `source` matches the tool that failed closed.
- No child invocation session events are emitted for route-unavailable
  preflight failures.
- Operator and GUI transcript presentations render the structured unavailable
  row without leaking JSON envelopes or inventing lifecycle/resource state.

## Verification

- Add failing focused tests first.
- Run `bun run --filter @kilnai/runtime test -- tests/gateway/managed-invocation-tool.test.ts`.
- Run `bun run --filter @kilnai/gateway-contracts test -- tests/operator-event-presentation.test.ts`.
- Run `bun run --filter @kilnai/gui test -- tests/transcript.test.tsx`.
- Run `bun run typecheck`.
- Run `bun run build`.
- Run `bun run test`.
- Run `git diff --check`.
- Update the roadmap after code verification.
