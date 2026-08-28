import { describe, expect, it } from "vitest";
import {
  decideTurnConvergence,
  resolveTurnConvergencePolicy,
  type TurnConvergenceObservation,
  type TurnConvergencePolicyInput,
  type TurnConvergenceReservation,
} from "../../src/agents/turn-convergence.js";

const POLICY_INPUT: TurnConvergencePolicyInput = {
  policyId: "turn-convergence",
  configurationHash: `sha256:${"0".repeat(64)}`,
  providerRequests: 3,
  toolRounds: 3,
  toolCalls: 4,
  cumulativeInputTokens: 100,
  elapsedMs: 1_000,
  activeMs: 800,
  recoveryAttempts: 2,
  consecutiveNoProgressSteps: 2,
};

const PROVIDER_REQUEST: TurnConvergenceReservation = {
  kind: "provider_request",
  projectedInputTokens: { status: "observed", value: 10 },
};

const TOOL_BATCH: TurnConvergenceReservation = {
  kind: "tool_batch",
  toolCallCount: 1,
};

function policy(overrides: Partial<TurnConvergencePolicyInput> = {}) {
  return resolveTurnConvergencePolicy({ ...POLICY_INPUT, ...overrides });
}

function observation(overrides: Partial<TurnConvergenceObservation> = {}): TurnConvergenceObservation {
  return {
    providerRequests: 0,
    toolRounds: 0,
    toolCalls: 0,
    cumulativeInputTokens: { status: "observed", value: 10 },
    elapsedMs: 0,
    activeMs: { status: "observed", value: 10 },
    recoveryAttempts: 0,
    consecutiveNoProgressSteps: 0,
    ...overrides,
  };
}

describe("turn convergence policy", () => {
  it("copies and freezes a resolved policy", () => {
    const input = { ...POLICY_INPUT };
    const resolved = resolveTurnConvergencePolicy(input);

    expect(resolved).toEqual(input);
    expect(resolved).not.toBe(input);
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it.each([
    ["policyId", { policyId: "" }],
    ["configurationHash", { configurationHash: " " }],
    ["configurationHash", { configurationHash: "sha256:turn-convergence" }],
    ["providerRequests", { providerRequests: 0 }],
    ["toolRounds", { toolRounds: 1.5 }],
    ["toolCalls", { toolCalls: Number.POSITIVE_INFINITY }],
    ["cumulativeInputTokens", { cumulativeInputTokens: Number.MAX_SAFE_INTEGER + 1 }],
    ["elapsedMs", { elapsedMs: Number.NaN }],
    ["activeMs", { activeMs: -1 }],
    ["recoveryAttempts", { recoveryAttempts: 0 }],
    ["consecutiveNoProgressSteps", { consecutiveNoProgressSteps: 0 }],
  ] as const)("rejects invalid %s policy input", (_field, override) => {
    expect(() => resolveTurnConvergencePolicy({ ...POLICY_INPUT, ...override })).toThrow();
  });

  it("pauses for elapsed time before lower-priority reasons", () => {
    expect(decideTurnConvergence(
      policy(),
      observation({ elapsedMs: 1_000, activeMs: { status: "unknown", reason: "clock unavailable" } }),
      PROVIDER_REQUEST,
    )).toEqual({
      status: "pause",
      reason: "elapsed_time_limit",
      metric: "elapsedMs",
      observed: 1_000,
      limit: 1_000,
    });
  });

  it("pauses when active time is unknown or at its limit", () => {
    expect(decideTurnConvergence(
      policy(),
      observation({ activeMs: { status: "unknown", reason: "activity clock unavailable" } }),
      PROVIDER_REQUEST,
    )).toEqual({
      status: "pause",
      reason: "observation_unavailable",
      metric: "activeMs",
      unknownReason: "activity clock unavailable",
    });
    expect(decideTurnConvergence(
      policy(),
      observation({ activeMs: { status: "observed", value: 800 } }),
      PROVIDER_REQUEST,
    )).toEqual({
      status: "pause",
      reason: "active_time_limit",
      metric: "activeMs",
      observed: 800,
      limit: 800,
    });
  });

  it("pauses at recovery and no-progress limits in order", () => {
    expect(decideTurnConvergence(
      policy(),
      observation({ recoveryAttempts: 2, consecutiveNoProgressSteps: 2 }),
      PROVIDER_REQUEST,
    )).toEqual({
      status: "pause",
      reason: "recovery_limit",
      metric: "recoveryAttempts",
      observed: 2,
      limit: 2,
    });
    expect(decideTurnConvergence(
      policy(),
      observation({ consecutiveNoProgressSteps: 2 }),
      PROVIDER_REQUEST,
    )).toEqual({
      status: "pause",
      reason: "no_progress",
      metric: "consecutiveNoProgressSteps",
      observed: 2,
      limit: 2,
    });
  });

  it("pauses at the provider request, tool round, and tool call limits", () => {
    expect(decideTurnConvergence(
      policy(),
      observation({ providerRequests: 3 }),
      PROVIDER_REQUEST,
    )).toEqual({
      status: "pause",
      reason: "provider_request_limit",
      metric: "providerRequests",
      observed: 3,
      limit: 3,
    });
    expect(decideTurnConvergence(
      policy(),
      observation({ toolRounds: 3 }),
      TOOL_BATCH,
    )).toEqual({
      status: "pause",
      reason: "tool_round_limit",
      metric: "toolRounds",
      observed: 3,
      limit: 3,
    });
    expect(decideTurnConvergence(
      policy(),
      observation({ toolCalls: 4 }),
      TOOL_BATCH,
    )).toEqual({
      status: "pause",
      reason: "tool_call_limit",
      metric: "toolCalls",
      observed: 5,
      limit: 4,
    });
  });

  it("stops a provider request when the hard tool-round limit is already reached", () => {
    expect(decideTurnConvergence(
      policy(),
      observation({ toolRounds: 3 }),
      PROVIDER_REQUEST,
    )).toEqual({
      status: "pause",
      reason: "tool_round_limit",
      metric: "toolRounds",
      observed: 3,
      limit: 3,
    });
  });

  it("pauses when cumulative input is unknown or would overshoot", () => {
    expect(decideTurnConvergence(
      policy(),
      observation({ cumulativeInputTokens: { status: "unknown", reason: "provider omitted usage" } }),
      PROVIDER_REQUEST,
    )).toEqual({
      status: "pause",
      reason: "observation_unavailable",
      metric: "cumulativeInputTokens",
      unknownReason: "provider omitted usage",
    });
    expect(decideTurnConvergence(
      policy(),
      observation({ cumulativeInputTokens: { status: "observed", value: 95 } }),
      { ...PROVIDER_REQUEST, projectedInputTokens: { status: "observed", value: 6 } },
    )).toEqual({
      status: "pause",
      reason: "cumulative_input_limit",
      metric: "cumulativeInputTokens",
      observed: 101,
      limit: 100,
    });
  });

  it("allows projected input exactly at the maximum and pauses an atomic batch overshoot", () => {
    expect(decideTurnConvergence(
      policy(),
      observation({ cumulativeInputTokens: { status: "observed", value: 90 } }),
      PROVIDER_REQUEST,
    )).toEqual({ status: "continue" });
    expect(decideTurnConvergence(
      policy(),
      observation({ toolCalls: 3 }),
      { kind: "tool_batch", toolCallCount: 2 },
    )).toEqual({
      status: "pause",
      reason: "tool_call_limit",
      metric: "toolCalls",
      observed: 5,
      limit: 4,
    });
  });

  it("continues when every relevant value is just below its limit", () => {
    expect(decideTurnConvergence(
      policy(),
      observation({
        providerRequests: 2,
        cumulativeInputTokens: { status: "observed", value: 89 },
        elapsedMs: 999,
        activeMs: { status: "observed", value: 799 },
        recoveryAttempts: 1,
        consecutiveNoProgressSteps: 1,
      }),
      { kind: "provider_request", projectedInputTokens: { status: "observed", value: 10 } },
    )).toEqual({ status: "continue" });
    expect(decideTurnConvergence(
      policy(),
      observation({ toolRounds: 2, toolCalls: 2 }),
      { kind: "tool_batch", toolCallCount: 1 },
    )).toEqual({ status: "continue" });
  });

  it("pauses when projected input is unavailable", () => {
    expect(decideTurnConvergence(
      policy(),
      observation(),
      { kind: "provider_request", projectedInputTokens: { status: "unknown", reason: "route did not project usage" } },
    )).toEqual({
      status: "pause",
      reason: "observation_unavailable",
      metric: "projectedInputTokens",
      unknownReason: "route did not project usage",
    });
  });

  it("fails closed for invalid observations", () => {
    expect(decideTurnConvergence(
      policy(),
      observation({ elapsedMs: Number.NaN }),
      PROVIDER_REQUEST,
    )).toEqual({
      status: "pause",
      reason: "observation_unavailable",
      metric: "elapsedMs",
      unknownReason: "elapsedMs observation is invalid",
    });
    expect(decideTurnConvergence(
      policy(),
      observation({ toolCalls: -1 }),
      TOOL_BATCH,
    )).toEqual({
      status: "pause",
      reason: "observation_unavailable",
      metric: "toolCalls",
      unknownReason: "toolCalls observation is invalid",
    });
  });

  it("rejects structurally invalid reservations", () => {
    expect(() => decideTurnConvergence(
      policy(),
      observation(),
      { kind: "provider_request", projectedInputTokens: { status: "observed", value: -1 } },
    )).toThrow();
    expect(() => decideTurnConvergence(
      policy(),
      observation(),
      { kind: "provider_request", projectedInputTokens: { status: "observed", value: 1.5 } },
    )).toThrow();
    expect(() => decideTurnConvergence(
      policy(),
      observation(),
      { kind: "tool_batch", toolCallCount: 0 },
    )).toThrow();
    expect(() => decideTurnConvergence(
      policy(),
      observation(),
      { kind: "tool_batch", toolCallCount: Number.MAX_SAFE_INTEGER + 1 },
    )).toThrow();
  });
});
