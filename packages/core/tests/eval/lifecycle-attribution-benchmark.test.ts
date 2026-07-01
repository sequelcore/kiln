import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createSessionEvent,
  projectCostUpdatedEventToLifecycleLedger,
  replayLifecycleAttributionEvidence,
  summarizeLifecycleAttributionLedger,
  type SessionLifecycleAttributionAllocation,
  type SessionProviderTokenClass,
  type SessionTokenUsage,
} from "../../src/events/index.js";

interface LifecycleAttributionBenchmarkCase {
  readonly caseId: string;
  readonly providerUsage: SessionTokenUsage;
  readonly allocations?: readonly SessionLifecycleAttributionAllocation[];
  readonly expected: {
    readonly semanticSourceCoverage: "unknown" | "partial-estimated";
    readonly overflowClampedProviderTokenClass?: SessionProviderTokenClass;
    readonly overflowClampedSource?: SessionLifecycleAttributionAllocation["source"];
  };
}

interface LifecycleAttributionBenchmarkResult {
  readonly caseId: string;
  readonly providerTotals: SessionTokenUsage;
  readonly semanticSourceCoverage: "unknown" | "partial-estimated";
}

describe("lifecycle attribution benchmark fixture", () => {
  it("reconciles and replays deterministic Slice 1 closure cases without fabricated precision", () => {
    const cases = readBenchmarkCases();

    expect(cases.map((entry) => entry.caseId)).toEqual([
      "unknown-aggregate-input",
      "mixed-estimated-and-unknown",
      "estimated-output-overflow",
    ]);

    const firstRun = cases.map(evaluateBenchmarkCase);
    const secondRun = cases.map(evaluateBenchmarkCase);

    expect(secondRun).toEqual(firstRun);
  });
});

function evaluateBenchmarkCase(entry: LifecycleAttributionBenchmarkCase): LifecycleAttributionBenchmarkResult {
      const costEvent = createSessionEvent<"cost_updated">({
        kind: "cost_updated",
        kilnSessionId: `session:${entry.caseId}`,
        sequence: 1,
        turnId: `session:${entry.caseId}:turn:1`,
        provider: {
          provider: "fixture-provider",
          model: "fixture-model",
        },
        usage: entry.providerUsage,
        cost: {
          currency: "USD",
          deltaUsd: 0.01,
        },
      }, {
        generateEventId: () => `event:${entry.caseId}:cost`,
        now: () => new Date("2026-06-30T12:00:00.000Z"),
      });
      const ledger = projectCostUpdatedEventToLifecycleLedger(costEvent, {
        allocations: entry.allocations,
        context: {
          route: "fixture-provider/fixture-model",
        },
      });
      const replayed = replayLifecycleAttributionEvidence({
        costEvent,
        ledger,
        summary: summarizeLifecycleAttributionLedger(ledger),
      });

      expect(replayed.providerTotals.input).toBe(entry.providerUsage.inputTokens);
      expect(replayed.providerTotals.output).toBe(entry.providerUsage.outputTokens);
      expect(replayed.providerTotals.cache_read).toBe(entry.providerUsage.cacheReadTokens);
      expect(replayed.providerTotals.cache_write).toBe(entry.providerUsage.cacheWriteTokens);
      expect(replayed.summary.totalCostUsd).toBeCloseTo(costEvent.cost.deltaUsd);
      assertCacheTokenClassRecords(entry, ledger);
      assertOverflowClamp(entry, ledger);
      expect(ledger.records.some((record) => record.source === "unknown")).toBe(true);
      if (entry.expected.semanticSourceCoverage === "unknown") {
        expect(ledger.records.every((record) => record.source === "unknown")).toBe(true);
      } else {
        expect(ledger.records.some((record) => record.quality === "estimated")).toBe(true);
      }

  return {
    caseId: entry.caseId,
    providerTotals: entry.providerUsage,
    semanticSourceCoverage: entry.expected.semanticSourceCoverage,
  };
}

function assertCacheTokenClassRecords(
  entry: LifecycleAttributionBenchmarkCase,
  ledger: ReturnType<typeof projectCostUpdatedEventToLifecycleLedger>,
): void {
  if (entry.providerUsage.cacheReadTokens > 0) {
    expect(ledger.records).toContainEqual(expect.objectContaining({
      source: "unknown",
      tokenClass: "cached",
      providerTokenClass: "cache_read",
      tokens: entry.providerUsage.cacheReadTokens,
    }));
  }
  if (entry.providerUsage.cacheWriteTokens > 0) {
    expect(ledger.records).toContainEqual(expect.objectContaining({
      source: "unknown",
      tokenClass: "cache_written",
      providerTokenClass: "cache_write",
      tokens: entry.providerUsage.cacheWriteTokens,
    }));
  }
}

function assertOverflowClamp(
  entry: LifecycleAttributionBenchmarkCase,
  ledger: ReturnType<typeof projectCostUpdatedEventToLifecycleLedger>,
): void {
  const providerTokenClass = entry.expected.overflowClampedProviderTokenClass;
  if (!providerTokenClass) {
    return;
  }
  const expectedSource = entry.expected.overflowClampedSource;
  const records = ledger.records.filter((record) => record.providerTokenClass === providerTokenClass);
  const expectedTokens = providerTokenClass === "input"
    ? entry.providerUsage.inputTokens
    : providerTokenClass === "output"
      ? entry.providerUsage.outputTokens
      : providerTokenClass === "cache_read"
        ? entry.providerUsage.cacheReadTokens
        : entry.providerUsage.cacheWriteTokens;

  expect(records).toEqual([expect.objectContaining({
    source: expectedSource,
    providerTokenClass,
    tokens: expectedTokens,
    quality: "estimated",
  })]);
  expect(records.reduce((total, record) => total + record.tokens, 0)).toBe(expectedTokens);
}

function readBenchmarkCases(): readonly LifecycleAttributionBenchmarkCase[] {
  const fixturePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../evals/benchmark/kiln-lifecycle-attribution-v1.jsonl",
  );
  return readFileSync(fixturePath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line) as LifecycleAttributionBenchmarkCase);
}
