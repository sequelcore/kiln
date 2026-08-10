import type {
  ManagedWriteApprovalBinding,
  ManagedWriteApprovalReceipt,
} from "../../managed-write-approvals/sqlite-managed-write-approval-authority.js";

declare const consumedWriteApprovalBrand: unique symbol;

export interface ManagedAgentRuntimeConsumedWriteApproval {
  readonly approvalId: string;
  readonly consumedAt: string;
  readonly consumerId: string;
  readonly binding: ManagedWriteApprovalBinding;
  readonly [consumedWriteApprovalBrand]: true;
}

const trustedConsumptions = new WeakSet<object>();

/** Internal bridge from the SQLite approval authority to managed invocation. */
export function createInternalConsumedWriteApproval(
  receipt: ManagedWriteApprovalReceipt,
): ManagedAgentRuntimeConsumedWriteApproval {
  if (receipt.state !== "consumed" || !receipt.consumedAt || !receipt.consumedBy) {
    throw new TypeError("Only an authority-consumed managed write approval can enter Runtime execution.");
  }
  const capability = Object.freeze({
    approvalId: receipt.approvalId,
    consumedAt: receipt.consumedAt,
    consumerId: receipt.consumedBy,
    binding: Object.freeze({ ...receipt.binding }),
  }) as ManagedAgentRuntimeConsumedWriteApproval;
  trustedConsumptions.add(capability);
  return capability;
}

export function isInternalConsumedWriteApproval(
  value: unknown,
): value is ManagedAgentRuntimeConsumedWriteApproval {
  return typeof value === "object" && value !== null && trustedConsumptions.has(value);
}
