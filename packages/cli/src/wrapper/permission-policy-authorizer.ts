import type { CapabilityAnnotations, ToolAuthorizer, AuthorityDescriptor } from "@kilnai/core";
import {
  deriveAuthorityFromEffect,
  type ActionEffectEnvelope,
} from "@kilnai/core";
import { CONSERVATIVE_UNKNOWN_ENVELOPE } from "@kilnai/core";
import type { KilnPermissionPolicy } from "./session.js";

function annotationEnvelope(annotations?: CapabilityAnnotations): ActionEffectEnvelope {
  if (!annotations) {
    return CONSERVATIVE_UNKNOWN_ENVELOPE;
  }
  const readOnly = annotations.readOnly === true;
  const destructive = annotations.destructive === true;
  const idempotent = annotations.idempotent === true;
  if (readOnly) {
    return {
      operation: "observe",
      boundaries: ["process", "workspace"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: [],
      idempotency: idempotent ? "idempotent" : "conditionally-idempotent",
    };
  }
  if (destructive) {
    return {
      operation: "mutate",
      boundaries: ["process", "workspace", "machine", "network", "external-system"],
      reversibility: "irreversible",
      dataEgress: "unknown",
      identityUse: "unknown",
      consequences: ["local-state", "security"],
      idempotency: "non-idempotent",
    };
  }
  if (idempotent) {
    return {
      operation: "mutate",
      boundaries: ["process", "workspace"],
      reversibility: "compensatable",
      dataEgress: "none",
      identityUse: "none",
      consequences: ["local-state"],
      idempotency: "idempotent",
    };
  }
  return CONSERVATIVE_UNKNOWN_ENVELOPE;
}

export class PermissionPolicyAuthorizer implements ToolAuthorizer {
  private readonly approval: KilnPermissionPolicy["approval"];

  constructor(policy: KilnPermissionPolicy) {
    this.approval = policy.approval ?? "on-request";
  }

  authorize(toolName: string, annotations?: CapabilityAnnotations, effectEnvelope?: ActionEffectEnvelope): AuthorityDescriptor {
    const envelope = effectEnvelope ?? annotationEnvelope(annotations);

    switch (this.approval) {
      case "never": {
        const result = deriveAuthorityFromEffect(envelope, {
          defaultLevel: envelope.operation === "observe" ? 1 : 2,
          requireApprovalForUnknown: false,
        });
        return { ...result, allowed: true, requiresApproval: false, reason: "approval=never: all tools auto-authorized" };
      }
      case "untrusted":
        return { level: 4, allowed: false, requiresApproval: true, reason: "approval=untrusted: all tools denied without explicit approval" };
      case "on-failure":
      case "on-request": {
        const result = deriveAuthorityFromEffect(envelope, {
          defaultLevel: 3,
          requireApprovalForUnknown: true,
        });
        return { ...result, reason: `${this.approval}: tool "${toolName}" ${result.reason}` };
      }
      default:
        return { level: 3, allowed: false, requiresApproval: true, reason: `Unknown approval mode "${this.approval}"` };
    }
  }
}