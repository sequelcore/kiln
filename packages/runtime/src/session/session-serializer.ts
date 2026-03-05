import type { AgentMessage } from "@kilnai/core";
import { ModeBSession } from "./mode-b-session.js";
import type { SerializedSessionData } from "./mode-b-session.js";
import type { SessionMode } from "./session-mode.js";

export interface SerializedSession {
  readonly id: string;
  readonly appName: string;
  readonly tenantId?: string;
  readonly userId: string;
  readonly systemPrompt: string;
  readonly idleTimeoutMs: number;
  readonly sessionMode: SessionMode;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly history: readonly AgentMessage[];
}

export function serializeSession(session: ModeBSession): string {
  const data: SerializedSession = {
    id: session.id,
    appName: session.appName,
    tenantId: session.tenantId,
    userId: session.userId,
    systemPrompt: session.systemPrompt,
    idleTimeoutMs: session.idleTimeoutMs,
    sessionMode: session.sessionMode,
    createdAt: session.createdAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
    history: session.conversationHistory as AgentMessage[],
  };
  return JSON.stringify(data);
}

export function deserializeSession(json: string): ModeBSession {
  const data = JSON.parse(json) as SerializedSessionData;
  return ModeBSession.fromSerialized(data);
}
