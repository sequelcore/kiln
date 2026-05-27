import type {
  BudgetAdmissionDecision,
  BudgetAdmissionPolicy,
  BudgetAdmissionRequest,
  BudgetAdmissionRouteCandidate,
  BudgetAdmissionRouteDecision,
  BudgetAdmissionSubject,
  BudgetRouteBudget,
  BudgetUsageSnapshot,
} from "@kilnai/core";

export interface RuntimeBudgetUsageReaderInput {
  readonly providerId: string;
  readonly subject: BudgetAdmissionSubject;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly routeId?: string;
  readonly model?: string;
}

export type RuntimeBudgetUsageReader = (
  input: RuntimeBudgetUsageReaderInput,
) => Promise<BudgetUsageSnapshot>;

export interface RuntimeBudgetAdmissionPort {
  admit(request: BudgetAdmissionRequest): Promise<BudgetAdmissionDecision>;
}

export interface RuntimeBudgetAdmissionServiceOptions {
  readonly policy: BudgetAdmissionPolicy;
  readonly usageReader?: RuntimeBudgetUsageReader;
}

export class RuntimeBudgetAdmissionService implements RuntimeBudgetAdmissionPort {
  private readonly policy: BudgetAdmissionPolicy;
  private readonly usageReader?: RuntimeBudgetUsageReader;

  constructor(options: RuntimeBudgetAdmissionServiceOptions) {
    this.policy = options.policy;
    this.usageReader = options.usageReader;
  }

  async admit(request: BudgetAdmissionRequest): Promise<BudgetAdmissionDecision> {
    if (!this.policy.enabled) {
      return {
        status: "admitted",
        reason: "budget-disabled",
        admittedRoutes: request.routeCandidates,
        usageSnapshots: [],
      };
    }

    if (request.routeCandidates.length === 0) {
      return {
        status: "denied",
        reason: "no-route-candidates",
        missingCapabilities: ["budget.route.available"],
        usageSnapshots: [],
        routeDecisions: [],
        message: "No route candidates are available for budget admission.",
      };
    }

    const routeBudgets = new Map(this.policy.routeBudgets.map((budget) => [budget.providerId, budget]));
    const finiteBudgetRoutes = request.routeCandidates.filter((route) =>
      hasFiniteBudget(route, routeBudgets.get(route.providerId))
    );
    if (finiteBudgetRoutes.length > 0 && !this.usageReader) {
      return usageUnavailable("Budget admission requires a live usage reader.");
    }

    const admittedRoutes: BudgetAdmissionRouteCandidate[] = [];
    const usageSnapshots: BudgetUsageSnapshot[] = [];
    const routeDecisions: BudgetAdmissionRouteDecision[] = [];

    for (const route of request.routeCandidates) {
      const routeBudget = routeBudgets.get(route.providerId);
      const ceiling = routeBudget?.dailyTokenCeiling ?? null;
      if (ceiling === null) {
        admittedRoutes.push(route);
        routeDecisions.push({
          route,
          status: "within_budget",
          tokensUsed: 0,
          ceiling,
        });
        continue;
      }

      let snapshot: BudgetUsageSnapshot;
      try {
        snapshot = await this.usageReader!({
          providerId: route.providerId,
          subject: request.subject,
          sessionId: request.sessionId,
          ...(request.turnId ? { turnId: request.turnId } : {}),
          ...(route.routeId ? { routeId: route.routeId } : {}),
          ...(route.model ? { model: route.model } : {}),
        });
      } catch {
        return usageUnavailable("Budget usage is unavailable for an enabled budget-aware route.");
      }

      usageSnapshots.push(snapshot);
      const withinBudget = snapshot.tokensUsed <= ceiling;
      routeDecisions.push({
        route,
        status: withinBudget ? "within_budget" : "over_budget",
        tokensUsed: snapshot.tokensUsed,
        ceiling,
      });
      if (withinBudget) {
        admittedRoutes.push(route);
      }
    }

    if (admittedRoutes.length > 0) {
      return {
        status: "admitted",
        reason: "route-within-budget",
        admittedRoutes,
        usageSnapshots,
        routeDecisions,
      };
    }

    return {
      status: "denied",
      reason: "all-routes-over-budget",
      missingCapabilities: ["budget.route.within_ceiling"],
      usageSnapshots,
      routeDecisions,
      message: "All route candidates are over their configured budget ceilings.",
    };
  }
}

function hasFiniteBudget(route: BudgetAdmissionRouteCandidate, budget: BudgetRouteBudget | undefined): boolean {
  return budget?.providerId === route.providerId && budget.dailyTokenCeiling !== null;
}

function usageUnavailable(message: string): BudgetAdmissionDecision {
  return {
    status: "denied",
    reason: "usage-unavailable",
    missingCapabilities: ["budget.usage.available"],
    usageSnapshots: [],
    routeDecisions: [],
    message,
  };
}
