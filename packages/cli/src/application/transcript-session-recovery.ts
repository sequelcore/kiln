import type {
  PersistedSessionMeta,
  PersistedTranscriptEvent,
  PersistedTranscriptEventDraft,
  SessionStore,
  TranscriptStore,
} from "../wrapper/session-store.js";

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const RECOVERY_ERROR_CODE = "STALE_OPEN_TURN_RECOVERED";

export interface RecoverStaleOpenTranscriptSessionsOptions {
  readonly transcriptStore: TranscriptStore;
  readonly sessionStore?: SessionStore;
  readonly projectPath?: string;
  readonly now?: Date;
  readonly staleAfterMs?: number;
}

export interface RecoverStaleOpenTranscriptSessionsResult {
  readonly checkedSessionIds: readonly string[];
  readonly recoveredSessionIds: readonly string[];
}

interface OpenTurnCandidate {
  readonly turnId: string;
  readonly startedAt: string;
  readonly lastEventAt: string;
}

export async function recoverStaleOpenTranscriptSessions(
  options: RecoverStaleOpenTranscriptSessionsOptions,
): Promise<RecoverStaleOpenTranscriptSessionsResult> {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const sessionIds = await options.transcriptStore.listSessions();
  const recoveredSessionIds: string[] = [];

  for (const sessionId of sessionIds) {
    const meta = await options.transcriptStore.readMeta(sessionId);
    if (!meta || meta.completedAt) {
      continue;
    }
    const transcript = await options.transcriptStore.readTranscript(sessionId);
    const openTurn = findStaleOpenTurn(transcript, now, staleAfterMs);
    if (!openTurn) {
      continue;
    }

    await appendRecoveryEvents({
      transcriptStore: options.transcriptStore,
      sessionId,
      openTurn,
      now,
      staleAfterMs,
    });
    await finalizeRecoveredSession({
      transcriptStore: options.transcriptStore,
      sessionStore: options.sessionStore,
      projectPath: options.projectPath,
      sessionId,
      meta,
      openTurn,
      now,
    });
    recoveredSessionIds.push(sessionId);
  }

  return {
    checkedSessionIds: sessionIds,
    recoveredSessionIds,
  };
}

function findStaleOpenTurn(
  transcript: readonly PersistedTranscriptEvent[],
  now: Date,
  staleAfterMs: number,
): OpenTurnCandidate | null {
  const openTurns = new Map<string, { startedAt: string; lastEventAt: string }>();
  let lastEventAt: string | null = null;

  for (const event of [...transcript].sort((left, right) => left.sequence - right.sequence)) {
    lastEventAt = latestIso(lastEventAt, event.timestamp);
    const turnId = readTurnId(event);
    if (!turnId) {
      continue;
    }
    for (const openTurn of openTurns.values()) {
      openTurn.lastEventAt = latestIso(openTurn.lastEventAt, event.timestamp);
    }
    if (event.kind === "turn_started") {
      openTurns.set(turnId, {
        startedAt: event.timestamp,
        lastEventAt: event.timestamp,
      });
      continue;
    }
    if (event.kind === "turn_completed") {
      openTurns.delete(turnId);
    }
  }

  if (openTurns.size === 0) {
    return null;
  }

  const [turnId, openTurn] = [...openTurns.entries()].at(-1) ?? [];
  if (!turnId || !openTurn) {
    return null;
  }
  const newestEvidenceAt = lastEventAt ?? openTurn.lastEventAt;
  if (!isStale(newestEvidenceAt, now, staleAfterMs)) {
    return null;
  }
  return {
    turnId,
    startedAt: openTurn.startedAt,
    lastEventAt: newestEvidenceAt,
  };
}

function readTurnId(event: PersistedTranscriptEvent): string | null {
  if (typeof event.turnId === "string" && event.turnId.trim().length > 0) {
    return event.turnId;
  }
  const payloadTurnId = event.payload.turnId;
  return typeof payloadTurnId === "string" && payloadTurnId.trim().length > 0 ? payloadTurnId : null;
}

function latestIso(left: string | null, right: string): string {
  if (!left) {
    return right;
  }
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) {
    return right;
  }
  if (!Number.isFinite(rightMs)) {
    return left;
  }
  return rightMs >= leftMs ? right : left;
}

function isStale(timestamp: string, now: Date, staleAfterMs: number): boolean {
  const eventMs = Date.parse(timestamp);
  if (!Number.isFinite(eventMs)) {
    return false;
  }
  return now.getTime() - eventMs >= staleAfterMs;
}

async function appendRecoveryEvents(input: {
  readonly transcriptStore: TranscriptStore;
  readonly sessionId: string;
  readonly openTurn: OpenTurnCandidate;
  readonly now: Date;
  readonly staleAfterMs: number;
}): Promise<void> {
  const timestamp = input.now.toISOString();
  const message = `Recovered stale open turn ${input.openTurn.turnId}.`;
  const drafts: readonly PersistedTranscriptEventDraft[] = [
    {
      eventId: `${input.sessionId}:recovery:${input.openTurn.turnId}:error`,
      kilnSessionId: input.sessionId,
      timestamp,
      kind: "error_recorded",
      turnId: input.openTurn.turnId,
      source: { actor: "runtime", surface: "runtime", component: "transcript-session-recovery" },
      payload: {
        errorCode: RECOVERY_ERROR_CODE,
        message,
        retriable: true,
        details: {
          recoveredAt: timestamp,
          staleAfterMs: input.staleAfterMs,
          startedAt: input.openTurn.startedAt,
          lastEventAt: input.openTurn.lastEventAt,
        },
      },
    },
    {
      eventId: `${input.sessionId}:recovery:${input.openTurn.turnId}:turn-completed`,
      kilnSessionId: input.sessionId,
      timestamp,
      kind: "turn_completed",
      turnId: input.openTurn.turnId,
      source: { actor: "runtime", surface: "runtime", component: "transcript-session-recovery" },
      payload: {
        turnId: input.openTurn.turnId,
        outcome: "failed",
        durationMs: Math.max(0, input.now.getTime() - Date.parse(input.openTurn.startedAt)),
      },
    },
  ];
  await input.transcriptStore.appendManyNext(input.sessionId, drafts);
}

async function finalizeRecoveredSession(input: {
  readonly transcriptStore: TranscriptStore;
  readonly sessionStore?: SessionStore;
  readonly projectPath?: string;
  readonly sessionId: string;
  readonly meta: PersistedSessionMeta;
  readonly openTurn: OpenTurnCandidate;
  readonly now: Date;
}): Promise<void> {
  const completedAt = input.now.toISOString();
  const lastError = `Recovered stale open turn ${input.openTurn.turnId}.`;
  await input.transcriptStore.finalize(input.sessionId, {
    completedAt,
    lastTurnOutcome: "failed",
    sessionLedger: {
      ...input.meta.sessionLedger,
      currentPhase: "recovered",
      lastError,
      lastProvider: input.meta.provider,
    },
  });

  if (!input.sessionStore || !input.projectPath) {
    return;
  }
  await input.sessionStore.append({
    sessionId: input.sessionId,
    provider: input.meta.provider,
    task: input.meta.task,
    canonicalTitle: input.meta.canonicalTitle,
    title: input.meta.title,
    summary: input.meta.summary,
    tags: input.meta.tags,
    providersUsed: input.meta.providersUsed ?? [input.meta.provider],
    completedAt,
    cost: input.meta.costUsd ?? 0,
    projectPath: input.projectPath,
    providerThread: input.meta.providerThread,
    resumeStrategy: input.meta.resumeStrategy,
  }, { updateContinuationTarget: false });
}
