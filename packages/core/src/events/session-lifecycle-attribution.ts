import type {
  CanonicalCostUpdatedEvent,
  SessionCost,
  SessionProviderIdentity,
  SessionTokenUsage,
} from "./session-event.js";
import type { ManagedAgentCoordinationUsageReport } from "../agents/managed-invocation/index.js";
import type { DeliberationResolution } from "../agents/deliberation-policy.js";
import type { VerificationUsageReport } from "../efficiency/output-verification-allocation.js";

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
  readonly deliberationResolution?: DeliberationResolution;
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

export interface SessionLifecycleAttributionProviderTotals {
  readonly input: number;
  readonly output: number;
  readonly cache_read: number;
  readonly cache_write: number;
}

export interface SessionLifecycleAttributionReconciliationResult {
  readonly ledger: SessionLifecycleAttributionLedger;
  readonly summary: SessionLifecycleAttributionSummary;
  readonly providerTotals: SessionLifecycleAttributionProviderTotals;
}

export interface ReplayLifecycleAttributionEvidenceInput {
  readonly costEvent: CanonicalCostUpdatedEvent;
  readonly ledger: SessionLifecycleAttributionLedger;
  readonly summary: SessionLifecycleAttributionSummary;
}

export interface ProjectCostUpdatedEventToLifecycleLedgerOptions {
  readonly allocations?: readonly SessionLifecycleAttributionAllocation[];
  readonly context?: SessionLifecycleExecutionContext;
}

export function projectManagedAgentCoordinationUsageAllocations(
  report: ManagedAgentCoordinationUsageReport,
): readonly SessionLifecycleAttributionAllocation[] {
  return report.components.flatMap((component) => {
    if (typeof component.tokens.value !== "number") return [];
    const output = component.providerTokenClass === "output";
    return [{
      source: "coordination" as const,
      tokenClass: output ? "generated" as const : "admitted" as const,
      providerTokenClass: component.providerTokenClass,
      tokens: component.tokens.value,
      quality: component.tokens.source,
      context: {
        phase: component.stage,
        policyVersion: report.version,
      },
      evidenceUris: component.evidenceUris,
      workerId: report.workerId,
    }];
  });
}

export function projectVerificationUsageAllocations(
  report: VerificationUsageReport,
): readonly SessionLifecycleAttributionAllocation[] {
  return report.attempts.flatMap((attempt) => {
    if (typeof attempt.tokens.value !== "number") return [];
    return [{
      source: "verification" as const,
      tokenClass: attempt.providerTokenClass === "output" ? "generated" as const : "admitted" as const,
      providerTokenClass: attempt.providerTokenClass,
      tokens: attempt.tokens.value,
      quality: attempt.tokens.source === "provider-reported" ? "provider_reported" as const : attempt.tokens.source,
      context: {
        phase: attempt.method,
        policyVersion: report.version,
      },
      evidenceUris: attempt.evidenceUris,
    }];
  });
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
    const reconciledAllocations = reconcileProviderClassAllocations(
      providerTokenClass,
      providerTotal,
      allocations,
    );
    const allocated = reconciledAllocations.reduce((total, allocation) => total + validateAllocation(allocation), 0);
    if (providerTotal === 0) {
      continue;
    }
    for (const allocation of reconciledAllocations) {
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

  if (records.length === 0 && event.cost.deltaUsd > 0) {
    records.push(recordFromAllocation(event, {
      source: "unknown",
      tokenClass: "raw",
      providerTokenClass: "input",
      tokens: 0,
      cost: {
        currency: event.cost.currency,
        deltaUsd: event.cost.deltaUsd,
        quality: "unknown",
      },
      quality: "unknown",
    }, options.context));
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

export function reconcileLifecycleAttributionLedger(
  event: CanonicalCostUpdatedEvent,
  ledger: SessionLifecycleAttributionLedger,
): SessionLifecycleAttributionReconciliationResult {
  validateLedgerIdentity(event, ledger);
  validateRecords(event, ledger.records);

  const providerTotals = providerTotalsFromUsage(event.usage);
  for (const providerTokenClass of PROVIDER_TOKEN_CLASSES) {
    const total = ledger.records
      .filter((record) => record.providerTokenClass === providerTokenClass)
      .reduce((sum, record) => sum + record.tokens, 0);
    const providerTotal = providerTotals[providerTokenClass];
    if (total > providerTotal) {
      throw new Error(`Lifecycle attribution allocation overflow for ${providerTokenClass}`);
    }
    if (total !== providerTotal) {
      throw new Error(`Lifecycle attribution provider-total mismatch for ${providerTokenClass}`);
    }
  }

  const summary = summarizeLifecycleAttributionLedger(ledger);
  if (Math.abs(summary.totalCostUsd - event.cost.deltaUsd) > 1e-12) {
    throw new Error("Lifecycle attribution provider-total mismatch for cost");
  }

  return { ledger, summary, providerTotals };
}

export function replayLifecycleAttributionEvidence(
  input: ReplayLifecycleAttributionEvidenceInput,
): SessionLifecycleAttributionReconciliationResult {
  const reconciled = reconcileLifecycleAttributionLedger(input.costEvent, input.ledger);
  if (!structurallyEqual(reconciled.summary, input.summary)) {
    throw new Error("Lifecycle attribution summary mismatch");
  }
  return reconciled;
}

function validateLedgerIdentity(
  event: CanonicalCostUpdatedEvent,
  ledger: SessionLifecycleAttributionLedger,
): void {
  if (
    ledger.sessionId !== event.kilnSessionId
    || ledger.turnId !== event.turnId
    || ledger.sourceEventId !== event.eventId
    || ledger.sourceEventSequence !== event.sequence
    || !structurallyEqual(ledger.provider, event.provider)
    || !structurallyEqual(ledger.usage, event.usage)
    || !structurallyEqual(ledger.cost, event.cost)
  ) {
    throw new Error("Lifecycle attribution identity mismatch");
  }
}

function validateRecords(
  event: CanonicalCostUpdatedEvent,
  records: readonly SessionLifecycleAttributionRecord[],
): void {
  const fingerprints = new Set<string>();
  let previousProviderClassIndex = -1;
  let unknownSeen = false;

  for (const record of records) {
    const fingerprint = JSON.stringify(record);
    if (fingerprints.has(fingerprint)) {
      throw new Error("Lifecycle attribution duplicate record");
    }
    fingerprints.add(fingerprint);

    if (
      record.sessionId !== event.kilnSessionId
      || record.turnId !== event.turnId
      || record.sourceEventId !== event.eventId
      || record.sourceEventSequence !== event.sequence
      || !structurallyEqual(record.provider, event.provider)
    ) {
      throw new Error("Lifecycle attribution identity mismatch");
    }
    if (
      !Number.isInteger(record.tokens)
      || record.tokens < 0
      || expectedProviderTokenClassForLifecycleClass(record.tokenClass) !== record.providerTokenClass
      || !Number.isFinite(record.cost.deltaUsd)
      || record.cost.deltaUsd < 0
      || record.cost.currency !== event.cost.currency
    ) {
      throw new Error("Lifecycle attribution allocation mismatch");
    }

    const providerClassIndex = PROVIDER_TOKEN_CLASSES.indexOf(record.providerTokenClass);
    if (providerClassIndex < previousProviderClassIndex) {
      throw new Error("Lifecycle attribution record order mismatch");
    }
    if (providerClassIndex !== previousProviderClassIndex) {
      previousProviderClassIndex = providerClassIndex;
      unknownSeen = false;
    } else if (unknownSeen && record.source !== "unknown") {
      throw new Error("Lifecycle attribution record order mismatch");
    }
    unknownSeen = record.source === "unknown";
  }
}

function providerTotalsFromUsage(usage: SessionTokenUsage): SessionLifecycleAttributionProviderTotals {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cache_read: usage.cacheReadTokens,
    cache_write: usage.cacheWriteTokens,
  };
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structurallyEqual(value, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(rightRecord, key)
      && structurallyEqual(leftRecord[key], rightRecord[key]));
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

function reconcileProviderClassAllocations(
  providerTokenClass: SessionProviderTokenClass,
  providerTotal: number,
  allocations: readonly SessionLifecycleAttributionAllocation[],
): readonly SessionLifecycleAttributionAllocation[] {
  const allocated = allocations.reduce((total, allocation) => total + validateAllocation(allocation), 0);
  if (allocated <= providerTotal) {
    return allocations;
  }
  if (allocations.some((allocation) => allocation.quality === "provider_reported" || allocation.cost?.quality === "provider_reported")) {
    throw new Error(`Lifecycle attribution for ${providerTokenClass} exceeds provider-reported usage`);
  }
  if (providerTotal === 0) {
    return [];
  }
  return clampEstimatedAllocationsToProviderTotal(allocations, providerTotal);
}

function clampEstimatedAllocationsToProviderTotal(
  allocations: readonly SessionLifecycleAttributionAllocation[],
  providerTotal: number,
): readonly SessionLifecycleAttributionAllocation[] {
  let remaining = providerTotal;
  const clamped: SessionLifecycleAttributionAllocation[] = [];
  for (const allocation of allocations) {
    if (remaining <= 0) {
      break;
    }
    const tokens = Math.min(allocation.tokens, remaining);
    remaining -= tokens;
    clamped.push({
      ...allocation,
      tokens,
      cost: undefined,
      quality: allocation.quality ?? "estimated",
    });
  }
  return clamped;
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
