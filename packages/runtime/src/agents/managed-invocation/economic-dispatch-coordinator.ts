import {
  digestManagedEconomicValue,
  createManagedEconomicSettlement,
  type ManagedEconomicAdoptedSnapshot,
  type ManagedEconomicAdoptedSnapshotExpectation,
  type ManagedEconomicCommitment,
  type ManagedEconomicPolicyIdentity,
  type ManagedEconomicSettlement,
  type ManagedEconomicExecutionReport,
  type ManagedAgentAdmissionProfile,
  type SessionManagedEconomicRejection,
  type SessionManagedEconomicLifecycleTransition,
} from "@kilnai/core";
import type { ManagedAgentRuntimeAdapter } from "./index.js";
import { projectManagedEconomicDenialRejections } from "../../managed-account-leases/managed-economic-denial-rejections.js";
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
  settleExecution(
    jobId: string,
    economicAttemptId: string,
    dispatchFenceId: string,
    settlement: ManagedEconomicSettlement,
  ): unknown;
  recordExecutionSettlementPending(
    jobId: string,
    economicAttemptId: string,
    dispatchFenceId: string,
    reason: string,
  ): unknown;
}

export interface ManagedEconomicLifecycleEventPort {
  record(input: {
    readonly transition: SessionManagedEconomicLifecycleTransition;
    readonly policy: ManagedEconomicPolicyIdentity;
    readonly commitment?: ManagedEconomicCommitment;
    readonly dispatchFenceId?: string;
    readonly settlement?: ManagedEconomicSettlement;
    readonly reason?: string;
    readonly rejections?: readonly SessionManagedEconomicRejection[];
  }): void;
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

/**
 * Marks expiry of the coordinator-owned economic lifecycle. This must remain
 * distinct from a parent cancellation so terminal adapters can report an
 * auditable timeout without reclassifying an operator stop request.
 */
export class ManagedEconomicLifecycleTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Managed economic lifecycle timed out after ${timeoutMs}ms.`);
    this.name = "ManagedEconomicLifecycleTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export interface ManagedEconomicDispatchPrepareInput {
  readonly jobId: string;
  readonly economicAttemptId: string;
  readonly intentFingerprint: string;
  readonly adoption: ManagedEconomicDispatchAdoption;
  readonly admissionProfile: ManagedAgentAdmissionProfile;
  readonly abortSignal?: AbortSignal;
  readonly lifecycleEvents?: ManagedEconomicLifecycleEventPort;
  /** Runs after held commitment acquisition and before dispatch fencing or adapter materialization. */
  readonly validateAndConsumeApprovalBeforeFence?: (input: {
    readonly commitment: ManagedEconomicCommitment;
  }) => void | Promise<void>;
  /** Runs after the durable fence and before any adapter materialization. */
  readonly validateExecutionProfile?: (input: {
    readonly commitment: ManagedEconomicCommitment;
    readonly dispatchFenceId: string;
  }) => void | Promise<void>;
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
      readonly recordExecutionSettlementPending: (reason: string) => void;
      readonly createExecutionSettlement: (
        report: ManagedEconomicExecutionReport,
      ) => ManagedEconomicSettlement;
      readonly registerEconomicSettlement: (settlement: PromiseLike<ManagedEconomicSettlement>) => void;
    };

/** Owns the only transition from secret-free selection evidence to a provider-capable adapter. */
export class ManagedEconomicDispatchCoordinator {
  constructor(private readonly options: ManagedEconomicDispatchCoordinatorOptions) {}

  async prepare(input: ManagedEconomicDispatchPrepareInput): Promise<ManagedEconomicDispatchPreparation> {
    const policy = () => input.adoption.snapshot.policy;
    const result = this.options.authority.acquire({
      jobId: input.jobId,
      economicAttemptId: input.economicAttemptId,
      intentFingerprint: input.intentFingerprint,
      ...input.adoption,
    });
    if (result.status !== "committed") {
      input.lifecycleEvents?.record({
        transition: "denied",
        policy: policy(),
        rejections: projectManagedEconomicDenialRejections(result),
      });
      return { status: "denied", result };
    }
    if (result.record.state !== "held") {
      return { status: "already-dispatched", record: result.record };
    }

    const dispatchFenceId = createManagedEconomicDispatchFenceId(result.record.commitment);
    let lifecycle: ReturnType<typeof createManagedEconomicLifecycleDeadline>;
    try {
      input.lifecycleEvents?.record({
        transition: "held",
        policy: policy(),
        commitment: result.record.commitment,
      });
      lifecycle = createManagedEconomicLifecycleDeadline(
        this.options.resolveLifecycleTimeoutMs(result.record.commitment, input.admissionProfile),
        input.abortSignal,
      );
      throwManagedEconomicAbort(lifecycle.signal);
      if (input.validateAndConsumeApprovalBeforeFence !== undefined) {
        await input.validateAndConsumeApprovalBeforeFence({
          commitment: result.record.commitment,
        });
      }
    } catch (error) {
      this.options.authority.releasePreFence(input.jobId, input.economicAttemptId);
      throw error;
    }
    let dispatchFenced = false;
    try {
      throwManagedEconomicAbort(lifecycle.signal);
      this.options.authority.fenceDispatch(input.jobId, input.economicAttemptId, dispatchFenceId);
      dispatchFenced = true;
      input.lifecycleEvents?.record({
        transition: "dispatch-fenced",
        policy: policy(),
        commitment: result.record.commitment,
        dispatchFenceId,
      });
      await input.validateExecutionProfile?.({
        commitment: result.record.commitment,
        dispatchFenceId,
      });
    } catch (error) {
      lifecycle.dispose();
      if (dispatchFenced) {
        this.options.authority.recordExecutionSettlementPending(
          input.jobId,
          input.economicAttemptId,
          dispatchFenceId,
          "post-fence-profile-authority-mismatch",
        );
      } else {
        this.options.authority.releasePreFence(input.jobId, input.economicAttemptId);
      }
      throw error;
    }

    let settlementRegistered = false;
    let settlementPendingRecorded = false;
    const recordSettlementPending = (reason: string) => {
      if (settlementPendingRecorded) return;
      this.options.authority.recordExecutionSettlementPending(
        input.jobId,
        input.economicAttemptId,
        dispatchFenceId,
        reason,
      );
      settlementPendingRecorded = true;
      input.lifecycleEvents?.record({
        transition: "settlement-pending",
        policy: policy(),
        commitment: result.record.commitment,
        dispatchFenceId,
        reason,
      });
    };
    const onAbort = () => {
      recordSettlementPending(settlementRegistered
        ? "registered-execution-settlement-timed-out"
        : "registered-execution-settlement-missing");
    };
    lifecycle.signal.addEventListener("abort", onAbort, { once: true });

    let adapter: ManagedAgentRuntimeAdapter | undefined;
    try {
      adapter = await awaitManagedEconomicMaterializationStep(this.options.createAdapter({
        commitment: result.record.commitment,
        dispatchFenceId,
        abortSignal: lifecycle.signal,
      }), lifecycle.signal);
      if (!adapter) throw new Error("Committed managed route has no executable adapter.");
    } catch (error) {
      lifecycle.signal.removeEventListener("abort", onAbort);
      recordSettlementPending(lifecycle.signal.aborted
        ? "registered-execution-settlement-missing"
        : "post-fence-adapter-materialization-failed");
      lifecycle.dispose();
      throw error;
    }
    return {
      status: "prepared",
      commitment: result.record.commitment,
      dispatchFenceId,
      adapter,
      abortSignal: lifecycle.signal,
      recordExecutionSettlementPending: recordSettlementPending,
      createExecutionSettlement: (report) => {
        const adoptedRoute = input.adoption.snapshot.routes.find((candidate) =>
          candidate.route.routeId === result.record.commitment.reservation.selectedIdentity.route.routeId
        );
        if (adoptedRoute === undefined) {
          throw new Error("Committed managed economic route is absent from its adopted snapshot.");
        }
        return createManagedEconomicSettlement({
          commitment: result.record.commitment,
          dispatchFenceId,
          adoptedRoute,
          report,
        });
      },
      registerEconomicSettlement: (settlement) => {
        if (settlementRegistered) {
          throw new Error("Managed economic execution settlement was registered more than once.");
        }
        settlementRegistered = true;
        void Promise.resolve(settlement).then(
          (resolved) => {
            this.options.authority.settleExecution(
              input.jobId,
              input.economicAttemptId,
              dispatchFenceId,
              resolved,
            );
            try {
              input.lifecycleEvents?.record({
                transition: managedEconomicSettlementTransition(resolved),
                policy: policy(),
                commitment: result.record.commitment,
                dispatchFenceId,
                settlement: resolved,
              });
            } catch {
              recordSettlementPending("lifecycle-evidence-append-failed");
            }
          },
          () => {
            recordSettlementPending("registered-execution-settlement-rejected");
          },
        ).catch(() => recordSettlementPending("registered-execution-settlement-invalid"))
          .finally(() => {
            lifecycle.signal.removeEventListener("abort", onAbort);
            lifecycle.dispose();
          })
          .catch(() => undefined);
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
    controller.abort(new ManagedEconomicLifecycleTimeoutError(timeoutMs));
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

function awaitManagedEconomicMaterializationStep<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
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

function managedEconomicSettlementTransition(
  settlement: ManagedEconomicSettlement,
): SessionManagedEconomicLifecycleTransition {
  switch (settlement.kind) {
    case "charged":
    case "estimated":
    case "subscription":
    case "included":
    case "free":
      return "released";
    case "leaked":
      return "leaked";
    default:
      return "settlement-pending";
  }
}

function createManagedEconomicDispatchFenceId(commitment: ManagedEconomicCommitment): string {
  return `managed-economic-dispatch:${digestManagedEconomicValue({
    commitmentId: commitment.commitmentId,
    reservationId: commitment.reservation.reservationId,
    jobId: commitment.reservation.jobId,
    economicAttemptId: commitment.reservation.economicAttemptId,
  }).slice("sha256:".length)}`;
}
