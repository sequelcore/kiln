import { randomUUID } from "node:crypto";
import { AllCredentialsExhaustedError, type CredentialOutcome, type CredentialPool } from "@kilnai/core";
import type { HarnessHomeAuth, HarnessPoolProviderId } from "@kilnai/runtime";
import type { IKilnSession, SessionCapabilities, SessionEvent, SessionRunOptions } from "./session.js";

export interface PooledHarnessSessionConfig {
  readonly runtimeSessionId?: string;
  readonly provider: HarnessPoolProviderId;
  readonly pool: CredentialPool<HarnessHomeAuth> | Promise<CredentialPool<HarnessHomeAuth>>;
  readonly createSession: (auth: HarnessHomeAuth) => IKilnSession;
  readonly createDefaultSession: () => IKilnSession;
}

export class PooledHarnessSession implements IKilnSession {
  readonly sessionId: string;

  private readonly provider: HarnessPoolProviderId;
  private readonly pool: CredentialPool<HarnessHomeAuth> | Promise<CredentialPool<HarnessHomeAuth>>;
  private readonly createSession: (auth: HarnessHomeAuth) => IKilnSession;
  private readonly createDefaultSession: () => IKilnSession;
  private activeSession: IKilnSession | null = null;

  constructor(config: PooledHarnessSessionConfig) {
    this.provider = config.provider;
    this.pool = config.pool;
    this.createSession = config.createSession;
    this.createDefaultSession = config.createDefaultSession;
    this.sessionId = config.runtimeSessionId ?? `pooled-${this.provider}-${randomUUID()}`;
  }

  get capabilities(): SessionCapabilities {
    return this.activeSession?.capabilities ?? {
      mcp: this.provider !== "codex",
      streaming: true,
      resumable: false,
      resume: false,
      costTrackingMode: this.provider === "codex" ? "computed" : "native",
      supportedTools: [],
      maxContextTokens: null,
      priority: this.provider === "claude-code" ? 1 : this.provider === "opencode" ? 2 : 3,
      fallbackTo: null,
      permissionPolicy: { approval: "on-request", sandbox: "read-only" },
    };
  }

  get providerSessionId(): string | undefined {
    return this.activeSession?.providerSessionId;
  }

  async *run(options: SessionRunOptions): AsyncIterable<SessionEvent> {
    const pool = await this.pool;
    if (pool.snapshot().metrics.totalCredentials === 0) {
      const session = this.createDefaultSession();
      this.activeSession = session;
      try {
        yield* session.run(options);
      } finally {
        await session.dispose();
      }
      return;
    }

    let lastError: unknown;
    let lastOutcome: CredentialOutcome | undefined;

    for (let attempt = 0; attempt < this.resolveMaxAttempts(pool); attempt++) {
      let lease;
      try {
        lease = pool.acquire();
      } catch (error) {
        if (error instanceof AllCredentialsExhaustedError) {
          throw new AllCredentialsExhaustedError(lastError ?? error.cause, lastOutcome);
        }
        throw error;
      }

      const session = this.createSession(lease.auth);
      this.activeSession = session;
      const events: SessionEvent[] = [];

      try {
        for await (const event of session.run(options)) {
          events.push(event);
        }
      } finally {
        await session.dispose();
      }

      const outcome = mapHarnessEventsToOutcome(events);
      pool.report(lease, outcome);

      if (outcome.type === "ok") {
        for (const event of events) {
          yield event;
        }
        return;
      }

      if (!isHarnessRetryable(outcome)) {
        for (const event of events) {
          yield event;
        }
        return;
      }

      lastError = events.find((event) => event.type === "error")?.message;
      lastOutcome = outcome;
    }

    throw new AllCredentialsExhaustedError(lastError, lastOutcome);
  }

  async dispose(): Promise<void> {
    await this.activeSession?.dispose();
    this.activeSession = null;
  }

  private resolveMaxAttempts(pool: CredentialPool<HarnessHomeAuth>): number {
    return Math.max(1, pool.snapshot().metrics.totalCredentials);
  }
}

function mapHarnessEventsToOutcome(events: readonly SessionEvent[]): CredentialOutcome {
  const error = events.find((event) => event.type === "error");
  if (!error) {
    return { type: "ok" };
  }

  const text = `${error.code} ${error.message}`.toLowerCase();
  if (text.includes("429") || text.includes("rate limit") || text.includes("rate-limit")) {
    return { type: "rate-limited" };
  }
  if (text.includes("402") || text.includes("quota")) {
    return { type: "quota-exceeded" };
  }
  if (text.includes("401") || text.includes("403") || text.includes("auth")) {
    return { type: "auth-failed" };
  }
  if (error.isRetryable) {
    return { type: "connection-failed" };
  }
  return { type: "unknown-error", message: error.message };
}

function isHarnessRetryable(outcome: CredentialOutcome): boolean {
  return outcome.type === "rate-limited"
    || outcome.type === "quota-exceeded"
    || outcome.type === "connection-failed";
}
