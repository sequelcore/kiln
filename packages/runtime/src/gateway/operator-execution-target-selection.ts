import type {
  ExecutionTargetChangeFailed,
  ExecutionTargetCost,
  ExecutionTargetRepairAction,
  ExecutionTargetReasonCode,
  ExecutionTargetSelectionIntent,
  ModelAccess,
} from "@kilnai/gateway-contracts";

export interface OperatorExecutionTargetCatalogEntry {
  readonly targetId: string;
  readonly label: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly providerRouteId?: string;
  readonly access: ModelAccess;
  readonly availability: "available" | "unavailable" | "unresolved";
  readonly reasonCodes: readonly ExecutionTargetReasonCode[];
  readonly repairActions: readonly ExecutionTargetRepairAction[];
  readonly eligibleAccountCount: number;
  readonly accountOverrideIds: readonly string[];
  readonly cost: ExecutionTargetCost;
}

export interface OperatorExecutionTargetAdmission {
  readonly targetId: string;
  /** Derived materialization data. Operator frames never supply these fields. */
  readonly providerId: string;
  readonly providerModelId: string;
}

export type OperatorExecutionTargetAdmissionResult =
  | { readonly ok: true; readonly admission: OperatorExecutionTargetAdmission }
  | {
      readonly ok: false;
      readonly reasonCode: ExecutionTargetReasonCode;
      readonly reason: string;
      readonly repairActions: readonly ExecutionTargetRepairAction[];
    };

/** Secret-free composition boundary between host configuration and operator surfaces. */
export interface OperatorExecutionTargetSelectionPort {
  getTargets(): Promise<readonly OperatorExecutionTargetCatalogEntry[]>;
  admit(intent: ExecutionTargetSelectionIntent): Promise<OperatorExecutionTargetAdmissionResult>;
}

export function failedExecutionTargetChange(input: {
  readonly targetId: string;
  readonly requestId: string;
  readonly result: Exclude<OperatorExecutionTargetAdmissionResult, { readonly ok: true }>;
}): ExecutionTargetChangeFailed {
  return {
    type: "execution_target_change_failed",
    targetId: input.targetId,
    requestId: input.requestId,
    reasonCode: input.result.reasonCode,
    reason: input.result.reason,
    repairActions: input.result.repairActions,
  };
}
