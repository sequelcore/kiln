import type {
  ExternalHarnessTerminalEvidence,
  TurnTerminalDisposition,
} from "@kilnai/core/agents";
import type { OrchestrateResult } from "../../src/session/runtime-session-orchestrator.types.js";
import { RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY } from "../../src/session/runtime-execution-envelope.js";

type RuntimeCompletedDisposition = Extract<
  TurnTerminalDisposition,
  { readonly dispositionReason: "completion_eligible" }
>;

type RuntimeFailedDisposition = Extract<
  TurnTerminalDisposition,
  { readonly outcome: "failed"; readonly dispositionReason: "runtime_failure" }
>;

type RuntimeConvergedResult = Extract<OrchestrateResult, { readonly convergence: unknown }>;
type RuntimeCompletedResult = Extract<OrchestrateResult, { readonly dispositionReason: "completion_eligible" }>;
type RuntimeConvergencePauseEvidence = RuntimeConvergedResult & {
  readonly convergence: RuntimeConvergedResult["convergence"] & { readonly pause: unknown };
};
type RuntimeCompletionEvidenceResult = Extract<OrchestrateResult, { readonly completion: unknown }>;

/** Minimal valid Runtime completion evidence for provider-loop fixtures. */
export function runtimeCompletedDisposition(): RuntimeCompletedDisposition {
  return {
    outcome: "completed",
    dispositionReason: "completion_eligible",
    completion: {
      obligations: [],
      producerEvidence: [],
      eligibility: { status: "eligible" },
    },
    convergence: {
      policy: RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY,
      progressEvidence: [],
    },
  };
}

/** Minimal Runtime failure evidence for fixtures whose failure is the tested signal. */
export function runtimeFailureDisposition(): RuntimeFailedDisposition {
  return {
    outcome: "failed",
    dispositionReason: "runtime_failure",
  };
}

/** Exact terminal evidence for a standalone native harness event. */
export function externalHarnessDisposition(
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

/** Narrow an orchestrator result before reading convergence evidence. */
export function requireRuntimeConvergence(result: OrchestrateResult): RuntimeConvergedResult {
  if (!("convergence" in result)) {
    throw new Error(`Expected convergence evidence for ${result.dispositionReason}.`);
  }
  return result;
}

/** Narrow a terminal result before reading a convergence pause decision. */
export function requireRuntimeConvergencePause(result: OrchestrateResult): RuntimeConvergencePauseEvidence {
  if (!hasRuntimeConvergencePause(result)) {
    throw new Error(`Expected convergence pause evidence for ${result.dispositionReason}.`);
  }
  return result;
}

function hasRuntimeConvergencePause(result: OrchestrateResult): result is RuntimeConvergencePauseEvidence {
  return "convergence" in result && "pause" in result.convergence;
}

/** Narrow an orchestrator result before reading completion evidence. */
export function requireRuntimeCompletion(result: OrchestrateResult): RuntimeCompletedResult {
  if (result.dispositionReason !== "completion_eligible") {
    throw new Error(`Expected completed result, received ${result.outcome}.`);
  }
  return result;
}

/** Narrow a terminal result before reading required-producer evidence. */
export function requireRuntimeCompletionEvidence(result: OrchestrateResult): RuntimeCompletionEvidenceResult {
  if (!("completion" in result)) {
    throw new Error(`Expected completion evidence for ${result.dispositionReason}.`);
  }
  return result;
}
