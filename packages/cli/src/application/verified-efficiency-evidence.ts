import {
  hashPolicyAdaptationConfiguration,
  projectCostUpdatedEventToLifecycleLedger,
  projectVerifiedEfficiencyEvidence,
  reconcileLifecycleAttributionLedger,
  type CanonicalCostUpdatedEvent,
  type ContextAllocationMode,
  type ExecutionBillingMode,
  type VerifiedEfficiencyEvidenceProjection,
  type VerifiedEfficiencyVerificationResult,
} from "@kilnai/core";

export interface BuildCliVerifiedEfficiencyEvidenceInput {
  readonly sessionId: string;
  readonly turnId: string;
  readonly observedAt: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly billingMode?: ExecutionBillingMode;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
  readonly outcome: "succeeded" | "failed" | "unknown";
  readonly contextAllocationMode: ContextAllocationMode;
  readonly policySelection?: {
    readonly policyId: string;
    readonly configurationHash: string;
  };
  readonly verificationResults?: readonly VerifiedEfficiencyVerificationResult[];
}

export interface CliVerifiedEfficiencyEvidence {
  readonly costEvent: CanonicalCostUpdatedEvent;
  readonly ledger: ReturnType<typeof projectCostUpdatedEventToLifecycleLedger>;
  readonly summary: ReturnType<typeof reconcileLifecycleAttributionLedger>["summary"];
  readonly efficiencyEvidence: VerifiedEfficiencyEvidenceProjection;
}

export function buildCliVerifiedEfficiencyEvidence(
  input: BuildCliVerifiedEfficiencyEvidenceInput,
): CliVerifiedEfficiencyEvidence {
  const observedAt = new Date(input.observedAt);
  if (Number.isNaN(observedAt.getTime())) throw new Error("CLI efficiency evidence requires a valid timestamp");
  const costEvent: CanonicalCostUpdatedEvent = {
    eventId: `${input.sessionId}:${input.turnId}:cli-cost`,
    kilnSessionId: input.sessionId,
    sequence: 0,
    timestamp: observedAt,
    kind: "cost_updated",
    turnId: input.turnId,
    provider: {
      provider: input.providerId,
      model: input.modelId,
      canonicalModel: input.modelId,
      ...(input.billingMode ? { billingMode: input.billingMode } : {}),
    },
    usage: {
      inputTokens: requireNonNegativeInteger(input.inputTokens, "input tokens"),
      outputTokens: requireNonNegativeInteger(input.outputTokens, "output tokens"),
      cacheReadTokens: requireNonNegativeInteger(input.cacheReadTokens, "cache read tokens"),
      cacheWriteTokens: requireNonNegativeInteger(input.cacheWriteTokens, "cache write tokens"),
    },
    cost: {
      currency: "USD",
      deltaUsd: requireNonNegative(input.costUsd, "cost"),
      totalUsd: input.costUsd,
    },
    source: { actor: "runtime", surface: "cli", component: "run-command" },
  };
  const ledger = projectCostUpdatedEventToLifecycleLedger(costEvent, {
    allocations: input.outputTokens > 0
      ? [{
          source: "final_output",
          tokenClass: "generated",
          providerTokenClass: "output",
          tokens: input.outputTokens,
          quality: "provider_reported",
          evidenceUris: [`kiln://sessions/${encodeURIComponent(input.sessionId)}/turns/${encodeURIComponent(input.turnId)}/final-output`],
        }]
      : [],
    context: { route: `${input.providerId}/${input.modelId}` },
  });
  const reconciled = reconcileLifecycleAttributionLedger(costEvent, ledger);
  const policy = input.policySelection ?? {
    policyId: `context-${input.contextAllocationMode}-static-v1`,
    configurationHash: hashPolicyAdaptationConfiguration({
      contextAllocationMode: input.contextAllocationMode,
    }),
  };
  const efficiencyEvidence = projectVerifiedEfficiencyEvidence({
    lifecycleEvidence: { costEvent, ledger, summary: reconciled.summary },
    observedAt: input.observedAt,
    policy: { owner: "ContextGovernor", ...policy },
    verificationResults: input.verificationResults,
    outcome: input.outcome,
  });
  return { costEvent, ledger, summary: reconciled.summary, efficiencyEvidence };
}

function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`CLI efficiency ${label} must be a non-negative integer`);
  return value;
}

function requireNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`CLI efficiency ${label} must be non-negative`);
  return value;
}
