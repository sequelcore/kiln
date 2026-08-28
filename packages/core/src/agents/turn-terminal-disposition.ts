import type {
  CompletionEligibility,
  CompletionObligation,
  RequiredProducerEvidence,
} from "./completion-obligation.js";
import type {
  ResolvedTurnConvergencePolicy,
  TurnConvergenceLimitPauseReason,
  TurnConvergencePauseDecision,
  TurnConvergencePauseReason,
} from "./turn-convergence.js";
import type { TurnProgressEvidence } from "./turn-progress-evidence.js";

/** Completion evidence whose producer obligations were all satisfied. */
export interface EligibleCompletionSettlementEvidence {
  readonly obligations: readonly CompletionObligation[];
  readonly producerEvidence: readonly RequiredProducerEvidence[];
  readonly eligibility: Extract<CompletionEligibility, { readonly status: "eligible" }>;
}

/** Completion evidence that must keep a terminal result from claiming success. */
export interface IneligibleCompletionSettlementEvidence {
  readonly obligations: readonly CompletionObligation[];
  readonly producerEvidence: readonly RequiredProducerEvidence[];
  readonly eligibility: Extract<CompletionEligibility, { readonly status: "ineligible" }>;
}

/** The two completion evidence settlements, narrowed by eligibility status. */
export type CompletionSettlementEvidence =
  | EligibleCompletionSettlementEvidence
  | IneligibleCompletionSettlementEvidence;

/** Full Core evidence for a turn paused by one convergence boundary. */
export type TurnConvergenceSettlementEvidence<
  Reason extends TurnConvergencePauseReason = TurnConvergencePauseReason,
> = TurnConvergenceEvidence & {
  readonly pause: TurnConvergencePauseDecisionForReason<Reason>;
};

/** Policy identity and turn-local progress evidence for every live-loop result. */
export interface TurnConvergenceEvidence {
  readonly policy: ResolvedTurnConvergencePolicy;
  readonly progressEvidence: readonly TurnProgressEvidence[];
}

type TurnConvergencePauseDecisionForReason<Reason extends TurnConvergencePauseReason> =
  Reason extends "observation_unavailable"
    ? Extract<TurnConvergencePauseDecision, { readonly reason: "observation_unavailable" }>
    : Omit<Extract<TurnConvergencePauseDecision, { readonly reason: TurnConvergenceLimitPauseReason }>, "reason">
      & { readonly reason: Reason };

type TurnConvergenceTerminalDisposition = {
  [Reason in TurnConvergencePauseReason]: {
    readonly outcome: "paused";
    readonly dispositionReason: Reason;
    readonly convergence: TurnConvergenceSettlementEvidence<Reason>;
  };
}[TurnConvergencePauseReason];

/**
 * Terminal evidence reported by a standalone native harness.
 *
 * Native Codex, Claude Code, and OpenCode sessions are outside the Runtime
 * convergence owner. Their terminal event therefore identifies the harness,
 * but deliberately carries no fabricated Runtime policy or completion
 * evidence.
 */
export interface ExternalHarnessTerminalEvidence {
  readonly harness: "codex" | "claude-code" | "opencode";
}

/**
 * One authoritative terminal disposition for an orchestrated Runtime turn.
 *
 * `outcome` is intentionally repeated in each branch so consumers can narrow
 * the result without maintaining a second outcome-to-reason mapping. The
 * Runtime owns choosing a branch; Core owns the vocabulary and evidence shape.
 */
export type RuntimeTurnTerminalDisposition =
  | {
      readonly outcome: "completed";
      readonly dispositionReason: "completion_eligible";
      readonly completion: EligibleCompletionSettlementEvidence;
      readonly convergence: TurnConvergenceEvidence;
    }
  | TurnConvergenceTerminalDisposition
  | {
      readonly outcome: "paused";
      readonly dispositionReason: "required_producer_not_run";
      readonly completion: IneligibleCompletionSettlementEvidence;
      readonly convergence: TurnConvergenceEvidence;
    }
  | {
      readonly outcome: "failed";
      readonly dispositionReason:
        | "required_producer_unavailable"
        | "required_producer_execution_failed"
        | "required_producer_invalid_evidence";
      readonly completion: IneligibleCompletionSettlementEvidence;
      readonly convergence: TurnConvergenceEvidence;
    }
  | {
      readonly outcome: "failed";
      readonly dispositionReason:
        | "managed_invocation_state_transition_required"
        | "governed_work_materialization_required"
        | "governed_work_incomplete"
        | "outer_authority_denied";
      readonly convergence: TurnConvergenceEvidence;
    }
  | {
      readonly outcome: "failed";
      readonly dispositionReason: "runtime_failure";
    }
  | {
      readonly outcome: "paused";
      readonly dispositionReason: "session_not_active";
    }
  | {
      readonly outcome: "cancelled";
      readonly dispositionReason: "operator_cancelled" | "runtime_cancelled";
    };

/** Terminal disposition emitted by a standalone native/external harness. */
export type ExternalHarnessTurnTerminalDisposition =
  | {
      readonly outcome: "completed";
      readonly dispositionReason: "external_harness_completed";
      readonly externalHarness: ExternalHarnessTerminalEvidence;
    }
  | {
      readonly outcome: "failed";
      readonly dispositionReason: "external_harness_failed";
      readonly externalHarness: ExternalHarnessTerminalEvidence;
    };

/**
 * Canonical terminal vocabulary shared by Runtime and external harnesses.
 * Runtime-owned contracts must use `RuntimeTurnTerminalDisposition` so an
 * external harness result cannot cross the orchestration boundary.
 */
export type TurnTerminalDisposition =
  | RuntimeTurnTerminalDisposition
  | ExternalHarnessTurnTerminalDisposition;
