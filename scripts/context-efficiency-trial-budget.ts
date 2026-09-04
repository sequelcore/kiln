export interface ContextEfficiencyTrialBudgetLimits {
  readonly timeoutMs: number;
  readonly maximumCumulativeInputTokens: number;
  readonly maximumCumulativeOutputTokens: number;
  readonly maximumProviderRequests: number;
  readonly maximumToolCalls: number;
  readonly maximumManagedChildren: number;
}

/** One already-dispatched physical request, whether produced by the parent or a managed child. */
export interface ContextEfficiencyPhysicalRequestUsage {
  /**
   * Collector-normalized identity, derived from the enclosing session/turn,
   * request index, dispatch attempt, and managed-child lineage when present.
   * It is deliberately not a new ProviderRequestObservation field.
   */
  readonly requestId: string;
  readonly inputTokens: number | "unknown";
  readonly outputTokens: number | "unknown";
}

export type ContextEfficiencyObservedUsage =
  | {
    readonly kind: "observed";
    readonly physicalRequestCount: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
  }
  | {
    readonly kind: "unknown";
    readonly physicalRequestCount: number;
    readonly reason: "duplicate_physical_request" | "invalid_token_usage" | "unknown_token_usage";
  };

export type ContextEfficiencyTrialBudgetStopReason =
  | "failure"
  | "usage_unknown"
  | "invalid_observation"
  | "elapsed_exhausted"
  | "input_tripwire"
  | "output_tripwire"
  | "provider_request_exhausted"
  | "tool_call_exhausted"
  | "managed_child_exhausted";

export type ContextEfficiencyTrialBudgetDecision =
  | {
    readonly kind: "allow";
    readonly usage: Extract<ContextEfficiencyObservedUsage, { readonly kind: "observed" }>;
    readonly allocation: {
      readonly remainingElapsedMs: number;
      readonly remainingInputTokens: number;
      readonly remainingOutputTokens: number;
      readonly remainingProviderRequests: number;
      readonly remainingToolCalls: number;
      readonly remainingManagedChildren: number;
    };
  }
  | {
    readonly kind: "stop";
    readonly reason: ContextEfficiencyTrialBudgetStopReason;
    readonly usage?: ContextEfficiencyObservedUsage;
  };

export interface ContextEfficiencyTrialBudgetInput {
  readonly limits: ContextEfficiencyTrialBudgetLimits;
  /** Wall time since this trial began, including completed parent and child work. */
  readonly elapsedMs: number;
  readonly toolCallCount: number;
  readonly managedChildCount: number;
  /** A terminal failure or unsettled prior dispatch never permits another trial turn. */
  readonly failed: boolean;
  readonly physicalRequests: readonly ContextEfficiencyPhysicalRequestUsage[];
}

/**
 * Adds parent and child physical-request usage exactly once. Unknown and malformed
 * usage remains explicit so callers cannot turn it into a zero-cost retry.
 */
export function sumContextEfficiencyObservedUsage(
  physicalRequests: readonly ContextEfficiencyPhysicalRequestUsage[],
): ContextEfficiencyObservedUsage {
  const requestIds = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let unknownReason: Extract<ContextEfficiencyObservedUsage, { readonly kind: "unknown" }> ["reason"] | undefined;

  for (const request of physicalRequests) {
    if (!isNonEmptyString(request.requestId) || requestIds.has(request.requestId)) {
      unknownReason = selectUnknownReason(unknownReason, "duplicate_physical_request");
      continue;
    }
    requestIds.add(request.requestId);

    if (request.inputTokens === "unknown" || request.outputTokens === "unknown") {
      unknownReason = selectUnknownReason(unknownReason, "unknown_token_usage");
      continue;
    }
    if (!isNonNegativeSafeInteger(request.inputTokens) || !isNonNegativeSafeInteger(request.outputTokens)) {
      unknownReason = selectUnknownReason(unknownReason, "invalid_token_usage");
      continue;
    }
    inputTokens += request.inputTokens;
    outputTokens += request.outputTokens;
    if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) {
      unknownReason = selectUnknownReason(unknownReason, "invalid_token_usage");
    }
  }

  if (unknownReason !== undefined) {
    return { kind: "unknown", physicalRequestCount: requestIds.size, reason: unknownReason };
  }

  return { kind: "observed", physicalRequestCount: requestIds.size, inputTokens, outputTokens };
}

/**
 * Computes the next diagnostic-turn allocation. These are collector tripwires,
 * not a substitute for Runtime's transport admission fence.
 */
export function evaluateContextEfficiencyTrialBudget(
  input: ContextEfficiencyTrialBudgetInput,
): ContextEfficiencyTrialBudgetDecision {
  if (!hasValidLimits(input.limits)
    || !isNonNegativeSafeInteger(input.elapsedMs)
    || !isNonNegativeSafeInteger(input.toolCallCount)
    || !isNonNegativeSafeInteger(input.managedChildCount)) {
    return { kind: "stop", reason: "invalid_observation" };
  }

  const usage = sumContextEfficiencyObservedUsage(input.physicalRequests);
  if (input.failed) return { kind: "stop", reason: "failure", usage };
  if (usage.kind === "unknown") return { kind: "stop", reason: "usage_unknown", usage };
  if (input.elapsedMs >= input.limits.timeoutMs) return { kind: "stop", reason: "elapsed_exhausted", usage };
  if (usage.inputTokens >= input.limits.maximumCumulativeInputTokens) {
    return { kind: "stop", reason: "input_tripwire", usage };
  }
  if (usage.outputTokens >= input.limits.maximumCumulativeOutputTokens) {
    return { kind: "stop", reason: "output_tripwire", usage };
  }
  if (usage.physicalRequestCount >= input.limits.maximumProviderRequests) {
    return { kind: "stop", reason: "provider_request_exhausted", usage };
  }
  if (input.toolCallCount > input.limits.maximumToolCalls) {
    return { kind: "stop", reason: "tool_call_exhausted", usage };
  }
  if (input.managedChildCount > input.limits.maximumManagedChildren) {
    return { kind: "stop", reason: "managed_child_exhausted", usage };
  }

  return {
    kind: "allow",
    usage,
    allocation: {
      remainingElapsedMs: input.limits.timeoutMs - input.elapsedMs,
      remainingInputTokens: input.limits.maximumCumulativeInputTokens - usage.inputTokens,
      remainingOutputTokens: input.limits.maximumCumulativeOutputTokens - usage.outputTokens,
      remainingProviderRequests: input.limits.maximumProviderRequests - usage.physicalRequestCount,
      remainingToolCalls: input.limits.maximumToolCalls - input.toolCallCount,
      remainingManagedChildren: input.limits.maximumManagedChildren - input.managedChildCount,
    },
  };
}

function hasValidLimits(limits: ContextEfficiencyTrialBudgetLimits): boolean {
  return Object.values(limits).every(isPositiveSafeInteger);
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Keep the most diagnostic reason regardless of the order observations arrive. */
function selectUnknownReason(
  current: Extract<ContextEfficiencyObservedUsage, { readonly kind: "unknown" }> ["reason"] | undefined,
  candidate: Extract<ContextEfficiencyObservedUsage, { readonly kind: "unknown" }> ["reason"],
): Extract<ContextEfficiencyObservedUsage, { readonly kind: "unknown" }> ["reason"] {
  const precedence = {
    unknown_token_usage: 1,
    invalid_token_usage: 2,
    duplicate_physical_request: 3,
  } as const;
  return current === undefined || precedence[candidate] > precedence[current] ? candidate : current;
}
