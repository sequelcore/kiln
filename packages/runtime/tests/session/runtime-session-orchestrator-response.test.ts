import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapter } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { finalizeRuntimeSessionResponse } from "../../src/session/runtime-session-orchestrator-response.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { ToolExecutionSummary } from "../../src/session/runtime-session-orchestrator.types.js";
import {
  deriveRuntimeConvergencePolicyInput,
  RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT,
} from "../../src/session/runtime-execution-envelope.js";

function session(): RuntimeSession {
  return new RuntimeSession({
    appName: "app",
    tenantId: "tenant",
    userId: "user",
    systemPrompt: "base",
  });
}

function provider(): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      parts: textParts("done"),
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function liveLoopConvergence() {
  return {
    policy: deriveRuntimeConvergencePolicyInput({
      ...RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT,
      policyId: "test.runtime.response-convergence",
    }),
    progressEvidence: [],
  };
}

describe("finalizeRuntimeSessionResponse", () => {
  const unresolvedManagedInvocationFailure: ToolExecutionSummary = {
    toolName: "managed_agent.invoke",
    success: false,
    durationMs: 10,
    resultSummary: "Managed invocation route cannot execute this phase because it lacks required tools: bash.",
    metadata: {
      kind: "managed-invocation",
      status: "unavailable",
      goal: { id: "goal-external-runtime", status: "active" },
    },
  };

  it("does not let a success-claiming final message stand when canonical outcome disagrees", async () => {
    const unqualifiedSuccessClaim = textParts(
      "Navigation to both objectives succeeded and the console is clean.",
    );

    const result = await finalizeRuntimeSessionResponse({
      deps: { provider: provider() },
      session: session(),
      parts: unqualifiedSuccessClaim,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      usageTotals: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      toolExecutions: [unresolvedManagedInvocationFailure],
      disposition: { outcome: "failed", dispositionReason: "runtime_failure" },
    });

    expect(result.outcome).not.toBe("completed");
    expect(result.parts).not.toEqual(unqualifiedSuccessClaim);
  });

  it("reconciles the transcript, not just the returned response", async () => {
    const unqualifiedSuccessClaim = textParts(
      "Navigation to both objectives succeeded and the console is clean.",
    );
    const testSession = session();

    const result = await finalizeRuntimeSessionResponse({
      deps: { provider: provider() },
      session: testSession,
      parts: unqualifiedSuccessClaim,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      usageTotals: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      toolExecutions: [unresolvedManagedInvocationFailure],
      disposition: { outcome: "failed", dispositionReason: "runtime_failure" },
    });

    const lastMessage = testSession.conversationHistory.at(-1);
    expect(lastMessage?.parts).toEqual(result.parts);
    expect(lastMessage?.parts).not.toEqual(unqualifiedSuccessClaim);
  });

  it("preserves governed incomplete disposition and live-loop convergence evidence", async () => {
    const convergence = liveLoopConvergence();
    const result = await finalizeRuntimeSessionResponse({
      deps: { provider: provider() },
      session: session(),
      parts: textParts("Governed work remains incomplete."),
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      usageTotals: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      toolExecutions: [],
      disposition: {
        outcome: "failed",
        dispositionReason: "governed_work_incomplete",
        convergence,
      },
    });

    expect(result).toMatchObject({
      outcome: "failed",
      dispositionReason: "governed_work_incomplete",
      convergence: {
        policy: { policyId: "test.runtime.response-convergence" },
        progressEvidence: [],
      },
    });
  });
});
