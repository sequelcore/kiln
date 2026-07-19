import { createHash } from "node:crypto";
import type { WebToolResultMetadata } from "../tools/domain/tool-result-metadata.js";

export interface WebRetrievalBenchmarkObservation {
  readonly taskId: string;
  readonly provider: string;
  readonly allowedDomains: readonly string[];
  readonly expectedUrls: readonly string[];
  readonly returnedUrls: readonly string[];
  readonly shouldAccept: boolean;
  readonly accepted: boolean;
  readonly latencyMs?: number;
  readonly costUsd?: number;
}

export interface WebRetrievalProviderMetrics {
  readonly provider: string;
  readonly taskCount: number;
  readonly domainComplianceRate: number;
  readonly goldUrlRecall: number;
  readonly decisionAccuracy: number;
  readonly meanSourceDiversity: number;
  readonly meanLatencyMs?: number;
  readonly totalCostUsd?: number;
}

export interface WebRetrievalBenchmarkReport {
  readonly benchmarkId: "web-retrieval-v1";
  readonly snapshotHash: string;
  readonly observationCount: number;
  readonly providers: readonly WebRetrievalProviderMetrics[];
}

export interface WebRetrievalBenchmarkCase {
  readonly taskId: string;
  readonly expectedUrls: readonly string[];
  readonly shouldAccept: boolean;
}

export function projectWebRetrievalObservation(
  benchmarkCase: WebRetrievalBenchmarkCase,
  metadata: WebToolResultMetadata<"web_search">,
): WebRetrievalBenchmarkObservation {
  const attempts = metadata.providerAttempts ?? [];
  const provider = attempts.length > 1
    ? attempts.map((attempt) => attempt.provider).join(" -> ")
    : metadata.provider ?? attempts[0]?.provider ?? "unrouted";
  const rejectedUrls = attempts.flatMap((attempt) => attempt.rejectedSourceIds ?? []);
  const returnedUrls = [
    ...(metadata.sources ?? []).map((source) => source.url),
    ...rejectedUrls,
  ];
  const attemptDuration = attempts.reduce((total, attempt) => total + (attempt.durationMs ?? 0), 0);
  const hasAttemptDuration = attempts.some((attempt) => attempt.durationMs !== undefined);
  const costUsd = metadata.providerUsage?.["costUsd"];
  return {
    taskId: benchmarkCase.taskId,
    provider,
    allowedDomains: metadata.domains ?? [],
    expectedUrls: benchmarkCase.expectedUrls,
    returnedUrls,
    shouldAccept: benchmarkCase.shouldAccept,
    accepted: metadata.errorCode === undefined,
    ...(hasAttemptDuration
      ? { latencyMs: attemptDuration }
      : metadata.providerDurationMs !== undefined
        ? { latencyMs: metadata.providerDurationMs }
        : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

export function evaluateWebRetrievalBenchmark(
  observations: readonly WebRetrievalBenchmarkObservation[],
): WebRetrievalBenchmarkReport {
  const normalized = observations.map(normalizeObservation)
    .sort((left, right) => left.provider.localeCompare(right.provider) || left.taskId.localeCompare(right.taskId));
  const seen = new Set<string>();
  for (const observation of normalized) {
    const key = `${observation.provider}\u0000${observation.taskId}`;
    if (seen.has(key)) {
      throw new Error(`duplicate observation for task ${observation.taskId} and provider ${observation.provider}`);
    }
    seen.add(key);
  }

  const byProvider = new Map<string, WebRetrievalBenchmarkObservation[]>();
  for (const observation of normalized) {
    const group = byProvider.get(observation.provider) ?? [];
    group.push(observation);
    byProvider.set(observation.provider, group);
  }

  return {
    benchmarkId: "web-retrieval-v1",
    snapshotHash: `sha256:${createHash("sha256").update(JSON.stringify(normalized)).digest("hex")}`,
    observationCount: normalized.length,
    providers: [...byProvider.entries()].map(([provider, group]) => scoreProvider(provider, group)),
  };
}

function scoreProvider(
  provider: string,
  observations: readonly WebRetrievalBenchmarkObservation[],
): WebRetrievalProviderMetrics {
  let returnedCount = 0;
  let compliantCount = 0;
  let expectedCount = 0;
  let expectedHits = 0;
  let correctDecisions = 0;
  let diversity = 0;
  const latencies: number[] = [];
  const costs: number[] = [];

  for (const observation of observations) {
    const returned = new Set(observation.returnedUrls);
    returnedCount += returned.size;
    compliantCount += observation.allowedDomains.length === 0
      ? returned.size
      : [...returned].filter((url) => observation.allowedDomains.some((domain) => hostMatches(url, domain))).length;
    const expected = new Set(observation.expectedUrls);
    expectedCount += expected.size;
    expectedHits += [...expected].filter((url) => returned.has(url)).length;
    if (observation.accepted === observation.shouldAccept) correctDecisions += 1;
    diversity += new Set([...returned].map(readHostname)).size;
    if (observation.latencyMs !== undefined) latencies.push(observation.latencyMs);
    if (observation.costUsd !== undefined) costs.push(observation.costUsd);
  }

  return {
    provider,
    taskCount: observations.length,
    domainComplianceRate: returnedCount === 0 ? 1 : compliantCount / returnedCount,
    goldUrlRecall: expectedCount === 0 ? 1 : expectedHits / expectedCount,
    decisionAccuracy: observations.length === 0 ? 0 : correctDecisions / observations.length,
    meanSourceDiversity: observations.length === 0 ? 0 : diversity / observations.length,
    ...(latencies.length > 0 ? { meanLatencyMs: sum(latencies) / latencies.length } : {}),
    ...(costs.length > 0 ? { totalCostUsd: sum(costs) } : {}),
  };
}

function normalizeObservation(observation: WebRetrievalBenchmarkObservation): WebRetrievalBenchmarkObservation {
  const taskId = requireIdentifier(observation.taskId, "taskId");
  const provider = requireIdentifier(observation.provider, "provider");
  if (observation.latencyMs !== undefined && (!Number.isFinite(observation.latencyMs) || observation.latencyMs < 0)) {
    throw new Error("latencyMs must be a non-negative finite number");
  }
  if (observation.costUsd !== undefined && (!Number.isFinite(observation.costUsd) || observation.costUsd < 0)) {
    throw new Error("costUsd must be a non-negative finite number");
  }
  return {
    ...observation,
    taskId,
    provider,
    allowedDomains: [...new Set(observation.allowedDomains.map((domain) => domain.trim().toLowerCase()))].sort(),
    expectedUrls: [...new Set(observation.expectedUrls.map(normalizeUrl))].sort(),
    returnedUrls: [...new Set(observation.returnedUrls.map(normalizeUrl))].sort(),
  };
}

function requireIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`unsupported benchmark URL: ${value}`);
  url.hash = "";
  return url.toString();
}

function readHostname(value: string): string {
  return new URL(value).hostname.toLowerCase();
}

function hostMatches(url: string, domain: string): boolean {
  const hostname = readHostname(url);
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
