import type { ResumeFeedback, ResumeOutcome, ResumeStrategy } from "../wrapper/index.js";
import type { PersistedSessionMeta, TranscriptStore } from "../wrapper/session-store.js";
import type { ProviderId } from "../wrapper/session-registry.js";

interface StrategyStats {
  readonly samples: number;
  readonly successRate: number;
  readonly verificationRate: number;
  readonly averageCostUsd: number;
}

function scoreOutcome(outcome: ResumeOutcome): { success: number; verified: number } {
  return {
    success: outcome.succeeded ? 1 : 0,
    verified: outcome.verificationPassed === true ? 1 : 0,
  };
}

function buildStats(outcomes: readonly ResumeOutcome[]): StrategyStats | undefined {
  if (outcomes.length === 0) {
    return undefined;
  }
  const totals = outcomes.reduce((acc, outcome) => {
    const scored = scoreOutcome(outcome);
    return {
      success: acc.success + scored.success,
      verified: acc.verified + scored.verified,
      costUsd: acc.costUsd + outcome.costUsd,
    };
  }, { success: 0, verified: 0, costUsd: 0 });

  return {
    samples: outcomes.length,
    successRate: totals.success / outcomes.length,
    verificationRate: totals.verified / outcomes.length,
    averageCostUsd: totals.costUsd / outcomes.length,
  };
}

function collectOutcome(
  meta: PersistedSessionMeta,
  provider: ProviderId | undefined,
): { strategy: Extract<ResumeStrategy, "cache-first" | "provider-native">; outcome: ResumeOutcome } | undefined {
  const metaProvider = meta.providerThread?.provider ?? meta.provider;
  if (provider !== undefined && metaProvider !== provider) {
    return undefined;
  }
  if (meta.resumeOutcome === undefined) {
    return undefined;
  }
  if (meta.resumeStrategy !== "cache-first" && meta.resumeStrategy !== "provider-native") {
    return undefined;
  }
  return {
    strategy: meta.resumeStrategy,
    outcome: meta.resumeOutcome,
  };
}

export async function inferResumeStrategyFeedback(
  transcriptStore: TranscriptStore,
  provider: ProviderId | undefined,
  limit = 16,
): Promise<ResumeFeedback> {
  const sessionIds = await transcriptStore.listSessions();
  const recentIds = sessionIds.slice(-limit).reverse();
  const byStrategy: Record<"cache-first" | "provider-native", ResumeOutcome[]> = {
    "cache-first": [],
    "provider-native": [],
  };

  for (const sessionId of recentIds) {
    const meta = await transcriptStore.readMeta(sessionId);
    if (meta === null) {
      continue;
    }
    const collected = collectOutcome(meta, provider);
    if (collected !== undefined) {
      byStrategy[collected.strategy].push(collected.outcome);
    }
  }

  const cacheFirst = buildStats(byStrategy["cache-first"]);
  const providerNative = buildStats(byStrategy["provider-native"]);
  const sampleSize = byStrategy["cache-first"].length + byStrategy["provider-native"].length;

  if (
    cacheFirst === undefined
    || providerNative === undefined
    || cacheFirst.samples < 2
    || providerNative.samples < 2
  ) {
    return { sampleSize, influencedChoice: false };
  }

  const cacheFirstScore = cacheFirst.successRate + (cacheFirst.verificationRate * 0.5);
  const providerNativeScore = providerNative.successRate + (providerNative.verificationRate * 0.5);

  if (
    cacheFirstScore >= providerNativeScore + 0.25
    || (
      cacheFirstScore >= providerNativeScore
      && cacheFirst.averageCostUsd <= providerNative.averageCostUsd * 0.85
    )
  ) {
    return { preferredStrategy: "cache-first", sampleSize, influencedChoice: false };
  }

  if (
    providerNativeScore >= cacheFirstScore + 0.25
    || (
      providerNativeScore >= cacheFirstScore
      && providerNative.averageCostUsd <= cacheFirst.averageCostUsd * 0.85
    )
  ) {
    return { preferredStrategy: "provider-native", sampleSize, influencedChoice: false };
  }

  return { sampleSize, influencedChoice: false };
}
