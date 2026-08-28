import type {
  ObservedTurnQuantity,
  TurnConvergenceObservation,
} from "@kilnai/core/agents";

/** Clock used by one admitted Runtime turn. It must be monotonic in production. */
export type RuntimeMonotonicClock = () => number;

export interface RuntimeProviderRequestCompletion {
  readonly durationMs: number;
}

/**
 * Turn-local derived observations used by the Core convergence decision.
 *
 * This object intentionally has no persistence, lifecycle, or telemetry
 * responsibility. A new instance is created for each admitted turn.
 */
export class RuntimeTurnConvergenceObservationCollector {
  private readonly startedAt: number;
  private readonly monotonicNow: RuntimeMonotonicClock;
  private clockAvailable = true;
  private providerRequestCount = 0;
  private toolRoundCount = 0;
  private toolCallCount = 0;
  private cumulativeInputTokens: ObservedTurnQuantity = { status: "observed", value: 0 };
  private completedActiveMs = 0;
  private activeObservationAvailable = true;
  private activeUnavailableReason: string | undefined;
  private recoveryAttemptCount = 0;
  private noProgressCount = 0;

  constructor(monotonicNow: RuntimeMonotonicClock = defaultRuntimeMonotonicClock) {
    this.monotonicNow = monotonicNow;
    this.startedAt = this.readClock();
  }

  /** Reserve one provider request immediately before its dispatch. */
  recordProviderRequestStarted(): number {
    this.providerRequestCount += 1;
    return this.readClock();
  }

  /**
   * Record the completed provider request and its provider-reported input.
   * The returned duration is retained separately by Runtime provider evidence.
   */
  recordProviderRequestCompleted(
    startedAt: number,
    inputTokens: number | undefined,
  ): RuntimeProviderRequestCompletion {
    const durationMs = this.durationSince(startedAt);
    this.recordActiveDuration(durationMs);
    this.recordInputTokens(inputTokens);
    return { durationMs };
  }

  /** Record one atomically admitted model-issued tool batch. */
  recordToolRound(toolCallCount: number): void {
    if (!isPositiveSafeInteger(toolCallCount)) {
      this.markActiveUnavailable("tool batch call count is invalid");
      return;
    }
    this.toolRoundCount += 1;
    this.toolCallCount += toolCallCount;
  }

  /** Record only an actual tool execution duration; blocked summaries are zero. */
  recordToolExecutionDuration(durationMs: number): void {
    this.recordActiveDuration(durationMs);
  }

  /** Record a Runtime-authored correction or recovery continuation. */
  recordRecoveryAttempt(): void {
    this.recoveryAttemptCount += 1;
  }

  /** Record one classified tool step that produced no material progress. */
  recordNoProgressStep(): void {
    this.noProgressCount += 1;
  }

  /** Reset the reserved no-progress signal when a productive step is observed. */
  recordProgress(): void {
    this.noProgressCount = 0;
  }

  /** Return a fresh plain observation snapshot for one Core decision. */
  snapshot(): TurnConvergenceObservation {
    const now = this.readClock();
    const elapsedMs = this.clockAvailable && Number.isFinite(now)
      ? now - this.startedAt
      : Number.NaN;
    return {
      providerRequests: this.providerRequestCount,
      toolRounds: this.toolRoundCount,
      toolCalls: this.toolCallCount,
      cumulativeInputTokens: this.cumulativeInputTokens,
      elapsedMs,
      activeMs: this.activeObservationAvailable
        ? { status: "observed", value: this.completedActiveMs }
        : {
            status: "unknown",
            reason: this.activeUnavailableReason ?? "active duration observation unavailable",
          },
      recoveryAttempts: this.recoveryAttemptCount,
      consecutiveNoProgressSteps: this.noProgressCount,
    };
  }

  private recordInputTokens(inputTokens: number | undefined): void {
    if (!isNonNegativeSafeInteger(inputTokens)) {
      this.cumulativeInputTokens = {
        status: "unknown",
        reason: "provider-reported input token usage is unavailable or invalid",
      };
      return;
    }
    if (this.cumulativeInputTokens.status === "unknown") return;
    const cumulative = this.cumulativeInputTokens.value + inputTokens;
    if (!Number.isSafeInteger(cumulative)) {
      this.cumulativeInputTokens = {
        status: "unknown",
        reason: "cumulative provider-reported input token usage exceeded safe range",
      };
      return;
    }
    this.cumulativeInputTokens = { status: "observed", value: cumulative };
  }

  private recordActiveDuration(durationMs: number): void {
    if (!isNonNegativeFiniteNumber(durationMs)) {
      this.markActiveUnavailable("active duration observation is invalid");
      return;
    }
    const cumulative = this.completedActiveMs + durationMs;
    if (!Number.isFinite(cumulative)) {
      this.markActiveUnavailable("cumulative active duration observation is invalid");
      return;
    }
    this.completedActiveMs = cumulative;
  }

  private durationSince(startedAt: number): number {
    const endedAt = this.readClock();
    if (!this.clockAvailable || !Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
      this.markActiveUnavailable("monotonic clock observation is unavailable");
      return Number.NaN;
    }
    const durationMs = endedAt - startedAt;
    if (!isNonNegativeFiniteNumber(durationMs)) {
      this.markActiveUnavailable("monotonic clock moved backwards");
      return Number.NaN;
    }
    return durationMs;
  }

  private readClock(): number {
    try {
      const value = this.monotonicNow();
      if (Number.isFinite(value)) return value;
      this.clockAvailable = false;
      return Number.NaN;
    } catch (error) {
      this.clockAvailable = false;
      return Number.NaN;
    }
  }

  private markActiveUnavailable(reason: string): void {
    this.activeObservationAvailable = false;
    this.activeUnavailableReason = reason;
  }
}

export function defaultRuntimeMonotonicClock(): number {
  return globalThis.performance.now();
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
