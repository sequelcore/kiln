import type { BoundedWorkAdoptionAuthority } from "../work-governance/bounded-work-contract.js";

const canonicalTurnIdBrand = Symbol("kiln.canonical-turn-id");

/** Internal turn identity used for authority and replay. */
export type CanonicalTurnId = string & { readonly [canonicalTurnIdBrand]: "CanonicalTurnId" };

export interface CanonicalTurnIdentity {
  readonly turnId: CanonicalTurnId;
  readonly turnOrdinal: number;
  readonly correlationId?: string;
}

export function canonicalTurnId(sessionId: string, turnOrdinal: number): CanonicalTurnId {
  const normalizedSessionId = requireIdentityPart(sessionId, "sessionId");
  if (!Number.isSafeInteger(turnOrdinal) || turnOrdinal < 1) {
    throw new Error("Canonical turn ordinal must be a positive integer.");
  }
  return `${normalizedSessionId}:turn:${turnOrdinal}` as CanonicalTurnId;
}

export function parseCanonicalTurnId(value: string, sessionId: string): number | undefined {
  const prefix = `${requireIdentityPart(sessionId, "sessionId")}:turn:`;
  if (!value.startsWith(prefix)) return undefined;
  const ordinalText = value.slice(prefix.length);
  if (!/^\d+$/u.test(ordinalText)) return undefined;
  const ordinal = Number(ordinalText);
  return Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : undefined;
}

export function deterministicOperatorAdoptionDecisionId(
  sessionId: string,
  turnId: CanonicalTurnId,
): string {
  return `${requireIdentityPart(sessionId, "sessionId")}:operator-adoption:${turnId}`;
}

export interface OperatorAdoptionDecisionAuthority {
  readonly ownerSessionId: string;
  readonly operatorTurnId: CanonicalTurnId;
  readonly contractAuthority: BoundedWorkAdoptionAuthority;
  readonly decisionId: string;
}

export function createOperatorAdoptionDecisionAuthority(input: {
  readonly ownerSessionId: string;
  readonly operatorTurnId: CanonicalTurnId;
  readonly actorId: string;
}): OperatorAdoptionDecisionAuthority {
  const ownerSessionId = requireIdentityPart(input.ownerSessionId, "ownerSessionId");
  const actorId = requireIdentityPart(input.actorId, "actorId");
  const decisionId = deterministicOperatorAdoptionDecisionId(ownerSessionId, input.operatorTurnId);
  return {
    ownerSessionId,
    operatorTurnId: input.operatorTurnId,
    decisionId,
    contractAuthority: { kind: "operator", actorId, decisionId },
  };
}

function requireIdentityPart(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must be a non-empty string.`);
  return normalized;
}
