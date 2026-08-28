import type { SessionTurnOutcome } from "@kilnai/core";
import type { RuntimeTurnTerminalDisposition } from "@kilnai/core/agents";
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

const TEST_CONVERGENCE_POLICY = {
  policyId: "test-policy",
  configurationHash: `sha256:${"0".repeat(64)}`,
  providerRequests: 10,
  toolRounds: 10,
  toolCalls: 10,
  cumulativeInputTokens: 10_000,
  elapsedMs: 60_000,
  activeMs: 60_000,
  recoveryAttempts: 10,
  consecutiveNoProgressSteps: 3,
} as const;

/** Minimal portable dispositions for projection tests that do not own Runtime policy. */
export function canonicalTurnDisposition(
  outcome: "completed",
): Extract<RuntimeTurnTerminalDisposition, { readonly dispositionReason: "completion_eligible" }>;
export function canonicalTurnDisposition(outcome: SessionTurnOutcome): RuntimeTurnTerminalDisposition;
export function canonicalTurnDisposition(outcome: SessionTurnOutcome): RuntimeTurnTerminalDisposition {
  switch (outcome) {
    case "completed":
      return {
        outcome,
        dispositionReason: "completion_eligible",
        completion: {
          obligations: [],
          producerEvidence: [],
          eligibility: { status: "eligible" },
        },
        convergence: {
          policy: TEST_CONVERGENCE_POLICY,
          progressEvidence: [],
        },
      };
    case "failed":
      return { outcome, dispositionReason: "runtime_failure" };
    case "cancelled":
      return { outcome, dispositionReason: "operator_cancelled" };
    case "paused":
      return { outcome, dispositionReason: "session_not_active" };
  }
}

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
