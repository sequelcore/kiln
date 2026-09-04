import { describe, expect, it } from "vitest";
import {
  evaluateContextEfficiencyTrialBudget,
  sumContextEfficiencyObservedUsage,
  type ContextEfficiencyTrialBudgetInput,
} from "./context-efficiency-trial-budget.js";

function input(overrides: Partial<ContextEfficiencyTrialBudgetInput> = {}): ContextEfficiencyTrialBudgetInput {
  return {
    limits: {
      timeoutMs: 100,
      maximumCumulativeInputTokens: 100,
      maximumCumulativeOutputTokens: 50,
      maximumProviderRequests: 8,
      maximumToolCalls: 4,
      maximumManagedChildren: 2,
    },
    elapsedMs: 20,
    toolCallCount: 1,
    managedChildCount: 0,
    failed: false,
    physicalRequests: [{ requestId: "parent:1", inputTokens: 10, outputTokens: 5 }],
    ...overrides,
  };
}

describe("context efficiency trial budget", () => {
  it("allocates the eighth physical request but stops before a ninth", () => {
    const physicalRequests = Array.from({ length: 7 }, (_, index) => ({
      requestId: `parent:${index + 1}`,
      inputTokens: 1,
      outputTokens: 1,
    }));
    expect(evaluateContextEfficiencyTrialBudget(input({ physicalRequests }))).toMatchObject({
      kind: "allow",
      allocation: { remainingProviderRequests: 1 },
    });
    expect(evaluateContextEfficiencyTrialBudget(input({
      physicalRequests: [...physicalRequests, { requestId: "parent:8", inputTokens: 1, outputTokens: 1 }],
    }))).toMatchObject({ kind: "stop", reason: "provider_request_exhausted" });
  });

  it.each([
    ["elapsed", input({ elapsedMs: 100 }), "elapsed_exhausted"],
    ["input", input({ physicalRequests: [{ requestId: "parent:1", inputTokens: 100, outputTokens: 1 }] }), "input_tripwire"],
    ["output", input({ physicalRequests: [{ requestId: "parent:1", inputTokens: 1, outputTokens: 50 }] }), "output_tripwire"],
  ] as const)("stops when the %s allocation is exhausted", (_name, budgetInput, reason) => {
    expect(evaluateContextEfficiencyTrialBudget(budgetInput)).toMatchObject({ kind: "stop", reason });
  });

  it("includes child observations and refuses unknown child usage", () => {
    const childUnknown = input({
      physicalRequests: [
        { requestId: "parent:1", inputTokens: 10, outputTokens: 5 },
        { requestId: "child:invocation-1:1", inputTokens: "unknown", outputTokens: 4 },
      ],
    });
    expect(evaluateContextEfficiencyTrialBudget(childUnknown)).toEqual({
      kind: "stop",
      reason: "usage_unknown",
      usage: { kind: "unknown", physicalRequestCount: 2, reason: "unknown_token_usage" },
    });
  });

  it("counts every unique dispatched request after an unknown intermediate retry", () => {
    const summary = sumContextEfficiencyObservedUsage([
      { requestId: "parent:1", inputTokens: 10, outputTokens: 5 },
      { requestId: "parent:retry:1", inputTokens: "unknown", outputTokens: "unknown" },
      { requestId: "child:invocation-1:1", inputTokens: 3, outputTokens: 2 },
    ]);
    expect(summary).toEqual({
      kind: "unknown",
      physicalRequestCount: 3,
      reason: "unknown_token_usage",
    });
    expect(evaluateContextEfficiencyTrialBudget(input({ physicalRequests: [
      { requestId: "parent:1", inputTokens: 10, outputTokens: 5 },
      { requestId: "parent:retry:1", inputTokens: "unknown", outputTokens: "unknown" },
      { requestId: "child:invocation-1:1", inputTokens: 3, outputTokens: 2 },
    ] }))).toMatchObject({ kind: "stop", reason: "usage_unknown" });
  });

  it("does not double count a repeated physical request identity", () => {
    const summary = sumContextEfficiencyObservedUsage([
      { requestId: "parent:1", inputTokens: 10, outputTokens: 5 },
      { requestId: "parent:1", inputTokens: 10, outputTokens: 5 },
    ]);
    expect(summary).toEqual({
      kind: "unknown",
      physicalRequestCount: 1,
      reason: "duplicate_physical_request",
    });
    expect(evaluateContextEfficiencyTrialBudget(input({ physicalRequests: [
      { requestId: "parent:1", inputTokens: 10, outputTokens: 5 },
      { requestId: "parent:1", inputTokens: 10, outputTokens: 5 },
    ] }))).toMatchObject({ kind: "stop", reason: "usage_unknown" });
  });

  it.each([
    { requestId: "parent:1", inputTokens: -1, outputTokens: 0 },
    { requestId: "parent:1", inputTokens: Number.NaN, outputTokens: 0 },
  ])("rejects invalid token usage instead of treating it as zero", (physicalRequest) => {
    expect(evaluateContextEfficiencyTrialBudget(input({ physicalRequests: [physicalRequest] }))).toMatchObject({
      kind: "stop",
      reason: "usage_unknown",
      usage: { kind: "unknown", reason: "invalid_token_usage" },
    });
  });

  it("counts later requests when an intermediate token observation is invalid", () => {
    expect(sumContextEfficiencyObservedUsage([
      { requestId: "parent:1", inputTokens: 10, outputTokens: 5 },
      { requestId: "parent:retry:1", inputTokens: -1, outputTokens: 0 },
      { requestId: "child:invocation-1:1", inputTokens: 3, outputTokens: 2 },
    ])).toEqual({
      kind: "unknown",
      physicalRequestCount: 3,
      reason: "invalid_token_usage",
    });
  });

  it("stops after a prior terminal failure", () => {
    expect(evaluateContextEfficiencyTrialBudget(input({ failed: true }))).toMatchObject({
      kind: "stop",
      reason: "failure",
    });
  });
});
