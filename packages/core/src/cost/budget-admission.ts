export type BudgetAdmissionSubject = "runtime-session-turn" | "managed-orchestration";

export interface BudgetRouteBudget {
  readonly providerId: string;
  readonly dailyTokenCeiling: number | null;
  readonly onCeiling?: "fallback" | "stop";
}

export interface BudgetAdmissionPolicy {
  readonly enabled: boolean;
  readonly routeBudgets: readonly BudgetRouteBudget[];
}

export interface BudgetAdmissionRouteCandidate {
  readonly routeId?: string;
  readonly providerId: string;
  readonly model?: string;
}

export interface BudgetUsageSnapshot {
  readonly providerId: string;
  readonly tokensUsed: number;
  readonly source: string;
  readonly capturedAt?: string;
}

export interface BudgetAdmissionRequest {
  readonly subject: BudgetAdmissionSubject;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly routeCandidates: readonly BudgetAdmissionRouteCandidate[];
}

export interface BudgetAdmissionRouteDecision {
  readonly route: BudgetAdmissionRouteCandidate;
  readonly status: "within_budget" | "over_budget";
  readonly tokensUsed: number;
  readonly ceiling: number | null;
}

export type BudgetAdmissionDecision =
  | {
    readonly status: "admitted";
    readonly reason: "budget-disabled" | "route-within-budget";
    readonly admittedRoutes: readonly BudgetAdmissionRouteCandidate[];
    readonly usageSnapshots: readonly BudgetUsageSnapshot[];
    readonly routeDecisions?: readonly BudgetAdmissionRouteDecision[];
  }
  | {
    readonly status: "denied";
    readonly reason: "usage-unavailable" | "all-routes-over-budget" | "no-route-candidates";
    readonly missingCapabilities: readonly string[];
    readonly usageSnapshots: readonly BudgetUsageSnapshot[];
    readonly routeDecisions: readonly BudgetAdmissionRouteDecision[];
    readonly message?: string;
  };
