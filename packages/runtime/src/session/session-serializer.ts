import type { AgentMessage } from "@kilnai/core";
import { ModeBSession } from "./mode-b-session.js";
import type { SerializedSessionData } from "./mode-b-session.js";

export function serializeSession(session: ModeBSession): string {
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
  };
  return JSON.stringify(data);
}

export function deserializeSession(json: string): ModeBSession {
  const data = JSON.parse(json) as SerializedSessionData;
  return ModeBSession.fromSerialized(data);
}
