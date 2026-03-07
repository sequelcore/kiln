// AnnotationAuthorizer: classifies tool authorization level from capability annotations

import type { CapabilityAnnotations } from "../engine/domain/capability.js";
import type { ToolAuthorizer, ToolAuthorizationResult, AuthorizationLevel } from "../engine/domain/tool-execution.js";

export interface AuthorizationPolicy {
  readonly defaultLevel?: AuthorizationLevel;
  readonly requireApprovalForUnknown?: boolean;
}

export class AnnotationAuthorizer implements ToolAuthorizer {
  private readonly policy: Required<AuthorizationPolicy>;

  constructor(policy?: AuthorizationPolicy) {
    this.policy = {
      defaultLevel: policy?.defaultLevel ?? 2,
      requireApprovalForUnknown: policy?.requireApprovalForUnknown ?? false,
    };
  }

  authorize(toolName: string, annotations?: CapabilityAnnotations): ToolAuthorizationResult {
    const level = this.classifyLevel(annotations);

    if (level === 1) {
      return { level, allowed: true, requiresApproval: false, reason: "Read-only tool, auto-execute" };
    }
    if (level === 2) {
      return { level, allowed: true, requiresApproval: false, reason: "Audited execution" };
    }
    if (level === 3) {
      return { level, allowed: false, requiresApproval: true, reason: `Tool "${toolName}" requires confirmation` };
    }
    // level === 4
    return { level, allowed: false, requiresApproval: true, reason: `Destructive tool "${toolName}" always requires confirmation` };
  }

  private classifyLevel(annotations?: CapabilityAnnotations): AuthorizationLevel {
    if (!annotations) {
      return this.policy.requireApprovalForUnknown ? 3 : this.policy.defaultLevel;
    }

    if (annotations.destructive) return 4;
    if (annotations.readOnly) return 1;
    if (annotations.idempotent) return 2;

    return this.policy.defaultLevel;
  }
}
