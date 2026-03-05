import { KilnError } from "@kilnai/core";

export type SessionMode = "ai_active" | "queued" | "human_active" | "resolved";

const VALID_TRANSITIONS: ReadonlyMap<SessionMode, readonly SessionMode[]> = new Map([
  ["ai_active", ["queued", "human_active"]],
  ["queued", ["human_active", "ai_active"]],
  ["human_active", ["ai_active", "resolved"]],
  ["resolved", ["ai_active"]],
]);

export function isValidTransition(from: SessionMode, to: SessionMode): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed !== undefined && allowed.includes(to);
}

export function transitionSessionMode(from: SessionMode, to: SessionMode): SessionMode {
  if (!isValidTransition(from, to)) {
    throw new KilnError("INVALID_SESSION_TRANSITION", `Invalid session mode transition: ${from} -> ${to}`, {
      context: { from, to },
    });
  }
  return to;
}
