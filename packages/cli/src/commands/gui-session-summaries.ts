import type { GuiDashboardSnapshot } from "@kilnai/runtime";
import { getGuiProviderMetadata } from "@kilnai/gateway-contracts";
import { resolveSessionSummary, mergeProvidersUsed } from "../application/session-metadata.js";
import type { PersistedSessionMeta, SessionRecord, SessionStore, TranscriptStore } from "../wrapper/session-store.js";

export function toProviderLabel(provider: string): string {
  return getGuiProviderMetadata(provider)?.label ?? provider;
}

function buildSessionSummary(input: {
  summary?: string;
  canonicalTitle?: string;
  title?: string;
  task?: string;
  provider: string;
}): string {
  return resolveSessionSummary({
    summary: input.summary,
    canonicalTitle: input.canonicalTitle ?? input.title,
    task: input.task,
    providerLabel: toProviderLabel(input.provider),
  });
}

function isGenericSummary(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "interactive" || normalized === "untitled session" || normalized.endsWith(" session");
}

type GuiSessionSummary = GuiDashboardSnapshot["sessions"][number];

function buildSummaryFromMeta(sessionId: string, meta: PersistedSessionMeta): GuiSessionSummary {
  const provider = meta.sessionLedger?.lastProvider ?? meta.provider;
  return {
    id: sessionId,
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.summary ? { summary: meta.summary } : {}),
    ...(meta.tags ? { tags: meta.tags } : {}),
    providersUsed: mergeProvidersUsed(
      meta.providerTokenUsage?.map((usage) => usage.provider),
      [meta.provider, meta.sessionLedger?.lastProvider],
    ),
    lastProvider: provider,
    ...(meta.lastTurnOutcome ? { lastTurnOutcome: meta.lastTurnOutcome } : {}),
    completedAt: meta.completedAt ?? meta.startedAt,
    cost: meta.costUsd ?? 0,
    taskSummary: buildSessionSummary({
      summary: meta.summary,
      canonicalTitle: meta.title,
      task: meta.task,
      provider,
    }),
  };
}

function applyLedgerRecord(summary: GuiSessionSummary, record: SessionRecord): GuiSessionSummary {
  const candidateSummary = buildSessionSummary({
    summary: record.summary,
    canonicalTitle: record.canonicalTitle,
    title: record.title,
    task: record.task,
    provider: record.provider,
  });
  const taskSummary = isGenericSummary(summary.taskSummary) && !isGenericSummary(candidateSummary)
    ? candidateSummary
    : summary.taskSummary;
  return {
    ...summary,
    ...(summary.title ?? record.title ? { title: summary.title ?? record.title } : {}),
    ...(summary.summary ?? record.summary ? { summary: summary.summary ?? record.summary } : {}),
    ...(summary.tags ?? record.tags ? { tags: summary.tags ?? record.tags } : {}),
    providersUsed: mergeProvidersUsed(record.providersUsed, [record.provider, ...summary.providersUsed]),
    lastProvider: record.provider,
    completedAt: record.completedAt.localeCompare(summary.completedAt) > 0 ? record.completedAt : summary.completedAt,
    cost: summary.cost || record.cost,
    taskSummary,
  };
}

export async function loadSessionSummaries(
  sessionStore: SessionStore,
  transcriptStore: TranscriptStore,
): Promise<GuiDashboardSnapshot["sessions"]> {
  const ledgerSessions = await sessionStore.list();
  const ledgerBySessionId = new Map(ledgerSessions.map((session) => [session.sessionId, session]));
  const transcriptSessionIds = await transcriptStore.listSessions();
  const summaries: GuiSessionSummary[] = [];

  for (const sessionId of transcriptSessionIds) {
    const meta = await transcriptStore.readMeta(sessionId);
    if (!meta) {
      continue;
    }
    const fromMeta = buildSummaryFromMeta(sessionId, meta);
    const ledger = ledgerBySessionId.get(sessionId);
    summaries.push(ledger ? applyLedgerRecord(fromMeta, ledger) : fromMeta);
  }

  return summaries
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
    .slice(0, 20);
}
