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
  readonly lastTurnOutcome?: OperatorSessionTurnOutcome;
  readonly costUsd: number;
} {
  let lastRoute: OperatorSessionRouteIdentity | undefined;
  let lastTurnOutcome: OperatorSessionTurnOutcome | undefined;
  let costUsd = 0;

  for (const event of session.sessionEvents) {
    if (event.kind === "provider_routed" && event.routeId) {
      lastRoute = {
        routeId: event.routeId,
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
  }

  return {
    ...(lastRoute ? { lastRoute } : {}),
    ...(lastTurnOutcome ? { lastTurnOutcome } : {}),
    costUsd,
  };
}

export function projectAppGatewayOperatorSessionSummary(session: RuntimeSession, now = new Date()): OperatorSessionSummary {
  const firstUserMessage = session.conversationHistory.find((message) => message.role === "user");
  const summary = firstUserMessage ? extractText(firstUserMessage.parts).trim() : "";
  const evidence = routeFromSessionEvents(session);
  const route = evidence.lastRoute;
  return projectOperatorSessionSummary({
    liveLifecycle: session.observeLiveLifecycle(now),
    transcript: {
      sessionId: session.id,
      ...(route ? { routeId: route.routeId } : {}),
      ...(route ? { provider: route.provider } : {}),
      ...(route?.model ? { model: route.model } : {}),
      routesUsed: evidence.lastRoute ? [evidence.lastRoute.routeId] : [],
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
  now = new Date(),
): readonly OperatorSessionSummary[] {
  return sessions
    .map((session) => projectAppGatewayOperatorSessionSummary(session, now))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
