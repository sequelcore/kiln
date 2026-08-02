import {
  digestManagedEconomicValue,
  type ManagedEconomicAdoptedSnapshot,
  type ManagedEconomicAdoptedSnapshotExpectation,
  type ManagedEconomicCommitment,
  type ManagedAgentAdmissionProfile,
} from "@kilnai/core";
import type { ManagedAgentRuntimeAdapter } from "./index.js";
import type {
  ManagedEconomicCommitmentAcquireResult,
  ManagedEconomicCommitmentRecord,
  ManagedEconomicRouteCapacity,
} from "../../managed-account-leases/managed-account-lease-authority.js";

export interface ManagedEconomicDispatchAdoption {
  readonly snapshot: ManagedEconomicAdoptedSnapshot;
  readonly expectation: ManagedEconomicAdoptedSnapshotExpectation;
  readonly routeCapacity: readonly ManagedEconomicRouteCapacity[];
}

export interface ManagedEconomicDispatchAuthorityPort {
  acquire(input: {
    readonly jobId: string;
    readonly economicAttemptId: string;
    readonly intentFingerprint: string;
    readonly snapshot: ManagedEconomicAdoptedSnapshot;
    readonly expectation: ManagedEconomicAdoptedSnapshotExpectation;
    readonly routeCapacity: readonly ManagedEconomicRouteCapacity[];
  }): ManagedEconomicCommitmentAcquireResult;
  releasePreFence(jobId: string, economicAttemptId: string): unknown;
  fenceDispatch(jobId: string, economicAttemptId: string, dispatchFenceId: string): unknown;
  settleSuccessfulExecution(jobId: string, economicAttemptId: string, dispatchFenceId: string): unknown;
  recordExecutionSettlementPending(
    jobId: string,
    economicAttemptId: string,
    dispatchFenceId: string,
    reason: string,
  ): unknown;
}

export interface ManagedEconomicDispatchCoordinatorOptions {
  readonly authority: ManagedEconomicDispatchAuthorityPort;
  readonly resolveLifecycleTimeoutMs: (
    commitment: ManagedEconomicCommitment,
    admissionProfile: ManagedAgentAdmissionProfile,
  ) => number;
  createAdapter(input: {
    readonly commitment: ManagedEconomicCommitment;
    readonly dispatchFenceId: string;
    readonly abortSignal: AbortSignal;
  }): Promise<ManagedAgentRuntimeAdapter | undefined>;
}

export interface ManagedEconomicDispatchPrepareInput {
  readonly jobId: string;
  readonly economicAttemptId: string;
  readonly intentFingerprint: string;
  readonly adoption: ManagedEconomicDispatchAdoption;
  readonly admissionProfile: ManagedAgentAdmissionProfile;
  readonly abortSignal?: AbortSignal;
}

export type ManagedEconomicDispatchPreparation =
  | {
      readonly status: "denied";
      readonly result: Exclude<ManagedEconomicCommitmentAcquireResult, { readonly status: "committed" }>;
    }
  | {
      readonly status: "already-dispatched";
      readonly record: ManagedEconomicCommitmentRecord;
    }
  | {
      readonly status: "prepared";
      readonly commitment: ManagedEconomicCommitment;
      readonly dispatchFenceId: string;
      readonly adapter: ManagedAgentRuntimeAdapter;
      readonly abortSignal: AbortSignal;
      readonly beforeProviderEffect: () => Promise<void>;
      readonly releaseBeforeProviderEffect: () => void;
      readonly registerExecutionSettlement: (settlement: PromiseLike<unknown>) => void;
    };

/** Owns the only transition from secret-free selection evidence to a provider-capable adapter. */
export class ManagedEconomicDispatchCoordinator {
  constructor(private readonly options: ManagedEconomicDispatchCoordinatorOptions) {}

  async prepare(input: ManagedEconomicDispatchPrepareInput): Promise<ManagedEconomicDispatchPreparation> {
    const result = this.options.authority.acquire({
      jobId: input.jobId,
      economicAttemptId: input.economicAttemptId,
      intentFingerprint: input.intentFingerprint,
      ...input.adoption,
    });
    if (result.status !== "committed") {
      return { status: "denied", result };
    }
    if (result.record.state !== "held") {
      return { status: "already-dispatched", record: result.record };
    }

    const dispatchFenceId = createManagedEconomicDispatchFenceId(result.record.commitment);
    let lifecycle: ReturnType<typeof createManagedEconomicLifecycleDeadline>;
    try {
      lifecycle = createManagedEconomicLifecycleDeadline(
        this.options.resolveLifecycleTimeoutMs(result.record.commitment, input.admissionProfile),
        input.abortSignal,
      );
    } catch (error) {
      this.options.authority.releasePreFence(input.jobId, input.economicAttemptId);
      throw error;
    }
    let adapter: ManagedAgentRuntimeAdapter | undefined;
    try {
      adapter = await awaitManagedEconomicPreFenceStep(this.options.createAdapter({
        commitment: result.record.commitment,
        dispatchFenceId,
        abortSignal: lifecycle.signal,
      }), lifecycle.signal);
      if (!adapter) throw new Error("Committed managed route has no executable adapter.");
    } catch (error) {
      lifecycle.dispose();
      this.options.authority.releasePreFence(input.jobId, input.economicAttemptId);
      throw error;
    }

    let dispatchFenced = false;
    let preFenceReleased = false;
    let settlementRegistered = false;
    const releasePreFence = () => {
      if (dispatchFenced || preFenceReleased) return;
      lifecycle.dispose();
      this.options.authority.releasePreFence(input.jobId, input.economicAttemptId);
      preFenceReleased = true;
    };
    const onAbort = () => releasePreFence();
    lifecycle.signal.addEventListener("abort", onAbort, { once: true });
    return {
      status: "prepared",
      commitment: result.record.commitment,
      dispatchFenceId,
      adapter,
      abortSignal: lifecycle.signal,
      beforeProviderEffect: async () => {
        if (dispatchFenced) return;
        throwManagedEconomicAbort(lifecycle.signal);
        this.options.authority.fenceDispatch(input.jobId, input.economicAttemptId, dispatchFenceId);
        dispatchFenced = true;
        lifecycle.signal.removeEventListener("abort", onAbort);
      },
      releaseBeforeProviderEffect: releasePreFence,
      registerExecutionSettlement: (settlement) => {
        if (!dispatchFenced) {
          throw new Error("Managed economic execution settlement was registered before the dispatch fence.");
        }
        if (settlementRegistered) {
          throw new Error("Managed economic execution settlement was registered more than once.");
        }
        settlementRegistered = true;
        void Promise.resolve(settlement).then(
          () => {
            this.options.authority.settleSuccessfulExecution(
              input.jobId,
              input.economicAttemptId,
              dispatchFenceId,
            );
          },
          () => {
            this.options.authority.recordExecutionSettlementPending(
              input.jobId,
              input.economicAttemptId,
              dispatchFenceId,
              "registered-execution-settlement-rejected",
            );
          },
        ).finally(lifecycle.dispose).catch(() => undefined);
      },
    };
  }
}

function createManagedEconomicLifecycleDeadline(timeoutMs: number, parentSignal: AbortSignal | undefined): {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
} {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Managed economic lifecycle timeout must be a positive finite number.");
  }
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  let disposed = false;
  const timer = setTimeout(() => {
    controller.abort(new Error(`Managed economic lifecycle timed out after ${timeoutMs}ms.`));
    disposed = true;
    parentSignal?.removeEventListener("abort", onParentAbort);
  }, timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

function awaitManagedEconomicPreFenceStep<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  throwManagedEconomicAbort(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(managedEconomicAbortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function throwManagedEconomicAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw managedEconomicAbortError(signal);
}

function managedEconomicAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(typeof signal.reason === "string" && signal.reason.trim() !== ""
      ? signal.reason
      : "Managed economic pre-fence preparation was aborted.");
}

function createManagedEconomicDispatchFenceId(commitment: ManagedEconomicCommitment): string {
  return `managed-economic-dispatch:${digestManagedEconomicValue({
    commitmentId: commitment.commitmentId,
    reservationId: commitment.reservation.reservationId,
    jobId: commitment.reservation.jobId,
    economicAttemptId: commitment.reservation.economicAttemptId,
  }).slice("sha256:".length)}`;
}
