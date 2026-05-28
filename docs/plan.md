# Background Managed Terminal Persistence Plan

Date: 2026-05-28

## Objective

Persist canonical terminal lifecycle events for background `managed_agent.start`
children when they finish naturally, even if no later `managed_agent.join`,
`managed_agent.cancel`, or GUI control is called. Preserve the same canonical
terminal persistence for runtime-owned startup failures that terminalize after
side-effected lease acquisition.

## Non-Goals

- No request-local timeout override or hidden wait shim.
- No GUI/TUI replay-only backfill.
- No legacy compatibility branch for missing canonical events.
- No local implementation of runtime budget admission or resource pagination.

## Implementation Slices

1. Completed: failing runtime tests
   - Add regression coverage in
     `packages/runtime/tests/gateway/managed-invocation-tool.test.ts` proving a
     background terminal event is appended and published before join.
   - Add regression coverage proving a side-effected lease-acquire failure in
     `managed_agent.start` records requested, started, and failed events without
     invoking the adapter.

2. Completed: runtime lifecycle notification
   - Add an explicit terminal observer to
     `RuntimeManagedAgentInvocationService` lifecycle options.
   - Notify exactly once after terminal finalization for success, failure,
     timeout, cancellation, stale, recovered, and compensated startup-failure
     states.
   - Keep the service ignorant of GUI/TUI persistence details.

3. Completed: runtime-tool sink publication
   - Have `managed_agent.start` register a terminal observer that appends the
     canonical terminal session event to the runtime session and publishes it to
     the configured `ManagedInvocationSessionEventSink`.
   - Reuse the existing terminal event helper so duplicate joins/cancels do not
     create duplicate lifecycle events.
   - Convert terminalized startup failures into structured `managed_agent.start`
     results with canonical session-event ids instead of dropping the transcript
     evidence behind a thrown runtime error.

4. Completed: documentation closeout
   - Update managed-agent architecture/research/roadmap docs with the completed
     behavior and timeout research conclusion.

## Verification

- Focused failing test before implementation:
  `bun test packages/runtime/tests/gateway/managed-invocation-tool.test.ts --test-name-pattern "background managed child"`
- Reviewer regression before implementation:
  `bun test packages/runtime/tests/gateway/managed-invocation-tool.test.ts --test-name-pattern side-effected`
  failed with a thrown `ManagedAgentRuntimeAdmissionError`.
- Focused regression after implementation:
  `bun test packages/runtime/tests/gateway/managed-invocation-tool.test.ts --test-name-pattern side-effected`
  passed.
- Managed invocation suite:
  `bun test packages/runtime/tests/gateway/managed-invocation-tool.test.ts`
  passed, 62 tests.
- Runtime package:
  `bun run --filter @kilnai/runtime test` passed, 177 files and 2,338 tests
  with five live-test files skipped by design.
- Typecheck:
  `bun run typecheck` passed.
- Additional package gates:
  `bun run --filter @kilnai/cli test`,
  `bun run --filter @kilnai/gui test`, and
  `bun run --filter @kilnai/gateway-contracts test` passed.
- Final focused GUI cancellation check:
  `bun run --cwd packages/runtime test tests/gateway/gui-gateway.test.ts --testNamePattern cancel`
  passed with the stricter terminal-publish count assertion.
- Review:
  DDD validation and final code review reported no blocking findings after the
  side-effected startup-failure gap was fixed.

## Residual Risk

Terminal observer publication is asynchronous by design; sink failures must not
change child terminal state. Existing sink fanout handles persistence/live-relay
isolation, and regression tests prove canonical session events are recorded
before a later join and for terminalized startup failures.
