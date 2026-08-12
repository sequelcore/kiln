import {
  projectOperatorSessionSummary,
  type OperatorSessionSummary,
} from "@kilnai/gateway-contracts";
import type {
  PersistedSessionMeta,
  PersistedTranscriptEvent,
  SessionRecord,
  SessionStore,
  TranscriptStore,
} from "../wrapper/session-store.js";

function transcriptRouteEvidence(meta: PersistedSessionMeta, events: readonly PersistedTranscriptEvent[]) {
  const routedEvents = events.flatMap((event) => {
    if (event.kind !== "provider_routed") return [];
    const routeId = typeof event.payload.routeId === "string" ? event.payload.routeId.trim() : "";
    if (!routeId) return [];
    const providerEvidence = event.payload.provider;
    const provider = typeof providerEvidence === "object" && providerEvidence !== null
      && typeof (providerEvidence as Record<string, unknown>).provider === "string"
      ? String((providerEvidence as Record<string, unknown>).provider).trim()
      : undefined;
    const model = typeof providerEvidence === "object" && providerEvidence !== null
      && typeof (providerEvidence as Record<string, unknown>).model === "string"
      ? String((providerEvidence as Record<string, unknown>).model).trim()
      : undefined;
    return [{ routeId, ...(provider ? { provider } : {}), ...(model ? { model } : {}) }];
  });
  const latest = routedEvents.at(-1);
  return {
    routesUsed: [
      ...routedEvents.map((route) => route.routeId),
      ...(meta.executionBindings ?? []).map((binding) => binding.routeId),
    ],
    ...(latest ? latest : {}),
  };
}

function transcriptEvidence(
  sessionId: string,
  meta: PersistedSessionMeta,
  events: readonly PersistedTranscriptEvent[],
) {
  const route = transcriptRouteEvidence(meta, events);
  return {
    sessionId,
    ...(route.routeId ? { routeId: route.routeId } : {}),
    ...(route.provider ? { provider: route.provider } : {}),
    ...(route.model ? { model: route.model } : {}),
    routesUsed: route.routesUsed,
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
    const events = await transcriptStore.readTranscript(sessionId);
    const ledger = ledgerBySessionId.get(sessionId);
    summaries.push(projectOperatorSessionSummary({
      transcript: transcriptEvidence(sessionId, meta, events),
      ...(ledger ? { ledger: ledgerEvidence(ledger) } : {}),
    }));
  }

  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
