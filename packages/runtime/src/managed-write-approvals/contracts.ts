import type { ManagedAgentAccess } from "@kilnai/core";

/** Stable, storage-neutral authority binding for an approved write. */
export interface ManagedWriteApprovalBinding {
  readonly projectId: string;
  readonly jobId: string;
  readonly callerId: string;
  readonly workItemFingerprint: string;
  readonly configuredAgentProfileId: string;
  readonly access: Extract<ManagedAgentAccess, "approved-write">;
  readonly routeId: string;
  readonly providerId: string;
  readonly model: string;
  readonly adapterCapabilityId: string;
  readonly adapterCapabilityVersion: string;
  readonly authorityDigest: string;
  readonly effectDigest: string;
  readonly revisionDigest: string;
}

export type ManagedWriteApprovalState = "issued" | "revoked" | "consumed";

/** A storage-neutral approval receipt. It is intentionally safe for application ports. */
export interface ManagedWriteApprovalReceipt {
  readonly approvalId: string;
  readonly state: ManagedWriteApprovalState;
  readonly binding: ManagedWriteApprovalBinding;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly approverId: string;
  readonly revokedAt?: string;
  readonly consumedAt?: string;
  readonly consumedBy?: string;
}
