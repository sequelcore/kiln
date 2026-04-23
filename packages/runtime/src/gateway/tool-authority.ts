import type { Capability, AuthorityDescriptor } from "@kilnai/core";

export type ToolAuthorityClassification =
  | "destructive"
  | "read_only"
  | "idempotent"
  | "audited";

export function rollupIntegrationAuthority(
  classifications: readonly ToolAuthorityClassification[],
): ToolAuthorityClassification {
  if (classifications.includes("destructive")) {
    return "destructive";
  }
  if (classifications.includes("audited")) {
    return "audited";
  }
  if (classifications.includes("idempotent")) {
    return "idempotent";
  }
  return "read_only";
}

export function classifyAuthorityFromCapability(
  capability: Capability | undefined,
): ToolAuthorityClassification {
  const annotations = capability?.annotations;
  if (annotations?.destructive) {
    return "destructive";
  }
  if (annotations?.readOnly) {
    return "read_only";
  }
  if (annotations?.idempotent) {
    return "idempotent";
  }
  return "audited";
}

export function authorityFromCapability(
  toolName: string,
  capability: Capability | undefined,
): AuthorityDescriptor | undefined {
  const annotations = capability?.annotations;
  if (!annotations) {
    return undefined;
  }

  if (annotations.destructive) {
    return {
      level: 4,
      allowed: false,
      requiresApproval: true,
      reason: `Destructive tool "${toolName}" always requires confirmation`,
    };
  }

  if (annotations.readOnly) {
    return {
      level: 1,
      allowed: true,
      requiresApproval: false,
      reason: "Read-only tool, auto-execute",
    };
  }

  if (annotations.idempotent) {
    return {
      level: 2,
      allowed: true,
      requiresApproval: false,
      reason: "Audited execution",
    };
  }

  return {
    level: 2,
    allowed: true,
    requiresApproval: false,
    reason: "Audited execution",
  };
}
