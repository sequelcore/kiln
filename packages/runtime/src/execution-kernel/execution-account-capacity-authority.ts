import {
  selectExecutionCapacityAccount,
  type ExecutionAccountCapacityCandidate,
  type ExecutionAccountEconomicsConfig,
  type ExecutionAccountPolicyId,
  type ExecutionAccountRef,
  type ExecutionAccountUsageEvidence,
  type ManagedAccountAffinityCommitOutcome,
  type ManagedAccountAffinityKey,
  type ManagedAccountLeaseEvidence,
  type ManagedEconomicQuotaEvidence,
  type ProviderModelRouteIdentity,
} from "@kilnai/core";

/** Configured provider account plus the evidence required for shared capacity. */
export interface ExecutionAccountCandidateBinding {
  readonly candidate: ExecutionAccountCapacityCandidate;
  /** Stable configured account identity used for capacity across credential revisions. */
  readonly capacityIdentity: string;
  readonly credentialRevisionId: string;
  readonly usageEvidence: ExecutionAccountUsageEvidence;
  readonly accountEconomics?: ExecutionAccountEconomicsConfig;
  readonly quotaEvidence?: ManagedEconomicQuotaEvidence | null;
  readonly capacity: {
    readonly maxConcurrency: number;
    readonly reservedAffinitySlots: number;
  };
}

/** Secret-free current capacity observation for a configured account binding. */
export interface ExecutionAccountCapacityObservation {
  readonly account: ExecutionAccountRef;
  readonly capacityIdentity: string;
  readonly leaseCapacity: "available" | "unavailable";
  readonly reservedForNewWork: boolean;
}

export type ExecutionAccountAffinityRequest =
  | { readonly continuity: "none" }
  | {
      readonly continuity: "prefer" | "require";
      readonly scope: "session" | "turn";
      readonly allowRebind?: boolean;
      readonly key: ManagedAccountAffinityKey;
    };

/** Account-only acquisition intent, independent from any ingress or managed job. */
export interface AccountCapacityAcquireInput {
  readonly runtimeInvocationId: string;
  readonly intentFingerprint: string;
  readonly accountPolicyId: ExecutionAccountPolicyId;
  readonly route: ProviderModelRouteIdentity;
  readonly candidates: readonly ExecutionAccountCandidateBinding[];
  readonly affinityRequest?: ExecutionAccountAffinityRequest;
}

export type AccountCapacityAcquireResult =
  | {
      readonly status: "acquired";
      readonly record: AccountCapacityRecord;
      readonly replay: boolean;
    }
  | {
      readonly status: "unavailable";
      readonly rejections: ReturnType<typeof selectExecutionCapacityAccount>["rejections"];
    }
  | { readonly status: "conflict"; readonly reason: "idempotency-conflict" };

export interface AccountCapacityRecord {
  readonly leaseId: string;
  readonly runtimeInvocationId: string;
  readonly accountPolicyId: ExecutionAccountPolicyId;
  readonly accountRef: ExecutionAccountRef;
  readonly route: ProviderModelRouteIdentity;
  readonly capacityIdentity: string;
  readonly credentialRevisionId: string;
  readonly state: "held" | "dispatch-fenced" | "settlement-pending" | "released";
  readonly selectionReason: ManagedAccountLeaseEvidence["selectionReason"];
  readonly candidateRejections: ManagedAccountLeaseEvidence["candidateRejections"];
  readonly affinityCommitOutcome?: ManagedAccountAffinityCommitOutcome;
  readonly dispatchFenceId?: string;
}

/** Deliberately secret-free execution settlement evidence. */
export type AccountCapacitySettlement =
  | {
      readonly kind: "completed";
      readonly outcome: "success" | "provider-error" | "cancelled";
      readonly observedAt: string;
    }
  | {
      readonly kind: "unknown";
      readonly reason: string;
      readonly observedAt: string;
    };

/** Provider-neutral authority for acquiring, fencing, and settling execution capacity. */
export interface ExecutionAccountCapacityAuthority {
  acquireAccountCapacity(input: AccountCapacityAcquireInput): AccountCapacityAcquireResult;
  releaseAccountCapacityPreFence(runtimeInvocationId: string): AccountCapacityRecord;
  fenceAccountCapacityDispatch(runtimeInvocationId: string, dispatchFenceId: string): AccountCapacityRecord;
  settleAccountCapacity(
    runtimeInvocationId: string,
    dispatchFenceId: string,
    settlement: AccountCapacitySettlement,
  ): AccountCapacityRecord;
}
