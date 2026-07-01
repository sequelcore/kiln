import {
  createSessionEvent,
  projectCostUpdatedEventToLifecycleLedger,
  summarizeLifecycleAttributionLedger,
  type SessionCost,
  type SessionProviderIdentity,
  type SessionTokenUsage,
} from "@kilnai/core";

export interface LiveCostEventIdentity {
  readonly eventId: string;
  readonly kilnSessionId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly turnId: string;
}

export interface ProjectLiveLifecycleAttributionInput extends LiveCostEventIdentity {
  readonly provider: SessionProviderIdentity;
  readonly usage: SessionTokenUsage;
  readonly cost: SessionCost;
}

export function projectLiveLifecycleAttribution(input: ProjectLiveLifecycleAttributionInput) {
  const costEvent = createSessionEvent<"cost_updated">({
    kind: "cost_updated",
    kilnSessionId: input.kilnSessionId,
    sequence: input.sequence,
    turnId: input.turnId,
    source: {
      actor: "runtime",
      surface: "runtime",
      component: "operator-gateway",
    },
    provider: input.provider,
    usage: input.usage,
    cost: input.cost,
  }, {
    generateEventId: () => input.eventId,
    now: () => new Date(input.timestamp),
  });
  const ledger = projectCostUpdatedEventToLifecycleLedger(costEvent, {
    context: {
      route: `${input.provider.provider}/${input.provider.model}`,
    },
  });
  return {
    parentEventId: input.eventId,
    ledger,
    summary: summarizeLifecycleAttributionLedger(ledger),
  };
}
