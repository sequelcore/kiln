import {
  projectOperatorSessionSummary,
  type OperatorSessionSummary,
} from "@kilnai/gateway-contracts";
import type { PersistedSessionMeta, SessionRecord, SessionStore, TranscriptStore } from "../wrapper/session-store.js";

function transcriptEvidence(sessionId: string, meta: PersistedSessionMeta) {
  return {
    sessionId,
    provider: meta.sessionLedger?.lastProvider ?? meta.provider,
    providersUsed: [
      ...(meta.providersUsed ?? []),
      ...(meta.providerTokenUsage?.map((usage) => usage.provider) ?? []),
      meta.provider,
      meta.sessionLedger?.lastProvider,
    ].filter((provider): provider is string => Boolean(provider)),
    ...(meta.title ?? meta.canonicalTitle ? { title: meta.title ?? meta.canonicalTitle } : {}),
    ...(meta.summary ? { summary: meta.summary } : {}),
    ...(meta.tags ? { tags: meta.tags } : {}),
    task: meta.task,
    startedAt: meta.startedAt,
    ...(meta.completedAt ? { completedAt: meta.completedAt } : {}),
    ...(meta.lastTurnOutcome ? { lastTurnOutcome: meta.lastTurnOutcome } : {}),
    ...(meta.costUsd !== undefined ? { costUsd: meta.costUsd } : {}),
  };
}

function ledgerEvidence(record: SessionRecord) {
  return {
    provider: record.provider,
    providersUsed: record.providersUsed,
    ...(record.canonicalTitle ?? record.title ? { title: record.canonicalTitle ?? record.title } : {}),
    ...(record.summary ? { summary: record.summary } : {}),
    ...(record.tags ? { tags: record.tags } : {}),
    task: record.task,
    completedAt: record.completedAt,
    accumulatedCostUsd: record.cost,
  };
}

export async function loadOperatorSessionSummaries(
  sessionStore: SessionStore,
  transcriptStore: TranscriptStore,
): Promise<readonly OperatorSessionSummary[]> {
  const ledgerSessions = await sessionStore.list();
  const ledgerBySessionId = new Map(ledgerSessions.map((session) => [session.sessionId, session]));
  const transcriptSessionIds = await transcriptStore.listSessions();
  const summaries: OperatorSessionSummary[] = [];

  for (const sessionId of transcriptSessionIds) {
    const meta = await transcriptStore.readMeta(sessionId);
    if (!meta) continue;
    const ledger = ledgerBySessionId.get(sessionId);
    summaries.push(projectOperatorSessionSummary({
      transcript: transcriptEvidence(sessionId, meta),
      ...(ledger ? { ledger: ledgerEvidence(ledger) } : {}),
    }));
  }

  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
