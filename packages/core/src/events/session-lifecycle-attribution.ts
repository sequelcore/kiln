import type {
  CanonicalCostUpdatedEvent,
  SessionCost,
  SessionProviderIdentity,
  SessionTokenUsage,
} from "./session-event.js";

export type SessionLifecycleSourceKind =
  | "control_instructions"
  | "procedural_context"
  | "memory"
  | "knowledge"
  | "coordination"
  | "transcript"
  | "tool_schema"
  | "tool_output"
  | "repository_evidence"
  | "web_evidence"
  | "verification"
  | "final_output"
  | "unknown";

export type SessionProviderTokenClass =
  | "input"
  | "output"
  | "cache_read"
  | "cache_write";

export type SessionLifecycleTokenClass =
  | "raw"
  | "admitted"
  | "deferred"
  | "cached"
  | "cache_written"
  | "generated"
  | "estimated_reasoning";

export type SessionLifecycleAttributionQuality =
  | "provider_reported"
  | "estimated"
  | "unknown";

export interface SessionLifecycleExecutionContext {
  readonly workItemId?: string;
  readonly parentLedgerId?: string;
  readonly parentEventId?: string;
  readonly parentTurnId?: string;
  readonly taskClass?: string;
  readonly phase?: string;
  readonly policyVersion?: string;
  readonly route?: string;
  readonly reasoningEffort?: string;
}

export interface SessionLifecycleAttributedCost {
  readonly currency: SessionCost["currency"];
  readonly deltaUsd: number;
  readonly quality: SessionLifecycleAttributionQuality;
}

export interface SessionLifecycleAttributionAllocation {
  readonly source: SessionLifecycleSourceKind;
  readonly tokenClass: SessionLifecycleTokenClass;
  readonly providerTokenClass?: SessionProviderTokenClass;
  readonly tokens: number;
  readonly cost?: SessionLifecycleAttributedCost;
  readonly quality?: SessionLifecycleAttributionQuality;
  readonly context?: SessionLifecycleExecutionContext;
  readonly evidenceUris?: readonly string[];
  readonly artifactId?: string;
  readonly toolName?: string;
  readonly workerId?: string;
}

export interface SessionLifecycleAttributionRecord {
  readonly sessionId: string;
  readonly turnId?: string;
  readonly sourceEventId: string;
  readonly sourceEventSequence: number;
  readonly source: SessionLifecycleSourceKind;
  readonly tokenClass: SessionLifecycleTokenClass;
  readonly providerTokenClass: SessionProviderTokenClass;
  readonly tokens: number;
  readonly cost: SessionLifecycleAttributedCost;
  readonly quality: SessionLifecycleAttributionQuality;
  readonly context: SessionLifecycleExecutionContext;
  readonly provider: SessionProviderIdentity;
  readonly evidenceUris: readonly string[];
  readonly artifactId?: string;
  readonly toolName?: string;
  readonly workerId?: string;
}

export interface SessionLifecycleAttributionLedger {
  readonly sessionId: string;
  readonly turnId?: string;
  readonly sourceEventId: string;
  readonly sourceEventSequence: number;
  readonly provider: SessionProviderIdentity;
  readonly usage: SessionTokenUsage;
  readonly cost: SessionCost;
  readonly context: SessionLifecycleExecutionContext;
  readonly records: readonly SessionLifecycleAttributionRecord[];
}

export interface SessionLifecycleAttributionSummary {
  readonly byTokenClass: Record<SessionLifecycleTokenClass, number>;
  readonly byTokenClassCostUsd: Record<SessionLifecycleTokenClass, number>;
  readonly bySource: Partial<Record<SessionLifecycleSourceKind, number>>;
  readonly bySourceCostUsd: Partial<Record<SessionLifecycleSourceKind, number>>;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
}

export interface ProjectCostUpdatedEventToLifecycleLedgerOptions {
  readonly allocations?: readonly SessionLifecycleAttributionAllocation[];
  readonly context?: SessionLifecycleExecutionContext;
}

type PendingLifecycleAttributionRecord = Omit<SessionLifecycleAttributionRecord, "cost" | "quality"> & {
  readonly cost?: SessionLifecycleAttributedCost;
  readonly quality?: SessionLifecycleAttributionQuality;
};

const PROVIDER_TOKEN_CLASSES: readonly SessionProviderTokenClass[] = [
  "input",
  "output",
  "cache_read",
  "cache_write",
];

export function projectCostUpdatedEventToLifecycleLedger(
  event: CanonicalCostUpdatedEvent,
  options: ProjectCostUpdatedEventToLifecycleLedgerOptions = {},
): SessionLifecycleAttributionLedger {
  const records: PendingLifecycleAttributionRecord[] = [];
  for (const providerTokenClass of PROVIDER_TOKEN_CLASSES) {
    const providerTotal = readProviderTotal(event.usage, providerTokenClass);
    const allocations = (options.allocations ?? []).filter((allocation) =>
      providerTokenClassForLifecycleClass(allocation) === providerTokenClass,
    );
    const allocated = allocations.reduce((total, allocation) => total + validateAllocation(allocation), 0);
    if (allocated > providerTotal) {
      throw new Error(`Lifecycle attribution for ${providerTokenClass} exceeds provider-reported usage`);
    }
    if (providerTotal === 0) {
      continue;
    }
    for (const allocation of allocations) {
      if (allocation.tokens === 0) {
        continue;
      }
      records.push(recordFromAllocation(event, allocation, options.context));
    }
    const remainder = providerTotal - allocated;
    if (remainder > 0) {
      records.push(recordFromAllocation(event, {
        source: "unknown",
        tokenClass: lifecycleClassForProviderClass(providerTokenClass),
        providerTokenClass,
        tokens: remainder,
        quality: "unknown",
      }, options.context));
    }
  }

  return {
    sessionId: event.kilnSessionId,
    turnId: event.turnId,
    sourceEventId: event.eventId,
    sourceEventSequence: event.sequence,
    provider: event.provider,
    usage: event.usage,
    cost: event.cost,
    context: options.context ?? {},
    records: attributeRecordCosts(records, event.cost),
  };
}

export function summarizeLifecycleAttributionLedger(
  ledger: SessionLifecycleAttributionLedger,
): SessionLifecycleAttributionSummary {
  const byTokenClass: Record<SessionLifecycleTokenClass, number> = {
    raw: 0,
    admitted: 0,
    deferred: 0,
    cached: 0,
    cache_written: 0,
    generated: 0,
    estimated_reasoning: 0,
  };
  const byTokenClassCostUsd: Record<SessionLifecycleTokenClass, number> = {
    raw: 0,
    admitted: 0,
    deferred: 0,
    cached: 0,
    cache_written: 0,
    generated: 0,
    estimated_reasoning: 0,
  };
  const bySource: Partial<Record<SessionLifecycleSourceKind, number>> = {};
  const bySourceCostUsd: Partial<Record<SessionLifecycleSourceKind, number>> = {};
  let totalTokens = 0;
  let totalCostUsd = 0;

  for (const record of ledger.records) {
    byTokenClass[record.tokenClass] += record.tokens;
    byTokenClassCostUsd[record.tokenClass] += record.cost.deltaUsd;
    bySource[record.source] = (bySource[record.source] ?? 0) + record.tokens;
    bySourceCostUsd[record.source] = (bySourceCostUsd[record.source] ?? 0) + record.cost.deltaUsd;
    totalTokens += record.tokens;
    totalCostUsd += record.cost.deltaUsd;
  }

  return {
    byTokenClass,
    byTokenClassCostUsd,
    bySource,
    bySourceCostUsd,
    totalTokens,
    totalCostUsd,
  };
}

function readProviderTotal(usage: SessionTokenUsage, providerTokenClass: SessionProviderTokenClass): number {
  switch (providerTokenClass) {
    case "input":
      return usage.inputTokens;
    case "output":
      return usage.outputTokens;
    case "cache_read":
      return usage.cacheReadTokens;
    case "cache_write":
      return usage.cacheWriteTokens;
  }
}

function providerTokenClassForLifecycleClass(
  allocation: SessionLifecycleAttributionAllocation,
): SessionProviderTokenClass {
  const expectedProviderTokenClass = expectedProviderTokenClassForLifecycleClass(allocation.tokenClass);
  if (allocation.providerTokenClass) {
    if (allocation.providerTokenClass !== expectedProviderTokenClass) {
      throw new Error(
        `Lifecycle token class ${allocation.tokenClass} cannot use provider token class ${allocation.providerTokenClass}`,
      );
    }
    return allocation.providerTokenClass;
  }
  return expectedProviderTokenClass;
}

function expectedProviderTokenClassForLifecycleClass(
  tokenClass: SessionLifecycleTokenClass,
): SessionProviderTokenClass {
  switch (tokenClass) {
    case "raw":
    case "admitted":
    case "deferred":
    case "estimated_reasoning":
      return "input";
    case "cached":
      return "cache_read";
    case "cache_written":
      return "cache_write";
    case "generated":
      return "output";
  }
}

function lifecycleClassForProviderClass(providerTokenClass: SessionProviderTokenClass): SessionLifecycleTokenClass {
  switch (providerTokenClass) {
    case "input":
      return "raw";
    case "output":
      return "generated";
    case "cache_read":
      return "cached";
    case "cache_write":
      return "cache_written";
  }
}

function validateAllocation(allocation: SessionLifecycleAttributionAllocation): number {
  if (!Number.isInteger(allocation.tokens) || allocation.tokens < 0) {
    throw new Error("Lifecycle attribution tokens must be a non-negative integer");
  }
  return allocation.tokens;
}

function recordFromAllocation(
  event: CanonicalCostUpdatedEvent,
  allocation: SessionLifecycleAttributionAllocation,
  ledgerContext: SessionLifecycleExecutionContext = {},
): PendingLifecycleAttributionRecord {
  return {
    sessionId: event.kilnSessionId,
    turnId: event.turnId,
    sourceEventId: event.eventId,
    sourceEventSequence: event.sequence,
    source: allocation.source,
    tokenClass: allocation.tokenClass,
    providerTokenClass: providerTokenClassForLifecycleClass(allocation),
    tokens: allocation.tokens,
    cost: allocation.cost,
    quality: allocation.quality ?? allocation.cost?.quality,
    context: {
      ...ledgerContext,
      ...allocation.context,
    },
    provider: event.provider,
    evidenceUris: allocation.evidenceUris ?? [],
    artifactId: allocation.artifactId,
    toolName: allocation.toolName,
    workerId: allocation.workerId,
  };
}

function attributeRecordCosts(
  records: readonly PendingLifecycleAttributionRecord[],
  cost: SessionCost,
): readonly SessionLifecycleAttributionRecord[] {
  const explicitCostUsd = records.reduce((total, record) => total + (record.cost?.deltaUsd ?? 0), 0);
  if (explicitCostUsd > cost.deltaUsd) {
    throw new Error("Lifecycle attribution cost exceeds provider-reported cost");
  }

  const recordsWithoutCost = records.filter((record) => !record.cost);
  const remainingCostUsd = cost.deltaUsd - explicitCostUsd;
  const remainingTokens = recordsWithoutCost.reduce((total, record) => total + record.tokens, 0);
  if (recordsWithoutCost.length === 0 && remainingCostUsd > 0) {
    throw new Error("Lifecycle attribution cost does not cover provider-reported cost");
  }

  return records.map((record) => {
    const attributedCost = record.cost ?? estimateCost(cost.currency, record.tokens, remainingTokens, remainingCostUsd);
    return {
      ...record,
      cost: attributedCost,
      quality: record.quality ?? attributedCost.quality,
    };
  });
}

function estimateCost(
  currency: SessionCost["currency"],
  tokens: number,
  remainingTokens: number,
  remainingCostUsd: number,
): SessionLifecycleAttributedCost {
  return {
    currency,
    deltaUsd: remainingTokens === 0 ? 0 : remainingCostUsd * (tokens / remainingTokens),
    quality: "estimated",
  };
}
