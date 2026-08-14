/** A local, pre-turn observation policy. It is neither provider quota nor spend. */
export interface SessionTurnBudgetPolicy {
  readonly tokenLimit: number;
  readonly action: "stop";
}

export interface SessionTokenUsageObservation {
  readonly observedTokens: number;
  readonly source: string;
  readonly capturedAt?: string;
}

export type SessionTurnBudgetDecision =
  | {
    readonly status: "admitted";
    readonly reason: "observed-below-limit";
    readonly observation: SessionTokenUsageObservation;
  }
  | {
    readonly status: "denied";
    readonly reason: "observed-at-or-above-limit" | "usage-unknown";
    readonly action: "stop";
    readonly message: string;
    readonly observation?: SessionTokenUsageObservation;
  };
