import type {
  OperatorTurnConvergenceEvidence,
  OperatorTurnConvergencePolicy,
  OperatorTurnTerminalDisposition,
} from "@kilnai/gateway-contracts";

export const GUI_TEST_CONVERGENCE_POLICY = {
  policyId: "kiln.gui.test.turn-convergence",
  configurationHash: `sha256:${"a".repeat(64)}`,
  providerRequests: 10,
  toolRounds: 8,
  toolCalls: 24,
  cumulativeInputTokens: 256_000,
  elapsedMs: 600_000,
  activeMs: 600_000,
  recoveryAttempts: 3,
  consecutiveNoProgressSteps: 3,
} satisfies OperatorTurnConvergencePolicy;

function convergenceEvidence(): OperatorTurnConvergenceEvidence {
  return {
    policy: GUI_TEST_CONVERGENCE_POLICY,
    progressEvidence: [],
  };
}

export function completedTurnDisposition(): Extract<
  OperatorTurnTerminalDisposition,
  { readonly dispositionReason: "completion_eligible" }
> {
  return {
    outcome: "completed",
    dispositionReason: "completion_eligible",
    completion: {
      obligations: [],
      producerEvidence: [],
      eligibility: { status: "eligible" },
    },
    convergence: convergenceEvidence(),
  };
}

export function noProgressTurnDisposition(): Extract<
  OperatorTurnTerminalDisposition,
  { readonly dispositionReason: "no_progress" }
> {
  return {
    outcome: "paused",
    dispositionReason: "no_progress",
    convergence: {
      ...convergenceEvidence(),
      pause: {
        status: "pause",
        reason: "no_progress",
        metric: "consecutiveNoProgressSteps",
        observed: 3,
        limit: 3,
      },
    },
  };
}

function ineligibleProducerCompletion(status: "not_run" | "unavailable") {
  return {
    obligations: [{
      kind: "required_producer" as const,
      obligationId: "required-producer:formal_verify",
      canonicalToolId: "formal_verify",
      acceptedEquivalentToolIds: [],
      sourceAlias: "Dafny",
    }],
    producerEvidence: [{ canonicalProducerId: "formal_verify", status }],
    eligibility: {
      status: "ineligible" as const,
      unmet: [{
        obligationId: "required-producer:formal_verify",
        canonicalToolId: "formal_verify",
        sourceAlias: "Dafny",
        status,
      }],
    },
  };
}

export function requiredProducerNotRunDisposition(): Extract<
  OperatorTurnTerminalDisposition,
  { readonly dispositionReason: "required_producer_not_run" }
> {
  return {
    outcome: "paused",
    dispositionReason: "required_producer_not_run",
    completion: ineligibleProducerCompletion("not_run"),
    convergence: convergenceEvidence(),
  };
}

export function requiredProducerUnavailableDisposition(): Extract<
  OperatorTurnTerminalDisposition,
  { readonly dispositionReason: "required_producer_unavailable" }
> {
  return {
    outcome: "failed",
    dispositionReason: "required_producer_unavailable",
    completion: ineligibleProducerCompletion("unavailable"),
    convergence: convergenceEvidence(),
  };
}

export function runtimeFailureDisposition(): Extract<
  OperatorTurnTerminalDisposition,
  { readonly dispositionReason: "runtime_failure" }
> {
  return {
    outcome: "failed",
    dispositionReason: "runtime_failure",
  };
}

export function operatorCancelledDisposition(): Extract<
  OperatorTurnTerminalDisposition,
  { readonly dispositionReason: "operator_cancelled" }
> {
  return {
    outcome: "cancelled",
    dispositionReason: "operator_cancelled",
  };
}
