import { describe, expect, it, vi } from "vitest";
import {
  ManagedAgentRuntimeAdmissionError,
  ManagedAgentRuntimeRecoveryDaemon,
} from "../../src/agents/managed-invocation/index.js";
import type {
  ManagedAgentRuntimeRecoveryDaemonService,
  ManagedAgentStaleRecoveryResult,
} from "../../src/agents/managed-invocation/index.js";

function emptyRecovery(): ManagedAgentStaleRecoveryResult {
  return { recovered: [] };
}

function makeService(): ManagedAgentRuntimeRecoveryDaemonService & {
  readonly recoverStaleInvocations: ReturnType<ReturnType<typeof vi.fn>>;
  readonly recoverPersistedInvocations: ReturnType<ReturnType<typeof vi.fn>>;
} {
  return {
    recoverStaleInvocations: vi.fn(async () => emptyRecovery()),
    recoverPersistedInvocations: vi.fn(async () => ({ recovered: [], accountLeases: [] })),
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

function makeTimerHarness(): {
  readonly setTimeoutImpl: typeof setTimeout;
  readonly clearTimeoutImpl: typeof clearTimeout;
  readonly delays: readonly number[];
  runNext(): Promise<void>;
} {
  const callbacks: Array<() => void> = [];
  const delays: number[] = [];
  const setTimeoutImpl = vi.fn((callback: () => void, delay?: number) => {
    callbacks.push(callback);
    delays.push(delay ?? 0);
    return { delay } as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  const clearTimeoutImpl = vi.fn() as unknown as typeof clearTimeout;
  return {
    setTimeoutImpl,
    clearTimeoutImpl,
    delays,
    async runNext(): Promise<void> {
      const callback = callbacks.shift();
      if (!callback) {
        throw new Error("expected scheduled recovery daemon callback");
      }
      callback();
      await flushMicrotasks();
    },
  };
}

describe("ManagedAgentRuntimeRecoveryDaemon", () => {
  it("runs persisted restart recovery before stale in-memory recovery on explicit sweeps", async () => {
    const service = makeService();
    const now = new Date("2026-05-22T10:00:00.000Z");
    const daemon = new ManagedAgentRuntimeRecoveryDaemon({
      service,
      staleAfterMs: 60000,
      sweepIntervalMs: 5000,
      staleReason: "scheduled stale recovery",
      persistedReason: "scheduled restart recovery",
      now: () => now,
    });

    const result = await daemon.runOnce({ recoverPersisted: true });

    expect(result).toEqual({
      persisted: { recovered: [], accountLeases: [] },
      stale: { recovered: [] },
    });
    expect(service.recoverPersistedInvocations).toHaveBeenCalledWith({
      now,
      reason: "scheduled restart recovery",
    });
    expect(service.recoverStaleInvocations).toHaveBeenCalledWith({
      staleAfterMs: 60000,
      now,
      reason: "scheduled stale recovery",
    });
    expect(service.recoverPersistedInvocations.mock.invocationCallOrder[0]).toBeLessThan(
      service.recoverStaleInvocations.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("schedules startup persisted recovery once and recurring stale-only sweeps", async () => {
    const service = makeService();
    const timers = makeTimerHarness();
    const daemon = new ManagedAgentRuntimeRecoveryDaemon({
      service,
      staleAfterMs: 1000,
      sweepIntervalMs: 2500,
      now: () => new Date("2026-05-22T10:00:00.000Z"),
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });

    daemon.start();

    expect(daemon.isRunning()).toBe(true);
    expect(timers.delays).toEqual([0]);

    await timers.runNext();

    expect(service.recoverPersistedInvocations).toHaveBeenCalledTimes(1);
    expect(service.recoverStaleInvocations).toHaveBeenCalledTimes(1);
    expect(timers.delays).toEqual([0, 2500]);

    await timers.runNext();

    expect(service.recoverPersistedInvocations).toHaveBeenCalledTimes(1);
    expect(service.recoverStaleInvocations).toHaveBeenCalledTimes(2);
    expect(timers.delays).toEqual([0, 2500, 2500]);

    daemon.stop();

    expect(daemon.isRunning()).toBe(false);
    expect(timers.clearTimeoutImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves startup persisted recovery when a manual stale-only sweep starts before the boot timer fires", async () => {
    const service = makeService();
    const timers = makeTimerHarness();
    const daemon = new ManagedAgentRuntimeRecoveryDaemon({
      service,
      staleAfterMs: 1000,
      sweepIntervalMs: 2500,
      now: () => new Date("2026-05-22T10:00:00.000Z"),
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });

    daemon.start();
    await daemon.runOnce();

    expect(service.recoverPersistedInvocations).toHaveBeenCalledTimes(1);
    expect(service.recoverStaleInvocations).toHaveBeenCalledTimes(1);

    await timers.runNext();

    expect(service.recoverPersistedInvocations).toHaveBeenCalledTimes(1);
    expect(service.recoverStaleInvocations).toHaveBeenCalledTimes(2);
  });

  it("coalesces overlapping recovery requests onto the in-flight sweep", async () => {
    const staleGate = deferred<ManagedAgentStaleRecoveryResult>();
    const service = makeService();
    service.recoverStaleInvocations.mockImplementation(async () => staleGate.promise);
    const daemon = new ManagedAgentRuntimeRecoveryDaemon({
      service,
      staleAfterMs: 1000,
      sweepIntervalMs: 2500,
      now: () => new Date("2026-05-22T10:00:00.000Z"),
    });

    const first = daemon.runOnce();
    const second = daemon.runOnce();

    expect(service.recoverStaleInvocations).toHaveBeenCalledTimes(1);
    staleGate.resolve(emptyRecovery());

    await expect(Promise.all([first, second])).resolves.toEqual([
      { stale: { recovered: [] } },
      { stale: { recovered: [] } },
    ]);
    expect(service.recoverStaleInvocations).toHaveBeenCalledTimes(1);
  });

  it("queues persisted recovery when requested during an in-flight stale-only sweep", async () => {
    const staleGate = deferred<ManagedAgentStaleRecoveryResult>();
    const service = makeService();
    service.recoverStaleInvocations
      .mockImplementationOnce(async () => staleGate.promise)
      .mockImplementation(async () => emptyRecovery());
    const daemon = new ManagedAgentRuntimeRecoveryDaemon({
      service,
      staleAfterMs: 1000,
      sweepIntervalMs: 2500,
      now: () => new Date("2026-05-22T10:00:00.000Z"),
    });

    const staleOnly = daemon.runOnce();
    await flushMicrotasks();
    const persisted = daemon.runOnce({ recoverPersisted: true });

    expect(service.recoverStaleInvocations).toHaveBeenCalledTimes(1);
    expect(service.recoverPersistedInvocations).not.toHaveBeenCalled();

    staleGate.resolve(emptyRecovery());

    await expect(staleOnly).resolves.toEqual({ stale: { recovered: [] } });
    await expect(persisted).resolves.toEqual({
      persisted: { recovered: [], accountLeases: [] },
      stale: { recovered: [] },
    });
    expect(service.recoverPersistedInvocations).toHaveBeenCalledTimes(1);
    expect(service.recoverStaleInvocations).toHaveBeenCalledTimes(2);
    expect(service.recoverPersistedInvocations.mock.invocationCallOrder[0]).toBeLessThan(
      service.recoverStaleInvocations.mock.invocationCallOrder[1] ?? 0,
    );
  });

  it("does not let a stopped in-flight sweep schedule timers into a restarted daemon generation", async () => {
    const staleGate = deferred<ManagedAgentStaleRecoveryResult>();
    const service = makeService();
    const timers = makeTimerHarness();
    service.recoverStaleInvocations.mockImplementationOnce(async () => staleGate.promise);
    const daemon = new ManagedAgentRuntimeRecoveryDaemon({
      service,
      staleAfterMs: 1000,
      sweepIntervalMs: 2500,
      now: () => new Date("2026-05-22T10:00:00.000Z"),
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });

    daemon.start();
    await timers.runNext();
    expect(service.recoverStaleInvocations).toHaveBeenCalledTimes(1);

    daemon.stop();
    daemon.start();

    expect(timers.delays).toEqual([0, 0]);

    staleGate.resolve(emptyRecovery());
    await flushMicrotasks();

    expect(timers.delays).toEqual([0, 0]);

    await timers.runNext();

    expect(service.recoverPersistedInvocations).toHaveBeenCalledTimes(2);
    expect(service.recoverStaleInvocations).toHaveBeenCalledTimes(2);
    expect(timers.delays).toEqual([0, 0, 2500]);
  });

  it("does not let an old generation sweep clear a restarted generation failure", async () => {
    const staleGate = deferred<ManagedAgentStaleRecoveryResult>();
    const service = makeService();
    const timers = makeTimerHarness();
    service.recoverStaleInvocations
      .mockImplementationOnce(async () => staleGate.promise)
      .mockRejectedValueOnce(new Error("restart sweep failed"));
    const daemon = new ManagedAgentRuntimeRecoveryDaemon({
      service,
      staleAfterMs: 1000,
      sweepIntervalMs: 2500,
      now: () => new Date("2026-05-22T10:00:00.000Z"),
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });

    daemon.start();
    await timers.runNext();
    daemon.stop();
    daemon.start();
    await timers.runNext();

    expect(daemon.lastError()?.message).toBe("restart sweep failed");

    staleGate.resolve(emptyRecovery());
    await flushMicrotasks();

    expect(daemon.lastError()?.message).toBe("restart sweep failed");
  });

  it("clears the previous generation failure when starting a new daemon generation", async () => {
    const service = makeService();
    const timers = makeTimerHarness();
    service.recoverStaleInvocations.mockRejectedValueOnce(new Error("previous sweep failed"));
    const daemon = new ManagedAgentRuntimeRecoveryDaemon({
      service,
      staleAfterMs: 1000,
      sweepIntervalMs: 2500,
      now: () => new Date("2026-05-22T10:00:00.000Z"),
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });

    daemon.start();
    await timers.runNext();
    expect(daemon.lastError()?.message).toBe("previous sweep failed");

    daemon.stop();
    daemon.start();

    expect(daemon.lastError()).toBeUndefined();
  });

  it("records scheduled sweep failures and keeps the daemon scheduled", async () => {
    const service = makeService();
    const timers = makeTimerHarness();
    service.recoverStaleInvocations.mockRejectedValueOnce(new Error("lease cleanup unavailable"));
    const daemon = new ManagedAgentRuntimeRecoveryDaemon({
      service,
      staleAfterMs: 1000,
      sweepIntervalMs: 2500,
      now: () => new Date("2026-05-22T10:00:00.000Z"),
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });

    daemon.start();
    await timers.runNext();

    expect(daemon.lastError()?.message).toBe("lease cleanup unavailable");
    expect(timers.delays).toEqual([0, 2500]);

    await timers.runNext();

    expect(daemon.lastError()).toBeUndefined();
    expect(service.recoverStaleInvocations).toHaveBeenCalledTimes(2);
  });

  it("fails fast on invalid daemon scheduling inputs", () => {
    const service = makeService();

    expect(() => new ManagedAgentRuntimeRecoveryDaemon({
      service,
      staleAfterMs: 0,
      sweepIntervalMs: 2500,
    })).toThrow(ManagedAgentRuntimeAdmissionError);
    expect(() => new ManagedAgentRuntimeRecoveryDaemon({
      service,
      staleAfterMs: 1000,
      sweepIntervalMs: Number.NaN,
    })).toThrow(ManagedAgentRuntimeAdmissionError);
    expect(() => new ManagedAgentRuntimeRecoveryDaemon({
      service,
      staleAfterMs: 1000,
      sweepIntervalMs: 2500,
      staleReason: " ",
    })).toThrow(ManagedAgentRuntimeAdmissionError);
  });
});
