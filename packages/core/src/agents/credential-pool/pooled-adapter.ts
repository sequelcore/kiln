import type {
  AgentResponse,
  AgentStreamEvent,
  CreateMessageOptions,
  ProviderAdapter,
} from "../index.js";
import type { CredentialExhaustionReason, CredentialOutcome } from "./outcome.js";
import { AllCredentialsExhaustedError, isRetryable } from "./outcome.js";
import { buildCredentialPoolExhaustionDiagnostic, type CredentialPool } from "./pool.js";

export type ErrorOutcomeMapper = (error: unknown) => CredentialOutcome;

export interface PooledProviderAdapterConfig<TAuth, TAdapter extends ProviderAdapter = ProviderAdapter> {
  readonly name: string;
  readonly pool: CredentialPool<TAuth>;
  readonly createAdapter: (auth: TAuth) => TAdapter;
  readonly mapError: ErrorOutcomeMapper;
  readonly maxAttempts?: number;
  readonly shouldRetryOutcome?: (outcome: CredentialOutcome) => boolean;
}

export class PooledProviderAdapter<
  TAuth,
  TAdapter extends ProviderAdapter = ProviderAdapter,
> implements ProviderAdapter {
  readonly name: string;

  private readonly pool: CredentialPool<TAuth>;
  private readonly createAdapter: (auth: TAuth) => TAdapter;
  private readonly mapError: ErrorOutcomeMapper;
  private readonly maxAttempts?: number;
  private readonly shouldRetryOutcome: (outcome: CredentialOutcome) => boolean;

  constructor(config: PooledProviderAdapterConfig<TAuth, TAdapter>) {
    this.name = config.name;
    this.pool = config.pool;
    this.createAdapter = config.createAdapter;
    this.mapError = config.mapError;
    this.maxAttempts = config.maxAttempts;
    this.shouldRetryOutcome = config.shouldRetryOutcome ?? isRetryable;
  }

  async createMessage(options: CreateMessageOptions): Promise<AgentResponse> {
    let lastError: unknown;
    let lastOutcome: CredentialOutcome | undefined;

    for (let attempt = 0; attempt < this.resolveMaxAttempts(); attempt++) {
      const lease = this.acquireOrThrow(lastError, lastOutcome);
      const adapter = this.createAdapter(lease.auth);

      try {
        const response = await adapter.createMessage(options);
        this.pool.report(lease, { type: "ok" });
        return response;
      } catch (error) {
        const outcome = this.mapError(error);
        this.pool.report(lease, outcome);

        if (!this.shouldRetryOutcome(outcome)) {
          throw error;
        }

        lastError = error;
        lastOutcome = outcome;
      }
    }

    throw new AllCredentialsExhaustedError(
      lastError,
      lastOutcome,
      this.buildDiagnostic("attempts-exhausted", lastOutcome),
    );
  }

  async *streamMessage(options: CreateMessageOptions): AsyncGenerator<AgentStreamEvent> {
    let lastError: unknown;
    let lastOutcome: CredentialOutcome | undefined;

    for (let attempt = 0; attempt < this.resolveMaxAttempts(); attempt++) {
      const lease = this.acquireOrThrow(lastError, lastOutcome);
      const adapter = this.createAdapter(lease.auth);
      const events: AgentStreamEvent[] = [];

      try {
        for await (const event of adapter.streamMessage(options)) {
          events.push(event);
        }
        this.pool.report(lease, { type: "ok" });
        for (const event of events) {
          yield event;
        }
        return;
      } catch (error) {
        const outcome = this.mapError(error);
        this.pool.report(lease, outcome);

        if (!this.shouldRetryOutcome(outcome)) {
          throw error;
        }

        lastError = error;
        lastOutcome = outcome;
      }
    }

    throw new AllCredentialsExhaustedError(
      lastError,
      lastOutcome,
      this.buildDiagnostic("attempts-exhausted", lastOutcome),
    );
  }

  private resolveMaxAttempts(): number {
    if (this.maxAttempts !== undefined) {
      return this.maxAttempts;
    }
    return Math.max(1, this.pool.snapshot().metrics.totalCredentials);
  }

  private acquireOrThrow(
    lastError: unknown,
    lastOutcome: CredentialOutcome | undefined,
  ): ReturnType<CredentialPool<TAuth>["acquire"]> {
    try {
      return this.pool.acquire();
    } catch (error) {
      if (error instanceof AllCredentialsExhaustedError) {
        throw new AllCredentialsExhaustedError(
          lastError ?? error.cause,
          lastOutcome ?? undefined,
          this.buildDiagnostic(error.diagnostic?.reason ?? "all-credentials-unavailable", lastOutcome ?? error.lastOutcome),
        );
      }
      throw error;
    }
  }

  private buildDiagnostic(
    reason: CredentialExhaustionReason,
    lastOutcome: CredentialOutcome | null | undefined,
  ) {
    return buildCredentialPoolExhaustionDiagnostic(this.pool.snapshot(), reason, lastOutcome ?? null);
  }
}
