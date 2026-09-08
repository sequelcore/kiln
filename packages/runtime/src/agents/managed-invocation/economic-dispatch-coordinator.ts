import {
  digestManagedEconomicValue,
  createManagedEconomicSettlement,
  type ManagedEconomicAdoptedSnapshot,
  type ManagedEconomicAdoptedSnapshotExpectation,
  type ManagedEconomicCommitment,
  type ManagedEconomicPolicyIdentity,
  type ManagedEconomicSettlement,
  type ManagedEconomicExecutionReport,
  type ManagedAgentAccess,
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
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "../../session/effective-authority-admission-bundle.js";

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
  }): ManagedEconomicCommitmentAcquireResult | Promise<ManagedEconomicCommitmentAcquireResult>;
  releasePreFence(jobId: string, economicAttemptId: string): unknown | Promise<unknown>;
  fenceDispatch(
    jobId: string,
    economicAttemptId: string,
    dispatchFenceId: string,
    actionClaim: ManagedEconomicActionClaim,
  ): unknown | Promise<unknown>;
  readDispatch(
    jobId: string,
    economicAttemptId: string,
    dispatchFenceId: string,
    actionClaim: ManagedEconomicActionClaim,
  ): ManagedEconomicCommitmentRecord | undefined | Promise<ManagedEconomicCommitmentRecord | undefined>;
  settleExecution(
    jobId: string,
    economicAttemptId: string,
    dispatchFenceId: string,
    settlement: ManagedEconomicSettlement,
  ): unknown | Promise<unknown>;
  recordExecutionSettlementPending(
    jobId: string,
    economicAttemptId: string,
    dispatchFenceId: string,
    reason: string,
  ): unknown | Promise<unknown>;
  recordExecutionNotDispatched(
    jobId: string,
    economicAttemptId: string,
    dispatchFenceId: string,
    reason: string,
  ): unknown | Promise<unknown>;
}

/** Immutable identity bound by the economic ledger's canonical action claim. */
export interface ManagedEconomicActionClaim {
  readonly version: 1;
  readonly attemptId: string;
  readonly admissionId: string;
  readonly admissionBundle: EffectiveAuthorityAdmissionBundle;
  readonly intentFingerprint: string;
  readonly ownerGeneration: string;
  readonly effectIdentity: string;
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
    access: ManagedAgentAccess,
    authorityProfileId: string,
  ) => number;
  createAdapter(input: {
    readonly commitment: ManagedEconomicCommitment;
    readonly dispatchFenceId: string;
    readonly abortSignal: AbortSignal;
    readonly authorityProfileId: string;
    readonly access: ManagedAgentAccess;
    readonly profileAuthorityDigest: string;
    readonly invocationId: string;
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

export interface ManagedEconomicDispatchPrepareInput<PreparedExecution = undefined> {
  readonly jobId: string;
  readonly economicAttemptId: string;
  readonly intentFingerprint: string;
  readonly adoption: ManagedEconomicDispatchAdoption;
  readonly access: ManagedAgentAccess;
  readonly authorityProfileId: string;
  readonly invocationId: string;
  /** Persisted authority-admission receipt bound by the canonical claim. */
  readonly admissionBundle: EffectiveAuthorityAdmissionBundle;
  /** Named Runtime-owned effect at which the claim stops. */
  readonly effectIdentity: string;
  readonly abortSignal?: AbortSignal;
  /** Optional bounded-intent duration cap, applied in addition to route timeout. */
  readonly workLimitDurationMs?: number;
  readonly lifecycleEvents?: ManagedEconomicLifecycleEventPort;
  /** Runs after held commitment acquisition and before adapter materialization or fencing. */
  readonly validateAndConsumeApprovalBeforeFence?: (input: {
    readonly commitment: ManagedEconomicCommitment;
  }) => void | Promise<void>;
  /** Runs before adapter materialization and the durable action fence. */
  readonly validateExecutionProfile?: (input: {
    readonly commitment: ManagedEconomicCommitment;
    readonly dispatchFenceId: string;
  }) => void | Promise<void>;
  /**
   * Realizes the exact committed execution after its adapter exists, but before
   * its durable provider-dispatch fence. It is the sole place for fallible
   * request construction that requires the materialized adapter.
   */
  readonly realizeExecutionBeforeFence?: (input: {
    readonly commitment: ManagedEconomicCommitment;
    readonly dispatchFenceId: string;
    readonly adapter: ManagedAgentRuntimeAdapter;
    readonly abortSignal: AbortSignal;
  }) => PreparedExecution | Promise<PreparedExecution>;
  /** Releases resources acquired by a completed realization when fencing still fails. */
  readonly releasePreparedExecutionBeforeFence?: (execution: PreparedExecution) => void | Promise<void>;
}

export type ManagedEconomicDispatchPreparation<PreparedExecution = undefined> =
  | {
      readonly status: "denied";
      readonly result: Exclude<ManagedEconomicCommitmentAcquireResult, { readonly status: "committed" }>;
    }
  | {
      readonly status: "not-dispatchable";
      readonly record: ManagedEconomicCommitmentRecord;
    }
  | {
      readonly status: "prepared";
      readonly commitment: ManagedEconomicCommitment;
      readonly dispatchFenceId: string;
      readonly actionClaim: ManagedEconomicActionClaim;
      readonly adapter: ManagedAgentRuntimeAdapter;
      readonly abortSignal: AbortSignal;
      /** Immutable request realization completed before provider dispatch was fenced. */
      readonly realization:
        | { readonly kind: "none" }
        | { readonly kind: "realized"; readonly execution: PreparedExecution };
      readonly recordExecutionSettlementPending: (reason: string) => Promise<void>;
      readonly recordExecutionNotDispatched: (reason: string) => Promise<void>;
      readonly createExecutionSettlement: (report: ManagedEconomicExecutionReport) => ManagedEconomicSettlement;
      readonly registerEconomicSettlement: (settlement: PromiseLike<ManagedEconomicSettlement>) => void;
    };

/** Owns the only transition from secret-free selection evidence to a provider-capable adapter. */
export class ManagedEconomicDispatchCoordinator {
  constructor(private readonly options: ManagedEconomicDispatchCoordinatorOptions) {}

  async prepare<PreparedExecution = undefined>(
    input: ManagedEconomicDispatchPrepareInput<PreparedExecution>,
  ): Promise<ManagedEconomicDispatchPreparation<PreparedExecution>> {
    const admissionBundle = defineEffectiveAuthorityAdmissionBundle(input.admissionBundle);
    const policy = () => input.adoption.snapshot.policy;
    const result = await this.options.authority.acquire({
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
      return { status: "not-dispatchable", record: result.record };
    }

    const actionClaim: ManagedEconomicActionClaim = {
      version: 1,
      attemptId: input.economicAttemptId,
      admissionId: admissionBundle.admissionId,
      admissionBundle,
      intentFingerprint: input.intentFingerprint,
      ownerGeneration: result.record.ownerGeneration,
      effectIdentity: input.effectIdentity,
    };
    const dispatchFenceId = createManagedEconomicDispatchFenceId(result.record.commitment, actionClaim);
    let lifecycle: ReturnType<typeof createManagedEconomicLifecycleDeadline> | undefined;
    try {
      input.lifecycleEvents?.record({
        transition: "held",
        policy: policy(),
        commitment: result.record.commitment,
      });
      lifecycle = createManagedEconomicLifecycleDeadline(
        Math.min(
          this.options.resolveLifecycleTimeoutMs(result.record.commitment, input.access, input.authorityProfileId),
          input.workLimitDurationMs ?? Number.POSITIVE_INFINITY,
        ),
        input.abortSignal,
      );
      throwManagedEconomicAbort(lifecycle.signal);
      if (input.validateAndConsumeApprovalBeforeFence !== undefined) {
        await input.validateAndConsumeApprovalBeforeFence({
          commitment: result.record.commitment,
        });
      }
    } catch (error) {
      lifecycle?.dispose();
      const cleanupErrors: unknown[] = [];
      try {
        await this.options.authority.releasePreFence(input.jobId, input.economicAttemptId);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
      throw managedEconomicPreparationError(error, cleanupErrors);
    }
    if (!lifecycle) throw new Error("Managed economic lifecycle was not initialized.");

    let adapter: ManagedAgentRuntimeAdapter;
    let realization:
      | Extract<ManagedEconomicDispatchPreparation<PreparedExecution>, { readonly status: "prepared" }>["realization"]
      | undefined;
    let dispatchFenced = false;
    let fenceResponseAmbiguous = false;
    try {
      throwManagedEconomicAbort(lifecycle.signal);
      await input.validateExecutionProfile?.({
        commitment: result.record.commitment,
        dispatchFenceId,
      });
      const adoptedRoute = input.adoption.snapshot.routes.find(
        (candidate) => candidate.route.routeId === result.record.commitment.reservation.selectedIdentity.route.routeId,
      );
      if (!adoptedRoute) throw new Error("Committed managed economic route is absent from its adopted snapshot.");
      const materialized = await awaitManagedEconomicMaterializationStep(
        this.options.createAdapter({
          commitment: result.record.commitment,
          dispatchFenceId,
          abortSignal: lifecycle.signal,
          authorityProfileId: input.authorityProfileId,
          access: input.access,
          profileAuthorityDigest: adoptedRoute.admittedIdentity.profileAuthorityDigest,
          invocationId: input.invocationId,
        }),
        lifecycle.signal,
      );
      if (!materialized) throw new Error("Committed managed route has no executable adapter.");
      adapter = materialized;
      throwManagedEconomicAbort(lifecycle.signal);
      if (input.realizeExecutionBeforeFence !== undefined) {
        const realizationPromise = Promise.resolve(
          input.realizeExecutionBeforeFence({
            commitment: result.record.commitment,
            dispatchFenceId,
            adapter,
            abortSignal: lifecycle.signal,
          }),
        );
        try {
          const execution = await awaitManagedEconomicMaterializationStep(realizationPromise, lifecycle.signal);
          realization = { kind: "realized", execution };
        } catch (error) {
          // A context or approval callback can finish after cancellation. Its
          // bounded-work allocation is still pre-dispatch and must be released.
          void realizationPromise
            .then(
              async (execution) => input.releasePreparedExecutionBeforeFence?.(execution),
              () => undefined,
            )
            .catch(() => undefined);
          throw error;
        }
      }
      throwManagedEconomicAbort(lifecycle.signal);
      try {
        await this.options.authority.fenceDispatch(input.jobId, input.economicAttemptId, dispatchFenceId, actionClaim);
        dispatchFenced = true;
      } catch (error) {
        // A successful SQLite commit can be reported as a transport failure.
        // Read back the exact claim before deciding that release is safe.
        let readBack: ManagedEconomicCommitmentRecord | undefined;
        try {
          readBack = await this.options.authority.readDispatch(
            input.jobId,
            input.economicAttemptId,
            dispatchFenceId,
            actionClaim,
          );
        } catch {
          // The claim state is now ambiguous. Releasing a held row here could
          // permit a later owner to redispatch an already committed effect.
          fenceResponseAmbiguous = true;
          throw error;
        }
        if (readBack?.state === "dispatch-fenced" && readBack.dispatchFenceId === dispatchFenceId) {
          dispatchFenced = true;
        } else {
          throw error;
        }
      }
      input.lifecycleEvents?.record({
        transition: "dispatch-fenced",
        policy: policy(),
        commitment: result.record.commitment,
        dispatchFenceId,
      });
    } catch (error) {
      lifecycle.dispose();
      const cleanupErrors: unknown[] = [];
      if (dispatchFenced) {
        try {
          await this.options.authority.recordExecutionSettlementPending(
            input.jobId,
            input.economicAttemptId,
            dispatchFenceId,
            "post-fence-lifecycle-evidence-failed",
          );
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      } else if (!fenceResponseAmbiguous) {
        try {
          await this.options.authority.releasePreFence(input.jobId, input.economicAttemptId);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (realization?.kind === "realized") {
        try {
          await input.releasePreparedExecutionBeforeFence?.(realization.execution);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      throw managedEconomicPreparationError(error, cleanupErrors);
    }

    let settlementRegistered = false;
    let settlementPending: Promise<void> | undefined;
    let notDispatchedReason: string | undefined;
    let notDispatchedPromise: Promise<void> | undefined;
    let terminalSettlement: "settlement-pending" | "runtime-not-dispatched" | undefined;
    let settlementOperationTail = Promise.resolve();
    let lifecycleDisposed = false;
    const disposeLifecycle = (): void => {
      if (lifecycleDisposed) return;
      lifecycleDisposed = true;
      lifecycle.signal.removeEventListener("abort", onAbort);
      lifecycle.dispose();
    };
    const enqueueSettlementOperation = (operation: () => Promise<void>): Promise<void> => {
      const queued = settlementOperationTail.then(operation);
      settlementOperationTail = queued.catch(() => undefined);
      return queued;
    };
    const recordSettlementPending = (reason: string): Promise<void> => {
      if (terminalSettlement === "runtime-not-dispatched") return Promise.resolve();
      settlementPending ??= enqueueSettlementOperation(async () => {
        if (terminalSettlement === "runtime-not-dispatched") return;
        await this.options.authority.recordExecutionSettlementPending(
          input.jobId,
          input.economicAttemptId,
          dispatchFenceId,
          reason,
        );
        terminalSettlement ??= "settlement-pending";
        input.lifecycleEvents?.record({
          transition: "settlement-pending",
          policy: policy(),
          commitment: result.record.commitment,
          dispatchFenceId,
          reason,
        });
      });
      return settlementPending;
    };
    const recordNotDispatched = (reason: string): Promise<void> => {
      if (notDispatchedReason !== undefined) {
        if (notDispatchedReason !== reason) {
          return Promise.reject(
            new Error("Managed economic runtime no-dispatch reason conflicts with its in-flight proof."),
          );
        }
        return notDispatchedPromise ?? Promise.resolve();
      }
      if (settlementRegistered) {
        return Promise.reject(
          new Error("Managed economic runtime no-dispatch proof conflicts with a registered settlement."),
        );
      }
      notDispatchedReason = reason;
      const operation = enqueueSettlementOperation(async () => {
        if (terminalSettlement === "runtime-not-dispatched") return;
        await this.options.authority.recordExecutionNotDispatched(
          input.jobId,
          input.economicAttemptId,
          dispatchFenceId,
          reason,
        );
        terminalSettlement = "runtime-not-dispatched";
        disposeLifecycle();
        input.lifecycleEvents?.record({
          transition: "released",
          policy: policy(),
          commitment: result.record.commitment,
          dispatchFenceId,
          settlement: {
            kind: "runtime-not-dispatched",
            reservationId: result.record.commitment.reservation.reservationId,
            dispatchFenceId,
            reason,
          },
        });
      });
      notDispatchedPromise = operation;
      void operation.catch(() => {
        if (terminalSettlement !== "runtime-not-dispatched" && notDispatchedPromise === operation) {
          notDispatchedPromise = undefined;
          notDispatchedReason = undefined;
        }
      });
      return operation;
    };
    const onAbort = () => {
      void recordSettlementPending(
        settlementRegistered ? "registered-execution-settlement-timed-out" : "registered-execution-settlement-missing",
      ).catch(() => undefined);
    };
    lifecycle.signal.addEventListener("abort", onAbort, { once: true });
    return {
      status: "prepared",
      commitment: result.record.commitment,
      dispatchFenceId,
      actionClaim,
      adapter,
      abortSignal: lifecycle.signal,
      realization: realization ?? { kind: "none" },
      recordExecutionSettlementPending: recordSettlementPending,
      recordExecutionNotDispatched: recordNotDispatched,
      createExecutionSettlement: (report) => {
        const adoptedRoute = input.adoption.snapshot.routes.find(
          (candidate) =>
            candidate.route.routeId === result.record.commitment.reservation.selectedIdentity.route.routeId,
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
        if (notDispatchedReason !== undefined) {
          throw new Error("Managed economic settlement registration conflicts with runtime no-dispatch proof.");
        }
        if (settlementRegistered) {
          throw new Error("Managed economic execution settlement was registered more than once.");
        }
        settlementRegistered = true;
        void Promise.resolve(settlement)
          .then(
            async (resolved) => {
              await this.options.authority.settleExecution(
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
                await recordSettlementPending("lifecycle-evidence-append-failed");
              }
            },
            async () => {
              await recordSettlementPending("registered-execution-settlement-rejected");
            },
          )
          .catch(() => recordSettlementPending("registered-execution-settlement-invalid"))
          .finally(() => disposeLifecycle())
          .catch(() => undefined);
      },
    };
  }
}

function createManagedEconomicLifecycleDeadline(
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
): {
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
    : new Error(
        typeof signal.reason === "string" && signal.reason.trim() !== ""
          ? signal.reason
          : "Managed economic pre-fence preparation was aborted.",
      );
}

function managedEconomicPreparationError(primaryError: unknown, cleanupErrors: readonly unknown[]): unknown {
  if (cleanupErrors.length === 0) return primaryError;
  const message = primaryError instanceof Error
    ? primaryError.message
    : "Managed economic preparation failed before provider dispatch.";
  return new AggregateError([primaryError, ...cleanupErrors], message);
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
    case "not-dispatched":
      throw new Error("Not-dispatched settlement is reserved for operator reconciliation and cannot follow a fence.");
    default:
      return "settlement-pending";
  }
}

function createManagedEconomicDispatchFenceId(
  commitment: ManagedEconomicCommitment,
  actionClaim: ManagedEconomicActionClaim,
): string {
  return `managed-economic-dispatch:${digestManagedEconomicValue({
    commitmentId: commitment.commitmentId,
    reservationId: commitment.reservation.reservationId,
    jobId: commitment.reservation.jobId,
    economicAttemptId: commitment.reservation.economicAttemptId,
    admissionId: actionClaim.admissionId,
    intentFingerprint: actionClaim.intentFingerprint,
    ownerGeneration: actionClaim.ownerGeneration,
    effectIdentity: actionClaim.effectIdentity,
  }).slice("sha256:".length)}`;
}
