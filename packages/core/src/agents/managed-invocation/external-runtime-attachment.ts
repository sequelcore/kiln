// Exact target identity for an external runtime, distinct from caller identity.
export interface ManagedAgentExternalRuntimeAttachmentIdentity {
  readonly kind: "external-runtime";
  readonly runtimeId: string;
  readonly attachmentId: string;
}

export type ManagedAgentExternalRuntimeAttachmentComparison =
  | "matched"
  | "both-absent"
  | "missing"
  | "mismatch"
  | "unsupported-route";

/** Exact, case-sensitive comparison. No normalization or fallback is permitted. */
export function compareManagedAgentExternalRuntimeAttachment(
  routeAttachment: ManagedAgentExternalRuntimeAttachmentIdentity | undefined,
  requestedAttachment: ManagedAgentExternalRuntimeAttachmentIdentity | undefined,
): ManagedAgentExternalRuntimeAttachmentComparison {
  if (!routeAttachment && !requestedAttachment) return "both-absent";
  if (routeAttachment && !requestedAttachment) return "missing";
  if (!routeAttachment && requestedAttachment) return "unsupported-route";
  return routeAttachment!.runtimeId === requestedAttachment!.runtimeId
    && routeAttachment!.attachmentId === requestedAttachment!.attachmentId
    ? "matched"
    : "mismatch";
}
