// AnnotationAuthorizer: bridges legacy annotation-based authorization
// to canonical action-effect governance.
// The canonical derivation path is deriveAuthorityFromEffect() in action-effect.ts.
// This class remains for backward compatibility during migration.

import type { CapabilityAnnotations } from "../engine/domain/capability.js";
import type { ToolAuthorizer, AuthorityDescriptor, AuthorizationLevel } from "../engine/domain/tool-execution.js";
import {
  deriveAuthorityFromEffect,
  CONSERVATIVE_UNKNOWN_ENVELOPE,
  type ActionEffectEnvelope,
  type ActionEffectPolicy,
} from "../engine/domain/action-effect.js";

export interface AuthorizationPolicy {
  readonly defaultLevel?: AuthorizationLevel;
  readonly requireApprovalForUnknown?: boolean;
}

function annotationEnvelope(annotations?: CapabilityAnnotations): ActionEffectEnvelope {
  if (!annotations) {
    return CONSERVATIVE_UNKNOWN_ENVELOPE;
  }

  const readOnly = annotations.readOnly === true;
  const destructive = annotations.destructive === true;
  const idempotent = annotations.idempotent === true;

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

export class AnnotationAuthorizer implements ToolAuthorizer {
  private readonly policy: Required<AuthorizationPolicy>;

  constructor(policy?: AuthorizationPolicy) {
    this.policy = {
      defaultLevel: policy?.defaultLevel ?? 2,
      requireApprovalForUnknown: policy?.requireApprovalForUnknown ?? false,
    };
  }

  authorize(_toolName: string, annotations?: CapabilityAnnotations, effectEnvelope?: ActionEffectEnvelope): AuthorityDescriptor {
    const envelope = effectEnvelope ?? annotationEnvelope(annotations);
    const effectPolicy: ActionEffectPolicy = {
      defaultLevel: this.policy.defaultLevel as 1 | 2 | 3 | 4,
      requireApprovalForUnknown: this.policy.requireApprovalForUnknown,
    };
    return deriveAuthorityFromEffect(envelope, effectPolicy);
  }
}