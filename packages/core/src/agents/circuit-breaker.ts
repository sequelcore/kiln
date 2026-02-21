// CircuitBreaker: state machine for external service call protection (closed -> open -> half-open)

import { KilnError } from "../engine/errors.js";

export interface CircuitBreakerConfig {
  readonly failureThreshold: number;    // failures before opening (default: 5)
  readonly resetTimeoutMs: number;      // time in open state before half-open (default: 30000)
  readonly halfOpenMaxAttempts: number;  // attempts in half-open before closing (default: 1)
}

export type CircuitState = "closed" | "open" | "half-open";

/**
 * Circuit breaker for external service calls.
 * States: closed (normal) -> open (failing, reject fast) -> half-open (probe) -> closed
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime?: number;
  private halfOpenAttempts = 0;
  private readonly config: Required<CircuitBreakerConfig>;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      resetTimeoutMs: config?.resetTimeoutMs ?? 30000,
      halfOpenMaxAttempts: config?.halfOpenMaxAttempts ?? 1,
    };
  }

  get currentState(): CircuitState {
    return this.state;
  }

  /** Execute a function through the circuit breaker. Throws KilnError with code CIRCUIT_OPEN if open. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      // Check if we should transition to half-open
      const now = Date.now();
      if (this.lastFailureTime && now - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.state = "half-open";
        this.halfOpenAttempts = 0;
      } else {
        throw new KilnError(
          "CIRCUIT_OPEN",
          "Circuit breaker is open - service temporarily unavailable",
          {
            context: {
              state: this.state,
              lastFailureTime: this.lastFailureTime,
              resetTimeoutMs: this.config.resetTimeoutMs,
            },
            retryable: true,
          }
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /** Reset the circuit breaker to closed state */
  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.halfOpenAttempts = 0;
    this.lastFailureTime = undefined;
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        // Success threshold met, close the circuit
        this.reset();
      }
    } else {
      // In closed state, reset failure count on success
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      // Failed in half-open, go back to open; reset counts for clean next cycle
      this.state = "open";
      this.failureCount = 0;
      this.halfOpenAttempts = 0;
    } else if (this.failureCount >= this.config.failureThreshold) {
      // Threshold exceeded, open the circuit; reset counts for clean next cycle
      this.state = "open";
      this.failureCount = 0;
      this.halfOpenAttempts = 0;
    }
  }
}
