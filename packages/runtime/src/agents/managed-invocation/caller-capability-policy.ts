import {
  type ManagedAgentCallerAttachmentIdentity,
  type CallerAuthorityProfile,
} from "@kilnai/core";
import type { EffectiveTurnAuthoritySnapshot } from "../../session/runtime-session-orchestrator.types.js";

export interface ManagedInvocationCallerAuthorityInput {
  readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
  /** The caller may only retain this route/profile's already-declared tools. */
  readonly routeAllowedToolNames: readonly string[];
}

export type ManagedInvocationCallerIdentityResolution =
  | { readonly ok: true; readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolves the parent authority for one tool call. The attachment supplies only
 * stable caller identity; the turn snapshot is the authority evidence.
 */
export function resolveManagedInvocationCallerIdentity(
  callerIdentity: ManagedAgentCallerAttachmentIdentity | undefined,
  effectiveTurnAuthority: EffectiveTurnAuthoritySnapshot | undefined,
): ManagedInvocationCallerIdentityResolution {
  if (!callerIdentity || callerIdentity.kind !== "kiln-runtime") {
    return callerIdentity ? { ok: true, callerIdentity } : { ok: true };
  }
  const admittedAuthority = effectiveTurnAuthority?.admittedAuthority;
  const parentEffectiveRequestedAuthority = admittedAuthority === "read_only"
    ? "read_only"
    : admittedAuthority === "idempotent" || admittedAuthority === "audited"
      ? "audited"
      : admittedAuthority === "destructive"
        ? "destructive"
        : undefined;
  if (!parentEffectiveRequestedAuthority) {
    return {
      ok: false,
      reason: "kiln-runtime managed invocation requires an admitted effective turn authority",
    };
  }
  return {
    ok: true,
    callerIdentity: { ...callerIdentity, parentEffectiveRequestedAuthority },
  };
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
  if (
    input.callerIdentity.kind === "kiln-runtime"
    && (
      input.callerIdentity.parentEffectiveRequestedAuthority === undefined
      || input.callerIdentity.parentEffectiveRequestedAuthority === "auto"
    )
  ) {
    throw new Error("kiln-runtime caller requires explicit parentEffectiveRequestedAuthority");
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
