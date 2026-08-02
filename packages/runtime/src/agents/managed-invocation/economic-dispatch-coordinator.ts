import {
  digestManagedEconomicValue,
  type ManagedEconomicAdoptedSnapshot,
  type ManagedEconomicAdoptedSnapshotExpectation,
  type ManagedEconomicCommitment,
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
  createAdapter(input: {
    readonly commitment: ManagedEconomicCommitment;
    readonly dispatchFenceId: string;
  }): Promise<ManagedAgentRuntimeAdapter | undefined>;
}

export interface ManagedEconomicDispatchPrepareInput {
  readonly jobId: string;
  readonly economicAttemptId: string;
  readonly intentFingerprint: string;
  readonly adoption: ManagedEconomicDispatchAdoption;
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
    let adapter: ManagedAgentRuntimeAdapter | undefined;
    try {
      adapter = await this.options.createAdapter({
        commitment: result.record.commitment,
        dispatchFenceId,
      });
      if (!adapter) throw new Error("Committed managed route has no executable adapter.");
    } catch (error) {
      this.options.authority.releasePreFence(input.jobId, input.economicAttemptId);
      throw error;
    }

    let dispatchFenced = false;
    let preFenceReleased = false;
    let settlementRegistered = false;
    return {
      status: "prepared",
      commitment: result.record.commitment,
      dispatchFenceId,
      adapter,
      beforeProviderEffect: async () => {
        if (dispatchFenced) return;
        this.options.authority.fenceDispatch(input.jobId, input.economicAttemptId, dispatchFenceId);
        dispatchFenced = true;
      },
      releaseBeforeProviderEffect: () => {
        if (dispatchFenced || preFenceReleased) return;
        this.options.authority.releasePreFence(input.jobId, input.economicAttemptId);
        preFenceReleased = true;
      },
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
        ).catch(() => undefined);
      },
    };
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
