import type {
  SessionTokenUsageObservation,
  SessionTurnBudgetDecision,
  SessionTurnBudgetPolicy,
} from "@kilnai/core";

export interface RuntimeSessionTokenUsageReader {
  (sessionId: string): Promise<SessionTokenUsageObservation>;
}

export interface RuntimeSessionTurnBudgetAuthority {
  admit(sessionId: string): Promise<SessionTurnBudgetDecision>;
}

export class RuntimeSessionTurnBudgetService implements RuntimeSessionTurnBudgetAuthority {
  constructor(
    private readonly policy: SessionTurnBudgetPolicy,
    private readonly usageReader: RuntimeSessionTokenUsageReader,
  ) {}

  async admit(sessionId: string): Promise<SessionTurnBudgetDecision> {
    try {
      const observation = await this.usageReader(sessionId);
      if (!Number.isSafeInteger(observation.observedTokens) || observation.observedTokens < 0) {
        return unknownUsage();
      }
      if (observation.observedTokens >= this.policy.tokenLimit) {
        return {
          status: "denied",
          reason: "observed-at-or-above-limit",
          action: "stop",
          observation,
          message: "The session's observed token usage is at or above its configured pre-turn limit.",
        };
      }
      return { status: "admitted", reason: "observed-below-limit", observation };
    } catch {
      return unknownUsage();
    }
  }
}

function unknownUsage(): SessionTurnBudgetDecision {
  return {
    status: "denied",
    reason: "usage-unknown",
    action: "stop",
    message: "Session token usage could not be read; the configured pre-turn limit stops this turn.",
  };
}
