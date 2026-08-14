import type { SessionTurnBudgetPolicy } from "@kilnai/core";
import {
  RuntimeSessionTurnBudgetService,
  type RuntimeSessionTokenUsageReader,
  type RuntimeSessionTurnBudgetAuthority,
} from "@kilnai/runtime";
import type { KilnGlobalConfig } from "../config/global-config.js";
import type { PersistedSessionMeta, PersistedTranscriptEvent, TranscriptStore } from "../wrapper/session-store.js";

export function createRuntimeSessionTurnBudgetFromGlobalConfig(
  globalConfig: KilnGlobalConfig | null | undefined,
  usageReader: RuntimeSessionTokenUsageReader,
): RuntimeSessionTurnBudgetAuthority | undefined {
  const policy = projectGlobalSessionTurnBudgetPolicy(globalConfig);
  return policy ? new RuntimeSessionTurnBudgetService(policy, usageReader) : undefined;
}

export function projectGlobalSessionTurnBudgetPolicy(
  globalConfig: KilnGlobalConfig | null | undefined,
): SessionTurnBudgetPolicy | undefined {
  const budget = globalConfig?.sessionTurnBudget;
  return budget ? { tokenLimit: budget.tokenLimit, action: budget.action } : undefined;
}

export function createCliTranscriptSessionTokenUsageReader(
  transcriptStore: TranscriptStore,
): RuntimeSessionTokenUsageReader {
  return async (sessionId) => {
    const [meta, events] = await Promise.all([
      transcriptStore.readMeta(sessionId),
      transcriptStore.readTranscript(sessionId),
    ]);
    const metaTokens = readMetaTokens(meta);
    const transcriptTokens = readTranscriptTokens(events);
    if (metaTokens === undefined || transcriptTokens === undefined) {
      throw new Error("Persisted session token usage is invalid");
    }
    return {
      observedTokens: Math.max(metaTokens, transcriptTokens),
      source: "cli-transcript-session-usage",
      capturedAt: new Date().toISOString(),
    };
  };
}

function readMetaTokens(meta: PersistedSessionMeta | null): number | undefined {
  if (!meta) return 0;
  const aggregate = sumTokenPair(meta.inputTokens, meta.outputTokens);
  const breakdown = meta.providerTokenUsage === undefined
    ? 0
    : sumProviderTokenUsage(meta.providerTokenUsage);
  return aggregate === undefined || breakdown === undefined ? undefined : Math.max(aggregate, breakdown);
}

function sumProviderTokenUsage(usages: readonly { readonly inputTokens?: number; readonly outputTokens?: number }[]): number | undefined {
  let total = 0;
  for (const usage of usages) {
    const tokens = sumTokenPair(usage.inputTokens, usage.outputTokens);
    if (tokens === undefined) return undefined;
    total += tokens;
  }
  return total;
}

function readTranscriptTokens(events: readonly PersistedTranscriptEvent[]): number | undefined {
  const tokensByTurnAndSource = new Map<string, number>();
  for (const [index, event] of events.entries()) {
    if (event.kind !== "cost_updated") continue;
    const turn = typeof event.turnId === "string" && event.turnId.length > 0 ? event.turnId : "session";
    const tokens = readEventTokens(event.payload);
    if (tokens === undefined) return undefined;
    // Missing identity deliberately gets a unique event key: we must not fuse
    // potentially distinct provider effects merely because they share a turn.
    const source = readEventSourceIdentity(event.payload) ?? `unidentified:${index}`;
    const key = `${turn}\u0000${source}`;
    tokensByTurnAndSource.set(key, Math.max(tokensByTurnAndSource.get(key) ?? 0, tokens));
  }
  return [...tokensByTurnAndSource.values()].reduce((total, tokens) => total + tokens, 0);
}

function readEventSourceIdentity(payload: Record<string, unknown>): string | undefined {
  const providerValue = payload.provider;
  const provider = typeof providerValue === "string"
    ? providerValue
    : isRecord(providerValue) && typeof providerValue.provider === "string" ? providerValue.provider : undefined;
  const model = typeof payload.canonicalModel === "string"
    ? payload.canonicalModel
    : typeof payload.model === "string" ? payload.model
    : isRecord(providerValue) && typeof providerValue.canonicalModel === "string" ? providerValue.canonicalModel
    : isRecord(providerValue) && typeof providerValue.model === "string" ? providerValue.model : undefined;
  return provider && model ? `${provider}\u0000${model}` : undefined;
}

function readEventTokens(payload: Record<string, unknown>): number | undefined {
  const usage = isRecord(payload.usage) ? payload.usage : payload;
  return sumTokenPair(usage.inputTokens, usage.outputTokens, true);
}

function sumTokenPair(input: unknown, output: unknown, required = false): number | undefined {
  if (input === undefined && output === undefined) return required ? undefined : 0;
  if (input === undefined || output === undefined) return undefined;
  if (
    typeof input !== "number" || !Number.isSafeInteger(input) || input < 0
    || typeof output !== "number" || !Number.isSafeInteger(output) || output < 0
  ) return undefined;
  return input + output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
