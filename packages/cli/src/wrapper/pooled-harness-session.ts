import { randomUUID } from "node:crypto";
import {
  AllCredentialsExhaustedError,
  isManagedAgentProviderQuotaFailure,
  type CredentialOutcome,
  type CredentialPool,
  type ExecutionSessionEphemeralHarnessStateEvidence,
  type ExecutionSessionEvent,
} from "@kilnai/core";
import type { HarnessHomeAuth, HarnessPoolProviderId } from "@kilnai/runtime";
import type { IKilnSession, SessionCapabilities, SessionRunOptions } from "./session.js";
import { MODEL_FACING_DEFAULT_PERMISSION_POLICY } from "../config/model-facing-permission-policy.js";

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
  private _observedHarnessVersion: string | undefined;
  private pendingEphemeralHarnessStateEvidence: ExecutionSessionEphemeralHarnessStateEvidence[] = [];

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
      permissionPolicy: MODEL_FACING_DEFAULT_PERMISSION_POLICY,
    };
  }

  get providerSessionId(): string | undefined {
    return this.activeSession?.providerSessionId;
  }

  get observedHarnessVersion(): string | undefined {
    return this._observedHarnessVersion ?? this.activeSession?.observedHarnessVersion;
  }

  async *run(options: SessionRunOptions): AsyncIterable<ExecutionSessionEvent> {
    this._observedHarnessVersion = undefined;
    const pool = await this.pool;
    if (pool.snapshot().metrics.totalCredentials === 0) {
      const session = this.createDefaultSession();
      this.activeSession = session;
      try {
        yield* session.run(options);
      } finally {
        await session.dispose();
        this._observedHarnessVersion = session.observedHarnessVersion;
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
      const events: ExecutionSessionEvent[] = [];

      try {
        for await (const event of session.run(options)) {
          events.push(event);
        }
      } finally {
        await session.dispose();
        this._observedHarnessVersion = session.observedHarnessVersion;
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

      // A retry discards the entire failed attempt, including evidence
      // finalized by the inner session during disposal.
      session.drainEphemeralHarnessStateEvidence?.();

      lastError = events.find((event) => event.type === "error")?.message;
      lastOutcome = outcome;
    }

    throw new AllCredentialsExhaustedError(lastError, lastOutcome);
  }

  async dispose(): Promise<void> {
    const session = this.activeSession;
    if (session === null) return;
    try {
      await session.dispose();
    } finally {
      this._observedHarnessVersion = session.observedHarnessVersion ?? this._observedHarnessVersion;
      for (const evidence of session.drainEphemeralHarnessStateEvidence?.() ?? []) {
        if (!this.pendingEphemeralHarnessStateEvidence.some((candidate) =>
          candidate.capabilityId === evidence.capabilityId
          && candidate.artifactDigest === evidence.artifactDigest
          && candidate.cleanupStatus === evidence.cleanupStatus
        )) {
          this.pendingEphemeralHarnessStateEvidence.push(evidence);
        }
      }
      this.activeSession = null;
    }
  }

  drainEphemeralHarnessStateEvidence(): readonly ExecutionSessionEphemeralHarnessStateEvidence[] {
    const evidence = this.pendingEphemeralHarnessStateEvidence;
    this.pendingEphemeralHarnessStateEvidence = [];
    return evidence;
  }

  private resolveMaxAttempts(pool: CredentialPool<HarnessHomeAuth>): number {
    return Math.max(1, pool.snapshot().metrics.totalCredentials);
  }
}

function mapHarnessEventsToOutcome(events: readonly ExecutionSessionEvent[]): CredentialOutcome {
  const error = events.find((event) => event.type === "error");
  if (!error) {
    return { type: "ok" };
  }

  const text = `${error.code} ${error.message}`.toLowerCase();
  if (text.includes("429") || text.includes("rate limit") || text.includes("rate-limit")) {
    return { type: "rate-limited" };
  }
  if (isManagedAgentProviderQuotaFailure(error)) {
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
