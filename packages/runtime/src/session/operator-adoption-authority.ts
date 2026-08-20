import type {
  CanonicalOperatorAdoptionDecisionEvent,
  CanonicalSessionEvent,
  CanonicalTurnIdentity,
  CanonicalTurnId,
  OperatorAdoptionDecisionAuthority,
} from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";
import {
  appendCanonicalOperatorAdoptionDecision,
  resolveCanonicalTurnIdentity,
} from "./runtime-session-event-ledger.js";

/**
 * Durable sink owned by the surface that owns the transcript. Runtime policy
 * may allocate the decision, but it must not invent an in-memory persistence
 * substitute for the canonical replay source.
 */
export type OperatorAdoptionDecisionPersistence = (
  event: CanonicalOperatorAdoptionDecisionEvent,
) => void | Promise<void>;

/** Runtime-owned productive-surface binding for adoption and replay. */
export interface OperatorAdoptionRuntimeBinding {
  readonly persist: OperatorAdoptionDecisionPersistence;
  readonly actorId?: string;
  readonly replayCanonicalSessionEvents?: (
    sessionId: string,
  ) => Promise<readonly CanonicalSessionEvent[]>;
}

export interface PreparedOperatorAdoptionTurn {
  readonly turnId: CanonicalTurnId;
  readonly turnOrdinal: number;
  readonly correlationId?: string;
  readonly operatorAdoptionDecision: OperatorAdoptionDecisionAuthority;
  readonly event: CanonicalOperatorAdoptionDecisionEvent;
}

/**
 * Allocates or reuses one canonical operator turn, appends its runtime-owned
 * adoption authority, and waits for the durable transcript write before the
 * caller can enter a model/tool round.
 */
export async function prepareOperatorAdoptionTurn(input: {
  readonly session: RuntimeSession;
  readonly actorId: string;
  readonly correlationId?: string;
  /** Identity allocated by the admission seam, preventing a second ordinal allocation. */
  readonly identity?: CanonicalTurnIdentity;
  readonly persist: OperatorAdoptionDecisionPersistence;
}): Promise<PreparedOperatorAdoptionTurn> {
  const identity = input.identity ?? resolveCanonicalTurnIdentity(input.session, input.correlationId);
  const event = appendCanonicalOperatorAdoptionDecision({
    session: input.session,
    turnId: identity.turnId,
    actorId: input.actorId,
    correlationId: identity.correlationId,
  });
  await input.persist(event);
  return {
    ...identity,
    operatorAdoptionDecision: {
      ownerSessionId: event.ownerSessionId,
      operatorTurnId: event.operatorTurnId,
      contractAuthority: event.contractAuthority,
      decisionId: event.decisionId,
    },
    event,
  };
}

/**
 * A narrow adapter for non-governed callers that still need to type-check a
 * canonical event sink. It deliberately rejects use instead of pretending
 * that the RuntimeSession map is durable.
 */
export function requireOperatorAdoptionDecisionPersistence(
  persist: OperatorAdoptionDecisionPersistence | undefined,
): OperatorAdoptionDecisionPersistence {
  if (!persist) {
    throw new Error(
      "Governed operator turns require a durable transcript-backed adoption decision sink.",
    );
  }
  return persist;
}

export function isGovernedGoalToolName(toolName: string): boolean {
  return toolName === "goal.create"
    || toolName === "goal.bounded_work_contract.supersede";
}

export function hasGovernedGoalTools(input: {
  readonly toolAllowlist?: ReadonlySet<string>;
  readonly additionalTools?: readonly { readonly name: string }[];
  readonly builtinToolNames?: Iterable<string>;
}): boolean {
  for (const name of input.toolAllowlist ?? []) {
    if (isGovernedGoalToolName(name)) return true;
  }
  for (const tool of input.additionalTools ?? []) {
    if (isGovernedGoalToolName(tool.name)) return true;
  }
  for (const name of input.builtinToolNames ?? []) {
    if (isGovernedGoalToolName(name)) return true;
  }
  return false;
}
