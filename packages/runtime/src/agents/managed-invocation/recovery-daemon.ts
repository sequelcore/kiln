import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
import type {
  ManagedAgentPersistentRecoveryInput,
  ManagedAgentStaleRecoveryInput,
  ManagedAgentStaleRecoveryResult,
} from "./index.js";

export interface ManagedAgentRuntimeRecoveryDaemonService {
  recoverStaleInvocations(input: ManagedAgentStaleRecoveryInput): Promise<ManagedAgentStaleRecoveryResult>;
  recoverPersistedInvocations(input?: ManagedAgentPersistentRecoveryInput): Promise<ManagedAgentStaleRecoveryResult>;
}

export interface ManagedAgentRuntimeRecoveryDaemonConfig {
  readonly service: ManagedAgentRuntimeRecoveryDaemonService;
  readonly staleAfterMs: number;
  readonly sweepIntervalMs: number;
  readonly recoverPersistedOnStart?: boolean;
  readonly staleReason?: string;
  readonly persistedReason?: string;
  readonly now?: () => Date;
  readonly setTimeoutImpl?: typeof setTimeout;
  readonly clearTimeoutImpl?: typeof clearTimeout;
}

export interface ManagedAgentRuntimeRecoveryDaemonRunInput {
  readonly recoverPersisted?: boolean;
}

export interface ManagedAgentRuntimeRecoveryDaemonRunResult {
  readonly persisted?: ManagedAgentStaleRecoveryResult;
  readonly stale: ManagedAgentStaleRecoveryResult;
}

export class ManagedAgentRuntimeRecoveryDaemon {
  private readonly service: ManagedAgentRuntimeRecoveryDaemonService;
  private readonly staleAfterMs: number;
  private readonly sweepIntervalMs: number;
  private readonly recoverPersistedOnStart: boolean;
  private readonly staleReason: string;
  private readonly persistedReason: string;
  private readonly now: () => Date;
  private readonly setTimeoutImpl: typeof setTimeout;
  private readonly clearTimeoutImpl: typeof clearTimeout;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private generation = 0;
  private startupPersistedPending = false;
  private sweepInFlight: Promise<ManagedAgentRuntimeRecoveryDaemonRunResult> | undefined;
  private sweepInFlightRecoverPersisted = false;
  private queuedPersistedSweep: Promise<ManagedAgentRuntimeRecoveryDaemonRunResult> | undefined;
  private lastSweepError: Error | undefined;

  constructor(config: ManagedAgentRuntimeRecoveryDaemonConfig) {
    if (!Number.isFinite(config.staleAfterMs) || config.staleAfterMs <= 0) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent recovery daemon stale threshold must be greater than zero");
    }
    if (!Number.isFinite(config.sweepIntervalMs) || config.sweepIntervalMs <= 0) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent recovery daemon sweep interval must be greater than zero");
    }
    this.service = config.service;
    this.staleAfterMs = config.staleAfterMs;
    this.sweepIntervalMs = config.sweepIntervalMs;
    this.recoverPersistedOnStart = config.recoverPersistedOnStart ?? true;
    this.staleReason = validateReason(
      config.staleReason,
      "Managed invocation heartbeat expired during scheduled recovery.",
    );
    this.persistedReason = validateReason(
      config.persistedReason,
      "Runtime recovery daemon found persisted managed invocation state.",
    );
    this.now = config.now ?? (() => new Date());
    this.setTimeoutImpl = config.setTimeoutImpl ?? setTimeout;
    this.clearTimeoutImpl = config.clearTimeoutImpl ?? clearTimeout;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.generation += 1;
    this.startupPersistedPending = this.recoverPersistedOnStart;
    this.lastSweepError = undefined;
    this.scheduleNext(0, this.generation);
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    this.startupPersistedPending = false;
    this.sweepInFlight = undefined;
    this.sweepInFlightRecoverPersisted = false;
    this.queuedPersistedSweep = undefined;
    if (this.timer !== undefined) {
      this.clearTimeoutImpl(this.timer);
      this.timer = undefined;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  lastError(): Error | undefined {
    return this.lastSweepError;
  }

  async runOnce(
    input: ManagedAgentRuntimeRecoveryDaemonRunInput = {},
  ): Promise<ManagedAgentRuntimeRecoveryDaemonRunResult> {
    const needsPersistedRecovery = input.recoverPersisted === true || this.startupPersistedPending;
    if (this.sweepInFlight !== undefined) {
      if (needsPersistedRecovery && !this.sweepInFlightRecoverPersisted) {
        this.startupPersistedPending = true;
        if (this.queuedPersistedSweep === undefined) {
          const queuedGeneration = this.generation;
          const queued = this.sweepInFlight
            .catch(() => undefined)
            .then(() => {
              if (this.generation !== queuedGeneration) {
                throw new ManagedAgentRuntimeAdmissionError("Managed agent recovery daemon sweep generation changed before persisted recovery");
              }
              return this.runOnce({ recoverPersisted: true });
            })
            .finally(() => {
              if (this.queuedPersistedSweep === queued) {
                this.queuedPersistedSweep = undefined;
              }
            });
          this.queuedPersistedSweep = queued;
        }
        return this.queuedPersistedSweep;
      }
      return this.sweepInFlight;
    }
    const recoverPersisted = this.consumeRecoverPersisted(input.recoverPersisted === true);
    const generation = this.generation;
    const sweep = this.runRecoveryCycle(recoverPersisted)
      .then((result) => {
        if (this.generation === generation) {
          this.lastSweepError = undefined;
        }
        return result;
      })
      .finally(() => {
        if (this.sweepInFlight === sweep) {
          this.sweepInFlight = undefined;
          this.sweepInFlightRecoverPersisted = false;
        }
      });
    this.sweepInFlight = sweep;
    this.sweepInFlightRecoverPersisted = recoverPersisted;
    return sweep;
  }

  private scheduleNext(delayMs: number, generation: number): void {
    if (!this.running) {
      return;
    }
    this.timer = this.setTimeoutImpl(() => {
      this.timer = undefined;
      void this.runScheduledSweep(generation);
    }, Math.max(delayMs, 0));
    maybeUnrefTimer(this.timer);
  }

  private async runScheduledSweep(generation: number): Promise<void> {
    if (!this.isActiveGeneration(generation)) {
      return;
    }
    try {
      await this.runOnce();
    } catch (error) {
      if (this.isActiveGeneration(generation)) {
        this.lastSweepError = toError(error);
      }
    } finally {
      if (this.isActiveGeneration(generation)) {
        this.scheduleNext(this.sweepIntervalMs, generation);
      }
    }
  }

  private async runRecoveryCycle(recoverPersisted: boolean): Promise<ManagedAgentRuntimeRecoveryDaemonRunResult> {
    const now = this.now();
    if (Number.isNaN(now.getTime())) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent recovery daemon timestamp is invalid");
    }
    const persisted = recoverPersisted
      ? await this.service.recoverPersistedInvocations({
        now,
        reason: this.persistedReason,
      })
      : undefined;
    const stale = await this.service.recoverStaleInvocations({
      staleAfterMs: this.staleAfterMs,
      now,
      reason: this.staleReason,
    });
    return {
      ...(persisted !== undefined ? { persisted } : {}),
      stale,
    };
  }

  private consumeRecoverPersisted(requested: boolean): boolean {
    const recoverPersisted = requested || this.startupPersistedPending;
    this.startupPersistedPending = false;
    return recoverPersisted;
  }

  private isActiveGeneration(generation: number): boolean {
    return this.running && this.generation === generation;
  }
}

function validateReason(input: string | undefined, fallback: string): string {
  if (input === undefined) {
    return fallback;
  }
  if (input.trim().length === 0) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent recovery daemon reason must be non-empty");
  }
  return input;
}

function maybeUnrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const candidate = timer as { readonly unref?: () => unknown };
  if (typeof candidate.unref === "function") {
    candidate.unref();
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
