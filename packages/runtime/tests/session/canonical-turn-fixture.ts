import type { CanonicalSessionEvent } from "@kilnai/core/events";
import type { RuntimeSession } from "../../src/session/runtime-session.js";
import {
  CanonicalTurnLifecycle,
  type CanonicalTurnTerminalInput,
  type CapturedRuntimeLedgerEvent,
  type RuntimeContinuitySnapshot,
} from "../../src/session/runtime-session-event-ledger.js";

export type CanonicalTurnFixtureInput = CanonicalTurnTerminalInput & {
  readonly session: RuntimeSession;
  readonly executionRouteId?: string;
  readonly turnId?: string;
  readonly channel: string;
  readonly userMessageContent: string;
  readonly turnStartedAt: Date;
  readonly continuity: RuntimeContinuitySnapshot;
  readonly runtimeEvents: readonly CapturedRuntimeLedgerEvent[];
};

/**
 * Drives the production lifecycle owner for ledger projection tests. Keeping
 * this adapter in tests prevents a second synchronous event authority from
 * surviving after Runtime adopted incremental start/progress/terminal writes.
 */
export async function projectCanonicalTurnForTest(
  input: CanonicalTurnFixtureInput,
): Promise<readonly CanonicalSessionEvent[]> {
  const before = input.session.sessionEvents.length;
  const lifecycle = new CanonicalTurnLifecycle({
    session: input.session,
    ...(input.turnId ? { turnId: input.turnId } : { turnId: `${input.session.id}:turn:1` }),
    channel: input.channel,
    userMessageContent: input.userMessageContent,
    turnStartedAt: input.turnStartedAt,
    continuity: input.continuity,
    ...(input.executionRouteId ? { executionRouteId: input.executionRouteId } : {}),
  });
  await lifecycle.start();
  await lifecycle.appendRuntimeEvents(input.runtimeEvents);
  const {
    session: _session,
    executionRouteId: _executionRouteId,
    turnId: _turnId,
    channel: _channel,
    userMessageContent: _userMessageContent,
    turnStartedAt: _turnStartedAt,
    continuity: _continuity,
    runtimeEvents: _runtimeEvents,
    ...terminal
  } = input;
  await lifecycle.settle(terminal);
  return input.session.sessionEvents.slice(before);
}
