import type { BudgetAdmissionPolicy } from "@kilnai/core";
import {
  RuntimeBudgetAdmissionService,
  type RuntimeBudgetAdmissionPort,
  type RuntimeBudgetUsageReader,
} from "@kilnai/runtime";
import type { KilnGlobalConfig } from "../config/global-config.js";
import type {
  PersistedProviderTokenUsage,
  PersistedSessionMeta,
  PersistedTranscriptEvent,
  TranscriptStore,
} from "../wrapper/session-store.js";

export function createRuntimeBudgetAdmissionFromGlobalConfig(
  globalConfig: KilnGlobalConfig | null | undefined,
  usageReader: RuntimeBudgetUsageReader,
): RuntimeBudgetAdmissionPort | undefined {
  if (globalConfig?.workerRouting?.budgetAware !== true) {
    return undefined;
  }
  return new RuntimeBudgetAdmissionService({
    policy: projectGlobalRoutingBudgetPolicy(globalConfig),
    usageReader,
  });
}

export function createCliTranscriptBudgetUsageReader(
  transcriptStore: TranscriptStore,
): RuntimeBudgetUsageReader {
  return async ({ providerId }) => {
    const dayStartMs = startOfLocalDayMs(new Date());
    let tokensUsed = 0;
    for (const sessionId of await transcriptStore.listSessions()) {
      const meta = await transcriptStore.readMeta(sessionId);
      if (!meta || !isBudgetUsageSessionForDay(meta, dayStartMs)) {
        continue;
      }
      tokensUsed += await readPersistedProviderTokenUsage(transcriptStore, sessionId, meta, providerId);
    }
    return {
      providerId,
      tokensUsed,
      source: "cli-transcript-session-usage",
      capturedAt: new Date().toISOString(),
    };
  };
}

export function projectGlobalRoutingBudgetPolicy(globalConfig: KilnGlobalConfig): BudgetAdmissionPolicy {
  return {
    enabled: globalConfig.workerRouting?.budgetAware === true,
    routeBudgets: Object.entries(globalConfig.workerRouting?.budget ?? {}).map(([providerId, budget]) => ({
      providerId,
      dailyTokenCeiling: budget.dailyTokenCeiling ?? null,
      ...(budget.onCeiling ? { onCeiling: budget.onCeiling } : {}),
    })),
  };
}

function startOfLocalDayMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function isBudgetUsageSessionForDay(meta: PersistedSessionMeta, dayStartMs: number): boolean {
  const usageTimestamp = Date.parse(meta.completedAt ?? meta.startedAt);
  return Number.isFinite(usageTimestamp) && usageTimestamp >= dayStartMs;
}

async function readPersistedProviderTokenUsage(
  transcriptStore: TranscriptStore,
  sessionId: string,
  meta: PersistedSessionMeta,
  providerId: string,
): Promise<number> {
  const providerUsage = readMetaProviderTokenUsage(meta.providerTokenUsage, providerId);
  const transcriptUsage = readPersistedTranscriptProviderTokenUsage(
    await transcriptStore.readTranscript(sessionId),
    providerId,
  );
  if (providerUsage > 0 || transcriptUsage > 0) {
    return Math.max(providerUsage, transcriptUsage);
  }

  if (meta.provider !== providerId) {
    return 0;
  }
  return sumTokenCounts([
    meta.inputTokens,
    meta.outputTokens,
    meta.cacheReadTokens,
    meta.cacheWriteTokens,
  ]);
}

function readMetaProviderTokenUsage(
  providerTokenUsage: readonly PersistedProviderTokenUsage[] | undefined,
  providerId: string,
): number {
  return providerTokenUsage
    ?.filter((usage) => usage.provider === providerId)
    .reduce((total, usage) => total + sumTokenCounts([
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens,
      usage.cacheWriteTokens,
    ]), 0)
    ?? 0;
}

function readPersistedTranscriptProviderTokenUsage(
  events: readonly PersistedTranscriptEvent[],
  providerId: string,
): number {
  const tokenUsageByTurn = new Map<string, number>();
  for (const event of events) {
    const eventProvider = readCostUpdatedEventProvider(event);
    if (eventProvider !== providerId) {
      continue;
    }
    const turnKey = typeof event.turnId === "string" && event.turnId.length > 0
      ? event.turnId
      : "session";
    tokenUsageByTurn.set(
      turnKey,
      Math.max(tokenUsageByTurn.get(turnKey) ?? 0, readCostUpdatedEventTokenUsage(event.payload)),
    );
  }
  return [...tokenUsageByTurn.values()].reduce((total, usage) => total + usage, 0);
}

function readCostUpdatedEventProvider(event: PersistedTranscriptEvent): string | undefined {
  if (event.kind !== "cost_updated") {
    return undefined;
  }
  const provider = event.payload.provider;
  if (typeof provider === "string") {
    return provider;
  }
  if (isRecord(provider) && typeof provider.provider === "string") {
    return provider.provider;
  }
  return undefined;
}

function readCostUpdatedEventTokenUsage(payload: Record<string, unknown>): number {
  const usage = payload.usage;
  if (isRecord(usage)) {
    return sumTokenCounts([
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens,
      usage.cacheWriteTokens,
    ]);
  }
  return sumTokenCounts([
    payload.inputTokens,
    payload.outputTokens,
    payload.cacheReadTokens,
    payload.cacheWriteTokens,
  ]);
}

function sumTokenCounts(values: readonly unknown[]): number {
  let total = 0;
  for (const value of values) {
    total += readTokenCount(value);
  }
  return total;
}

function readTokenCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
