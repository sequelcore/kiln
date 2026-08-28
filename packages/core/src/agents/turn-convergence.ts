export type ObservedTurnQuantity =
  | { readonly status: "observed"; readonly value: number }
  | { readonly status: "unknown"; readonly reason: string };

export interface TurnConvergencePolicyInput {
  readonly policyId: string;
  readonly configurationHash: string;
  readonly providerRequests: number;
  readonly toolRounds: number;
  readonly toolCalls: number;
  readonly cumulativeInputTokens: number;
  readonly elapsedMs: number;
  readonly activeMs: number;
  readonly recoveryAttempts: number;
  readonly consecutiveNoProgressSteps: number;
}

export type ResolvedTurnConvergencePolicy = Readonly<TurnConvergencePolicyInput>;

export interface TurnConvergenceObservation {
  readonly providerRequests: number;
  readonly toolRounds: number;
  readonly toolCalls: number;
  readonly cumulativeInputTokens: ObservedTurnQuantity;
  readonly elapsedMs: number;
  readonly activeMs: ObservedTurnQuantity;
  readonly recoveryAttempts: number;
  readonly consecutiveNoProgressSteps: number;
}

export type TurnConvergenceReservation =
  | {
    readonly kind: "provider_request";
    readonly projectedInputTokens: ObservedTurnQuantity;
  }
  | {
    readonly kind: "tool_batch";
    readonly toolCallCount: number;
  };

export type TurnConvergencePauseReason =
  | "provider_request_limit"
  | "tool_round_limit"
  | "tool_call_limit"
  | "cumulative_input_limit"
  | "elapsed_time_limit"
  | "active_time_limit"
  | "recovery_limit"
  | "no_progress"
  | "observation_unavailable";

export type TurnConvergenceMetric =
  | "providerRequests"
  | "toolRounds"
  | "toolCalls"
  | "cumulativeInputTokens"
  | "projectedInputTokens"
  | "elapsedMs"
  | "activeMs"
  | "recoveryAttempts"
  | "consecutiveNoProgressSteps";

export type TurnConvergenceLimitPauseReason = Exclude<TurnConvergencePauseReason, "observation_unavailable">;

type TurnConvergenceLimitPauseMetric = {
  readonly provider_request_limit: "providerRequests";
  readonly tool_round_limit: "toolRounds";
  readonly tool_call_limit: "toolCalls";
  readonly cumulative_input_limit: "cumulativeInputTokens";
  readonly elapsed_time_limit: "elapsedMs";
  readonly active_time_limit: "activeMs";
  readonly recovery_limit: "recoveryAttempts";
  readonly no_progress: "consecutiveNoProgressSteps";
};

type TurnConvergenceLimitPauseDecision = {
  [Reason in TurnConvergenceLimitPauseReason]: {
    readonly status: "pause";
    readonly reason: Reason;
    readonly metric: TurnConvergenceLimitPauseMetric[Reason];
    readonly observed: number;
    readonly limit: number;
  };
}[TurnConvergenceLimitPauseReason];

type DistributiveOmit<Value, Key extends PropertyKey> = Value extends unknown ? Omit<Value, Key> : never;
type TurnConvergenceLimitPauseInput = DistributiveOmit<TurnConvergenceLimitPauseDecision, "status">;

export type TurnConvergencePauseDecision =
  | TurnConvergenceLimitPauseDecision
  | {
    readonly status: "pause";
    readonly reason: "observation_unavailable";
    readonly metric: TurnConvergenceMetric;
    readonly unknownReason: string;
  };

export type TurnConvergenceDecision =
  | { readonly status: "continue" }
  | TurnConvergencePauseDecision;

const POLICY_MAXIMUM_FIELDS = [
  "providerRequests",
  "toolRounds",
  "toolCalls",
  "cumulativeInputTokens",
  "elapsedMs",
  "activeMs",
  "recoveryAttempts",
  "consecutiveNoProgressSteps",
] as const satisfies readonly (keyof TurnConvergencePolicyInput)[];
const SHA256_CONFIGURATION_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

/** Normalize and freeze the explicit limits used by one turn-convergence policy. */
export function resolveTurnConvergencePolicy(
  input: TurnConvergencePolicyInput,
): ResolvedTurnConvergencePolicy {
  return Object.freeze({
    policyId: requireIdentity(input.policyId, "policyId"),
    configurationHash: requireConfigurationHash(input.configurationHash),
    providerRequests: requirePositiveSafeInteger(input.providerRequests, "providerRequests"),
    toolRounds: requirePositiveSafeInteger(input.toolRounds, "toolRounds"),
    toolCalls: requirePositiveSafeInteger(input.toolCalls, "toolCalls"),
    cumulativeInputTokens: requirePositiveSafeInteger(input.cumulativeInputTokens, "cumulativeInputTokens"),
    elapsedMs: requirePositiveSafeInteger(input.elapsedMs, "elapsedMs"),
    activeMs: requirePositiveSafeInteger(input.activeMs, "activeMs"),
    recoveryAttempts: requirePositiveSafeInteger(input.recoveryAttempts, "recoveryAttempts"),
    consecutiveNoProgressSteps: requirePositiveSafeInteger(
      input.consecutiveNoProgressSteps,
      "consecutiveNoProgressSteps",
    ),
  });
}

/** Apply the fixed convergence precedence to one next-step reservation. */
export function decideTurnConvergence(
  policy: ResolvedTurnConvergencePolicy,
  observation: TurnConvergenceObservation,
  reservation: TurnConvergenceReservation,
): TurnConvergenceDecision {
  validateReservation(reservation);

  const invalidElapsed = invalidNumber(observation.elapsedMs, "elapsedMs");
  if (invalidElapsed !== undefined) return unavailable("elapsedMs", invalidElapsed);
  if (observation.elapsedMs >= policy.elapsedMs) {
    return limit({
      reason: "elapsed_time_limit",
      metric: "elapsedMs",
      observed: observation.elapsedMs,
      limit: policy.elapsedMs,
    });
  }

  if (observation.activeMs.status === "unknown") return unavailable("activeMs", observation.activeMs.reason);
  if (observation.activeMs.status !== "observed") {
    return unavailable("activeMs", "activeMs observation is invalid");
  }
  const invalidActive = invalidNumber(observation.activeMs.value, "activeMs");
  if (invalidActive !== undefined) return unavailable("activeMs", invalidActive);
  if (observation.activeMs.value >= policy.activeMs) {
    return limit({
      reason: "active_time_limit",
      metric: "activeMs",
      observed: observation.activeMs.value,
      limit: policy.activeMs,
    });
  }

  const invalidRecovery = invalidCount(observation.recoveryAttempts, "recoveryAttempts");
  if (invalidRecovery !== undefined) return unavailable("recoveryAttempts", invalidRecovery);
  if (observation.recoveryAttempts >= policy.recoveryAttempts) {
    return limit({
      reason: "recovery_limit",
      metric: "recoveryAttempts",
      observed: observation.recoveryAttempts,
      limit: policy.recoveryAttempts,
    });
  }

  const invalidNoProgress = invalidCount(
    observation.consecutiveNoProgressSteps,
    "consecutiveNoProgressSteps",
  );
  if (invalidNoProgress !== undefined) return unavailable("consecutiveNoProgressSteps", invalidNoProgress);
  if (observation.consecutiveNoProgressSteps >= policy.consecutiveNoProgressSteps) {
    return limit(
      {
        reason: "no_progress",
        metric: "consecutiveNoProgressSteps",
        observed: observation.consecutiveNoProgressSteps,
        limit: policy.consecutiveNoProgressSteps,
      },
    );
  }

  switch (reservation.kind) {
    case "provider_request":
      const invalidRequests = invalidCount(observation.providerRequests, "providerRequests");
      if (invalidRequests !== undefined) return unavailable("providerRequests", invalidRequests);
      if (observation.providerRequests >= policy.providerRequests) {
        return limit({
          reason: "provider_request_limit",
          metric: "providerRequests",
          observed: observation.providerRequests,
          limit: policy.providerRequests,
        });
      }
      const invalidRounds = invalidCount(observation.toolRounds, "toolRounds");
      if (invalidRounds !== undefined) return unavailable("toolRounds", invalidRounds);
      if (observation.toolRounds >= policy.toolRounds) {
        return limit({
          reason: "tool_round_limit",
          metric: "toolRounds",
          observed: observation.toolRounds,
          limit: policy.toolRounds,
        });
      }
      if (observation.cumulativeInputTokens.status === "unknown") {
        return unavailable("cumulativeInputTokens", observation.cumulativeInputTokens.reason);
      }
      if (observation.cumulativeInputTokens.status !== "observed") {
        return unavailable("cumulativeInputTokens", "cumulativeInputTokens observation is invalid");
      }
      if (reservation.projectedInputTokens.status === "unknown") {
        return unavailable("projectedInputTokens", reservation.projectedInputTokens.reason);
      }
      if (reservation.projectedInputTokens.status !== "observed") {
        return unavailable("projectedInputTokens", "projectedInputTokens observation is invalid");
      }
      const invalidCumulative = invalidNonNegativeSafeInteger(
        observation.cumulativeInputTokens.value,
        "cumulativeInputTokens",
      );
      if (invalidCumulative !== undefined) return unavailable("cumulativeInputTokens", invalidCumulative);
      const projectedInputTokens = reservation.projectedInputTokens.value;
      if (observation.cumulativeInputTokens.value > policy.cumulativeInputTokens - projectedInputTokens) {
        return limit(
          {
            reason: "cumulative_input_limit",
            metric: "cumulativeInputTokens",
            observed: observation.cumulativeInputTokens.value + projectedInputTokens,
            limit: policy.cumulativeInputTokens,
          },
        );
      }
      return continueDecision();
    case "tool_batch":
      const invalidToolRounds = invalidCount(observation.toolRounds, "toolRounds");
      if (invalidToolRounds !== undefined) return unavailable("toolRounds", invalidToolRounds);
      if (observation.toolRounds >= policy.toolRounds) {
        return limit({
          reason: "tool_round_limit",
          metric: "toolRounds",
          observed: observation.toolRounds,
          limit: policy.toolRounds,
        });
      }
      const invalidToolCalls = invalidCount(observation.toolCalls, "toolCalls");
      if (invalidToolCalls !== undefined) return unavailable("toolCalls", invalidToolCalls);
      if (observation.toolCalls > policy.toolCalls - reservation.toolCallCount) {
        return limit(
          {
            reason: "tool_call_limit",
            metric: "toolCalls",
            observed: observation.toolCalls + reservation.toolCallCount,
            limit: policy.toolCalls,
          },
        );
      }
      return continueDecision();
  }
}

function limit<Decision extends TurnConvergenceLimitPauseInput>(
  input: Decision,
): Decision & { readonly status: "pause" } {
  return { status: "pause", ...input };
}

function unavailable(metric: TurnConvergenceMetric, unknownReason: string): TurnConvergencePauseDecision {
  return { status: "pause", reason: "observation_unavailable", metric, unknownReason };
}

function continueDecision(): TurnConvergenceDecision {
  return { status: "continue" };
}

function requireIdentity(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function requireConfigurationHash(value: string): string {
  const normalized = requireIdentity(value, "configurationHash");
  if (!SHA256_CONFIGURATION_HASH_PATTERN.test(normalized)) {
    throw new TypeError("configurationHash must be a sha256:<64 lowercase hex> digest");
  }
  return normalized;
}

function requirePositiveSafeInteger(value: number, field: typeof POLICY_MAXIMUM_FIELDS[number]): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a finite positive safe integer`);
  }
  return value;
}

function validateReservation(reservation: TurnConvergenceReservation): void {
  if (reservation.kind === "provider_request") {
    if (reservation.projectedInputTokens.status !== "observed"
      && reservation.projectedInputTokens.status !== "unknown") {
      throw new TypeError("provider_request.projectedInputTokens status is invalid");
    }
    if (reservation.projectedInputTokens.status === "observed"
      && !isNonNegativeSafeInteger(reservation.projectedInputTokens.value)) {
      throw new TypeError("provider_request.projectedInputTokens must be a non-negative safe integer");
    }
    if (reservation.projectedInputTokens.status === "unknown"
      && typeof reservation.projectedInputTokens.reason !== "string") {
      throw new TypeError("provider_request.projectedInputTokens unknown reason must be a string");
    }
    return;
  }
  if (reservation.kind !== "tool_batch") {
    throw new TypeError("turn convergence reservation kind is invalid");
  }
  if (!Number.isSafeInteger(reservation.toolCallCount) || reservation.toolCallCount <= 0) {
    throw new TypeError("tool_batch.toolCallCount must be a positive safe integer");
  }
}

function invalidCount(value: number, field: string): string | undefined {
  return isNonNegativeSafeInteger(value) ? undefined : `${field} observation is invalid`;
}

function invalidNumber(value: number, field: string): string | undefined {
  return Number.isFinite(value) && value >= 0 ? undefined : `${field} observation is invalid`;
}

function invalidNonNegativeSafeInteger(value: number, field: string): string | undefined {
  return isNonNegativeSafeInteger(value) ? undefined : `${field} observation is invalid`;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
