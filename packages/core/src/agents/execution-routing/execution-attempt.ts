import type { ExecutionAccountRef } from "./account-identity.js";

export type ExecutionAttemptPhase = "planned" | "leased" | "dispatching" | "committed" | "succeeded" | "failed" | "cancelled";

export interface ExecutionAttempt {
  readonly attemptId: string;
  readonly account: ExecutionAccountRef;
  readonly phase: ExecutionAttemptPhase;
}

export function createExecutionAttempt(input: { readonly attemptId: string; readonly account: ExecutionAccountRef }): ExecutionAttempt {
  if (input.attemptId.trim().length === 0) throw new TypeError("attemptId must not be empty.");
  return Object.freeze({ ...input, phase: "planned" });
}

/** Advances only the durable attempt lifecycle; terminal phases are irreversible. */
export function advanceExecutionAttempt(attempt: ExecutionAttempt, phase: ExecutionAttemptPhase): ExecutionAttempt {
  if (!isNextPhase(attempt.phase, phase)) {
    throw new Error(`Invalid ExecutionAttempt transition: ${attempt.phase} -> ${phase}.`);
  }
  return Object.freeze({ ...attempt, phase });
}

function isNextPhase(current: ExecutionAttemptPhase, next: ExecutionAttemptPhase): boolean {
  const isPreCommitTerminal = (next === "failed" || next === "cancelled")
    && (current === "planned" || current === "leased" || current === "dispatching");
  return isPreCommitTerminal
    || (current === "planned" && next === "leased")
    || (current === "leased" && next === "dispatching")
    || (current === "dispatching" && next === "committed")
    || (current === "committed" && (next === "succeeded" || next === "failed" || next === "cancelled"));
}
