import { describe, expect, it } from "vitest";
import { RuntimeTurnConvergenceObservationCollector } from "../../src/session/runtime-turn-convergence-observation.js";

describe("RuntimeTurnConvergenceObservationCollector", () => {
  it("starts with finite turn-local observations and no lifetime telemetry", () => {
    let now = 100;
    const collector = new RuntimeTurnConvergenceObservationCollector(() => now);

    expect(collector.snapshot()).toEqual({
      providerRequests: 0,
      toolRounds: 0,
      toolCalls: 0,
      cumulativeInputTokens: { status: "observed", value: 0 },
      elapsedMs: 0,
      activeMs: { status: "observed", value: 0 },
      recoveryAttempts: 0,
      consecutiveNoProgressSteps: 0,
    });

    now = 125;
    expect(collector.snapshot().providerRequests).toBe(0);
    expect(collector.snapshot().elapsedMs).toBe(25);
  });

  it("records provider input and completed provider/tool active duration", () => {
    let now = 10;
    const collector = new RuntimeTurnConvergenceObservationCollector(() => now);

    const providerStartedAt = collector.recordProviderRequestStarted();
    now = 35;
    expect(collector.recordProviderRequestCompleted(providerStartedAt, 12)).toEqual({ durationMs: 25 });
    collector.recordToolRound(2);
    collector.recordToolExecutionDuration(7);

    expect(collector.snapshot()).toMatchObject({
      providerRequests: 1,
      toolRounds: 1,
      toolCalls: 2,
      cumulativeInputTokens: { status: "observed", value: 12 },
      activeMs: { status: "observed", value: 32 },
    });
  });

  it("reads the completion clock once and returns the duration used for active accounting", () => {
    let reads = 0;
    const collector = new RuntimeTurnConvergenceObservationCollector(() => {
      reads += 1;
      return reads === 1 ? 10 : reads === 2 ? 20 : 30;
    });
    const startedAt = collector.recordProviderRequestStarted();
    const completion = collector.recordProviderRequestCompleted(startedAt, 1);

    expect(reads).toBe(3);
    expect(completion.durationMs).toBe(10);
    expect(collector.snapshot().activeMs).toEqual({ status: "observed", value: 10 });
  });

  it("fails closed when provider usage or the clock is unavailable", () => {
    let now = 0;
    const collector = new RuntimeTurnConvergenceObservationCollector(() => now);
    const providerStartedAt = collector.recordProviderRequestStarted();
    now = Number.NaN;
    collector.recordProviderRequestCompleted(providerStartedAt, undefined);

    expect(collector.snapshot()).toMatchObject({
      elapsedMs: Number.NaN,
      cumulativeInputTokens: {
        status: "unknown",
        reason: "provider-reported input token usage is unavailable or invalid",
      },
      activeMs: {
        status: "unknown",
      },
    });
  });

  it("retains a reserved no-progress method without classifying live turns", () => {
    const collector = new RuntimeTurnConvergenceObservationCollector(() => 0);
    collector.recordNoProgressStep();
    expect(collector.snapshot().consecutiveNoProgressSteps).toBe(1);
    collector.recordProgress();
    expect(collector.snapshot().consecutiveNoProgressSteps).toBe(0);
  });
});
