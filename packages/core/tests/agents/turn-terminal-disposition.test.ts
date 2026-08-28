import { describe, expect, it } from "vitest";
import type {
  CompletionSettlementEvidence,
  TurnConvergenceSettlementEvidence,
  TurnTerminalDisposition,
} from "../../src/agents/index.js";

describe("TurnTerminalDisposition", () => {
  it("models an empty producer obligation set as explicitly eligible", () => {
    const completion: CompletionSettlementEvidence = {
      obligations: [],
      producerEvidence: [],
      eligibility: { status: "eligible" },
    };
    const disposition: TurnTerminalDisposition = {
      outcome: "completed",
      dispositionReason: "completion_eligible",
      completion,
      convergence: {
        policy: {
          policyId: "test-policy",
          configurationHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          providerRequests: 1,
          toolRounds: 1,
          toolCalls: 1,
          cumulativeInputTokens: 1,
          elapsedMs: 1,
          activeMs: 1,
          recoveryAttempts: 1,
          consecutiveNoProgressSteps: 1,
        },
        progressEvidence: [],
      },
    };

    expect(disposition).toEqual({
      outcome: "completed",
      dispositionReason: "completion_eligible",
      completion,
      convergence: expect.objectContaining({
        progressEvidence: [],
      }),
    });
  });

  it("keeps convergence reason and evidence in one paused branch", () => {
    const convergence: TurnConvergenceSettlementEvidence<"no_progress"> = {
      policy: {
        policyId: "test-policy",
        configurationHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        providerRequests: 1,
        toolRounds: 1,
        toolCalls: 1,
        cumulativeInputTokens: 1,
        elapsedMs: 1,
        activeMs: 1,
        recoveryAttempts: 1,
        consecutiveNoProgressSteps: 1,
      },
      pause: {
        status: "pause",
        reason: "no_progress",
        metric: "consecutiveNoProgressSteps",
        observed: 1,
        limit: 1,
      },
      progressEvidence: [],
    };
    const disposition: Extract<TurnTerminalDisposition, { readonly dispositionReason: "no_progress" }> = {
      outcome: "paused",
      dispositionReason: "no_progress",
      convergence,
    };

    expect(disposition.convergence.pause.reason).toBe(disposition.dispositionReason);

    // The disposition and nested pause evidence are one correlated union.
    const contradictoryConvergence: TurnConvergenceSettlementEvidence<"tool_round_limit"> = {
      ...convergence,
      pause: { ...convergence.pause, reason: "tool_round_limit", metric: "toolRounds" },
    };
    const contradictory: Extract<TurnTerminalDisposition, { readonly dispositionReason: "provider_request_limit" }> = {
      outcome: "paused",
      dispositionReason: "provider_request_limit",
      // @ts-expect-error A provider-request reason cannot carry a tool-round pause.
      convergence: contradictoryConvergence,
    };
    expect(contradictory).toBeDefined();
  });

  it("requires typed reasons for producer, governed, authority, and queued outcomes", () => {
    const dispositions: readonly TurnTerminalDisposition[] = [
      {
        outcome: "paused",
        dispositionReason: "required_producer_not_run",
        completion: {
          obligations: [],
          producerEvidence: [],
          eligibility: { status: "ineligible", unmet: [] },
        },
        convergence: {
          policy: {
            policyId: "test-policy",
            configurationHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            providerRequests: 1,
            toolRounds: 1,
            toolCalls: 1,
            cumulativeInputTokens: 1,
            elapsedMs: 1,
            activeMs: 1,
            recoveryAttempts: 1,
            consecutiveNoProgressSteps: 1,
          },
          progressEvidence: [],
        },
      },
      {
        outcome: "failed",
        dispositionReason: "required_producer_unavailable",
        completion: { obligations: [], producerEvidence: [], eligibility: { status: "ineligible", unmet: [] } },
        convergence: {
          policy: {
            policyId: "test-policy",
            configurationHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            providerRequests: 1,
            toolRounds: 1,
            toolCalls: 1,
            cumulativeInputTokens: 1,
            elapsedMs: 1,
            activeMs: 1,
            recoveryAttempts: 1,
            consecutiveNoProgressSteps: 1,
          },
          progressEvidence: [],
        },
      },
      {
        outcome: "failed",
        dispositionReason: "required_producer_execution_failed",
        completion: { obligations: [], producerEvidence: [], eligibility: { status: "ineligible", unmet: [] } },
        convergence: {
          policy: {
            policyId: "test-policy",
            configurationHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            providerRequests: 1,
            toolRounds: 1,
            toolCalls: 1,
            cumulativeInputTokens: 1,
            elapsedMs: 1,
            activeMs: 1,
            recoveryAttempts: 1,
            consecutiveNoProgressSteps: 1,
          },
          progressEvidence: [],
        },
      },
      {
        outcome: "failed",
        dispositionReason: "required_producer_invalid_evidence",
        completion: { obligations: [], producerEvidence: [], eligibility: { status: "ineligible", unmet: [] } },
        convergence: {
          policy: {
            policyId: "test-policy",
            configurationHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            providerRequests: 1,
            toolRounds: 1,
            toolCalls: 1,
            cumulativeInputTokens: 1,
            elapsedMs: 1,
            activeMs: 1,
            recoveryAttempts: 1,
            consecutiveNoProgressSteps: 1,

          },
          progressEvidence: [],
        },
      },
      {
        outcome: "failed",
        dispositionReason: "managed_invocation_state_transition_required",
        convergence: { policy: { policyId: "test-policy", configurationHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000", providerRequests: 1, toolRounds: 1, toolCalls: 1, cumulativeInputTokens: 1, elapsedMs: 1, activeMs: 1, recoveryAttempts: 1, consecutiveNoProgressSteps: 1 }, progressEvidence: [] },
      },
      {
        outcome: "failed",
        dispositionReason: "governed_work_materialization_required",
        convergence: { policy: { policyId: "test-policy", configurationHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000", providerRequests: 1, toolRounds: 1, toolCalls: 1, cumulativeInputTokens: 1, elapsedMs: 1, activeMs: 1, recoveryAttempts: 1, consecutiveNoProgressSteps: 1 }, progressEvidence: [] },
      },
      {
        outcome: "failed",
        dispositionReason: "governed_work_incomplete",
        convergence: { policy: { policyId: "test-policy", configurationHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000", providerRequests: 1, toolRounds: 1, toolCalls: 1, cumulativeInputTokens: 1, elapsedMs: 1, activeMs: 1, recoveryAttempts: 1, consecutiveNoProgressSteps: 1 }, progressEvidence: [] },
      },
      {
        outcome: "failed",
        dispositionReason: "outer_authority_denied",
        convergence: { policy: { policyId: "test-policy", configurationHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000", providerRequests: 1, toolRounds: 1, toolCalls: 1, cumulativeInputTokens: 1, elapsedMs: 1, activeMs: 1, recoveryAttempts: 1, consecutiveNoProgressSteps: 1 }, progressEvidence: [] },
      },
      { outcome: "failed", dispositionReason: "runtime_failure" },
      { outcome: "paused", dispositionReason: "session_not_active" },
      { outcome: "cancelled", dispositionReason: "operator_cancelled" },
      { outcome: "cancelled", dispositionReason: "runtime_cancelled" },
    ];

    expect(dispositions).toHaveLength(12);
  });

  it("identifies native harness settlement without claiming Runtime convergence evidence", () => {
    const completed: TurnTerminalDisposition = {
      outcome: "completed",
      dispositionReason: "external_harness_completed",
      externalHarness: { harness: "codex" },
    };
    const failed: TurnTerminalDisposition = {
      outcome: "failed",
      dispositionReason: "external_harness_failed",
      externalHarness: { harness: "claude-code" },
    };

    expect(completed).not.toHaveProperty("convergence");
    expect(completed).not.toHaveProperty("completion");
    expect(failed).not.toHaveProperty("convergence");
    expect(failed).not.toHaveProperty("completion");
  });
});
