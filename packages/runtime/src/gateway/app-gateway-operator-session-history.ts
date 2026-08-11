import {
  projectOperatorSessionSummary,
  type OperatorSessionRouteIdentity,
  type OperatorSessionSummary,
  type OperatorSessionTurnOutcome,
} from "@kilnai/gateway-contracts";
import { extractText } from "@kilnai/core";
import type { RuntimeSession } from "../session/runtime-session.js";

function routeFromSessionEvents(session: RuntimeSession): {
  readonly lastRoute?: OperatorSessionRouteIdentity;
  readonly providersUsed: readonly string[];
  readonly lastTurnOutcome?: OperatorSessionTurnOutcome;
  readonly costUsd: number;
} {
  const providersUsed = new Set<string>();
  let lastRoute: OperatorSessionRouteIdentity | undefined;
  let lastTurnOutcome: OperatorSessionTurnOutcome | undefined;
  let costUsd = 0;

  for (const event of session.sessionEvents) {
    if (event.kind === "provider_routed" || event.kind === "cost_updated") {
      providersUsed.add(event.provider.provider);
      lastRoute = {
        provider: event.provider.provider,
        ...(event.provider.model ? { model: event.provider.model } : {}),
      };
    }
    if (event.kind === "cost_updated") {
      costUsd += event.cost.deltaUsd;
    }
    if (event.kind === "turn_completed") {
      lastTurnOutcome = event.outcome;
    }
    if (
      (
        event.kind === "agent_invocation_requested"
        || event.kind === "agent_invocation_started"
        || event.kind === "agent_invocation_completed"
        || event.kind === "agent_invocation_failed"
        || event.kind === "agent_invocation_cancelled"
      )
      && event.providerRoute?.providerId
    ) {
      providersUsed.add(event.providerRoute.providerId);
    }
  }

  if (session.sessionLedger.lastProvider) providersUsed.add(session.sessionLedger.lastProvider);
  return {
    ...(lastRoute ? { lastRoute } : {}),
    providersUsed: [...providersUsed],
    ...(lastTurnOutcome ? { lastTurnOutcome } : {}),
    costUsd,
  };
}

export function projectAppGatewayOperatorSessionSummary(session: RuntimeSession): OperatorSessionSummary {
  const firstUserMessage = session.conversationHistory.find((message) => message.role === "user");
  const summary = firstUserMessage ? extractText(firstUserMessage.parts).trim() : "";
  const evidence = routeFromSessionEvents(session);
  const route = evidence.lastRoute;
  return projectOperatorSessionSummary({
    transcript: {
      sessionId: session.id,
      ...(route ? { provider: route.provider } : {}),
      ...(route?.model ? { model: route.model } : {}),
      providersUsed: evidence.providersUsed,
      title: session.appName,
      ...(summary ? { summary } : {}),
      task: summary || `${session.appName} session`,
      startedAt: session.createdAt.toISOString(),
      completedAt: session.lastActivityAt.toISOString(),
      ...(evidence.lastTurnOutcome ? { lastTurnOutcome: evidence.lastTurnOutcome } : {}),
      costUsd: evidence.costUsd,
    },
  });
}

export function projectAppGatewayOperatorSessionHistory(
  sessions: readonly RuntimeSession[],
): readonly OperatorSessionSummary[] {
  return sessions
    .map(projectAppGatewayOperatorSessionSummary)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
