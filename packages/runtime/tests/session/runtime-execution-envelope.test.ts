import { describe, expect, it } from "vitest";
import { digestManagedEconomicValue } from "@kilnai/core/cost";
import {
  deriveRuntimeConvergencePolicyInput,
  resolveRuntimeExecutionEnvelope,
  RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY,
  RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_ID,
  RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT,
} from "../../src/session/runtime-execution-envelope.js";

describe("Runtime execution envelope convergence", () => {
  it("resolves a finite immutable default policy when no envelope is provided", () => {
    const resolved = resolveRuntimeExecutionEnvelope(undefined);

    expect(resolved.convergence).toBe(RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY);
    expect(resolved.convergence).toEqual({
      policyId: RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_ID,
      configurationHash: RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT.configurationHash,
      providerRequests: 10,
      toolRounds: 8,
      toolCalls: 24,
      cumulativeInputTokens: 256_000,
      elapsedMs: 600_000,
      activeMs: 600_000,
      recoveryAttempts: 3,
      consecutiveNoProgressSteps: 3,
    });
    expect(resolved.convergence.configurationHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.convergence)).toBe(true);
  });

  it("replaces the default with every explicit finite policy value", () => {
    const explicit = {
      policyId: "runtime-test.explicit",
      configurationHash: `sha256:${"1".repeat(64)}`,
      providerRequests: 2,
      toolRounds: 3,
      toolCalls: 4,
      cumulativeInputTokens: 5,
      elapsedMs: 6,
      activeMs: 7,
      recoveryAttempts: 8,
      consecutiveNoProgressSteps: 9,
    } as const;

    const resolved = resolveRuntimeExecutionEnvelope({ convergence: explicit });

    expect(resolved.convergence).toEqual(explicit);
    expect(resolved.convergence).not.toBe(RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY);
  });

  it("rejects invalid convergence and conversation values at the Runtime boundary", () => {
    expect(() => resolveRuntimeExecutionEnvelope({
      convergence: { ...RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT, toolRounds: 0 },
    })).toThrow("toolRounds must be a finite positive safe integer");

    expect(() => resolveRuntimeExecutionEnvelope({
      convergence: { ...RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT, elapsedMs: Number.NaN },
    })).toThrow("elapsedMs must be a finite positive safe integer");

    expect(() => resolveRuntimeExecutionEnvelope({
      convergence: { ...RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT, configurationHash: "sha256:invalid" },
    })).toThrow("configurationHash must be a sha256:<64 lowercase hex> digest");

    expect(() => deriveRuntimeConvergencePolicyInput({
      policyId: "runtime-test.invalid",
      toolRounds: 0,
    })).toThrow("toolRounds must be a finite positive safe integer");

    expect(() => resolveRuntimeExecutionEnvelope({
      conversation: { toolResults: { triggerToolResultTokens: 0, retainRecentToolResults: 1 } },
    })).toThrow("triggerToolResultTokens must be a positive integer");
  });

  it("keeps conversation projection independent from convergence resolution", () => {
    const explicit = deriveRuntimeConvergencePolicyInput({
      policyId: "runtime-test.conversation-independent",
      toolRounds: 12,
    });
    const withoutConversation = resolveRuntimeExecutionEnvelope({ convergence: explicit });
    const withConversation = resolveRuntimeExecutionEnvelope({
      convergence: explicit,
      conversation: { toolResults: { triggerToolResultTokens: 1_024, retainRecentToolResults: 2 } },
    });

    expect(withoutConversation.convergence).toEqual(withConversation.convergence);
    expect(withoutConversation.conversation).toBeUndefined();
    expect(withConversation.conversation).toEqual({
      toolResults: { triggerToolResultTokens: 1_024, retainRecentToolResults: 2 },
    });
    expect(Object.isFrozen(withConversation.conversation)).toBe(true);
  });

  it("derives a complete named override with a deterministic policy hash", () => {
    const derived = deriveRuntimeConvergencePolicyInput({
      policyId: "kiln.managed-direct.default",
      toolRounds: 32,
    });
    const expectedHash = digestManagedEconomicValue({
      policyId: derived.policyId,
      providerRequests: derived.providerRequests,
      toolRounds: derived.toolRounds,
      toolCalls: derived.toolCalls,
      cumulativeInputTokens: derived.cumulativeInputTokens,
      elapsedMs: derived.elapsedMs,
      activeMs: derived.activeMs,
      recoveryAttempts: derived.recoveryAttempts,
      consecutiveNoProgressSteps: derived.consecutiveNoProgressSteps,
    });

    expect(derived).toEqual({
      ...RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT,
      policyId: "kiln.managed-direct.default",
      toolRounds: 32,
      configurationHash: expectedHash,
    });
    expect(deriveRuntimeConvergencePolicyInput({
      policyId: "kiln.managed-direct.default",
      toolRounds: 32,
    })).toEqual(derived);
    expect(deriveRuntimeConvergencePolicyInput({
      policyId: "kiln.other-policy",
      toolRounds: 32,
    }).configurationHash).not.toBe(derived.configurationHash);
    expect(deriveRuntimeConvergencePolicyInput({
      policyId: derived.policyId,
      toolRounds: 4,
    }, derived).configurationHash).not.toBe(derived.configurationHash);
  });
});
