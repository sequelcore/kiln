import {
  type ManagedAgentCallerAttachmentIdentity,
  type CallerAuthorityProfile,
} from "@kilnai/core";

export interface ManagedInvocationCallerAuthorityInput {
  readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
  /** The caller may only retain this route/profile's already-declared tools. */
  readonly routeAllowedToolNames: readonly string[];
}

/** Caller identity narrows execution authority only; it never selects providers. */
export function deriveManagedInvocationCallerAuthority(
  input: ManagedInvocationCallerAuthorityInput,
): CallerAuthorityProfile {
  if (!input.callerIdentity) {
    return {
      authorityCeiling: "read_only",
      allowedToolNames: input.routeAllowedToolNames,
      allowsRecursion: false,
      allowsAttachments: false,
      allowsWrite: false,
    };
  }
  const parentAuthority = input.callerIdentity.kind === "kiln-runtime"
    ? input.callerIdentity.parentEffectiveRequestedAuthority
    : undefined;
  return {
    authorityCeiling: parentAuthority && parentAuthority !== "auto" ? parentAuthority : "destructive",
    allowedToolNames: input.routeAllowedToolNames,
    allowsRecursion: true,
    allowsAttachments: true,
    allowsWrite: parentAuthority !== "read_only",
  };
}
