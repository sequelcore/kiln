import { describe, expect, it } from "vitest";
import {
  OperatorTurnRequiredProducerEvidenceSchema,
  OperatorTurnTerminalDispositionSchema,
  RuntimeOperatorTurnTerminalDispositionSchema,
  parseRuntimeOperatorTurnTerminalDisposition,
  type OperatorTurnConvergenceEvidence,
  type OperatorTurnConvergencePolicy,
  type OperatorTurnEligibleCompletionSettlementEvidence,
  type OperatorTurnIneligibleCompletionSettlementEvidence,
  type OperatorTurnTerminalDisposition,
  type OperatorTurnTerminalDispositionReason,
} from "../src/operator-turn-terminal-disposition.js";

const policy: OperatorTurnConvergencePolicy = {
  policyId: "test.runtime.turn-convergence",
  configurationHash: `sha256:${"0".repeat(64)}`,
  providerRequests: 10,
  toolRounds: 8,
  toolCalls: 24,
  cumulativeInputTokens: 256_000,
  elapsedMs: 600_000,
  activeMs: 600_000,
  recoveryAttempts: 3,
  consecutiveNoProgressSteps: 3,
};

const convergence: OperatorTurnConvergenceEvidence = {
  policy,
  progressEvidence: [],
};

const eligibleCompletion: OperatorTurnEligibleCompletionSettlementEvidence = {
  obligations: [],
  producerEvidence: [],
  eligibility: { status: "eligible" },
};

const ineligibleCompletion: OperatorTurnIneligibleCompletionSettlementEvidence = {
  obligations: [{
    kind: "required_producer",
    obligationId: "required-producer:formal_verify",
    canonicalToolId: "formal_verify",
    acceptedEquivalentToolIds: [],
    sourceAlias: "Dafny",
  }],
  producerEvidence: [],
  eligibility: {
    status: "ineligible",
    unmet: [{
      obligationId: "required-producer:formal_verify",
      canonicalToolId: "formal_verify",
      sourceAlias: "Dafny",
      status: "not_run",
    }],
  },
};

const terminalDispositions = {
  completion_eligible: {
    outcome: "completed",
    dispositionReason: "completion_eligible",
    completion: eligibleCompletion,
    convergence,
  },
  provider_request_limit: {
    outcome: "paused",
    dispositionReason: "provider_request_limit",
    convergence: {
      ...convergence,
      pause: {
        status: "pause",
        reason: "provider_request_limit",
        metric: "providerRequests",
        observed: 10,
        limit: 10,
      },
    },
  },
  tool_round_limit: {
    outcome: "paused",
    dispositionReason: "tool_round_limit",
    convergence: {
      ...convergence,
      pause: {
        status: "pause",
        reason: "tool_round_limit",
        metric: "toolRounds",
        observed: 8,
        limit: 8,
      },
    },
  },
  tool_call_limit: {
    outcome: "paused",
    dispositionReason: "tool_call_limit",
    convergence: {
      ...convergence,
      pause: {
        status: "pause",
        reason: "tool_call_limit",
        metric: "toolCalls",
        observed: 24,
        limit: 24,
      },
    },
  },
  cumulative_input_limit: {
    outcome: "paused",
    dispositionReason: "cumulative_input_limit",
    convergence: {
      ...convergence,
      pause: {
        status: "pause",
        reason: "cumulative_input_limit",
        metric: "cumulativeInputTokens",
        observed: 256_000,
        limit: 256_000,
      },
    },
  },
  elapsed_time_limit: {
    outcome: "paused",
    dispositionReason: "elapsed_time_limit",
    convergence: {
      ...convergence,
      pause: {
        status: "pause",
        reason: "elapsed_time_limit",
        metric: "elapsedMs",
        observed: 600_000,
        limit: 600_000,
      },
    },
  },
  active_time_limit: {
    outcome: "paused",
    dispositionReason: "active_time_limit",
    convergence: {
      ...convergence,
      pause: {
        status: "pause",
        reason: "active_time_limit",
        metric: "activeMs",
        observed: 600_000,
        limit: 600_000,
      },
    },
  },
  recovery_limit: {
    outcome: "paused",
    dispositionReason: "recovery_limit",
    convergence: {
      ...convergence,
      pause: {
        status: "pause",
        reason: "recovery_limit",
        metric: "recoveryAttempts",
        observed: 3,
        limit: 3,
      },
    },
  },
  no_progress: {
    outcome: "paused",
    dispositionReason: "no_progress",
    convergence: {
      ...convergence,
      pause: {
        status: "pause",
        reason: "no_progress",
        metric: "consecutiveNoProgressSteps",
        observed: 3,
        limit: 3,
      },
    },
  },
  observation_unavailable: {
    outcome: "paused",
    dispositionReason: "observation_unavailable",
    convergence: {
      ...convergence,
      pause: {
        status: "pause",
        reason: "observation_unavailable",
        metric: "cumulativeInputTokens",
        unknownReason: "provider omitted input token usage",
      },
    },
  },
  required_producer_not_run: {
    outcome: "paused",
    dispositionReason: "required_producer_not_run",
    completion: ineligibleCompletion,
    convergence,
  },
  required_producer_unavailable: {
    outcome: "failed",
    dispositionReason: "required_producer_unavailable",
    completion: ineligibleCompletion,
    convergence,
  },
  required_producer_execution_failed: {
    outcome: "failed",
    dispositionReason: "required_producer_execution_failed",
    completion: ineligibleCompletion,
    convergence,
  },
  required_producer_invalid_evidence: {
    outcome: "failed",
    dispositionReason: "required_producer_invalid_evidence",
    completion: ineligibleCompletion,
    convergence,
  },
  managed_invocation_state_transition_required: {
    outcome: "failed",
    dispositionReason: "managed_invocation_state_transition_required",
    convergence,
  },
  governed_work_materialization_required: {
    outcome: "failed",
    dispositionReason: "governed_work_materialization_required",
    convergence,
  },
  governed_work_incomplete: {
    outcome: "failed",
    dispositionReason: "governed_work_incomplete",
    convergence,
  },
  outer_authority_denied: {
    outcome: "failed",
    dispositionReason: "outer_authority_denied",
    convergence,
  },
  runtime_failure: {
    outcome: "failed",
    dispositionReason: "runtime_failure",
  },
  external_harness_completed: {
    outcome: "completed",
    dispositionReason: "external_harness_completed",
    externalHarness: { harness: "codex" },
  },
  external_harness_failed: {
    outcome: "failed",
    dispositionReason: "external_harness_failed",
    externalHarness: { harness: "claude-code" },
  },
  session_not_active: {
    outcome: "paused",
    dispositionReason: "session_not_active",
  },
  operator_cancelled: {
    outcome: "cancelled",
    dispositionReason: "operator_cancelled",
  },
  runtime_cancelled: {
    outcome: "cancelled",
    dispositionReason: "runtime_cancelled",
  },
} satisfies Record<OperatorTurnTerminalDispositionReason, OperatorTurnTerminalDisposition>;

describe("operator turn terminal disposition wire contract", () => {
  it("requires scoped tool execution references for accepted producer evidence", () => {
    expect(OperatorTurnRequiredProducerEvidenceSchema.safeParse({
      canonicalProducerId: "formal_verify",
      status: "accepted",
      evidenceReferences: [{ toolCallScopeId: "scope-1", toolCallId: "call-1" }],
    }).success).toBe(true);
    expect(OperatorTurnRequiredProducerEvidenceSchema.safeParse({
      canonicalProducerId: "formal_verify",
      status: "accepted",
      evidenceReferences: ["call-1"],
    }).success).toBe(false);
  });

  it("keeps the compile-time reason set in runtime schema parity", () => {
    const reasons = Object.entries(terminalDispositions).map(([reason, disposition]) => {
      expect(OperatorTurnTerminalDispositionSchema.safeParse(disposition).success).toBe(true);
      return reason;
    });

    expect(reasons.sort()).toEqual(Object.keys(terminalDispositions).sort());
    expect(reasons).toHaveLength(24);
  });

  it("projects Runtime dispositions by stripping pipeline metadata and rejects native harness branches", () => {
    const projected = parseRuntimeOperatorTurnTerminalDisposition({
      ...terminalDispositions.runtime_failure,
      parts: [{ type: "text", text: "internal result" }],
      providerRequests: [{ requestId: "request-1" }],
      dispatchEgress: { internal: true },
    });

    expect(projected).toEqual(terminalDispositions.runtime_failure);
    expect(RuntimeOperatorTurnTerminalDispositionSchema.safeParse(
      terminalDispositions.external_harness_completed,
    ).success).toBe(false);
  });

  it.each([
    {
      ...terminalDispositions.completion_eligible,
      outcome: "failed",
    },
    {
      ...terminalDispositions.completion_eligible,
      dispositionReason: "runtime_failure",
    },
    {
      ...terminalDispositions.no_progress,
      convergence: {
        ...terminalDispositions.no_progress.convergence,
        pause: {
          ...terminalDispositions.no_progress.convergence.pause,
          reason: "tool_round_limit",
          metric: "toolRounds",
        },
      },
    },
    {
      outcome: "paused",
      dispositionReason: "required_producer_not_run",
      convergence,
    },
    {
      ...terminalDispositions.runtime_failure,
      unexpected: true,
    },
  ] satisfies readonly unknown[])("rejects mismatched or incomplete evidence: %#", (disposition) => {
    expect(OperatorTurnTerminalDispositionSchema.safeParse(disposition).success).toBe(false);
  });
});
