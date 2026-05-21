## Objective

Start Slice 1 of `docs/roadmap/01-background-parallel-agent-surface.md` by
making the managed child invocation lifecycle vocabulary runtime-owned,
explicit, and reusable across core contracts, runtime session events, and
gateway projections.

## Non-Goals

- Do not add `managed_agent.start/status/join/cancel/list` yet.
- Do not introduce a second lifecycle registry or surface-local store.
- Do not change foreground `managed_agent.invoke` call behavior.
- Do not implement worktree, sandbox, or port leases in this slice.

## Scout Summary

Owning bounded context:

- Core managed-invocation contract:
  `packages/core/src/agents/managed-invocation/index.ts`
- Runtime managed-invocation adapters and session event emission:
  `packages/runtime/src/agents/managed-invocation/*`
- Shared session event contract:
  `packages/core/src/events/session-event.ts`
- Gateway/operator projections:
  `packages/gateway-contracts/src/operator-event-presentation.ts`,
  `packages/gateway-contracts/src/operator-cockpit-projection.ts`

Current facts:

- `ManagedAgentInvocationRecord.lifecycleState` already exists, but its values
  mix request/admission and execution states:
  `requested`, `denied`, `admitted`, `started`, `completed`, `failed`,
  `cancelled`, `timed-out`, and `cleaned-up`.
- Runtime session events already emit managed invocation request, start, and
  terminal events through the session ledger.
- Gateway contracts already render managed invocation events from the shared
  session projection rather than a surface-local lifecycle store.

## First Slice

1. Add a canonical managed child lifecycle state set in core:
   `pending`, `starting`, `running`, `waiting_for_approval`, `completed`,
   `failed`, `timed_out`, `cancelled`, `stale`, and `recovered`.
2. Keep `ManagedAgentInvocationRecord.lifecycleState` as the single lifecycle
   field, but validate it against the canonical set.
3. Update runtime adapters and event mapping from `timed-out` to `timed_out`.
4. Keep foreground `managed_agent.invoke` producing the same requested,
   started, and terminal session events.
5. Update focused tests first, then production code.

## Test Plan

Focused tests:

```bash
bun run --cwd packages/core test -- tests/managed-agent/invocation-contracts.test.ts
bun run --cwd packages/runtime test -- tests/session/managed-invocation-session-events.test.ts
```

Broader verification:

```bash
bun run --filter @kilnai/core typecheck
bun run --filter @kilnai/runtime typecheck
git diff --check
```

## Risks

- `timed-out` appears in runtime, CLI, GUI, and TUI tests for other status
  domains. This slice must only change managed invocation lifecycle state, not
  unrelated turn outcome or session persistence status strings.
- Session event names remain stable for cross-surface compatibility. This
  slice changes lifecycle evidence vocabulary, not event kind names.
- Gateway cockpit currently projects status from event kinds; deeper read-only
  lifecycle summaries belong to a later Slice 1 increment if they require new
  public contract shape.
