export type SessionContinuityStatus = "idle" | "connecting" | "ready" | "running" | "error";

export type SessionContinuityMode = "fresh" | "continue" | "live" | "detached";

export interface SessionContinuityInput {
  readonly status: SessionContinuityStatus;
  readonly selectedSessionId: string | null;
  readonly liveSessionId: string | null;
  readonly continuationTargetId: string | null;
  readonly messageCount: number;
  readonly sessionEventCount: number;
  readonly detachedSessionIds: readonly string[];
}

export interface SessionContinuity {
  readonly mode: SessionContinuityMode;
  readonly status: SessionContinuityStatus;
  readonly selectedSessionId: string | null;
  readonly liveSessionId: string | null;
  readonly continuationTargetId: string | null;
  readonly detachedSessionIds: readonly string[];
  readonly outboundContinuationSessionId?: string;
  readonly outboundSessionIntent?: "fresh";
  readonly shouldResetVisibleHistoryOnSubmit: boolean;
}

export function deriveSessionContinuity(input: SessionContinuityInput): SessionContinuity {
  const activeContinuationSessionId = input.continuationTargetId ?? input.selectedSessionId ?? undefined;
  const startsFreshSession = activeContinuationSessionId === undefined
    && input.liveSessionId === null
    && input.messageCount === 0
    && input.sessionEventCount === 0;
  const detachedLiveSession = input.liveSessionId && input.detachedSessionIds.includes(input.liveSessionId);

  return {
    mode: deriveSessionContinuityMode(input, startsFreshSession, Boolean(detachedLiveSession), activeContinuationSessionId),
    status: input.status,
    selectedSessionId: input.selectedSessionId,
    liveSessionId: input.liveSessionId,
    continuationTargetId: input.continuationTargetId,
    detachedSessionIds: input.detachedSessionIds,
    ...(activeContinuationSessionId ? { outboundContinuationSessionId: activeContinuationSessionId } : {}),
    ...(startsFreshSession ? { outboundSessionIntent: "fresh" as const } : {}),
    shouldResetVisibleHistoryOnSubmit: false,
  };
}

function deriveSessionContinuityMode(
  input: SessionContinuityInput,
  startsFreshSession: boolean,
  detachedLiveSession: boolean,
  activeContinuationSessionId: string | undefined,
): SessionContinuityMode {
  if (detachedLiveSession) {
    return "detached";
  }
  if (input.status === "running" && input.liveSessionId) {
    return "live";
  }
  if (activeContinuationSessionId) {
    return "continue";
  }
  if (input.liveSessionId) {
    return "live";
  }
  return startsFreshSession ? "fresh" : "live";
}

export function shouldApplySessionScopedFrame(
  continuity: SessionContinuity,
  kilnSessionId: string,
): boolean {
  if (continuity.detachedSessionIds.includes(kilnSessionId)) {
    return false;
  }
  if (continuity.liveSessionId) {
    return continuity.liveSessionId === kilnSessionId;
  }
  if (continuity.selectedSessionId) {
    return continuity.selectedSessionId === kilnSessionId;
  }
  if (continuity.continuationTargetId && continuity.status !== "running") {
    return continuity.continuationTargetId === kilnSessionId;
  }
  return continuity.status === "running" || continuity.status === "idle";
}
