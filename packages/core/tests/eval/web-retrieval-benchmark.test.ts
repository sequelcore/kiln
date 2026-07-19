import { describe, expect, it } from "vitest";
import {
  evaluateWebRetrievalBenchmark,
  projectWebRetrievalObservation,
} from "../../src/eval/web-retrieval-benchmark.js";

describe("evaluateWebRetrievalBenchmark", () => {
  it("compares providers on contract compliance, evidence recall, decisions, diversity, latency, and cost", () => {
    const report = evaluateWebRetrievalBenchmark([
      {
        taskId: "match-result",
        provider: "tavily",
        allowedDomains: ["espn.com", "tudn.com"],
        expectedUrls: ["https://espn.com/match", "https://tudn.com/match"],
        returnedUrls: ["https://espn.com/match", "https://spam.example/result"],
        shouldAccept: true,
        accepted: false,
        latencyMs: 120,
        costUsd: 0.002,
      },
      {
        taskId: "match-result",
        provider: "brave",
        allowedDomains: ["espn.com", "tudn.com"],
        expectedUrls: ["https://espn.com/match", "https://tudn.com/match"],
        returnedUrls: ["https://espn.com/match", "https://tudn.com/match"],
        shouldAccept: true,
        accepted: true,
        latencyMs: 80,
        costUsd: 0.001,
      },
    ]);

    expect(report.benchmarkId).toBe("web-retrieval-v1");
    expect(report.snapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(report.providers).toEqual([
      expect.objectContaining({
        provider: "brave",
        domainComplianceRate: 1,
        goldUrlRecall: 1,
        decisionAccuracy: 1,
        meanSourceDiversity: 2,
        meanLatencyMs: 80,
        totalCostUsd: 0.001,
      }),
      expect.objectContaining({
        provider: "tavily",
        domainComplianceRate: 0.5,
        goldUrlRecall: 0.5,
        decisionAccuracy: 0,
        meanSourceDiversity: 2,
        meanLatencyMs: 120,
        totalCostUsd: 0.002,
      }),
    ]);
  });

  it("rejects duplicate task/provider observations so snapshots remain reproducible", () => {
    const observation = {
      taskId: "same",
      provider: "provider",
      allowedDomains: [] as const,
      expectedUrls: [] as const,
      returnedUrls: [] as const,
      shouldAccept: false,
      accepted: false,
    };
    expect(() => evaluateWebRetrievalBenchmark([observation, observation])).toThrow(
      "duplicate observation for task same and provider provider",
    );
  });

  it("projects governed fallback metadata including rejected provider URLs", () => {
    const observation = projectWebRetrievalObservation({
      taskId: "fallback",
      expectedUrls: ["https://docs.example.com/kiln"],
      shouldAccept: true,
    }, {
      toolName: "web_search",
      kind: "web",
      operation: "search",
      provider: "brave",
      domains: ["docs.example.com"],
      sources: [{ url: "https://docs.example.com/kiln" }],
      providerUsage: { costUsd: 0.001 },
      providerAttempts: [{
        providerId: "primary",
        provider: "tavily",
        outcome: "contract_rejected",
        durationMs: 50,
        rejectedSourceIds: ["https://spam.example/result"],
      }, {
        providerId: "fallback",
        provider: "brave",
        outcome: "accepted",
        durationMs: 30,
      }],
    });

    expect(observation).toEqual({
      taskId: "fallback",
      provider: "tavily -> brave",
      allowedDomains: ["docs.example.com"],
      expectedUrls: ["https://docs.example.com/kiln"],
      returnedUrls: ["https://docs.example.com/kiln", "https://spam.example/result"],
      shouldAccept: true,
      accepted: true,
      latencyMs: 80,
      costUsd: 0.001,
    });
  });
});
