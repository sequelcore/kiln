import type { ExecutionSessionEvent } from "@kilnai/core/events";
import {
  resolveTurnConvergencePolicy,
  type ExternalHarnessTerminalEvidence,
  type TurnConvergencePolicyInput,
  type TurnTerminalDisposition,
} from "@kilnai/core/agents";

const TEST_RUNTIME_POLICY_INPUT = {
  policyId: "kiln.cli.tests.runtime-turn",
  configurationHash: `sha256:${"0".repeat(64)}`,
  providerRequests: 10,
  toolRounds: 8,
  toolCalls: 24,
  cumulativeInputTokens: 256_000,
  elapsedMs: 600_000,
  activeMs: 600_000,
  recoveryAttempts: 3,
  consecutiveNoProgressSteps: 3,
} satisfies TurnConvergencePolicyInput;

const TEST_RUNTIME_CONVERGENCE_POLICY = resolveTurnConvergencePolicy(TEST_RUNTIME_POLICY_INPUT);

type CompletedExecutionSessionEvent = Extract<ExecutionSessionEvent, { readonly type: "completed" }>;

export function runtimeCompletedDisposition(): Extract<
  TurnTerminalDisposition,
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
    convergence: {
      policy: TEST_RUNTIME_CONVERGENCE_POLICY,
      progressEvidence: [],
    },
  };
}

export function runtimeFailureDisposition(): Extract<
  TurnTerminalDisposition,
  { readonly dispositionReason: "runtime_failure" }
> {
  return { outcome: "failed", dispositionReason: "runtime_failure" };
}

export function runtimePausedDisposition(): Extract<
  TurnTerminalDisposition,
  { readonly dispositionReason: "tool_round_limit" }
> {
  return {
    outcome: "paused",
    dispositionReason: "tool_round_limit",
    convergence: {
      policy: TEST_RUNTIME_CONVERGENCE_POLICY,
      progressEvidence: [{
        kind: "progress",
        reason: "new_material_result",
        evidenceFingerprint: `sha256:${"1".repeat(64)}`,
        supportingToolCallIds: ["tool-progress"],
      }],
      pause: {
        status: "pause",
        reason: "tool_round_limit",
        metric: "toolRounds",
        observed: TEST_RUNTIME_CONVERGENCE_POLICY.toolRounds,
        limit: TEST_RUNTIME_CONVERGENCE_POLICY.toolRounds,
      },
    },
  };
}

export function runtimeCancellationDisposition(): {
  readonly outcome: "cancelled";
  readonly dispositionReason: "operator_cancelled";
} {
  return { outcome: "cancelled", dispositionReason: "operator_cancelled" };
}

export function nativeHarnessDisposition(
  harness: ExternalHarnessTerminalEvidence["harness"],
  outcome: "completed" | "failed",
): Extract<
  TurnTerminalDisposition,
  { readonly dispositionReason: "external_harness_completed" | "external_harness_failed" }
> {
  return outcome === "completed"
    ? {
        outcome: "completed",
        dispositionReason: "external_harness_completed",
        externalHarness: { harness },
      }
    : {
        outcome: "failed",
        dispositionReason: "external_harness_failed",
        externalHarness: { harness },
      };
}

export function nativeHarnessCancellationDisposition(): {
  readonly outcome: "cancelled";
  readonly dispositionReason: "operator_cancelled";
} {
  return {
    outcome: "cancelled",
    dispositionReason: "operator_cancelled",
  };
}

export function requireCompletedExecutionSessionEvent(
  events: readonly ExecutionSessionEvent[],
): CompletedExecutionSessionEvent {
  const event = events.find(
    (candidate): candidate is CompletedExecutionSessionEvent => candidate.type === "completed",
  );
  if (event === undefined) {
    throw new Error("Expected a completed execution-session event.");
  }
  return event;
}
