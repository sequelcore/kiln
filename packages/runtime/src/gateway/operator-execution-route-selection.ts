import type {
  ExecutionRouteCatalog,
  ExecutionRouteRepairAction,
  ExecutionRouteReasonCode,
  ExecutionRouteSelectionIntent,
} from "@kilnai/gateway-contracts";

/**
 * Composition boundary for operator surfaces. The host owns configuration and
 * execution-service construction; Runtime accepts only a secret-free route
 * catalog and an admission result.
 */
export interface OperatorExecutionRouteAdmission {
  readonly routeId: string;
  /** Derived materialization data. Never accept these from an operator frame. */
  readonly providerId: string;
  readonly providerModelId: string;
}

export type OperatorExecutionRouteAdmissionResult =
  | { readonly ok: true; readonly admission: OperatorExecutionRouteAdmission }
  | {
    readonly ok: false;
    readonly reasonCode: ExecutionRouteReasonCode;
    readonly reason: string;
    readonly repairActions: readonly ExecutionRouteRepairAction[];
  };

export interface OperatorExecutionRouteSelectionPort {
  getCatalog(): Promise<ExecutionRouteCatalog>;
  admit(intent: ExecutionRouteSelectionIntent): Promise<OperatorExecutionRouteAdmissionResult>;
}
