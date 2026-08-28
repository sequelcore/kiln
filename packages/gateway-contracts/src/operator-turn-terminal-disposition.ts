import { z } from "zod";

const nonEmptyString = z.string().min(1);
const nonNegativeInteger = z.number().finite().int().nonnegative();
const positiveInteger = z.number().finite().int().positive();
const configurationHash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const OperatorTurnProgressEvidenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("progress"),
    reason: z.literal("new_material_result"),
    evidenceFingerprint: nonEmptyString,
    supportingToolCallIds: z.array(nonEmptyString).readonly(),
  }).strict(),
  z.object({
    kind: z.literal("no_progress"),
    reason: z.enum([
      "repeated_result",
      "failed_execution",
      "invalid_input",
      "empty_discovery",
      "empty_result",
      "blocked_batch",
    ]),
    strategyFingerprint: nonEmptyString,
    supportingToolCallIds: z.array(nonEmptyString).readonly(),
  }).strict(),
]);

export type OperatorTurnProgressEvidence = z.infer<typeof OperatorTurnProgressEvidenceSchema>;

export const OperatorTurnConvergencePolicySchema = z.object({
  policyId: nonEmptyString,
  configurationHash,
  providerRequests: positiveInteger,
  toolRounds: positiveInteger,
  toolCalls: positiveInteger,
  cumulativeInputTokens: positiveInteger,
  elapsedMs: positiveInteger,
  activeMs: positiveInteger,
  recoveryAttempts: positiveInteger,
  consecutiveNoProgressSteps: positiveInteger,
}).strict();

export type OperatorTurnConvergencePolicy = z.infer<typeof OperatorTurnConvergencePolicySchema>;

export const OperatorTurnConvergenceEvidenceSchema = z.object({
  policy: OperatorTurnConvergencePolicySchema,
  progressEvidence: z.array(OperatorTurnProgressEvidenceSchema).readonly(),
}).strict();

export type OperatorTurnConvergenceEvidence = z.infer<typeof OperatorTurnConvergenceEvidenceSchema>;

export const OperatorTurnCompletionObligationSchema = z.object({
  kind: z.literal("required_producer"),
  obligationId: nonEmptyString,
  canonicalToolId: nonEmptyString,
  acceptedEquivalentToolIds: z.array(nonEmptyString).readonly(),
  sourceAlias: nonEmptyString,
}).strict();

export type OperatorTurnCompletionObligation = z.infer<typeof OperatorTurnCompletionObligationSchema>;

export const OperatorTurnRequiredProducerEvidenceReferenceSchema = z.object({
  toolCallScopeId: nonEmptyString,
  toolCallId: nonEmptyString,
}).strict();

export type OperatorTurnRequiredProducerEvidenceReference = z.infer<
  typeof OperatorTurnRequiredProducerEvidenceReferenceSchema
>;

export const OperatorTurnRequiredProducerEvidenceSchema = z.object({
  canonicalProducerId: nonEmptyString,
  status: z.enum([
    "accepted",
    "unavailable",
    "not_run",
    "execution_failed",
    "invalid_evidence",
  ]),
  evidenceReferences: z.array(OperatorTurnRequiredProducerEvidenceReferenceSchema).readonly().optional(),
}).strict();

export type OperatorTurnRequiredProducerEvidence = z.infer<typeof OperatorTurnRequiredProducerEvidenceSchema>;

export const OperatorTurnCompletionObligationUnmetSchema = z.object({
  obligationId: nonEmptyString,
  canonicalToolId: nonEmptyString,
  sourceAlias: nonEmptyString,
  status: z.enum([
    "unavailable",
    "not_run",
    "execution_failed",
    "invalid_evidence",
  ]),
  evidence: OperatorTurnRequiredProducerEvidenceSchema.optional(),
}).strict();

export type OperatorTurnCompletionObligationUnmet = z.infer<typeof OperatorTurnCompletionObligationUnmetSchema>;

export const OperatorTurnEligibleCompletionSettlementEvidenceSchema = z.object({
  obligations: z.array(OperatorTurnCompletionObligationSchema).readonly(),
  producerEvidence: z.array(OperatorTurnRequiredProducerEvidenceSchema).readonly(),
  eligibility: z.object({
    status: z.literal("eligible"),
  }).strict(),
}).strict();

export type OperatorTurnEligibleCompletionSettlementEvidence = z.infer<
  typeof OperatorTurnEligibleCompletionSettlementEvidenceSchema
>;

export const OperatorTurnIneligibleCompletionSettlementEvidenceSchema = z.object({
  obligations: z.array(OperatorTurnCompletionObligationSchema).readonly(),
  producerEvidence: z.array(OperatorTurnRequiredProducerEvidenceSchema).readonly(),
  eligibility: z.object({
    status: z.literal("ineligible"),
    unmet: z.array(OperatorTurnCompletionObligationUnmetSchema).readonly(),
  }).strict(),
}).strict();

export type OperatorTurnIneligibleCompletionSettlementEvidence = z.infer<
  typeof OperatorTurnIneligibleCompletionSettlementEvidenceSchema
>;

type OperatorTurnConvergenceLimitPauseReason =
  | "provider_request_limit"
  | "tool_round_limit"
  | "tool_call_limit"
  | "cumulative_input_limit"
  | "elapsed_time_limit"
  | "active_time_limit"
  | "recovery_limit"
  | "no_progress";

type OperatorTurnConvergenceLimitPauseMetric = {
  readonly provider_request_limit: "providerRequests";
  readonly tool_round_limit: "toolRounds";
  readonly tool_call_limit: "toolCalls";
  readonly cumulative_input_limit: "cumulativeInputTokens";
  readonly elapsed_time_limit: "elapsedMs";
  readonly active_time_limit: "activeMs";
  readonly recovery_limit: "recoveryAttempts";
  readonly no_progress: "consecutiveNoProgressSteps";
};

function turnConvergenceLimitPauseDecision<Reason extends OperatorTurnConvergenceLimitPauseReason>(
  reason: Reason,
  metric: OperatorTurnConvergenceLimitPauseMetric[Reason],
) {
  return z.object({
    status: z.literal("pause"),
    reason: z.literal(reason),
    metric: z.literal(metric),
    observed: nonNegativeInteger,
    limit: positiveInteger,
  }).strict();
}

const OperatorTurnObservationUnavailablePauseDecisionSchema = z.object({
  status: z.literal("pause"),
  reason: z.literal("observation_unavailable"),
  metric: z.enum([
    "providerRequests",
    "toolRounds",
    "toolCalls",
    "cumulativeInputTokens",
    "projectedInputTokens",
    "elapsedMs",
    "activeMs",
    "recoveryAttempts",
    "consecutiveNoProgressSteps",
  ]),
  unknownReason: nonEmptyString,
}).strict();

const OperatorTurnProviderRequestLimitPauseDecisionSchema = turnConvergenceLimitPauseDecision(
  "provider_request_limit",
  "providerRequests",
);
const OperatorTurnToolRoundLimitPauseDecisionSchema = turnConvergenceLimitPauseDecision(
  "tool_round_limit",
  "toolRounds",
);
const OperatorTurnToolCallLimitPauseDecisionSchema = turnConvergenceLimitPauseDecision(
  "tool_call_limit",
  "toolCalls",
);
const OperatorTurnCumulativeInputLimitPauseDecisionSchema = turnConvergenceLimitPauseDecision(
  "cumulative_input_limit",
  "cumulativeInputTokens",
);
const OperatorTurnElapsedTimeLimitPauseDecisionSchema = turnConvergenceLimitPauseDecision(
  "elapsed_time_limit",
  "elapsedMs",
);
const OperatorTurnActiveTimeLimitPauseDecisionSchema = turnConvergenceLimitPauseDecision(
  "active_time_limit",
  "activeMs",
);
const OperatorTurnRecoveryLimitPauseDecisionSchema = turnConvergenceLimitPauseDecision(
  "recovery_limit",
  "recoveryAttempts",
);
const OperatorTurnNoProgressPauseDecisionSchema = turnConvergenceLimitPauseDecision(
  "no_progress",
  "consecutiveNoProgressSteps",
);

/** Exact wire representation of the convergence pause decision union. */
export const OperatorTurnConvergencePauseDecisionSchema = z.discriminatedUnion("reason", [
  OperatorTurnProviderRequestLimitPauseDecisionSchema,
  OperatorTurnToolRoundLimitPauseDecisionSchema,
  OperatorTurnToolCallLimitPauseDecisionSchema,
  OperatorTurnCumulativeInputLimitPauseDecisionSchema,
  OperatorTurnElapsedTimeLimitPauseDecisionSchema,
  OperatorTurnActiveTimeLimitPauseDecisionSchema,
  OperatorTurnRecoveryLimitPauseDecisionSchema,
  OperatorTurnNoProgressPauseDecisionSchema,
  OperatorTurnObservationUnavailablePauseDecisionSchema,
]);

export type OperatorTurnConvergencePauseDecision = z.infer<typeof OperatorTurnConvergencePauseDecisionSchema>;

function convergenceSettlementEvidence<TPause extends z.ZodTypeAny>(pause: TPause) {
  return OperatorTurnConvergenceEvidenceSchema.extend({
    pause,
  }).strict();
}

const completedDisposition = z.object({
  outcome: z.literal("completed"),
  dispositionReason: z.literal("completion_eligible"),
  completion: OperatorTurnEligibleCompletionSettlementEvidenceSchema,
  convergence: OperatorTurnConvergenceEvidenceSchema,
}).strict();

const providerRequestLimitDisposition = z.object({
  outcome: z.literal("paused"),
  dispositionReason: z.literal("provider_request_limit"),
  convergence: convergenceSettlementEvidence(
    OperatorTurnProviderRequestLimitPauseDecisionSchema,
  ),
}).strict();

const toolRoundLimitDisposition = z.object({
  outcome: z.literal("paused"),
  dispositionReason: z.literal("tool_round_limit"),
  convergence: convergenceSettlementEvidence(
    OperatorTurnToolRoundLimitPauseDecisionSchema,
  ),
}).strict();

const toolCallLimitDisposition = z.object({
  outcome: z.literal("paused"),
  dispositionReason: z.literal("tool_call_limit"),
  convergence: convergenceSettlementEvidence(
    OperatorTurnToolCallLimitPauseDecisionSchema,
  ),
}).strict();

const cumulativeInputLimitDisposition = z.object({
  outcome: z.literal("paused"),
  dispositionReason: z.literal("cumulative_input_limit"),
  convergence: convergenceSettlementEvidence(
    OperatorTurnCumulativeInputLimitPauseDecisionSchema,
  ),
}).strict();

const elapsedTimeLimitDisposition = z.object({
  outcome: z.literal("paused"),
  dispositionReason: z.literal("elapsed_time_limit"),
  convergence: convergenceSettlementEvidence(
    OperatorTurnElapsedTimeLimitPauseDecisionSchema,
  ),
}).strict();

const activeTimeLimitDisposition = z.object({
  outcome: z.literal("paused"),
  dispositionReason: z.literal("active_time_limit"),
  convergence: convergenceSettlementEvidence(
    OperatorTurnActiveTimeLimitPauseDecisionSchema,
  ),
}).strict();

const recoveryLimitDisposition = z.object({
  outcome: z.literal("paused"),
  dispositionReason: z.literal("recovery_limit"),
  convergence: convergenceSettlementEvidence(
    OperatorTurnRecoveryLimitPauseDecisionSchema,
  ),
}).strict();

const noProgressDisposition = z.object({
  outcome: z.literal("paused"),
  dispositionReason: z.literal("no_progress"),
  convergence: convergenceSettlementEvidence(
    OperatorTurnNoProgressPauseDecisionSchema,
  ),
}).strict();

const observationUnavailableDisposition = z.object({
  outcome: z.literal("paused"),
  dispositionReason: z.literal("observation_unavailable"),
  convergence: convergenceSettlementEvidence(
    OperatorTurnObservationUnavailablePauseDecisionSchema,
  ),
}).strict();

const requiredProducerNotRunDisposition = z.object({
  outcome: z.literal("paused"),
  dispositionReason: z.literal("required_producer_not_run"),
  completion: OperatorTurnIneligibleCompletionSettlementEvidenceSchema,
  convergence: OperatorTurnConvergenceEvidenceSchema,
}).strict();

const requiredProducerUnavailableDisposition = z.object({
  outcome: z.literal("failed"),
  dispositionReason: z.literal("required_producer_unavailable"),
  completion: OperatorTurnIneligibleCompletionSettlementEvidenceSchema,
  convergence: OperatorTurnConvergenceEvidenceSchema,
}).strict();

const requiredProducerExecutionFailedDisposition = z.object({
  outcome: z.literal("failed"),
  dispositionReason: z.literal("required_producer_execution_failed"),
  completion: OperatorTurnIneligibleCompletionSettlementEvidenceSchema,
  convergence: OperatorTurnConvergenceEvidenceSchema,
}).strict();

const requiredProducerInvalidEvidenceDisposition = z.object({
  outcome: z.literal("failed"),
  dispositionReason: z.literal("required_producer_invalid_evidence"),
  completion: OperatorTurnIneligibleCompletionSettlementEvidenceSchema,
  convergence: OperatorTurnConvergenceEvidenceSchema,
}).strict();

const managedInvocationStateTransitionDisposition = z.object({
  outcome: z.literal("failed"),
  dispositionReason: z.literal("managed_invocation_state_transition_required"),
  convergence: OperatorTurnConvergenceEvidenceSchema,
}).strict();

const governedWorkMaterializationDisposition = z.object({
  outcome: z.literal("failed"),
  dispositionReason: z.literal("governed_work_materialization_required"),
  convergence: OperatorTurnConvergenceEvidenceSchema,
}).strict();

const governedWorkIncompleteDisposition = z.object({
  outcome: z.literal("failed"),
  dispositionReason: z.literal("governed_work_incomplete"),
  convergence: OperatorTurnConvergenceEvidenceSchema,
}).strict();

const outerAuthorityDeniedDisposition = z.object({
  outcome: z.literal("failed"),
  dispositionReason: z.literal("outer_authority_denied"),
  convergence: OperatorTurnConvergenceEvidenceSchema,
}).strict();

const runtimeFailureDisposition = z.object({
  outcome: z.literal("failed"),
  dispositionReason: z.literal("runtime_failure"),
}).strict();

const externalHarnessCompletedDisposition = z.object({
  outcome: z.literal("completed"),
  dispositionReason: z.literal("external_harness_completed"),
  externalHarness: z.object({
    harness: z.enum(["codex", "claude-code", "opencode"]),
  }).strict(),
}).strict();

const externalHarnessFailedDisposition = z.object({
  outcome: z.literal("failed"),
  dispositionReason: z.literal("external_harness_failed"),
  externalHarness: z.object({
    harness: z.enum(["codex", "claude-code", "opencode"]),
  }).strict(),
}).strict();

const sessionNotActiveDisposition = z.object({
  outcome: z.literal("paused"),
  dispositionReason: z.literal("session_not_active"),
}).strict();

const operatorCancelledDisposition = z.object({
  outcome: z.literal("cancelled"),
  dispositionReason: z.literal("operator_cancelled"),
}).strict();

const runtimeCancelledDisposition = z.object({
  outcome: z.literal("cancelled"),
  dispositionReason: z.literal("runtime_cancelled"),
}).strict();

const emptyFrameFieldsSchema = z.object({}).strict();

/** Runtime-owned branches strip pipeline-only metadata after validation. */
const runtimeTerminalDispositionBranches = [
  completedDisposition.strip(),
  providerRequestLimitDisposition.strip(),
  toolRoundLimitDisposition.strip(),
  toolCallLimitDisposition.strip(),
  cumulativeInputLimitDisposition.strip(),
  elapsedTimeLimitDisposition.strip(),
  activeTimeLimitDisposition.strip(),
  recoveryLimitDisposition.strip(),
  noProgressDisposition.strip(),
  observationUnavailableDisposition.strip(),
  requiredProducerNotRunDisposition.strip(),
  requiredProducerUnavailableDisposition.strip(),
  requiredProducerExecutionFailedDisposition.strip(),
  requiredProducerInvalidEvidenceDisposition.strip(),
  managedInvocationStateTransitionDisposition.strip(),
  governedWorkMaterializationDisposition.strip(),
  governedWorkIncompleteDisposition.strip(),
  outerAuthorityDeniedDisposition.strip(),
  runtimeFailureDisposition.strip(),
  sessionNotActiveDisposition.strip(),
  operatorCancelledDisposition.strip(),
  runtimeCancelledDisposition.strip(),
] as const;

/** Runtime-only terminal disposition wire contract used by the gateway pipeline. */
export const RuntimeOperatorTurnTerminalDispositionSchema = z.discriminatedUnion(
  "dispositionReason",
  runtimeTerminalDispositionBranches,
);

export type RuntimeOperatorTurnTerminalDisposition = z.infer<
  typeof RuntimeOperatorTurnTerminalDispositionSchema
>;

/** Validate and project an admitted Runtime result into its wire disposition. */
export function parseRuntimeOperatorTurnTerminalDisposition(
  input: unknown,
): RuntimeOperatorTurnTerminalDisposition {
  return RuntimeOperatorTurnTerminalDispositionSchema.parse(input);
}

function terminalDispositionBranches<TFrame extends z.ZodRawShape>(frameFields: z.ZodObject<TFrame>) {
  return [
    completedDisposition.extend(frameFields.shape),
    providerRequestLimitDisposition.extend(frameFields.shape),
    toolRoundLimitDisposition.extend(frameFields.shape),
    toolCallLimitDisposition.extend(frameFields.shape),
    cumulativeInputLimitDisposition.extend(frameFields.shape),
    elapsedTimeLimitDisposition.extend(frameFields.shape),
    activeTimeLimitDisposition.extend(frameFields.shape),
    recoveryLimitDisposition.extend(frameFields.shape),
    noProgressDisposition.extend(frameFields.shape),
    observationUnavailableDisposition.extend(frameFields.shape),
    requiredProducerNotRunDisposition.extend(frameFields.shape),
    requiredProducerUnavailableDisposition.extend(frameFields.shape),
    requiredProducerExecutionFailedDisposition.extend(frameFields.shape),
    requiredProducerInvalidEvidenceDisposition.extend(frameFields.shape),
    managedInvocationStateTransitionDisposition.extend(frameFields.shape),
    governedWorkMaterializationDisposition.extend(frameFields.shape),
    governedWorkIncompleteDisposition.extend(frameFields.shape),
    outerAuthorityDeniedDisposition.extend(frameFields.shape),
    runtimeFailureDisposition.extend(frameFields.shape),
    externalHarnessCompletedDisposition.extend(frameFields.shape),
    externalHarnessFailedDisposition.extend(frameFields.shape),
    sessionNotActiveDisposition.extend(frameFields.shape),
    operatorCancelledDisposition.extend(frameFields.shape),
    runtimeCancelledDisposition.extend(frameFields.shape),
  ] as const;
}

/** Exact wire representation of the terminal disposition union. */
export const OperatorTurnTerminalDispositionSchema = z.discriminatedUnion(
  "dispositionReason",
  terminalDispositionBranches(emptyFrameFieldsSchema),
);

/**
 * Composes the terminal disposition with a strict frame envelope while keeping
 * the reason-specific evidence correlation in one shared union.
 */
export function extendOperatorTurnTerminalDispositionSchema<TFrame extends z.ZodRawShape>(
  frameFields: z.ZodObject<TFrame>,
) {
  return z.union(terminalDispositionBranches(frameFields));
}

export type OperatorTurnTerminalDisposition = z.infer<typeof OperatorTurnTerminalDispositionSchema>;
export type OperatorTurnTerminalDispositionReason = OperatorTurnTerminalDisposition["dispositionReason"];
