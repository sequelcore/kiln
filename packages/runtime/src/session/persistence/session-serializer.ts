import type { AgentMessage } from "@kilnai/core";
import { RuntimeSession } from "../runtime-session.js";
import type { SerializedSessionData } from "../runtime-session.js";

export function serializeSession(session: RuntimeSession): string {
  const data: SerializedSessionData = {
    id: session.id,
    appName: session.appName,
    tenantId: session.tenantId,
    userId: session.userId,
    systemPrompt: session.systemPrompt,
    idleTimeoutMs: session.idleTimeoutMs,
    sessionMode: session.sessionMode,
    version: session.version,
    createdAt: session.createdAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
    history: session.conversationHistory as AgentMessage[],
    activeAgentId: session.activeAgentId,
    agentTurnHistory: session.agentTurnHistory,
    handoffCount: session.handoffCount,
    lastRouteChangeAt: session.lastRouteChangeAt,
    totalTokens: session.totalTokens,
    userTurnCount: session.userTurnCount,
    lastHumanMessageAt: session.lastHumanMessageAt,
    userContext: session.userContext,
    sessionLedger: session.sessionLedger,
    exactArtifacts: session.exactArtifacts,
    sessionEvents: session.sessionEvents.map((event) => ({
      ...event,
      timestamp: event.timestamp.toISOString(),
    })),
    runtimeConfigurationRevision: session.runtimeConfigurationRevision,
    runtimeSessionAuthorityFacet: session.runtimeSessionAuthorityFacet,
  };
  return JSON.stringify(data);
}

export function deserializeSession(json: string): RuntimeSession {
  const data = JSON.parse(json) as SerializedSessionData;
  return RuntimeSession.fromSerialized(data);
}
